import { calculateRepayment, getPolicyStatus, ibrZeroPaymentAgiThreshold } from "./formulas.ts";
import { POLICY_EVIDENCE_CORPUS, POLICY_RULE_REGISTRY, POLICY_SNAPSHOT } from "./constants.ts";
import { getDocumentationTemplate } from "./templates.ts";
import { handleAdvisorApi, handleShareApi } from "./advisor.ts";
import type { D1DatabaseBinding } from "./advisor.ts";
import { retrieveKnowledge } from "./knowledge.ts";
import { synthesizeBorrowerGrounded, type AiBinding } from "./synthesis.ts";
import type {
  AdvisorClientDashboardSummary,
  AdvisorClientRecordV1,
  AdvisorPrincipal,
  CalculatorRequest,
  Region,
  TemplateRequest,
  LoanType,
  LoanDisbursementPeriod,
  StudentAidFactProvenance,
  StudentAidNormalizedLoanFact,
  StudentAidParserDiagnostics,
  StudentAidPortfolioSummary,
  AdvisorConsultationIntent,
  ConsultationHistoryTurnV1
} from "./types.ts";
import { BORROWER_UI_HTML } from "./ui/pages/borrower.ts";
import { ADVISOR_UI_HTML } from "./ui/pages/advisor-workspace.ts";
import { SHARE_UI_HTML } from "./ui/pages/share.ts";

const SERVER_VERSION = "0.9.9";
const SUPPORTED_PROTOCOL_VERSION = "2025-03-26";
const MAX_REQUEST_BYTES = 64 * 1024;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-allow-methods": "GET, POST, OPTIONS"
};

interface RateLimiterBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  MCP_BEARER_TOKEN?: string;
  MCP_ALLOWED_ORIGINS?: string;
  MCP_RATE_LIMITER?: RateLimiterBinding;
  ADVISOR_DB?: D1DatabaseBinding;
  AI?: AiBinding;
  CONSULTATION_MODEL?: string;
}

export function advisorCanAccessClient(principal: AdvisorPrincipal, client: AdvisorClientRecordV1): boolean {
  return principal.status === "active"
    && principal.advisorId.length > 0
    && client.ownerAdvisorId.length > 0
    && principal.advisorId === client.ownerAdvisorId;
}

export function assertAdvisorClientAccess(principal: AdvisorPrincipal, client: AdvisorClientRecordV1): AdvisorClientRecordV1 {
  if (!advisorCanAccessClient(principal, client)) throw new Error("Client not found or not accessible.");
  return client;
}

export function clientDashboardSummary(principal: AdvisorPrincipal, client: AdvisorClientRecordV1): AdvisorClientDashboardSummary {
  const scopedClient = assertAdvisorClientAccess(principal, client);
  return {
    clientId: scopedClient.clientId,
    displayName: scopedClient.contact.displayName,
    lifecycleState: scopedClient.lifecycleState,
    readinessState: scopedClient.readinessState,
    updatedAt: scopedClient.updatedAt
  };
}

type JsonObject = Record<string, unknown>;
type JsonRpcId = string | number | null;
type RuntimeSchema = {
  readonly type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, RuntimeSchema>>;
  readonly items?: RuntimeSchema;
  readonly enum?: readonly unknown[];
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minimum?: number;
  readonly exclusiveMinimum?: number;
  readonly maxLength?: number;
};

class RequestTooLargeError extends Error {}

const loanTypeEnum = [
  "direct_subsidized",
  "direct_unsubsidized",
  "direct_grad_plus",
  "direct_parent_plus",
  "direct_consolidation_no_parent_plus",
  "direct_consolidation_with_parent_plus",
  "ffel_subsidized_stafford",
  "ffel_unsubsidized_stafford",
  "ffel_grad_plus",
  "ffel_parent_plus",
  "ffel_consolidation_no_parent_plus",
  "ffel_consolidation_with_parent_plus",
  "perkins"
] as const;

const toolDefinitions = [
  {
    name: "calculate_alt_income_student_loan",
    description: "Annualize variable taxable income and estimate federal student-loan payments under RAP, IBR, PAYE, and ICR using a versioned 2026 policy snapshot. V0.2 adds explicit loan-type/disbursement eligibility objects and the official 2026 ICR income-percentage-factor table. Estimates only; official eligibility and billing come from Federal Student Aid and the servicer.",
    inputSchema: {
      type: "object",
      required: ["income", "region", "familySize"],
      properties: {
        income: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["cadence"],
            properties: {
              cadence: { enum: ["hourly", "weekly", "biweekly", "semimonthly", "monthly", "annual", "seasonal_lump_sum"] },
              amount: { type: "number", minimum: 0 },
              hourlyRate: { type: "number", minimum: 0 },
              hoursPerWeek: { type: "number", minimum: 0 },
              weeksPerYear: { type: "number", minimum: 0 },
              seasonalPayments: { type: "array", items: { type: "number", minimum: 0 } }
            }
          }
        },
        region: { enum: ["contiguous_us", "alaska", "hawaii"] },
        familySize: { type: "integer", minimum: 1 },
        dependentsClaimedOnFederalTaxReturn: { type: "integer", minimum: 0 },
        estimatedAboveTheLineAdjustments: { type: "number", minimum: 0 },
        adjustedGrossIncomeOverride: { type: "number", minimum: 0 },
        taxFilingStatus: { enum: ["single", "married_filing_jointly", "married_filing_separately", "head_of_household"] },
        loan: {
          type: "object",
          properties: {
            principal: { type: "number", minimum: 0 },
            annualInterestRatePercent: { type: "number", minimum: 0 },
            repaymentLoans: {
              type: "array",
              minItems: 1,
              maxItems: 200,
              items: {
                type: "object",
                required: ["principal", "annualInterestRatePercent"],
                properties: {
                  principal: { type: "number", minimum: 0 },
                  annualInterestRatePercent: { type: "number", minimum: 0 }
                }
              }
            },
            newBorrowerOnOrAfterJuly1_2014: { type: "boolean" },
            hasLoanDisbursedOnOrAfterJuly1_2026: { type: "boolean", description: "Legacy V0.1 compatibility hint. Prefer eligibilityLoans for V0.2 eligibility assessment." },
            icrIncomePercentageFactor: { type: "number", exclusiveMinimum: 0, description: "Optional explicit override. Usually unnecessary in V0.2 because the 2026 official table is built in." },
            icrIncomeFactorCategory: { enum: ["single", "married_or_head_of_household"] },
            payeNewBorrowerOnOrAfterOct1_2007: { type: "boolean" },
            payeDirectLoanDisbursementOnOrAfterOct1_2011: { type: "boolean" },
            eligibilityLoans: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["loanType", "disbursementPeriod"],
                properties: {
                  loanType: { enum: loanTypeEnum },
                  disbursementPeriod: { enum: ["before_2026_07_01", "on_or_after_2026_07_01"] },
                  inDefault: { type: "boolean" },
                  madeIcrPaymentBeforeJuly1_2028: { type: "boolean" }
                }
              }
            }
          }
        },
        plans: { type: "array", items: { enum: ["RAP", "IBR", "PAYE", "ICR"] } }
      }
    }
  },
  {
    name: "get_repayment_documentation_template",
    description: "Generate truthful supporting-statement documents for current taxable income, a significant income change, unemployment compensation income, or no current taxable income. V0.3 accepts structured incomeSources arrays and can render Markdown, plain text, or privacy-safe printable HTML. Missing caller facts remain explicit placeholders.",
    inputSchema: {
      type: "object",
      required: ["templateType"],
      properties: {
        templateType: { enum: ["current_income_statement", "income_change_explanation", "unemployment_income_statement", "no_current_taxable_income_statement"] },
        outputFormat: { enum: ["markdown", "text", "html"], description: "Defaults to markdown." },
        documentDate: { type: "string", description: "Optional caller-supplied display date. Omitted dates remain [date]." },
        borrowerName: { type: "string" },
        servicerName: { type: "string" },
        incomeSources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sourceType: { enum: ["employment", "self_employment", "contract", "unemployment", "other"] },
              name: { type: "string" },
              address: { type: "string" },
              grossAmount: { type: "number", minimum: 0 },
              paymentFrequency: { type: "string" },
              notes: { type: "string" }
            }
          }
        },
        incomeSourceName: { type: "string", description: "Legacy single-source compatibility field. Prefer incomeSources." },
        incomeSourceAddress: { type: "string", description: "Legacy single-source compatibility field. Prefer incomeSources." },
        paymentFrequency: { type: "string", description: "Legacy single-source compatibility field. Prefer incomeSources." },
        grossAmount: { type: "number", minimum: 0, description: "Legacy single-source compatibility field. Prefer incomeSources." },
        notes: { type: "string" }
      }
    }
  },
  {
    name: "policy_status",
    description: "Report the calculator's immutable policy snapshot date, supported repayment plans, known PAYE/ICR sunset dates, the effective period of the built-in 2026 ICR factor table, and official source links.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
] as const;

export const STUDENTAID_MAPPING_VERSION = "2026-09-05-v2";

type ParsedStudentAidBorrower = {
  displayName?: string;
  email?: string;
  phone?: string;
  streetAddress1?: string;
  streetAddress2?: string;
  city?: string;
  stateCode?: string;
  countryCode?: string;
  zipCode?: string;
  provenance: Record<string, StudentAidFactProvenance>;
};

export type ParsedStudentAidPortfolio = {
  fileRequestDate?: string;
  borrower: ParsedStudentAidBorrower;
  loans: StudentAidNormalizedLoanFact[];
  repaymentLoans: Array<{ principal: number; annualInterestRatePercent: number }>;
  eligibilityLoans?: Array<{ loanType: LoanType; disbursementPeriod: LoanDisbursementPeriod; inDefault?: boolean }>;
  summary: StudentAidPortfolioSummary;
  totalPrincipal: number;
  totalInterest: number;
  ambiguousCount: number;
  diagnostics: StudentAidParserDiagnostics;
};

function studentAidNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function studentAidDateToPeriod(value: string | undefined): LoanDisbursementPeriod | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const timestamp = match
    ? Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]))
    : Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return timestamp >= Date.UTC(2026, 6, 1) ? "on_or_after_2026_07_01" : "before_2026_07_01";
}

function studentAidDateTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const timestamp = match
    ? Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]))
    : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function latestStudentAidStatus(statuses: Array<{ code?: string; description?: string; effectiveDate?: string }>): { code?: string; description?: string; effectiveDate?: string } | undefined {
  let latest: { code?: string; description?: string; effectiveDate?: string } | undefined;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  for (const status of statuses) {
    const timestamp = studentAidDateTimestamp(status.effectiveDate);
    if (timestamp !== undefined && timestamp > latestTimestamp) {
      latest = status;
      latestTimestamp = timestamp;
    }
  }
  return latest ?? statuses[0];
}

function studentAidYes(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  if (["Y", "YES", "TRUE", "1"].includes(normalized)) return true;
  if (["N", "NO", "FALSE", "0"].includes(normalized)) return false;
  return undefined;
}

function maskStudentAidIdentifier(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const visible = normalized.slice(-4);
  return `••••${visible}`;
}

function mapStudentAidLoanType(code: string | undefined, description: string | undefined, parentPlusIndicator?: string): LoanType | undefined {
  const c = String(code || "").trim().toUpperCase();
  const d = String(description || "").trim().toUpperCase();
  const hasParentPlus = studentAidYes(parentPlusIndicator);
  if (["D0", "D1"].includes(c)) return "direct_subsidized";
  if (["D2", "D8"].includes(c)) return "direct_unsubsidized";
  if (c === "D3") return "direct_grad_plus";
  if (c === "D4") return "direct_parent_plus";
  if (["D5", "D6", "D9"].includes(c)) {
    if (hasParentPlus === true) return "direct_consolidation_with_parent_plus";
    if (hasParentPlus === false) return "direct_consolidation_no_parent_plus";
    return undefined;
  }
  if (c === "GB") return "ffel_grad_plus";
  if (c === "PL") return "ffel_parent_plus";
  if (c === "SF") return "ffel_subsidized_stafford";
  if (["SU", "SN"].includes(c)) return "ffel_unsubsidized_stafford";
  if (c === "CL") {
    if (hasParentPlus === true) return "ffel_consolidation_with_parent_plus";
    if (hasParentPlus === false) return "ffel_consolidation_no_parent_plus";
    return undefined;
  }
  if (["PU", "DU", "NU"].includes(c) || d.includes("PERKINS")) return "perkins";
  const isDirect = d.includes("DIRECT");
  const isFfel = d.includes("FFEL") || d.includes("FEDERAL STAFFORD");
  if (d.includes("CONSOLIDAT")) return undefined;
  if (isDirect) {
    if (d.includes("PARENT") && d.includes("PLUS")) return "direct_parent_plus";
    if ((d.includes("GRAD") || d.includes("PROFESSIONAL")) && d.includes("PLUS")) return "direct_grad_plus";
    if (d.includes("UNSUBSID")) return "direct_unsubsidized";
    if (d.includes("SUBSID")) return "direct_subsidized";
  }
  if (isFfel) {
    if (d.includes("PARENT") && d.includes("PLUS")) return "ffel_parent_plus";
    if ((d.includes("GRAD") || d.includes("PROFESSIONAL")) && d.includes("PLUS")) return "ffel_grad_plus";
    if (d.includes("UNSUBSID") || d.includes("NON-SUBSID")) return "ffel_unsubsidized_stafford";
    if (d.includes("SUBSID")) return "ffel_subsidized_stafford";
  }
  return undefined;
}

function studentAidPreferredPhone(student: Record<string, string>): string | undefined {
  const candidates = [
    ["Student Cell Phone Number", "Student Cell Phone Country Code", "Student Cell Phone Preferred"],
    ["Student Home Phone Number", "Student Home Phone Country Code", "Student Home Phone Preferred"],
    ["Student Work Phone Number", "Student Work Phone Country Code", "Student Work Phone Preferred"]
  ] as const;
  const preferred = candidates.find(([numberKey, , preferredKey]) => student[numberKey] && studentAidYes(student[preferredKey]) === true);
  const chosen = preferred ?? candidates.find(([numberKey]) => student[numberKey]);
  if (!chosen) return undefined;
  const number = student[chosen[0]]?.trim();
  const country = student[chosen[1]]?.trim();
  return [country ? `+${country.replace(/^\+/, "")}` : "", number].filter(Boolean).join(" ") || undefined;
}

export function parseStudentAidDataText(text: string): ParsedStudentAidPortfolio {
  const student: Record<string, string> = {};
  const rawLoans: any[] = [];
  const rawLines = text.split(/\r?\n/);
  const tokens = rawLines.flatMap((rawLine, lineIndex) => {
    const separator = rawLine.indexOf(":");
    if (separator < 0) return [];
    return [{ lineNumber: lineIndex + 1, key: rawLine.slice(0, separator).trim(), value: rawLine.slice(separator + 1).trim() }];
  });
  const hasAwardAnchors = tokens.some((token) => token.key === "Loan Award ID");
  const firstAwardIndex = tokens.findIndex((token) => token.key === "Loan Award ID");
  const firstTypeIndex = tokens.findIndex((token) => token.key === "Loan Type Code" || token.key === "Loan Type");
  const awardFirstLayout = hasAwardAnchors && (firstTypeIndex < 0 || firstAwardIndex < firstTypeIndex);
  const recognizedLabels = new Set<string>();
  const unmappedLabels = new Set<string>();
  const structuralWarnings: string[] = [];
  const validationIssues: string[] = [];
  let fileRequestDate: string | undefined;
  let current: any = null;
  let currentStatus: any = null;
  let currentDisbursement: any = null;
  let currentDelinquency: any = null;
  let currentContact: any = null;
  const newLoan = () => ({ statuses: [], disbursements: [], delinquencies: [], contacts: [], provenance: {} });
  const ensureCurrent = () => { if (!current) current = newLoan(); return current; };
  const pushCurrent = () => { if (current) rawLoans.push(current); current = null; currentStatus = null; currentDisbursement = null; currentDelinquency = null; currentContact = null; };
  const textFields: Record<string, string> = {
    "Loan Attending School Name": "attendingSchoolName",
    "Loan Attending School OPEID": "attendingSchoolOpeid",
    "Loan Date": "loanDate",
    "Loan Repayment Begin Date": "repaymentBeginDate",
    "Loan Period Begin Date": "periodBeginDate",
    "Loan Period End Date": "periodEndDate",
    "Loan Canceled Date": "canceledDate",
    "Loan Outstanding Principal Balance as of Date": "outstandingPrincipalAsOfDate",
    "Loan Outstanding Interest Balance as of Date": "outstandingInterestAsOfDate",
    "Loan Interest Rate Type Code": "interestRateTypeCode",
    "Loan Interest Rate Type Description": "interestRateTypeDescription",
    "Loan Repayment Plan Type Code": "repaymentPlanTypeCode",
    "Loan Repayment Plan Type Code Description": "repaymentPlanDescription",
    "Loan Repayment Plan Begin Date": "repaymentPlanBeginDate",
    "Loan Repayment Plan IDR Plan Anniversary Date": "repaymentPlanIdrAnniversaryDate",
    "Loan Confirmed Subsidy Status": "confirmedSubsidyStatus",
    "Loan Reaffirmation Date": "reaffirmationDate",
    "Loan Most Recent Payment Effective Date": "mostRecentPaymentEffectiveDate",
    "Loan Next Payment Due Date": "nextPaymentDueDate",
    "Academic Level": "academicLevel",
    "Award Year": "awardYear",
    "Reaffirmation flag": "reaffirmationFlag",
    "UpdtDt": "updateDate",
    "Loan Updated Date": "updateDate",
    "Additional Unsubsidized Loan Flag": "additionalUnsubsidizedLoanFlag",
    "Joint Consolidation Loan Indicator": "jointConsolidationLoanIndicator",
    "Joint Consolidation Loan Separation Indicator": "jointConsolidationLoanSeparationIndicator",
    "Loan Special Contact Reason": "loanSpecialContactReason",
    "Loan Special Contact": "loanSpecialContact",
    "Current Loan Status": "currentLoanStatusCode",
    "Current Loan Status Description": "currentLoanStatusDescription",
    "Parent Plus First Level Consolidation Indicator": "parentPlusFirstLevelConsolidationIndicator",
    "Consolidation Loan With Any Parent Plus Indicator": "consolidationLoanWithAnyParentPlusIndicator"
  };
  const numericFields: Record<string, string> = {
    "Loan Amount": "originalAmount",
    "Loan Disbursed Amount": "disbursedAmount",
    "Loan Canceled Amount": "canceledAmount",
    "Loan Outstanding Principal Balance": "outstandingPrincipal",
    "Loan Outstanding Interest Balance": "outstandingInterest",
    "Loan Interest Rate": "interestRatePercent",
    "Loan Actual Interest Rate": "actualInterestRatePercent",
    "Loan Statutory Interest Rate": "statutoryInterestRatePercent",
    "Loan Repayment Plan Scheduled Amount": "repaymentPlanScheduledAmount",
    "Loan Subsidized Usage in Years": "subsidizedUsageYears",
    "Loan Cumulative Payment Amount": "cumulativePaymentAmount",
    "Loan PSLF Cumulative Matched Months": "pslfCumulativeMatchedMonths",
    "Capitalized Interest": "capitalizedInterest",
    "Net Loan Amount": "netLoanAmount",
    "Calculated Subsidized Aggregate OPB": "calculatedSubsidizedAggregateOpb",
    "Calculated Unsubsidized Aggregate OPB": "calculatedUnsubsidizedAggregateOpb",
    "Calculated Combined Aggregate OPB": "calculatedCombinedAggregateOpb",
    "Highest Historical Outstanding Principal Balance (OPB)": "highestHistoricalOutstandingPrincipalBalance",
    "Current Standard-Standard Schedule Payment Amount": "currentStandardSchedulePaymentAmount",
    "Permanent Standard-Standard Schedule Payment Amount": "permanentStandardSchedulePaymentAmount"
  };

  for (const token of tokens) {
    const { key, value, lineNumber } = token;
    if (!key) continue;
    if (key === "File Request Date") { recognizedLabels.add(key); fileRequestDate = value || undefined; continue; }
    if (key.startsWith("Student ") || key.startsWith("Grant ")) { recognizedLabels.add(key); if (key.startsWith("Student ")) student[key] = value; continue; }
    if (key === "Loan Award ID") {
      recognizedLabels.add(key);
      if (!current) current = newLoan();
      else if (current.__hasAwardAnchor) { pushCurrent(); current = newLoan(); }
      current.__hasAwardAnchor = true;
      const masked = maskStudentAidIdentifier(value);
      if (masked) { current.maskedAwardId = masked; current.provenance.maskedAwardId = "derived_studentaid"; }
      continue;
    }
    if ((!hasAwardAnchors || !awardFirstLayout) && (key === "Loan Type Code" || key === "Loan Type")) {
      recognizedLabels.add(key);
      pushCurrent();
      current = newLoan();
      current[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = value || undefined;
      if (value) current.provenance[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = "imported_studentaid";
      continue;
    }
    if (key === "Loan Type Code" || key === "Loan Type") { recognizedLabels.add(key); const loan = ensureCurrent(); loan[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = value || undefined; if (value) loan.provenance[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = "imported_studentaid"; continue; }
    if (key === "Loan Type Description") { recognizedLabels.add(key); const loan = ensureCurrent(); loan.loanTypeDescription = value || undefined; if (value) loan.provenance.loanTypeDescription = "imported_studentaid"; continue; }
    if (textFields[key]) { recognizedLabels.add(key); const loan = ensureCurrent(); loan[textFields[key]] = value || undefined; if (value) loan.provenance[textFields[key]] = "imported_studentaid"; continue; }
    if (numericFields[key]) { recognizedLabels.add(key); const loan = ensureCurrent(); const number = studentAidNumber(value); if (number !== undefined) { loan[numericFields[key]] = number; loan.provenance[numericFields[key]] = "imported_studentaid"; } continue; }
    if (key === "Loan Delinquency Date" || key === "DelinqDate") { recognizedLabels.add(key); const loan = ensureCurrent(); currentDelinquency = { date: value || undefined }; loan.delinquencies.push(currentDelinquency); loan.delinquencyDate = value || undefined; if (value) loan.provenance.delinquencyDate = "imported_studentaid"; continue; }
    if (key === "Loan Delinquency End Date") { recognizedLabels.add(key); const loan = ensureCurrent(); loan.delinquencyEndDate = value || undefined; if (value) loan.provenance.delinquencyEndDate = "imported_studentaid"; if (currentDelinquency) currentDelinquency.endDate = value || undefined; else structuralWarnings.push(`Line ${lineNumber}: Loan Delinquency End Date appeared without a preceding delinquency start date.`); continue; }
    if (key === "Loan Status") { recognizedLabels.add(key); const loan = ensureCurrent(); currentStatus = { code: value || undefined }; loan.statuses.push(currentStatus); continue; }
    if (key === "Loan Status Description") { recognizedLabels.add(key); if (currentStatus) currentStatus.description = value || undefined; else structuralWarnings.push(`Line ${lineNumber}: Loan Status Description appeared without a preceding Loan Status.`); continue; }
    if (key === "Loan Status Effective Date") { recognizedLabels.add(key); if (currentStatus) currentStatus.effectiveDate = value || undefined; else structuralWarnings.push(`Line ${lineNumber}: Loan Status Effective Date appeared without a preceding Loan Status.`); continue; }
    if (key === "Loan Disbursement Date") { recognizedLabels.add(key); const loan = ensureCurrent(); currentDisbursement = { date: value || undefined }; loan.disbursements.push(currentDisbursement); continue; }
    if (key === "Loan Disbursement Amount") { recognizedLabels.add(key); if (currentDisbursement) currentDisbursement.amount = studentAidNumber(value); else structuralWarnings.push(`Line ${lineNumber}: Loan Disbursement Amount appeared without a preceding disbursement date.`); continue; }
    if (key === "Loan Contact Type") { recognizedLabels.add(key); const loan = ensureCurrent(); currentContact = { type: value || undefined }; loan.contacts.push(currentContact); continue; }
    if (key.startsWith("Loan Contact ")) {
      const contactFields: Record<string, string> = { "Loan Contact Code":"code", "Loan Contact Name":"name", "Loan Contact Street Address 1":"streetAddress1", "Loan Contact Street Address 2":"streetAddress2", "Loan Contact City":"city", "Loan Contact State Code":"stateCode", "Loan Contact Zip Code":"zipCode", "Loan Contact Phone Number":"phoneNumber", "Loan Contact Phone Extension":"phoneExtension", "Loan Contact Email Address":"emailAddress", "Loan Contact Web Site Address":"websiteAddress" };
      if (contactFields[key]) { recognizedLabels.add(key); if (currentContact) currentContact[contactFields[key]] = value || undefined; else structuralWarnings.push(`Line ${lineNumber}: ${key} appeared without a preceding Loan Contact Type.`); }
      else unmappedLabels.add(key);
      continue;
    }
    if (key === "Most Relevant") { recognizedLabels.add(key); if (currentContact) currentContact.mostRelevant = studentAidYes(value) === true; else structuralWarnings.push(`Line ${lineNumber}: Most Relevant appeared without a preceding Loan Contact Type.`); continue; }
    unmappedLabels.add(key);
  }
  pushCurrent();
  if (!hasAwardAnchors && rawLoans.length) structuralWarnings.push("Loan Award ID anchors were not present; parser used the conservative legacy loan-boundary fallback.");
  if (!rawLoans.length) validationIssues.push("No loan records were assembled from the StudentAid data.");

  const loans = rawLoans.map((raw, index): StudentAidNormalizedLoanFact => {
    const dateForPeriod = raw.disbursements.find((item: any) => item.date)?.date || raw.loanDate;
    const mappedLoanType = mapStudentAidLoanType(raw.loanTypeCode, raw.loanTypeDescription, raw.consolidationLoanWithAnyParentPlusIndicator);
    const disbursementPeriod = studentAidDateToPeriod(dateForPeriod);
    const newestStatus = latestStudentAidStatus(raw.statuses || []);
    const explicitCode = String(raw.currentLoanStatusCode || "").trim().toUpperCase();
    const explicitDescription = String(raw.currentLoanStatusDescription || "").trim().toUpperCase();
    const newestCode = String(newestStatus?.code || "").trim().toUpperCase();
    const newestDescription = String(newestStatus?.description || "").trim().toUpperCase();
    if ((explicitCode && newestCode && explicitCode !== newestCode) || (explicitDescription && newestDescription && explicitDescription !== newestDescription)) structuralWarnings.push(`Loan ${index + 1}: explicit current status differs from the newest dated status timeline entry.`);
    const statusDescription = explicitDescription || newestDescription;
    const inDefault = statusDescription.includes("DEFAULT") && !statusDescription.includes("NON-DEFAULT");
    const provenance = { ...(raw.provenance || {}) } as Record<string, StudentAidFactProvenance>;
    if (mappedLoanType) provenance.mappedLoanType = "derived_studentaid";
    if (disbursementPeriod) provenance.disbursementPeriod = "derived_studentaid";
    provenance.inDefault = "derived_studentaid";
    const { __hasAwardAnchor: _hasAwardAnchor, ...normalizedRaw } = raw;
    return { ...normalizedRaw, loanIndex: index, ...(mappedLoanType ? { mappedLoanType } : {}), ...(disbursementPeriod ? { disbursementPeriod } : {}), ...(inDefault ? { inDefault: true } : {}), provenance };
  });
  const active = loans.filter((loan) => typeof loan.outstandingPrincipal === "number" && loan.outstandingPrincipal > 0);
  const repaymentLoans = active.filter((loan) => typeof loan.interestRatePercent === "number").map((loan) => ({ principal: loan.outstandingPrincipal!, annualInterestRatePercent: loan.interestRatePercent! }));
  const fullyMappedForEligibility = active.length > 0 && active.every((loan) => loan.mappedLoanType && loan.disbursementPeriod);
  const eligibilityLoans = fullyMappedForEligibility ? active.map((loan) => ({ loanType: loan.mappedLoanType!, disbursementPeriod: loan.disbursementPeriod!, ...(loan.inDefault ? { inDefault: true } : {}) })) : undefined;
  const totalPrincipal = active.reduce((sum, loan) => sum + (loan.outstandingPrincipal || 0), 0);
  const totalInterest = active.reduce((sum, loan) => sum + (loan.outstandingInterest || 0), 0);
  const ambiguousCount = active.filter((loan) => !loan.mappedLoanType || !loan.disbursementPeriod).length;
  const summary: StudentAidPortfolioSummary = { loanCount: loans.length, activeLoanCount: active.length, totalOutstandingPrincipal: totalPrincipal, totalOutstandingInterest: totalInterest, repaymentLoanCount: repaymentLoans.length, eligibilityMappedLoanCount: active.length - ambiguousCount, ambiguousEligibilityLoanCount: ambiguousCount, hasLoanDisbursedOnOrAfterJuly1_2026: active.some((loan) => loan.disbursementPeriod === "on_or_after_2026_07_01") };
  const nameParts = [student["Student First Name"], student["Student Middle Initial"], student["Student Last Name"]].map((value) => value?.trim()).filter(Boolean);
  const borrower: ParsedStudentAidBorrower = { provenance: {} };
  const borrowerFields: Array<[keyof ParsedStudentAidBorrower, string | undefined]> = [
    ["displayName", nameParts.join(" ") || undefined], ["email", student["Student Email Address"]], ["phone", studentAidPreferredPhone(student)], ["streetAddress1", student["Student Street Address 1"]], ["streetAddress2", student["Student Street Address 2"]], ["city", student["Student City"]], ["stateCode", student["Student State Code"]], ["countryCode", student["Student Country Code"]], ["zipCode", student["Student Zip Code"]]
  ];
  for (const [field, rawValue] of borrowerFields) {
    const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    if (value) { (borrower as any)[field] = value; borrower.provenance[String(field)] = "imported_studentaid"; }
  }
  const diagnostics: StudentAidParserDiagnostics = {
    mappingVersion: STUDENTAID_MAPPING_VERSION,
    rawLineCount: rawLines.length,
    parsedLineCount: tokens.length,
    recognizedLabelCount: recognizedLabels.size,
    unmappedLabels: [...unmappedLabels].filter(Boolean).sort(),
    structuralWarnings,
    validationIssues
  };
  return { ...(fileRequestDate ? { fileRequestDate } : {}), borrower, loans, repaymentLoans, ...(eligibilityLoans ? { eligibilityLoans } : {}), summary, totalPrincipal, totalInterest, ambiguousCount, diagnostics };
}


function shareUiResponse(): Response {
  return new Response(SHARE_UI_HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-src https://cal.com https://app.cal.com; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    }
  });
}

function advisorUiResponse(): Response {
  return new Response(ADVISOR_UI_HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    }
  });
}

function ibrZeroPaymentResponse(request: Request, env: Env): Response {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return jsonResponse({ ok: false, error: "Cross-origin quick-info requests are not allowed." }, 403, request, env, { "cache-control": "no-store" });
  }
  const region = new URL(request.url).searchParams.get("region") ?? "contiguous_us";
  if (!(["contiguous_us", "alaska", "hawaii"] as const).includes(region as Region)) {
    return jsonResponse({ ok: false, error: "Unknown poverty-guideline region." }, 400, request, env, { "cache-control": "no-store" });
  }
  const typedRegion = region as Region;
  const regionLabel = typedRegion === "contiguous_us" ? "48 states + D.C." : typedRegion === "alaska" ? "Alaska" : "Hawaii";
  const thresholds = Array.from({ length: 6 }, (_, index) => ({
    familySize: index + 1,
    maxAgiForZeroPayment: ibrZeroPaymentAgiThreshold(typedRegion, index + 1)
  }));
  return jsonResponse({
    ok: true,
    plan: "IBR",
    policySnapshot: "2026-08-27",
    region: typedRegion,
    regionLabel,
    rule: "Estimated IBR payment is $0 when the AGI used for IBR is at or below 150% of the applicable poverty guideline.",
    thresholds
  }, 200, request, env, { "cache-control": "no-store" });
}

function uiResponse(): Response {
  return new Response(BORROWER_UI_HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    }
  });
}

async function handleDocumentApi(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return jsonResponse({ ok: false, error: "Cross-origin document requests are not allowed." }, 403, request, env, { "cache-control": "no-store" });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return jsonResponse({ ok: false, error: "Content-Type must be application/json." }, 415, request, env, { "cache-control": "no-store" });
  }

  if (env.MCP_RATE_LIMITER) {
    try {
      const { success } = await env.MCP_RATE_LIMITER.limit({ key: "public:/api/document" });
      if (!success) return jsonResponse({ ok: false, error: "Rate limit exceeded." }, 429, request, env, { "cache-control": "no-store" });
    } catch {
      return jsonResponse({ ok: false, error: "Rate limiter unavailable." }, 503, request, env, { "cache-control": "no-store" });
    }
  }

  let text: string;
  try {
    text = (await readRequestText(request)).text;
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return jsonResponse({ ok: false, error: `Request body exceeds ${MAX_REQUEST_BYTES} bytes.` }, 413, request, env, { "cache-control": "no-store" });
    }
    return jsonResponse({ ok: false, error: "Unable to read request body." }, 400, request, env, { "cache-control": "no-store" });
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON." }, 400, request, env, { "cache-control": "no-store" });
  }

  const documentDefinition = toolDefinitions.find((tool) => tool.name === "get_repayment_documentation_template")!;
  const issues = validateSchema(body, documentDefinition.inputSchema as RuntimeSchema);
  if (issues.length > 0) {
    return jsonResponse({ ok: false, error: "Invalid document input.", issues }, 400, request, env, { "cache-control": "no-store" });
  }

  try {
    const requestBody = body as TemplateRequest;
    return jsonResponse({ ok: true, format: requestBody.outputFormat ?? "markdown", document: getDocumentationTemplate(requestBody) }, 200, request, env, { "cache-control": "no-store" });
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Document generation failed." }, 400, request, env, { "cache-control": "no-store" });
  }
}

async function handleCalculatorApi(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return jsonResponse({ ok: false, error: "Cross-origin calculator requests are not allowed." }, 403, request, env, { "cache-control": "no-store" });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return jsonResponse({ ok: false, error: "Content-Type must be application/json." }, 415, request, env, { "cache-control": "no-store" });
  }

  if (env.MCP_RATE_LIMITER) {
    try {
      const { success } = await env.MCP_RATE_LIMITER.limit({ key: "public:/api/calculate" });
      if (!success) return jsonResponse({ ok: false, error: "Rate limit exceeded." }, 429, request, env, { "cache-control": "no-store" });
    } catch {
      return jsonResponse({ ok: false, error: "Rate limiter unavailable." }, 503, request, env, { "cache-control": "no-store" });
    }
  }

  let text: string;
  try {
    text = (await readRequestText(request)).text;
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return jsonResponse({ ok: false, error: `Request body exceeds ${MAX_REQUEST_BYTES} bytes.` }, 413, request, env, { "cache-control": "no-store" });
    }
    return jsonResponse({ ok: false, error: "Unable to read request body." }, 400, request, env, { "cache-control": "no-store" });
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON." }, 400, request, env, { "cache-control": "no-store" });
  }

  const calculatorDefinition = toolDefinitions.find((tool) => tool.name === "calculate_alt_income_student_loan")!;
  const issues = validateSchema(body, calculatorDefinition.inputSchema as RuntimeSchema);
  if (issues.length > 0) {
    return jsonResponse({ ok: false, error: "Invalid calculator input.", issues }, 400, request, env, { "cache-control": "no-store" });
  }

  try {
    return jsonResponse({ ok: true, result: calculateRepayment(body as CalculatorRequest) }, 200, request, env, { "cache-control": "no-store" });
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Calculation failed." }, 400, request, env, { "cache-control": "no-store" });
  }
}

type BorrowerConsultationIntent = "estimate_summary" | "eligibility_review" | "plan_comparison" | "policy_explanation";
function borrowerRetrievalText(value: string): string { return value.toLowerCase().replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim(); }
function borrowerRetrievalTokens(value: string): string[] { return [...new Set(borrowerRetrievalText(value).split(" ").filter((token) => token.length >= 2))]; }
function borrowerConsultationIntent(question: string): BorrowerConsultationIntent {
  const q = borrowerRetrievalText(question);
  if (/parent plus|ffel|perkins|consolidat|eligib|loan type|disbursement/.test(q)) return "eligibility_review";
  if (/lowest|monthly payment|compare|comparison|forgiveness|repayment path|modeled payment/.test(q)) return "plan_comparison";
  if (/policy|rule|save|repaye|paye|icr|ibr|rap|why|pslf|public service|default|rehabilitat|recertif/.test(q)) return "policy_explanation";
  return "estimate_summary";
}
function borrowerKnowledgeIntent(intent: BorrowerConsultationIntent): AdvisorConsultationIntent { return intent === "estimate_summary" ? "case_summary" : intent; }
function borrowerConsultationHistory(value: unknown): ConsultationHistoryTurnV1[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6) throw new Error("Consultation history must contain at most six turns.");
  let total = 0;
  return value.map((turn, index) => {
    if (!isObject(turn) || (turn.role !== "user" && turn.role !== "assistant") || typeof turn.content !== "string") throw new Error(`Consultation history turn ${index + 1} is invalid.`);
    const content = turn.content.trim();
    if (!content || content.length > 1600) throw new Error(`Consultation history turn ${index + 1} must be between 1 and 1600 characters.`);
    total += content.length;
    if (total > 7000) throw new Error("Consultation history is too large.");
    return { role: turn.role, content };
  });
}
function borrowerLexicalScore(question: string, keywords: readonly string[], extra = ""): number {
  const normalizedQuestion = borrowerRetrievalText(question);
  const tokens = new Set(borrowerRetrievalTokens(question));
  let score = 0;
  for (const keyword of keywords) {
    const normalized = borrowerRetrievalText(keyword);
    if (normalized && normalizedQuestion.includes(normalized)) score += normalized.includes(" ") ? 6 : 4;
    for (const token of borrowerRetrievalTokens(keyword)) if (tokens.has(token)) score += 1;
  }
  for (const token of borrowerRetrievalTokens(extra)) if (tokens.has(token)) score += 0.5;
  return score;
}
function borrowerPolicyEvidence(question: string, intent: BorrowerConsultationIntent) {
  const ranked = POLICY_EVIDENCE_CORPUS
    .filter((entry) => entry.policySnapshot === POLICY_SNAPSHOT)
    .map((entry) => ({ entry, score: borrowerLexicalScore(question, entry.keywords, entry.title) }))
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  const selected = ranked.filter((candidate) => candidate.score > 0).slice(0, 4).map((candidate) => candidate.entry);
  if (selected.length) return selected;
  return intent === "estimate_summary" ? [] : POLICY_EVIDENCE_CORPUS.filter((entry) => entry.policySnapshot === POLICY_SNAPSHOT).slice(0, 2);
}
function borrowerPolicyRules(question: string, evidenceIds: Set<string>, intent: BorrowerConsultationIntent) {
  return POLICY_RULE_REGISTRY
    .filter((rule) => rule.policySnapshot === POLICY_SNAPSHOT)
    .map((rule) => ({ rule, score: borrowerLexicalScore(question, rule.keywords, `${rule.title} ${rule.programs.join(" ")} ${rule.loanFamilies.join(" ")}`) + rule.evidenceChunkIds.filter((id) => evidenceIds.has(id)).length * 4 }))
    .filter((candidate) => candidate.score > 0 || intent !== "estimate_summary")
    .sort((a, b) => b.score - a.score || a.rule.id.localeCompare(b.rule.id)).slice(0, 4).map((candidate) => candidate.rule);
}
function borrowerConsultationAnswer(question: string, result: ReturnType<typeof calculateRepayment>, intent: BorrowerConsultationIntent, evidenceIds: string[]): string {
  const citations = evidenceIds.length ? ` Policy evidence: ${evidenceIds.map((id) => `[${id}]`).join(" ")}.` : "";
  if (intent === "plan_comparison") {
    const candidates = result.planEstimates.filter((plan) => plan.eligibility.status !== "ineligible" && typeof plan.monthlyPaymentEstimate === "number");
    if (candidates.length) {
      const lowest = [...candidates].sort((a, b) => a.monthlyPaymentEstimate - b.monthlyPaymentEstimate)[0]!;
      return `${lowest.plan} has the lowest modeled monthly payment among the currently non-ineligible options at $${lowest.monthlyPaymentEstimate.toFixed(2)} per month. This is an estimate, not an official billing or eligibility decision.${citations}`;
    }
  }
  if (intent === "eligibility_review") {
    const summary = result.planEstimates.map((plan) => `${plan.plan}: ${plan.eligibility.status}`).join("; ");
    return `The deterministic calculator currently screens the selected plans as ${summary}. Loan-family, disbursement, default, and consolidation facts drive those code-owned results; retrieved policy evidence only explains them.${citations}`;
  }
  if (intent === "policy_explanation") {
    return `This explanation is pinned to policy snapshot ${POLICY_SNAPSHOT}. Deterministic code remains authoritative for payment math and eligibility screening; reviewed policy evidence is grounding only.${citations}`;
  }
  const payments = result.planEstimates.map((plan) => `${plan.plan}: $${plan.monthlyPaymentEstimate.toFixed(2)}/mo (${plan.eligibility.status})`).join("; ");
  return `Your current private-session estimate uses an estimated AGI of $${result.estimatedAdjustedGrossIncome.toFixed(2)}. Modeled payments: ${payments}. Nothing from this consultation is saved.`;
}
async function handleBorrowerConsultationApi(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) return jsonResponse({ ok:false, error:"Cross-origin consultation requests are not allowed." }, 403, request, env, { "cache-control":"no-store" });
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) return jsonResponse({ ok:false, error:"Content-Type must be application/json." }, 415, request, env, { "cache-control":"no-store" });
  if (env.MCP_RATE_LIMITER) {
    try { const { success } = await env.MCP_RATE_LIMITER.limit({ key:"public:/api/consultation" }); if (!success) return jsonResponse({ok:false,error:"Rate limit exceeded."},429,request,env,{"cache-control":"no-store"}); }
    catch { return jsonResponse({ok:false,error:"Rate limiter unavailable."},503,request,env,{"cache-control":"no-store"}); }
  }
  let text: string;
  try { text = (await readRequestText(request)).text; }
  catch (error) { return jsonResponse({ok:false,error:error instanceof RequestTooLargeError?`Request body exceeds ${MAX_REQUEST_BYTES} bytes.`:"Unable to read request body."},error instanceof RequestTooLargeError?413:400,request,env,{"cache-control":"no-store"}); }
  let body: unknown;
  try { body = JSON.parse(text) as unknown; } catch { return jsonResponse({ok:false,error:"Invalid JSON."},400,request,env,{"cache-control":"no-store"}); }
  const calculatorDefinition = toolDefinitions.find((tool) => tool.name === "calculate_alt_income_student_loan")!;
  const consultationSchema: RuntimeSchema = { type:"object", required:["question","calculator"], properties:{ question:{type:"string",maxLength:2000}, policySnapshot:{type:"string"}, calculator:calculatorDefinition.inputSchema as RuntimeSchema, history:{type:"array",maxItems:6,items:{type:"object",required:["role","content"],properties:{role:{enum:["user","assistant"]},content:{type:"string",maxLength:1600}}}} } };
  const issues = validateSchema(body, consultationSchema, "$.body");
  if (issues.length) return jsonResponse({ok:false,error:"Invalid borrower consultation input.",issues},400,request,env,{"cache-control":"no-store"});
  const input = body as { question:string; policySnapshot?:string; calculator:CalculatorRequest; history?:ConsultationHistoryTurnV1[] };
  const question = input.question.trim();
  if (!question) return jsonResponse({ok:false,error:"Consultation question is required."},400,request,env,{"cache-control":"no-store"});
  if (input.policySnapshot !== undefined && input.policySnapshot !== POLICY_SNAPSHOT) return jsonResponse({ok:false,error:`Requested policy snapshot ${input.policySnapshot} is not the current accepted snapshot ${POLICY_SNAPSHOT}.`},409,request,env,{"cache-control":"no-store"});
  try {
    const history = borrowerConsultationHistory(input.history);
    const result = calculateRepayment(input.calculator);
    const intent = borrowerConsultationIntent(question);
    const evidence = borrowerPolicyEvidence(question,intent);
    const evidenceIds = new Set(evidence.map((entry) => entry.id));
    const rules = borrowerPolicyRules(question,evidenceIds,intent);
    if (evidence.some((entry) => entry.policySnapshot !== POLICY_SNAPSHOT) || rules.some((rule) => rule.policySnapshot !== POLICY_SNAPSHOT)) return jsonResponse({ok:false,error:"Policy retrieval attempted to use evidence outside the current accepted snapshot."},409,request,env,{"cache-control":"no-store"});
    const deterministic = {
      normalizedAnnualTaxableGrossIncome: result.normalizedAnnualTaxableGrossIncome,
      estimatedAdjustedGrossIncome: result.estimatedAdjustedGrossIncome,
      povertyGuideline: result.povertyGuideline,
      planEstimates: result.planEstimates.map((plan) => ({ plan:plan.plan, eligibilityStatus:plan.eligibility.status, monthlyPaymentEstimate:plan.monthlyPaymentEstimate, formulaSummary:plan.formulaSummary, eligibilityNote:plan.eligibilityNote, warnings:plan.warnings })),
      warnings: result.warnings
    };
    const knowledge = retrieveKnowledge({ question, intent:borrowerKnowledgeIntent(intent), audience:"borrower", history, limit:6 });
    const deterministicFallback = borrowerConsultationAnswer(question,result,intent,knowledge.map((entry)=>entry.id));
    const synthesis = await synthesizeBorrowerGrounded({ env, question, intent, deterministic, knowledge, history, deterministicFallback });
    return jsonResponse({ ok:true, consultation:{ schema:"student-loan-idr-borrower-consultation-v1", schemaVersion:1, contextMode:"browser_local_calculator", synthesisMode:synthesis.synthesisMode, policySnapshot:POLICY_SNAPSHOT, intent, answer:synthesis.answer, citations:synthesis.citations, ...(synthesis.model?{model:synthesis.model}:{}), ...(synthesis.fallbackReason?{fallbackReason:synthesis.fallbackReason}:{}), deterministic, policyRules:[...rules], policyEvidence:[...evidence], knowledge, privacy:{ persisted:false, advisorDataIncluded:false, rawStudentAidIncluded:false, clientLookup:false }, mutationApplied:false } },200,request,env,{"cache-control":"no-store"});
  } catch (error) { return jsonResponse({ok:false,error:error instanceof Error?error.message:"Consultation failed."},400,request,env,{"cache-control":"no-store"}); }
}

const hasOwn = (value: JsonObject, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

function allowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  const allowlist = (env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowlist.includes(origin);
}

function responseHeaders(request: Request, env: Env): Headers {
  const headers = new Headers(JSON_HEADERS);
  const origin = request.headers.get("origin");
  if (origin !== null && allowedOrigin(request, env)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return headers;
}

function jsonRpcResultObject(id: string | number, result: unknown): JsonObject {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcErrorObject(id: JsonRpcId, code: number, message: string, data?: unknown): JsonObject {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function jsonResponse(payload: unknown, status: number, request: Request, env: Env, extraHeaders?: Record<string, string>): Response {
  const headers = responseHeaders(request, env);
  for (const [key, value] of Object.entries(extraHeaders ?? {})) headers.set(key, value);
  return new Response(JSON.stringify(payload), { status, headers });
}

function contentResult(value: unknown): { content: { type: "text"; text: string }[]; structuredContent: unknown } {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

function validateSchema(value: unknown, schema: RuntimeSchema, path = "arguments"): string[] {
  const issues: string[] = [];

  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    issues.push(`${path} must be one of the declared enum values.`);
    return issues;
  }

  if (schema.type === "object") {
    if (!isObject(value)) return [`${path} must be an object.`];
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!hasOwn(value, required)) issues.push(`${path}.${required} is required.`);
    }
    for (const key of Object.keys(value)) {
      const childSchema = properties[key];
      if (!childSchema) {
        issues.push(`${path}.${key} is not an allowed field.`);
        continue;
      }
      issues.push(...validateSchema(value[key], childSchema, `${path}.${key}`));
    }
    return issues;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path} must be an array.`];
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(`${path} must contain at least ${schema.minItems} item(s).`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(`${path} must contain at most ${schema.maxItems} item(s).`);
    if (schema.items) value.forEach((item, index) => issues.push(...validateSchema(item, schema.items!, `${path}[${index}]`)));
    return issues;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") return [`${path} must be a string.`];
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(`${path} exceeds the maximum length of ${schema.maxLength}.`);
    return issues;
  }

  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return [`${path} must be a finite ${schema.type}.`];
    if (schema.type === "integer" && !Number.isInteger(value)) issues.push(`${path} must be an integer.`);
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(`${path} must be greater than or equal to ${schema.minimum}.`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) issues.push(`${path} must be greater than ${schema.exclusiveMinimum}.`);
    return issues;
  }

  if (schema.type === "boolean" && typeof value !== "boolean") issues.push(`${path} must be a boolean.`);
  return issues;
}

function validateInitializeParams(value: unknown): string[] {
  if (!isObject(value)) return ["params must be an object."];
  const issues: string[] = [];
  if (typeof value.protocolVersion !== "string") issues.push("params.protocolVersion must be a string.");
  if (!isObject(value.capabilities)) issues.push("params.capabilities must be an object.");
  if (!isObject(value.clientInfo)) {
    issues.push("params.clientInfo must be an object.");
  } else {
    if (typeof value.clientInfo.name !== "string") issues.push("params.clientInfo.name must be a string.");
    if (typeof value.clientInfo.version !== "string") issues.push("params.clientInfo.version must be a string.");
  }
  return issues;
}

function isJsonRpcResponse(value: unknown): boolean {
  if (!isObject(value) || value.jsonrpc !== "2.0") return false;
  const id = value.id;
  if (typeof id !== "string" && typeof id !== "number") return false;
  return hasOwn(value, "result") !== hasOwn(value, "error") && !hasOwn(value, "method");
}

async function handleJsonRpcMessage(value: unknown, batched: boolean): Promise<JsonObject | null> {
  if (isJsonRpcResponse(value)) return null;
  if (!isObject(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") {
    return jsonRpcErrorObject(null, -32600, "Invalid Request");
  }

  const hasId = hasOwn(value, "id");
  if (!hasId) return null;
  if (typeof value.id !== "string" && typeof value.id !== "number") {
    return jsonRpcErrorObject(null, -32600, "MCP request id must be a string or number.");
  }
  const id = value.id;

  if (value.method === "initialize") {
    if (batched) return jsonRpcErrorObject(id, -32600, "initialize must not be sent in a JSON-RPC batch.");
    const issues = validateInitializeParams(value.params);
    if (issues.length > 0) return jsonRpcErrorObject(id, -32602, "Invalid initialize params", { issues });
    const requestedVersion = (value.params as JsonObject).protocolVersion as string;
    return jsonRpcResultObject(id, {
      protocolVersion: requestedVersion === SUPPORTED_PROTOCOL_VERSION ? requestedVersion : SUPPORTED_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "student-loan-idr-mcp", version: SERVER_VERSION }
    });
  }

  if (value.method === "ping") return jsonRpcResultObject(id, {});
  if (value.method === "tools/list") return jsonRpcResultObject(id, { tools: toolDefinitions });

  if (value.method === "tools/call") {
    const params = value.params;
    if (!isObject(params) || typeof params.name !== "string") {
      return jsonRpcErrorObject(id, -32602, "tools/call requires an object params value with a string name.");
    }
    const definition = toolDefinitions.find((tool) => tool.name === params.name);
    if (!definition) return jsonRpcErrorObject(id, -32601, `Unknown tool: ${params.name}`);
    const toolArguments = params.arguments ?? {};
    const issues = validateSchema(toolArguments, definition.inputSchema as RuntimeSchema);
    if (issues.length > 0) return jsonRpcErrorObject(id, -32602, "Invalid tool arguments", { issues });

    try {
      if (params.name === "calculate_alt_income_student_loan") {
        return jsonRpcResultObject(id, contentResult(calculateRepayment(toolArguments as CalculatorRequest)));
      }
      if (params.name === "get_repayment_documentation_template") {
        return jsonRpcResultObject(id, contentResult(getDocumentationTemplate(toolArguments as TemplateRequest)));
      }
      if (params.name === "policy_status") {
        return jsonRpcResultObject(id, contentResult(getPolicyStatus()));
      }
      return jsonRpcErrorObject(id, -32601, `Unknown tool: ${params.name}`);
    } catch (error) {
      return jsonRpcResultObject(id, {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : "Unknown tool error" }]
      });
    }
  }

  return jsonRpcErrorObject(id, -32601, `Method not found: ${value.method}`);
}

async function readRequestText(request: Request): Promise<{ text: string; bytes: number }> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_REQUEST_BYTES) throw new RequestTooLargeError("Request body too large");
  }
  if (!request.body) return { text: "", bytes: 0 };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      await reader.cancel("request body exceeded limit");
      throw new RequestTooLargeError("Request body too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { text, bytes };
}

function requestMetadata(value: unknown): { method: string; tool?: string } {
  if (Array.isArray(value)) return { method: "batch" };
  if (!isObject(value) || typeof value.method !== "string") return { method: "invalid" };
  if (value.method === "tools/call" && isObject(value.params) && typeof value.params.name === "string") {
    return { method: value.method, tool: value.params.name };
  }
  return { method: value.method };
}

function logRequest(event: { method: string; tool?: string; httpStatus: number; requestBytes: number; durationMs: number }): void {
  console.log(JSON.stringify({
    service: "student-loan-idr-mcp",
    version: SERVER_VERSION,
    event: "mcp_request",
    method: event.method,
    ...(event.tool === undefined ? {} : { tool: event.tool }),
    http_status: event.httpStatus,
    request_bytes: event.requestBytes,
    duration_ms: event.durationMs
  }));
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  let requestBytes = 0;
  let metadata: { method: string; tool?: string } = { method: "unparsed" };
  const finish = (response: Response): Response => {
    logRequest({ ...metadata, httpStatus: response.status, requestBytes, durationMs: Date.now() - startedAt });
    return response;
  };

  if (!allowedOrigin(request, env)) {
    return finish(jsonResponse(jsonRpcErrorObject(null, -32600, "Forbidden Origin"), 403, request, env));
  }

  if (env.MCP_BEARER_TOKEN && request.headers.get("authorization") !== `Bearer ${env.MCP_BEARER_TOKEN}`) {
    return finish(jsonResponse(jsonRpcErrorObject(null, -32600, "Unauthorized"), 401, request, env, { "www-authenticate": "Bearer" }));
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return finish(jsonResponse(jsonRpcErrorObject(null, -32600, "Content-Type must be application/json."), 415, request, env));
  }

  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    return finish(jsonResponse(jsonRpcErrorObject(null, -32600, "Accept must include application/json and text/event-stream."), 406, request, env));
  }

  if (env.MCP_RATE_LIMITER) {
    try {
      const { success } = await env.MCP_RATE_LIMITER.limit({ key: env.MCP_BEARER_TOKEN ? "authenticated:/mcp" : "public:/mcp" });
      if (!success) return finish(jsonResponse(jsonRpcErrorObject(null, -32000, "Rate limit exceeded"), 429, request, env));
    } catch {
      return finish(jsonResponse(jsonRpcErrorObject(null, -32603, "Rate limiter unavailable"), 503, request, env));
    }
  }

  let text: string;
  try {
    const bounded = await readRequestText(request);
    text = bounded.text;
    requestBytes = bounded.bytes;
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return finish(jsonResponse(jsonRpcErrorObject(null, -32600, `Request body exceeds ${MAX_REQUEST_BYTES} bytes.`), 413, request, env));
    }
    return finish(jsonResponse(jsonRpcErrorObject(null, -32603, "Unable to read request body"), 400, request, env));
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return finish(jsonResponse(jsonRpcErrorObject(null, -32700, "Parse error"), 200, request, env));
  }
  metadata = requestMetadata(body);

  if (Array.isArray(body)) {
    if (body.length === 0) return finish(jsonResponse(jsonRpcErrorObject(null, -32600, "Invalid Request"), 200, request, env));
    const responses: JsonObject[] = [];
    for (const item of body) {
      const response = await handleJsonRpcMessage(item, true);
      if (response) responses.push(response);
    }
    if (responses.length === 0) return finish(new Response(null, { status: 202, headers: responseHeaders(request, env) }));
    return finish(jsonResponse(responses, 200, request, env));
  }

  const response = await handleJsonRpcMessage(body, false);
  if (!response) return finish(new Response(null, { status: 202, headers: responseHeaders(request, env) }));
  return finish(jsonResponse(response, 200, request, env));
}

function home(request: Request, env: Env): Response {
  return jsonResponse({
    ok: true,
    name: "student-loan-idr-mcp",
    version: SERVER_VERSION,
    protocol_version: SUPPORTED_PROTOCOL_VERSION,
    policy_snapshot: "2026-08-27",
    tools: toolDefinitions.map((tool) => tool.name),
    endpoints: ["GET /", "GET /advisor", "GET /health", "GET /api/ibr-zero-payment", "POST /api/calculate", "POST /api/consultation", "POST /api/document", "POST /mcp", "POST /api/advisor/register", "POST /api/advisor/login", "GET /api/advisor/session", "GET /api/advisor/action-dashboard", "GET /api/advisor/retrieval-metadata", "GET|POST /api/advisor/clients", "GET|PUT|DELETE /api/advisor/clients/:clientId", "GET /api/advisor/clients/:clientId/case-context", "POST /api/advisor/clients/:clientId/retrieval", "POST /api/advisor/clients/:clientId/consultation", "GET /api/advisor/clients/:clientId/comparison", "GET /api/advisor/clients/:clientId/intelligence", "GET /api/advisor/clients/:clientId/timeline", "GET|PATCH|DELETE /api/advisor/clients/:clientId/timeline/:eventId", "POST /api/advisor/clients/:clientId/calculations", "POST /api/advisor/clients/:clientId/comparisons", "POST /api/advisor/clients/:clientId/documents/generate", "GET|POST /api/advisor/clients/:clientId/artifacts", "GET|DELETE /api/advisor/clients/:clientId/artifacts/:artifactId", "POST /api/advisor/clients/:clientId/artifacts/:artifactId/regenerate", "GET|POST /api/advisor/clients/:clientId/snapshots", "GET|DELETE /api/advisor/clients/:clientId/snapshots/:snapshotId", "GET /api/advisor/clients/:clientId/snapshots/:snapshotId/artifact", "POST /api/advisor/clients/:clientId/snapshots/:snapshotId/rerun", "GET /api/share/:shareToken/artifact"],
    advisor_workspace: {
      persistence: env.ADVISOR_DB ? "d1" : "unconfigured",
      authentication: "server_session_cookie",
      owner_scoped_client_crud: Boolean(env.ADVISOR_DB),
      browser_workspace: "/advisor",
      saved_guided_client_workflow: true,
      repayment_comparison_visualizations: true,
      retained_client_artifacts: true,
      calculation_history: true,
      student_aid_dual_mode_import: true,
      student_aid_normalized_prefill: true,
      student_aid_per_loan_facts: true,
      fsa_portfolio_intelligence: true,
      client_case_context_v1: true,
      client_timeline_v1: true,
      automatic_case_history: true,
      advisor_action_dashboard_v1: true,
      deterministic_next_best_action: true,
      structured_client_retrieval_v1: true,
      reviewed_policy_rag_v1: true,
      chat_native_advisor_consultation_v1: true,
      grounded_workers_ai_synthesis_v1: true,
      versioned_knowledge_packs_v1: true,
      advisor_specialty_knowledge_v1: true,
      borrower_official_knowledge_only: true,
      bounded_consultation_history_turns: 6,
      borrower_safe_consultation_v1: true,
      borrower_consultation_persistence: false,
      borrower_comparison_artifact_v1: true,
      comparison_artifact_svg_export: true,
      secure_share_snapshot_parity: true,
      deterministic_math_authority: true,
      raw_student_aid_embeddings: false,
      shared_borrower_pii_corpus: false,
      student_aid_provenance_review: true,
      max_normalized_client_request_bytes: 512 * 1024,
      raw_student_aid_retention: false
    },
    hardening: {
      max_request_bytes: MAX_REQUEST_BYTES,
      bearer_auth_configured: Boolean(env.MCP_BEARER_TOKEN),
      origin_allowlist_configured: Boolean(env.MCP_ALLOWED_ORIGINS),
      rate_limit_configured: Boolean(env.MCP_RATE_LIMITER),
      sensitive_payload_logging: false
    }
  }, 200, request, env);
}

export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname === "/mcp") {
      if (!allowedOrigin(request, env)) return jsonResponse(jsonRpcErrorObject(null, -32600, "Forbidden Origin"), 403, request, env);
      return new Response(null, { status: 204, headers: responseHeaders(request, env) });
    }
    if (request.method === "GET" && url.pathname === "/") return uiResponse();
    if (request.method === "GET" && url.pathname === "/advisor") return advisorUiResponse();
    if (request.method === "GET" && /^\/share\/[A-Za-z0-9_-]{16,128}$/.test(url.pathname)) return shareUiResponse();
    if (request.method === "GET" && url.pathname === "/health") return home(request, env);
    if (request.method === "GET" && url.pathname === "/api/ibr-zero-payment") return ibrZeroPaymentResponse(request, env);
    if (url.pathname.startsWith("/api/advisor/")) return handleAdvisorApi(request, env);
    if (url.pathname.startsWith("/api/share/")) return handleShareApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/calculate") return handleCalculatorApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/consultation") return handleBorrowerConsultationApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/document") return handleDocumentApi(request, env);
    if (url.pathname === "/mcp" && request.method === "GET") {
      if (!allowedOrigin(request, env)) return jsonResponse(jsonRpcErrorObject(null, -32600, "Forbidden Origin"), 403, request, env);
      return new Response("SSE listening is not implemented by this stateless server.", { status: 405, headers: { allow: "POST, OPTIONS" } });
    }
    if (request.method === "POST" && url.pathname === "/mcp") return handleMcp(request, env);
    return new Response("Not Found", { status: 404 });
  }
};
