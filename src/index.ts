import { calculateRepayment, getPolicyStatus, ibrZeroPaymentAgiThreshold } from "./formulas.ts";
import { getDocumentationTemplate } from "./templates.ts";
import { handleAdvisorApi } from "./advisor.ts";
import type { D1DatabaseBinding } from "./advisor.ts";
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
  StudentAidPortfolioSummary
} from "./types.ts";

const SERVER_VERSION = "0.8.6";
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

export const STUDENTAID_MAPPING_VERSION = "2026-08-28-v1";

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
  let fileRequestDate: string | undefined;
  let current: any = null;
  let currentStatus: any = null;
  let currentDisbursement: any = null;
  let currentContact: any = null;
  const pushCurrent = () => { if (current) rawLoans.push(current); current = null; currentStatus = null; currentDisbursement = null; currentContact = null; };
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
    "DelinqDate": "delinquencyDate",
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

  for (const rawLine of text.split(/\r?\n/)) {
    const separator = rawLine.indexOf(":");
    if (separator < 0) continue;
    const key = rawLine.slice(0, separator).trim();
    const value = rawLine.slice(separator + 1).trim();
    if (key === "File Request Date") { fileRequestDate = value || undefined; continue; }
    if (key.startsWith("Student ")) { student[key] = value; continue; }
    if (key === "Loan Type Code" || key === "Loan Type") {
      pushCurrent();
      current = { loanTypeCode: key === "Loan Type Code" ? value : undefined, loanTypeDescription: key === "Loan Type" ? value : undefined, statuses: [], disbursements: [], contacts: [], provenance: {} };
      if (value) current.provenance[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = "imported_studentaid";
      continue;
    }
    if (!current) continue;
    if (key === "Loan Type Description") { current.loanTypeDescription = value || undefined; if (value) current.provenance.loanTypeDescription = "imported_studentaid"; continue; }
    if (key === "Loan Award ID") { const masked = maskStudentAidIdentifier(value); if (masked) { current.maskedAwardId = masked; current.provenance.maskedAwardId = "derived_studentaid"; } continue; }
    if (textFields[key]) { current[textFields[key]] = value || undefined; if (value) current.provenance[textFields[key]] = "imported_studentaid"; continue; }
    if (numericFields[key]) { const number = studentAidNumber(value); if (number !== undefined) { current[numericFields[key]] = number; current.provenance[numericFields[key]] = "imported_studentaid"; } continue; }
    if (key === "Loan Status") { currentStatus = { code: value || undefined }; current.statuses.push(currentStatus); continue; }
    if (key === "Loan Status Description" && currentStatus) { currentStatus.description = value || undefined; continue; }
    if (key === "Loan Status Effective Date" && currentStatus) { currentStatus.effectiveDate = value || undefined; continue; }
    if (key === "Loan Disbursement Date") { currentDisbursement = { date: value || undefined }; current.disbursements.push(currentDisbursement); continue; }
    if (key === "Loan Disbursement Amount" && currentDisbursement) { currentDisbursement.amount = studentAidNumber(value); continue; }
    if (key === "Loan Contact Type") { currentContact = { type: value || undefined }; current.contacts.push(currentContact); continue; }
    if (currentContact && key.startsWith("Loan Contact ")) {
      const contactFields: Record<string, string> = { "Loan Contact Code":"code", "Loan Contact Name":"name", "Loan Contact Street Address 1":"streetAddress1", "Loan Contact Street Address 2":"streetAddress2", "Loan Contact City":"city", "Loan Contact State Code":"stateCode", "Loan Contact Zip Code":"zipCode", "Loan Contact Phone Number":"phoneNumber", "Loan Contact Phone Extension":"phoneExtension", "Loan Contact Email Address":"emailAddress", "Loan Contact Web Site Address":"websiteAddress" };
      if (contactFields[key]) currentContact[contactFields[key]] = value || undefined;
      continue;
    }
    if (key === "Most Relevant" && currentContact) { currentContact.mostRelevant = studentAidYes(value) === true; continue; }
  }
  pushCurrent();

  const loans = rawLoans.map((raw, index): StudentAidNormalizedLoanFact => {
    const dateForPeriod = raw.disbursements.find((item: any) => item.date)?.date || raw.loanDate;
    const mappedLoanType = mapStudentAidLoanType(raw.loanTypeCode, raw.loanTypeDescription, raw.consolidationLoanWithAnyParentPlusIndicator);
    const disbursementPeriod = studentAidDateToPeriod(dateForPeriod);
    const statusDescription = String(raw.currentLoanStatusDescription || raw.statuses.at(-1)?.description || "").toUpperCase();
    const inDefault = statusDescription.includes("DEFAULT") && !statusDescription.includes("NON-DEFAULT");
    const provenance = { ...(raw.provenance || {}) } as Record<string, StudentAidFactProvenance>;
    if (mappedLoanType) provenance.mappedLoanType = "derived_studentaid";
    if (disbursementPeriod) provenance.disbursementPeriod = "derived_studentaid";
    provenance.inDefault = "derived_studentaid";
    return { ...raw, loanIndex: index, ...(mappedLoanType ? { mappedLoanType } : {}), ...(disbursementPeriod ? { disbursementPeriod } : {}), ...(inDefault ? { inDefault: true } : {}), provenance };
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
  return { ...(fileRequestDate ? { fileRequestDate } : {}), borrower, loans, repaymentLoans, ...(eligibilityLoans ? { eligibilityLoans } : {}), summary, totalPrincipal, totalInterest, ambiguousCount };
}

const BORROWER_UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Student Loan IDR Estimate</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: Canvas; color: CanvasText; line-height: 1.5; }
    main { width: min(1040px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0 64px; }
    h1 { font-size: clamp(2rem, 7vw, 4rem); line-height: 1; letter-spacing: -0.045em; margin: 0 0 16px; }
    h2 { margin-top: 0; }
    .lede { max-width: 780px; font-size: 1.05rem; color: color-mix(in srgb, CanvasText 72%, transparent); }
    .notice { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 16px; padding: 16px; margin: 24px 0; background: color-mix(in srgb, CanvasText 4%, Canvas); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .span-2 { grid-column: 1 / -1; }
    label, legend { font-weight: 650; }
    label { display: grid; gap: 7px; }
    input, select, textarea, button { font: inherit; }
    input, select, textarea { width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); background: Canvas; color: CanvasText; }
    textarea { min-height: 96px; resize: vertical; }
    fieldset { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 12px; padding: 14px; margin: 0; }
    .checks { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; }
    .checks label { display: flex; align-items: center; gap: 7px; font-weight: 500; }
    .checks input { width: auto; }
    .actions { display: flex; gap: 12px; align-items: center; margin-top: 22px; flex-wrap: wrap; }
    button { border: 0; border-radius: 999px; padding: 12px 18px; font-weight: 750; cursor: pointer; background: CanvasText; color: Canvas; }
    button:disabled { opacity: .55; cursor: wait; }
    #status { min-height: 1.5em; color: color-mix(in srgb, CanvasText 70%, transparent); }
    #results { margin-top: 32px; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0 20px; }
    .metric, .plan { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 14px; padding: 16px; }
    .metric strong { display: block; font-size: 1.35rem; }
    .plans { display: grid; gap: 12px; }
    .plan-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .plan-head strong { font-size: 1.15rem; }
    .payment { font-size: 1.35rem; font-weight: 800; }
    .badge { display: inline-flex; padding: 3px 9px; border: 1px solid currentColor; border-radius: 999px; font-size: .82rem; text-transform: capitalize; }
    .muted { color: color-mix(in srgb, CanvasText 66%, transparent); }
    .advisor-savebar { border: 2px solid color-mix(in srgb, CanvasText 28%, transparent); border-radius: 16px; padding: 16px; margin: 20px 0 24px; background: color-mix(in srgb, CanvasText 6%, Canvas); }
    .advisor-savebar[hidden] { display: none; }
    .advisor-savebar-head { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
    .advisor-savebar .actions { margin-top: 0; }
    .link-button { display: inline-flex; align-items: center; border: 1px solid currentColor; border-radius: 999px; padding: 10px 15px; text-decoration: none; font-weight: 750; }
    .workspace { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 16px; padding: 18px; margin: 24px 0; }
    .guide-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
    .guide-transcript { display: grid; gap: 10px; margin: 16px 0; max-height: 360px; overflow: auto; padding-right: 4px; }
    .message { max-width: min(720px, 92%); padding: 10px 13px; border-radius: 14px; border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    .message.guide { justify-self: start; background: color-mix(in srgb, CanvasText 4%, Canvas); }
    .message.user { justify-self: end; background: CanvasText; color: Canvas; }
    .answer-bubbles { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
    .answer-bubbles button { padding: 9px 13px; background: color-mix(in srgb, CanvasText 8%, Canvas); color: CanvasText; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); }
    .guide-entry { display: flex; gap: 8px; align-items: center; }
    .guide-entry input { flex: 1; }
    .fact-ledger { margin-top: 16px; padding-top: 14px; border-top: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    .fact-ledger ul { margin-bottom: 0; }
    .quick-info { width: 100%; border-collapse: collapse; margin: 10px 0; font-variant-numeric: tabular-nums; }
    .quick-info th, .quick-info td { padding: 8px 10px; text-align: left; border-bottom: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    .quick-info th:last-child, .quick-info td:last-child { text-align: right; }
    .quick-callout { border-left: 4px solid currentColor; padding: 10px 12px; margin: 10px 0; background: color-mix(in srgb, CanvasText 4%, Canvas); border-radius: 0 10px 10px 0; }
    .document-workspace[hidden], #document-draft-area[hidden] { display: none; }
    .document-preview { white-space: pre-wrap; overflow: auto; max-height: 520px; padding: 16px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 12px; background: color-mix(in srgb, CanvasText 3%, Canvas); font: 0.92rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .document-review { display: flex; align-items: flex-start; gap: 9px; font-weight: 600; margin-top: 14px; }
    .document-review input { width: auto; margin-top: 4px; }
    .basis { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 8px; font-size: .78rem; font-weight: 750; border: 1px solid currentColor; margin-right: 6px; }
    .fact-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .fact { border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius: 12px; padding: 12px; }
    .fact strong { display: block; margin-bottom: 4px; }
    .readiness-list { display: grid; gap: 10px; margin-top: 12px; }
    .readiness-card { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 12px; padding: 12px; }
    .readiness-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    .readiness-card ul { margin-bottom: 0; }
    .readiness-actions { margin-top: 12px; }
    #portfolio-summary { margin-top: 12px; }
    .comparison-workspace[hidden] { display: none; }
    .comparison-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 14px 0; }
    .comparison-card, .chart-panel { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 14px; padding: 14px; }
    .comparison-card h3, .chart-panel h3 { margin: 0 0 8px; }
    .comparison-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
    .comparison-metrics div { border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent); padding-top: 7px; }
    .comparison-metrics strong { display: block; }
    .chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
    .chart-panel svg { display: block; width: 100%; height: auto; min-height: 220px; overflow: visible; }
    .chart-panel .axis { stroke: color-mix(in srgb, CanvasText 28%, transparent); stroke-width: 1; }
    .chart-panel .series { fill: none; stroke: currentColor; stroke-width: 3; }
    .chart-panel text { fill: currentColor; font: 12px ui-sans-serif, system-ui, sans-serif; }
    .comparison-assumptions { margin-top: 14px; }
    .history-workspace[hidden] { display: none; }
    .history-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .history-list { display: grid; gap: 10px; }
    .history-item { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 12px; padding: 12px; }
    .history-item .actions { margin-top: 10px; }
    ul { padding-left: 22px; }
    a { color: inherit; }
    footer { margin-top: 36px; font-size: .9rem; color: color-mix(in srgb, CanvasText 65%, transparent); }
    .jump-nav { display: flex; gap: 8px; flex-wrap: wrap; margin: 18px 0 24px; }
    .jump-nav a { display: inline-flex; align-items: center; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 999px; padding: 8px 12px; text-decoration: none; font-weight: 700; background: color-mix(in srgb, CanvasText 4%, Canvas); }
    .field-completion { margin: -8px 0 16px; font-size: .92rem; }
    @media (max-width: 700px) { .grid, .summary, .fact-grid, .comparison-cards, .chart-grid, .history-grid { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } main { width: min(100% - 24px, 1040px); padding-top: 28px; } .jump-nav { position: sticky; top: 0; z-index: 20; background: Canvas; gap: 7px; margin: 0 0 20px; padding: 10px 0 8px; } .jump-nav a { flex: 1 1 calc(50% - 7px); justify-content: center; min-height: 44px; } #guided-assistant, #loan-import, #calculator-form, #results { scroll-margin-top: 68px; } }
    .field-color-toggle { display: flex; align-items: center; gap: 8px; font-weight: 600; margin: 4px 0 18px; }
    .field-color-toggle input { width: auto; }
    label[data-fill-state] { border-left: 4px solid transparent; border-radius: 6px; padding-left: 10px; margin-left: -14px; transition: border-color .15s ease, background-color .15s ease; }
    label[data-fill-state].fill-red { border-left-color: #dc2626; background: color-mix(in srgb, #dc2626 9%, transparent); }
    label[data-fill-state].fill-green { border-left-color: #16a34a; background: color-mix(in srgb, #16a34a 9%, transparent); }
    label[data-fill-state].fill-purple { border-left-color: #9333ea; background: color-mix(in srgb, #9333ea 9%, transparent); }
    .fill-status-text { font-size: .78rem; font-weight: 700; letter-spacing: .01em; }
    label[data-fill-state].fill-red .fill-status-text { color: #dc2626; }
    label[data-fill-state].fill-green .fill-status-text { color: #16a34a; }
    label[data-fill-state].fill-purple .fill-status-text { color: #9333ea; }
    body.field-colors-off .fill-status-text { color: inherit; }
    body.field-colors-off label[data-fill-state] { border-left-color: transparent; background: transparent; padding-left: 0; margin-left: 0; }
  </style>
</head>
<body>
<main>
  <p><strong>Student Loan IDR Estimate</strong> · policy snapshot 2026-08-27</p>
  <h1>Turn your real loan facts into a repayment estimate.</h1>
  <p class="lede">This calculator annualizes the income facts you enter and applies the same deterministic RAP, IBR, PAYE, and ICR formulas exposed by this Worker’s MCP tools. It is an estimate—not an official eligibility or billing decision.</p>
  <div class="notice"><strong>Privacy:</strong> this page has no analytics, no external assets, and no browser storage. Calculation inputs are sent only to this same Worker for the current request. A StudentAid.gov loan-data file is parsed locally in your browser and the raw file is never uploaded. Do not enter SSNs, account numbers, or fabricated facts.</div>
  <p class="muted">Working with multiple borrowers? <a href="/advisor">Open the advisor / manager workspace</a>. The direct borrower workflow remains available without an account.</p>
  <nav class="jump-nav" aria-label="Jump to workflow section">
    <a href="#guided-assistant">Guide</a>
    <a href="#loan-import">Loan import</a>
    <a href="#calculator-form">Calculator</a>
    <a href="#results">Results</a>
  </nav>

  <section class="advisor-savebar" id="advisor-client-bar" hidden aria-labelledby="advisor-client-title">
    <div class="advisor-savebar-head">
      <div>
        <span class="basis">Advisor client</span>
        <strong id="advisor-client-title">Saved client workflow</strong>
        <div id="advisor-client-name" class="muted"></div>
      </div>
      <div class="actions">
        <button type="button" id="advisor-save-progress">Save progress</button>
        <button type="button" id="advisor-regenerate-document">Regenerate document</button>
        <button type="button" id="advisor-compare-plans">Compare repayment paths</button>
        <button type="button" id="advisor-retain-calculation">Retain calculation</button>
        <button type="button" id="advisor-open-history">History</button>
        <a class="link-button" href="/advisor">Client dashboard</a>
      </div>
    </div>
    <p id="advisor-save-status" class="muted" role="status" aria-live="polite">Loading saved client facts…</p>
  </section>

  <section class="workspace comparison-workspace" id="advisor-comparison-workspace" hidden aria-labelledby="advisor-comparison-title">
    <h2 id="advisor-comparison-title">Repayment & forgiveness comparison</h2>
    <p><span class="basis">Modeled estimate</span>These scenarios reuse this Worker’s deterministic repayment formulas and the client’s saved normalized facts. They are not guaranteed forgiveness, eligibility, approval, tax treatment, or servicer outcomes.</p>
    <p id="advisor-comparison-status" class="muted" role="status" aria-live="polite">Save the client’s current facts, then compare repayment paths.</p>
    <div class="actions"><button type="button" id="advisor-retain-comparison">Retain this comparison</button></div>
    <div id="advisor-comparison-cards" class="comparison-cards"></div>
    <div class="chart-grid">
      <article class="chart-panel"><h3>Monthly payment path</h3><p class="muted">Current calculated payment held constant for this bounded scenario.</p><svg id="advisor-payment-chart" viewBox="0 0 720 260" role="img" aria-label="Modeled monthly payment by repayment plan"></svg></article>
      <article class="chart-panel"><h3>Cumulative borrower paid</h3><p class="muted">Modeled dollars paid by the borrower over time.</p><svg id="advisor-paid-chart" viewBox="0 0 720 260" role="img" aria-label="Modeled cumulative borrower payments by repayment plan"></svg></article>
      <article class="chart-panel"><h3>Remaining balance</h3><p class="muted">Modeled principal plus tracked unpaid interest where applicable.</p><svg id="advisor-balance-chart" viewBox="0 0 720 260" role="img" aria-label="Modeled remaining loan balance by repayment plan"></svg></article>
      <article class="chart-panel"><h3>Estimated forgiveness</h3><p class="muted">Shown only when this policy snapshot supports a bounded forgiveness horizon and required timing facts are saved.</p><svg id="advisor-forgiveness-chart" viewBox="0 0 720 260" role="img" aria-label="Modeled forgiveness amount by repayment plan"></svg></article>
    </div>
    <div id="advisor-comparison-assumptions" class="comparison-assumptions"></div>
  </section>

  <section class="workspace history-workspace" id="advisor-history-workspace" hidden aria-labelledby="advisor-history-title">
    <div class="guide-head"><div><h2 id="advisor-history-title">Retained client history</h2><p class="muted">Only explicitly retained document drafts and normalized calculation/comparison snapshots appear here. Raw StudentAid downloads and evidence files are never retained.</p></div><button type="button" id="advisor-refresh-history">Refresh history</button></div>
    <p id="advisor-history-status" class="muted" role="status" aria-live="polite"></p>
    <div class="history-grid">
      <div><h3>Document drafts</h3><div id="advisor-artifact-history" class="history-list"></div></div>
      <div><h3>Calculation snapshots</h3><div id="advisor-snapshot-history" class="history-list"></div></div>
    </div>
  </section>

  <section class="workspace" id="guided-assistant" aria-labelledby="guided-assistant-title">
    <div class="guide-head">
      <div>
        <h2 id="guided-assistant-title">Guided IDR assistant</h2>
        <p class="muted">Answer by tapping a bubble or typing. This first version is deterministic: it records only what you confirm, labels the fact source, and prefills the calculator below. No account is required.</p>
      </div>
      <span class="badge">Private session</span>
    </div>
    <div id="guide-transcript" class="guide-transcript" role="log" aria-live="polite"></div>
    <div id="guide-answers" class="answer-bubbles" aria-label="Suggested answers"></div>
    <form id="guide-form" class="guide-entry">
      <input id="guide-input" autocomplete="off" placeholder="Type your answer" aria-label="Type your answer">
      <button type="submit">Send</button>
    </form>
    <div class="fact-ledger">
      <strong>Facts collected in this session</strong>
      <p class="muted">These remain browser-local until you choose to calculate. Imported loan facts and deterministic results are labeled separately.</p>
      <ul id="guided-facts"><li class="muted">No guided facts confirmed yet.</li></ul>
    </div>
  </section>

  <section class="workspace document-workspace" id="document-workspace" aria-labelledby="document-workspace-title" hidden>
    <h2 id="document-workspace-title">Review your supporting statement</h2>
    <p><span class="basis">Draft only</span>This uses only facts you supplied. Missing facts stay as visible placeholders. It does not create employer records, evidence, or signatures, and it does not submit anything to Federal Student Aid or a loan servicer.</p>
    <div class="fact-ledger" id="income-readiness-panel">
      <strong>Source-by-source income readiness</strong>
      <p class="muted">Each taxable source stays separate in this browser-local session. Evidence readiness is borrower-stated only: this page does not upload, inspect, or verify evidence files.</p>
      <p id="readiness-summary" class="muted">No current income sources confirmed yet.</p>
      <div id="income-source-readiness" class="readiness-list"></div>
      <div class="readiness-actions"><button type="button" id="add-income-source">Add another income source</button></div>
    </div>
    <form id="document-form">
      <div class="grid">
        <label class="span-2">Draft scope
          <select name="documentScope" id="document-scope">
            <option value="combined">Combined confirmed income sources</option>
          </select>
          <span class="muted">Choose a single source for a source-specific statement, or keep all confirmed sources together.</span>
        </label>
        <label>Document date <span class="muted">(optional)</span>
          <input name="documentDate" type="text" placeholder="Leave blank for [date]">
        </label>
        <label>Borrower name <span class="muted">(optional)</span>
          <input name="borrowerName" type="text" placeholder="Leave blank for [borrower full name]">
        </label>
        <label>Loan servicer <span class="muted">(optional)</span>
          <input name="servicerName" type="text" placeholder="Leave blank for [loan servicer]">
        </label>
        <label>Payer / employer / agency <span class="muted">(optional)</span>
          <input name="sourceName" type="text" placeholder="Leave blank for a placeholder">
        </label>
        <label>Source address <span class="muted">(optional)</span>
          <input name="sourceAddress" type="text" placeholder="Leave blank for a placeholder">
        </label>
        <label>Gross amount for the stated cadence <span class="muted">(optional)</span>
          <input name="grossAmount" type="number" min="0" step="0.01" placeholder="Leave blank for a placeholder">
        </label>
        <label>Payment frequency <span class="muted">(optional)</span>
          <input name="paymentFrequency" type="text" placeholder="e.g. biweekly">
        </label>
        <label class="span-2">Additional explanation <span class="muted">(optional)</span>
          <textarea name="notes" placeholder="Leave blank for [optional explanation]"></textarea>
        </label>
      </div>
      <div class="actions">
        <button type="submit" id="document-generate">Generate / refresh draft</button>
        <span id="document-status" role="status" aria-live="polite"></span>
      </div>
    </form>
    <div id="document-draft-area" hidden>
      <h3>Draft preview</h3>
      <pre id="document-preview" class="document-preview"></pre>
      <label class="document-review"><input type="checkbox" id="document-reviewed"> <span>I reviewed the draft facts. I understand this is not signed or submitted, and I must sign it myself if I choose to use it.</span></label>
      <div class="actions">
        <button type="button" id="document-print" disabled>Print / Save PDF</button>
        <button type="button" id="document-download" disabled>Download HTML</button>
        <button type="button" id="advisor-retain-document" disabled hidden>Retain draft in client history</button>
      </div>
    </div>
  </section>

  <section class="workspace" id="loan-import" aria-labelledby="loan-import-title">
    <h2 id="loan-import-title">Import your federal loan portfolio</h2>
    <p><span class="basis">Imported fact</span>Choose the <strong>Download My Aid Data</strong> text file from StudentAid.gov. The raw file can contain personal contact information, so this page reads it only on this device, extracts active loan balance/rate/type/date facts, and never uploads the raw text.</p>
    <label>StudentAid.gov My Aid Data file
      <input id="loan-file" type="file" accept=".txt,text/plain">
    </label>
    <p id="import-status" role="status" aria-live="polite" class="muted">No loan file loaded. Manual loan fields remain available below.</p>
    <div id="portfolio-summary"></div>
    <div id="studentaid-review"></div>
  </section>

  <section class="workspace" aria-labelledby="fact-basis-title">
    <h2 id="fact-basis-title">Know what each answer is based on</h2>
    <div class="fact-grid">
      <div class="fact"><strong><span class="basis">Stated fact</span>Family size</strong>Use the current IDR definition, not a guessed tax-household count. It includes you; a spouse when appropriate; supported children (including qualifying unborn children); and other people only when the current support/living requirements are met. There is no six-person cap in the current IDR form.</div>
      <div class="fact"><strong><span class="basis">Documented fact</span>Current taxable income</strong>If current income must be documented instead of using tax information, current Federal Student Aid instructions generally require documentation no older than 90 days, gross pay and pay frequency, and at least one item for each taxable income source. A signed source-by-source statement is the fallback when documentation is unavailable or needs explanation.</div>
      <div class="fact"><strong><span class="basis">Imported fact</span>Loan portfolio</strong>Balances, interest rates, loan descriptions, dates, status, and servicer fields can come from your StudentAid.gov data file. Ambiguous consolidation history is not guessed.</div>
      <div class="fact"><strong><span class="basis">Derived estimate</span>Payment result</strong>Plan amounts are deterministic calculations from the facts above and the versioned policy snapshot. They are not official approval, certification, or a servicer bill.</div>
    </div>
  </section>

  <form id="calculator-form">
    <label class="field-color-toggle"><input type="checkbox" id="field-color-toggle" checked> Show field-status colors (green = has a value, red = required &amp; missing, purple = optional)</label>
    <p id="field-completion" class="field-completion muted" role="status" aria-live="polite"></p>
    <p class="muted"><strong>Field status shows completeness only.</strong> A filled field is not automatically correct, verified, eligible, or advisor-approved.</p>
    <p id="calculator-income-note" class="muted">If you use the guided source-by-source workflow, calculation uses every confirmed guided taxable income source. The visible income controls remain the manual fallback and the first-source preview. Hourly guided sources use the displayed hours-per-week and weeks-per-year controls, so review those before calculating.</p>
    <div class="grid">
      <label>Income cadence
        <select name="cadence" id="cadence">
          <option value="annual">Annual</option>
          <option value="monthly">Monthly</option>
          <option value="semimonthly">Twice monthly</option>
          <option value="biweekly">Every two weeks</option>
          <option value="weekly">Weekly</option>
          <option value="hourly">Hourly</option>
        </select>
      </label>
      <label data-fill-state="required"><span><span class="basis">Stated fact</span>Gross taxable income amount for that cadence</span>
        <input name="incomeAmount" type="number" min="0" step="0.01" value="50000" required>
      </label>
      <label id="hours-field" data-fill-state="optional" hidden>Hours per week
        <input name="hoursPerWeek" type="number" min="0" step="0.01" value="40">
      </label>
      <label id="weeks-field" data-fill-state="optional" hidden>Weeks per year
        <input name="weeksPerYear" type="number" min="0" step="0.01" value="52">
      </label>
      <label>Region
        <select name="region">
          <option value="contiguous_us">48 states + D.C.</option>
          <option value="alaska">Alaska</option>
          <option value="hawaii">Hawaii</option>
        </select>
      </label>
      <label data-fill-state="required"><span><span class="basis">Stated fact</span>Legacy IDR family size</span>
        <input name="familySize" type="number" min="1" step="1" value="1" required aria-describedby="family-size-help">
        <span id="family-size-help" class="muted">Use the current Federal Student Aid support-based definition above; do not cap the value at 6.</span>
      </label>
      <label data-fill-state="required"><span><span class="basis">Stated fact</span>Dependents claimed on federal tax return</span>
        <input name="dependents" type="number" min="0" step="1" value="0" required>
        <span class="muted">Used by RAP and intentionally separate from legacy IDR family size.</span>
      </label>
      <label data-fill-state="optional">Estimated above-the-line adjustments <span class="muted">(optional)</span>
        <input name="adjustments" type="number" min="0" step="0.01" placeholder="0">
      </label>
      <label data-fill-state="optional">AGI override <span class="muted">(optional)</span>
        <input name="agiOverride" type="number" min="0" step="0.01" placeholder="Use calculated estimate">
      </label>
      <label>Tax filing status <span class="muted">(helps ICR)</span>
        <select name="taxFilingStatus">
          <option value="">Not supplied</option>
          <option value="single">Single</option>
          <option value="married_filing_jointly">Married filing jointly</option>
          <option value="married_filing_separately">Married filing separately</option>
          <option value="head_of_household">Head of household</option>
        </select>
      </label>
      <label data-fill-state="optional">Loan principal <span class="muted">(optional; improves caps/ICR)</span>
        <input name="principal" type="number" min="0" step="0.01" placeholder="e.g. 30000">
      </label>
      <label data-fill-state="optional">Annual interest rate % <span class="muted">(optional)</span>
        <input name="interestRate" type="number" min="0" step="0.001" placeholder="e.g. 6.5">
      </label>
      <label>Loan type <span class="muted">(optional eligibility screen)</span>
        <select name="loanType">
          <option value="">Not supplied</option>
          <option value="direct_subsidized">Direct Subsidized</option>
          <option value="direct_unsubsidized">Direct Unsubsidized</option>
          <option value="direct_grad_plus">Direct Grad PLUS</option>
          <option value="direct_parent_plus">Direct Parent PLUS</option>
          <option value="direct_consolidation_no_parent_plus">Direct Consolidation — no Parent PLUS</option>
          <option value="direct_consolidation_with_parent_plus">Direct Consolidation — includes Parent PLUS</option>
          <option value="ffel_subsidized_stafford">FFEL Subsidized Stafford</option>
          <option value="ffel_unsubsidized_stafford">FFEL Unsubsidized Stafford</option>
          <option value="ffel_grad_plus">FFEL Grad PLUS</option>
          <option value="ffel_parent_plus">FFEL Parent PLUS</option>
          <option value="ffel_consolidation_no_parent_plus">FFEL Consolidation — no Parent PLUS</option>
          <option value="ffel_consolidation_with_parent_plus">FFEL Consolidation — includes Parent PLUS</option>
          <option value="perkins">Perkins</option>
        </select>
      </label>
      <label>Loan disbursement period
        <select name="disbursementPeriod">
          <option value="before_2026_07_01">Before July 1, 2026</option>
          <option value="on_or_after_2026_07_01">On/after July 1, 2026</option>
        </select>
      </label>
      <label>IBR borrower timing
        <select name="ibrNewBorrower">
          <option value="">Not supplied</option>
          <option value="true">New borrower on/after July 1, 2014</option>
          <option value="false">Earlier borrower</option>
        </select>
      </label>
      <fieldset class="span-2">
        <legend>Plans to estimate</legend>
        <div class="checks">
          <label><input type="checkbox" name="plans" value="RAP" checked> RAP</label>
          <label><input type="checkbox" name="plans" value="IBR" checked> IBR</label>
          <label><input type="checkbox" name="plans" value="PAYE" checked> PAYE</label>
          <label><input type="checkbox" name="plans" value="ICR" checked> ICR</label>
        </div>
      </fieldset>
    </div>
    <div class="actions">
      <button type="submit" id="submit">Calculate estimate</button>
      <span id="status" role="status" aria-live="polite"></span>
    </div>
  </form>

  <section id="results" aria-live="polite"></section>
  <footer>Official eligibility and payment amounts come from the U.S. Department of Education and your loan servicer. SAVE is not modeled in this 2026-08-27 policy snapshot.</footer>
</main>
<script>
(() => {
  const form = document.getElementById("calculator-form");
  const cadence = document.getElementById("cadence");
  const hoursField = document.getElementById("hours-field");
  const weeksField = document.getElementById("weeks-field");
  const status = document.getElementById("status");
  const results = document.getElementById("results");
  const submit = document.getElementById("submit");
  const loanFile = document.getElementById("loan-file");
  const importStatus = document.getElementById("import-status");
  const portfolioSummary = document.getElementById("portfolio-summary");
  const studentAidReview = document.getElementById("studentaid-review");
  const guideTranscript = document.getElementById("guide-transcript");
  const guideAnswers = document.getElementById("guide-answers");
  const guideForm = document.getElementById("guide-form");
  const guideInput = document.getElementById("guide-input");
  const guidedFactsList = document.getElementById("guided-facts");
  const documentWorkspace = document.getElementById("document-workspace");
  const documentForm = document.getElementById("document-form");
  const documentGenerate = document.getElementById("document-generate");
  const documentStatus = document.getElementById("document-status");
  const documentDraftArea = document.getElementById("document-draft-area");
  const documentPreview = document.getElementById("document-preview");
  const documentReviewed = document.getElementById("document-reviewed");
  const documentPrint = document.getElementById("document-print");
  const documentDownload = document.getElementById("document-download");
  const documentScope = document.getElementById("document-scope");
  const readinessSummary = document.getElementById("readiness-summary");
  const incomeSourceReadiness = document.getElementById("income-source-readiness");
  const addIncomeSource = document.getElementById("add-income-source");
  const advisorClientBar = document.getElementById("advisor-client-bar");
  const advisorClientName = document.getElementById("advisor-client-name");
  const advisorSaveProgress = document.getElementById("advisor-save-progress");
  const advisorRegenerateDocument = document.getElementById("advisor-regenerate-document");
  const advisorComparePlans = document.getElementById("advisor-compare-plans");
  const advisorRetainCalculation = document.getElementById("advisor-retain-calculation");
  const advisorOpenHistory = document.getElementById("advisor-open-history");
  const advisorRetainComparison = document.getElementById("advisor-retain-comparison");
  const advisorRetainDocument = document.getElementById("advisor-retain-document");
  const advisorHistoryWorkspace = document.getElementById("advisor-history-workspace");
  const advisorHistoryStatus = document.getElementById("advisor-history-status");
  const advisorArtifactHistory = document.getElementById("advisor-artifact-history");
  const advisorSnapshotHistory = document.getElementById("advisor-snapshot-history");
  const advisorRefreshHistory = document.getElementById("advisor-refresh-history");
  const advisorSaveStatus = document.getElementById("advisor-save-status");
  const advisorComparisonWorkspace = document.getElementById("advisor-comparison-workspace");
  const advisorComparisonStatus = document.getElementById("advisor-comparison-status");
  const advisorComparisonCards = document.getElementById("advisor-comparison-cards");
  const advisorPaymentChart = document.getElementById("advisor-payment-chart");
  const advisorPaidChart = document.getElementById("advisor-paid-chart");
  const advisorBalanceChart = document.getElementById("advisor-balance-chart");
  const advisorForgivenessChart = document.getElementById("advisor-forgiveness-chart");
  const advisorComparisonAssumptions = document.getElementById("advisor-comparison-assumptions");
  const advisorClientId = new URLSearchParams(window.location.search).get("advisorClient");
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const numberOrUndefined = (value) => value === "" ? undefined : Number(value);
  let importedPortfolio = null;
  let documentDraft = null;
  let guideDocumentGoal = null;
  let guideContinueToCalculator = false;
  let guideIncomeCadence = null;
  let guideIncomeAmount = null;
  let guidedIncomeSources = [];
  let pendingIncomeSource = null;
  let collectMultipleSources = false;
  let advisorClient = null;
  let advisorCsrfToken = null;
  let advisorIdentity = null;
  let advisorSavedIncome = null;
  let importedFieldProvenance = {};

  function numericValue(value) {
    if (!value) return undefined;
    const normalized = value.replace(/[$,%]/g, "").replace(/,/g, "").trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function studentAidYesLocal(value) {
    const normalized = String(value || "").trim().toUpperCase();
    if (["Y", "YES", "TRUE", "1"].includes(normalized)) return true;
    if (["N", "NO", "FALSE", "0"].includes(normalized)) return false;
    return undefined;
  }

  function maskStudentAidIdentifierLocal(value) {
    const normalized = String(value || "").trim();
    return normalized ? "••••" + normalized.slice(-4) : null;
  }

  function mapLoanType(code, description, parentPlusIndicator) {
    const c = String(code || "").trim().toUpperCase();
    const value = String(description || "").toUpperCase();
    const hasParentPlus = studentAidYesLocal(parentPlusIndicator);
    if (["D0", "D1"].includes(c)) return "direct_subsidized";
    if (["D2", "D8"].includes(c)) return "direct_unsubsidized";
    if (c === "D3") return "direct_grad_plus";
    if (c === "D4") return "direct_parent_plus";
    if (["D5", "D6", "D9"].includes(c)) return hasParentPlus === true ? "direct_consolidation_with_parent_plus" : hasParentPlus === false ? "direct_consolidation_no_parent_plus" : null;
    if (c === "GB") return "ffel_grad_plus";
    if (c === "PL") return "ffel_parent_plus";
    if (c === "SF") return "ffel_subsidized_stafford";
    if (["SU", "SN"].includes(c)) return "ffel_unsubsidized_stafford";
    if (c === "CL") return hasParentPlus === true ? "ffel_consolidation_with_parent_plus" : hasParentPlus === false ? "ffel_consolidation_no_parent_plus" : null;
    if (["PU", "DU", "NU"].includes(c) || value.includes("PERKINS")) return "perkins";
    if (!value || value.includes("CONSOLIDAT")) return null;
    const isDirect = value.includes("DIRECT");
    const isFfel = value.includes("FFEL") || value.includes("FEDERAL STAFFORD");
    if (isDirect) {
      if (value.includes("PARENT") && value.includes("PLUS")) return "direct_parent_plus";
      if ((value.includes("GRAD") || value.includes("PROFESSIONAL")) && value.includes("PLUS")) return "direct_grad_plus";
      if (value.includes("UNSUBSID")) return "direct_unsubsidized";
      if (value.includes("SUBSID")) return "direct_subsidized";
    }
    if (isFfel) {
      if (value.includes("PARENT") && value.includes("PLUS")) return "ffel_parent_plus";
      if ((value.includes("GRAD") || value.includes("PROFESSIONAL")) && value.includes("PLUS")) return "ffel_grad_plus";
      if (value.includes("UNSUBSID") || value.includes("NON-SUBSID")) return "ffel_unsubsidized_stafford";
      if (value.includes("SUBSID")) return "ffel_subsidized_stafford";
    }
    return null;
  }

  function disbursementPeriod(value) {
    const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const timestamp = match ? Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])) : Date.parse(value || "");
    if (!Number.isFinite(timestamp)) return null;
    return timestamp >= Date.UTC(2026, 6, 1) ? "on_or_after_2026_07_01" : "before_2026_07_01";
  }

  function parseStudentAidData(text) {
    const student = {};
    const records = [];
    let fileRequestDate = null;
    let current = null;
    let currentStatus = null;
    let currentDisbursement = null;
    let currentContact = null;
    const pushCurrent = () => { if (current) records.push(current); current = null; currentStatus = null; currentDisbursement = null; currentContact = null; };
    const textFields = {
      "Loan Attending School Name":"attendingSchoolName", "Loan Attending School OPEID":"attendingSchoolOpeid", "Loan Date":"loanDate", "Loan Repayment Begin Date":"repaymentBeginDate", "Loan Period Begin Date":"periodBeginDate", "Loan Period End Date":"periodEndDate", "Loan Canceled Date":"canceledDate", "Loan Outstanding Principal Balance as of Date":"outstandingPrincipalAsOfDate", "Loan Outstanding Interest Balance as of Date":"outstandingInterestAsOfDate", "Loan Interest Rate Type Code":"interestRateTypeCode", "Loan Interest Rate Type Description":"interestRateTypeDescription", "Loan Repayment Plan Type Code":"repaymentPlanTypeCode", "Loan Repayment Plan Type Code Description":"repaymentPlanDescription", "Loan Repayment Plan Begin Date":"repaymentPlanBeginDate", "Loan Repayment Plan IDR Plan Anniversary Date":"repaymentPlanIdrAnniversaryDate", "Loan Confirmed Subsidy Status":"confirmedSubsidyStatus", "Loan Reaffirmation Date":"reaffirmationDate", "Loan Most Recent Payment Effective Date":"mostRecentPaymentEffectiveDate", "Loan Next Payment Due Date":"nextPaymentDueDate", "Academic Level":"academicLevel", "Award Year":"awardYear", "Reaffirmation flag":"reaffirmationFlag", "UpdtDt":"updateDate", "DelinqDate":"delinquencyDate", "Current Loan Status":"currentLoanStatusCode", "Current Loan Status Description":"currentLoanStatusDescription", "Parent Plus First Level Consolidation Indicator":"parentPlusFirstLevelConsolidationIndicator", "Consolidation Loan With Any Parent Plus Indicator":"consolidationLoanWithAnyParentPlusIndicator"
    };
    const numericFields = {
      "Loan Amount":"originalAmount", "Loan Disbursed Amount":"disbursedAmount", "Loan Canceled Amount":"canceledAmount", "Loan Outstanding Principal Balance":"outstandingPrincipal", "Loan Outstanding Interest Balance":"outstandingInterest", "Loan Interest Rate":"interestRatePercent", "Loan Actual Interest Rate":"actualInterestRatePercent", "Loan Statutory Interest Rate":"statutoryInterestRatePercent", "Loan Repayment Plan Scheduled Amount":"repaymentPlanScheduledAmount", "Loan Subsidized Usage in Years":"subsidizedUsageYears", "Loan Cumulative Payment Amount":"cumulativePaymentAmount", "Loan PSLF Cumulative Matched Months":"pslfCumulativeMatchedMonths", "Capitalized Interest":"capitalizedInterest", "Net Loan Amount":"netLoanAmount", "Calculated Subsidized Aggregate OPB":"calculatedSubsidizedAggregateOpb", "Calculated Unsubsidized Aggregate OPB":"calculatedUnsubsidizedAggregateOpb", "Calculated Combined Aggregate OPB":"calculatedCombinedAggregateOpb", "Highest Historical Outstanding Principal Balance (OPB)":"highestHistoricalOutstandingPrincipalBalance", "Current Standard-Standard Schedule Payment Amount":"currentStandardSchedulePaymentAmount", "Permanent Standard-Standard Schedule Payment Amount":"permanentStandardSchedulePaymentAmount"
    };
    for (const rawLine of text.split(/\r?\n/)) {
      const separator = rawLine.indexOf(":");
      if (separator < 0) continue;
      const key = rawLine.slice(0, separator).trim();
      const value = rawLine.slice(separator + 1).trim();
      if (key === "File Request Date") { fileRequestDate = value || null; continue; }
      if (key.startsWith("Student ")) { student[key] = value; continue; }
      if (key === "Loan Type Code" || key === "Loan Type") {
        pushCurrent();
        current = { loanTypeCode: key === "Loan Type Code" ? value : null, loanTypeDescription: key === "Loan Type" ? value : null, statuses: [], disbursements: [], contacts: [], provenance: {} };
        if (value) current.provenance[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = "imported_studentaid";
        continue;
      }
      if (!current) continue;
      if (key === "Loan Type Description") { current.loanTypeDescription = value || null; if (value) current.provenance.loanTypeDescription = "imported_studentaid"; continue; }
      if (key === "Loan Award ID") { const masked = maskStudentAidIdentifierLocal(value); if (masked) { current.maskedAwardId = masked; current.provenance.maskedAwardId = "derived_studentaid"; } continue; }
      if (textFields[key]) { if (value) { current[textFields[key]] = value; current.provenance[textFields[key]] = "imported_studentaid"; } continue; }
      if (numericFields[key]) { const number = numericValue(value); if (number !== undefined) { current[numericFields[key]] = number; current.provenance[numericFields[key]] = "imported_studentaid"; } continue; }
      if (key === "Loan Status") { currentStatus = { code: value || undefined }; current.statuses.push(currentStatus); continue; }
      if (key === "Loan Status Description" && currentStatus) { currentStatus.description = value || undefined; continue; }
      if (key === "Loan Status Effective Date" && currentStatus) { currentStatus.effectiveDate = value || undefined; continue; }
      if (key === "Loan Disbursement Date") { currentDisbursement = { date: value || undefined }; current.disbursements.push(currentDisbursement); continue; }
      if (key === "Loan Disbursement Amount" && currentDisbursement) { currentDisbursement.amount = numericValue(value); continue; }
      if (key === "Loan Contact Type") { currentContact = { type: value || undefined }; current.contacts.push(currentContact); continue; }
      if (currentContact && key.startsWith("Loan Contact ")) {
        const contactFields = { "Loan Contact Code":"code", "Loan Contact Name":"name", "Loan Contact Street Address 1":"streetAddress1", "Loan Contact Street Address 2":"streetAddress2", "Loan Contact City":"city", "Loan Contact State Code":"stateCode", "Loan Contact Zip Code":"zipCode", "Loan Contact Phone Number":"phoneNumber", "Loan Contact Phone Extension":"phoneExtension", "Loan Contact Email Address":"emailAddress", "Loan Contact Web Site Address":"websiteAddress" };
        if (contactFields[key] && value) currentContact[contactFields[key]] = value;
        continue;
      }
      if (key === "Most Relevant" && currentContact) { currentContact.mostRelevant = studentAidYesLocal(value) === true; continue; }
    }
    pushCurrent();
    const loans = records.map((loan, loanIndex) => {
      const dateForPeriod = loan.disbursements.find((item) => item.date)?.date || loan.loanDate;
      const mappedLoanType = mapLoanType(loan.loanTypeCode, loan.loanTypeDescription, loan.consolidationLoanWithAnyParentPlusIndicator);
      const period = disbursementPeriod(dateForPeriod);
      const status = String(loan.currentLoanStatusDescription || loan.statuses.at(-1)?.description || "").toUpperCase();
      const inDefault = status.includes("DEFAULT") && !status.includes("NON-DEFAULT");
      const provenance = { ...loan.provenance };
      if (mappedLoanType) provenance.mappedLoanType = "derived_studentaid";
      if (period) provenance.disbursementPeriod = "derived_studentaid";
      provenance.inDefault = "derived_studentaid";
      return { ...loan, loanIndex, mappedLoanType, disbursementPeriod: period, inDefault, provenance };
    });
    const active = loans.filter((loan) => typeof loan.outstandingPrincipal === "number" && loan.outstandingPrincipal > 0);
    const repaymentLoans = active.filter((loan) => typeof loan.interestRatePercent === "number").map((loan) => ({ principal: loan.outstandingPrincipal, annualInterestRatePercent: loan.interestRatePercent }));
    const fullyMappedForEligibility = active.length > 0 && active.every((loan) => loan.mappedLoanType && loan.disbursementPeriod);
    const eligibilityLoans = fullyMappedForEligibility ? active.map((loan) => ({ loanType: loan.mappedLoanType, disbursementPeriod: loan.disbursementPeriod, ...(loan.inDefault ? { inDefault: true } : {}) })) : undefined;
    const totalPrincipal = active.reduce((sum, loan) => sum + loan.outstandingPrincipal, 0);
    const totalInterest = active.reduce((sum, loan) => sum + (loan.outstandingInterest || 0), 0);
    const ambiguousCount = active.filter((loan) => !loan.mappedLoanType || !loan.disbursementPeriod).length;
    const name = [student["Student First Name"], student["Student Middle Initial"], student["Student Last Name"]].filter(Boolean).join(" ").trim();
    const preferredPhoneKeys = [["Student Cell Phone Number","Student Cell Phone Country Code","Student Cell Phone Preferred"],["Student Home Phone Number","Student Home Phone Country Code","Student Home Phone Preferred"],["Student Work Phone Number","Student Work Phone Country Code","Student Work Phone Preferred"]];
    const phoneChoice = preferredPhoneKeys.find(([numberKey,,preferredKey]) => student[numberKey] && studentAidYesLocal(student[preferredKey]) === true) || preferredPhoneKeys.find(([numberKey]) => student[numberKey]);
    const phone = phoneChoice ? [student[phoneChoice[1]] ? "+" + String(student[phoneChoice[1]]).replace(/^\+/,"") : "", student[phoneChoice[0]]].filter(Boolean).join(" ") : "";
    const borrower = { provenance: {} };
    [["displayName",name],["email",student["Student Email Address"]],["phone",phone],["streetAddress1",student["Student Street Address 1"]],["streetAddress2",student["Student Street Address 2"]],["city",student["Student City"]],["stateCode",student["Student State Code"]],["countryCode",student["Student Country Code"]],["zipCode",student["Student Zip Code"]]].forEach(([field,value]) => { if (value) { borrower[field] = String(value).trim(); borrower.provenance[field] = "imported_studentaid"; } });
    const relevantContact = active.flatMap((loan) => loan.contacts || []).find((contact) => contact.mostRelevant && contact.name) || active.flatMap((loan) => loan.contacts || []).find((contact) => contact.name);
    const summary = { loanCount: loans.length, activeLoanCount: active.length, totalOutstandingPrincipal: totalPrincipal, totalOutstandingInterest: totalInterest, repaymentLoanCount: repaymentLoans.length, eligibilityMappedLoanCount: active.length - ambiguousCount, ambiguousEligibilityLoanCount: ambiguousCount, hasLoanDisbursedOnOrAfterJuly1_2026: active.some((loan) => loan.disbursementPeriod === "on_or_after_2026_07_01") };
    return { fileRequestDate, borrower, loans, repaymentLoans, eligibilityLoans, totalPrincipal, totalInterest, ambiguousCount, summary, servicerName: relevantContact?.name || null };
  }

  function provenanceLabel(value) {
    return ({ imported_studentaid:"Imported from StudentAid", derived_studentaid:"Derived from StudentAid", advisor_entered:"Advisor entered", borrower_confirmed:"Borrower confirmed", missing_review:"Missing / needs review" })[value] || "Missing / needs review";
  }

  function renderPortfolio(portfolio) {
    portfolioSummary.replaceChildren();
    studentAidReview.replaceChildren();
    if (!portfolio.loans.length) return;
    const summary = document.createElement("div");
    summary.className = "summary";
    [["Active loans found", String(portfolio.summary?.activeLoanCount ?? portfolio.loans.length)], ["Outstanding principal", money.format(portfolio.totalPrincipal)], ["Outstanding interest", money.format(portfolio.totalInterest || 0)], ["Balance + rate rows", String(portfolio.repaymentLoans.length)], ["Eligibility mapped", String(portfolio.summary?.eligibilityMappedLoanCount ?? 0)], ["Post-7/1/2026 loan", portfolio.summary?.hasLoanDisbursedOnOrAfterJuly1_2026 ? "Yes" : "No"]].forEach(([label, value]) => {
      const metric = document.createElement("div");
      metric.className = "metric";
      metric.append(addText("span", label, "muted"), addText("strong", value));
      summary.appendChild(metric);
    });
    portfolioSummary.appendChild(summary);
    if (portfolio.ambiguousCount) portfolioSummary.appendChild(addText("p", String(portfolio.ambiguousCount) + " active loan record(s) have an ambiguous type/date for eligibility screening. Their balances can still be modeled when an interest rate is present, but this calculator will not guess consolidation/Parent PLUS history.", "muted"));

    const heading = document.createElement("div"); heading.className = "guide-head";
    const headingText = document.createElement("div"); headingText.append(addText("h3", "Imported StudentAid facts"), addText("p", "Review the normalized fields below. In advisor mode, only these normalized facts can be saved; the raw .txt file never leaves this browser.", "muted"));
    heading.appendChild(headingText); studentAidReview.appendChild(heading);
    const borrowerGrid = document.createElement("div"); borrowerGrid.className = "grid";
    const contactFields = [["displayName","Borrower name"],["email","Email"],["phone","Phone"],["streetAddress1","Street address 1"],["streetAddress2","Street address 2"],["city","City"],["stateCode","State / region"],["countryCode","Country"],["zipCode","ZIP / postal code"]];
    importedFieldProvenance = { ...(portfolio.borrower?.provenance || {}), ...importedFieldProvenance };
    contactFields.forEach(([field,label]) => {
      const wrapper = document.createElement("label");
      const title = document.createElement("span"); title.append(addText("span", provenanceLabel(importedFieldProvenance[field] || (portfolio.borrower?.[field] ? "imported_studentaid" : "missing_review")), "basis"), document.createTextNode(label));
      const input = document.createElement("input"); input.value = portfolio.borrower?.[field] || ""; input.dataset.importField = field; input.placeholder = "Not supplied by StudentAid";
      input.addEventListener("input", () => {
        importedFieldProvenance[field] = advisorClientId ? "advisor_entered" : "borrower_confirmed";
        if (portfolio.borrower) portfolio.borrower[field] = input.value;
        if (field === "displayName") setDocumentValue("borrowerName", input.value);
        title.querySelector(".basis").textContent = provenanceLabel(importedFieldProvenance[field]);
      });
      wrapper.append(title, input); borrowerGrid.appendChild(wrapper);
    });
    studentAidReview.appendChild(borrowerGrid);

    const loansHeading = addText("h3", "Individual loan facts"); loansHeading.style.marginTop = "18px"; studentAidReview.appendChild(loansHeading);
    portfolio.loans.forEach((loan, index) => {
      const details = document.createElement("details"); details.className = "readiness-card"; if (index === 0) details.open = true;
      const label = loan.loanTypeDescription || loan.mappedLoanType || loan.loanTypeCode || "Loan " + (index + 1);
      const header = document.createElement("summary"); header.textContent = label + " · " + (typeof loan.outstandingPrincipal === "number" ? money.format(loan.outstandingPrincipal) : "no outstanding principal"); details.appendChild(header);
      const list = document.createElement("ul");
      const skip = new Set(["loanIndex","statuses","disbursements","contacts","provenance"]);
      Object.entries(loan).forEach(([key,value]) => { if (skip.has(key) || value === undefined || value === null || value === "") return; const source = loan.provenance?.[key] || (["mappedLoanType","disbursementPeriod","inDefault"].includes(key) ? "derived_studentaid" : "imported_studentaid"); list.appendChild(addText("li", provenanceLabel(source) + " · " + key.replace(/([A-Z])/g," $1").replace(/^./,(c)=>c.toUpperCase()) + ": " + String(value))); });
      (loan.statuses || []).forEach((statusFact) => list.appendChild(addText("li", "Imported from StudentAid · Status: " + [statusFact.code,statusFact.description,statusFact.effectiveDate].filter(Boolean).join(" · "))));
      (loan.disbursements || []).forEach((disbursement) => list.appendChild(addText("li", "Imported from StudentAid · Disbursement: " + [disbursement.date, typeof disbursement.amount === "number" ? money.format(disbursement.amount) : ""].filter(Boolean).join(" · "))));
      (loan.contacts || []).forEach((contact) => list.appendChild(addText("li", "Imported from StudentAid · Contact: " + [contact.type,contact.name,contact.phoneNumber,contact.emailAddress,contact.websiteAddress].filter(Boolean).join(" · "))));
      details.appendChild(list); studentAidReview.appendChild(details);
    });

    if (portfolio.borrower?.displayName) setDocumentValue("borrowerName", portfolio.borrower.displayName);
    if (portfolio.servicerName) setDocumentValue("servicerName", portfolio.servicerName);
    setCalculatorValue("principal", portfolio.totalPrincipal);
    if (portfolio.repaymentLoans.length === 1) setCalculatorValue("interestRate", portfolio.repaymentLoans[0].annualInterestRatePercent); else setCalculatorValue("interestRate", "");
    if (portfolio.eligibilityLoans?.length === 1) { setCalculatorValue("loanType", portfolio.eligibilityLoans[0].loanType); setCalculatorValue("disbursementPeriod", portfolio.eligibilityLoans[0].disbursementPeriod); } else setCalculatorValue("loanType", "");
  }

  function syncHourlyFields() {
    const hourly = cadence.value === "hourly";
    hoursField.hidden = !hourly;
    weeksField.hidden = !hourly;
  }

  function addText(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function render(result) {
    results.replaceChildren();
    results.appendChild(addText("h2", "Estimate"));

    const summary = document.createElement("div");
    summary.className = "summary";
    [
      ["Annualized taxable gross", money.format(result.normalizedAnnualTaxableGrossIncome)],
      ["Estimated AGI", money.format(result.estimatedAdjustedGrossIncome)],
      ["2026 poverty guideline", money.format(result.povertyGuideline)]
    ].forEach(([label, value]) => {
      const metric = document.createElement("div");
      metric.className = "metric";
      metric.append(addText("span", label, "muted"), addText("strong", value));
      summary.appendChild(metric);
    });
    results.appendChild(summary);

    const plans = document.createElement("div");
    plans.className = "plans";
    result.planEstimates.forEach((plan) => {
      const card = document.createElement("article");
      card.className = "plan";
      const head = document.createElement("div");
      head.className = "plan-head";
      const title = document.createElement("div");
      title.append(addText("strong", plan.plan), document.createTextNode(" "), addText("span", plan.eligibility.status, "badge"));
      head.append(title, addText("span", money.format(plan.monthlyPaymentEstimate) + "/mo", "payment"));
      card.append(head);
      card.appendChild(addText("p", plan.formulaSummary));
      card.appendChild(addText("p", plan.eligibilityNote, "muted"));
      if (plan.warnings.length) {
        const list = document.createElement("ul");
        plan.warnings.forEach((warning) => list.appendChild(addText("li", warning)));
        card.appendChild(list);
      }
      plans.appendChild(card);
    });
    results.appendChild(plans);

    const caveats = document.createElement("details");
    const summaryNode = addText("summary", "Assumptions and warnings");
    caveats.appendChild(summaryNode);
    const list = document.createElement("ul");
    [...result.assumptions, ...result.warnings].forEach((item) => list.appendChild(addText("li", item)));
    caveats.appendChild(list);
    results.appendChild(caveats);
  }

  const guidedFacts = new Map();
  let guideStep = "goal";
  let guideIncomeSituation = null;

  function guideSay(text, role = "guide") {
    const node = addText("div", text, "message " + role);
    guideTranscript.appendChild(node);
    guideTranscript.scrollTop = guideTranscript.scrollHeight;
  }

  function recordGuidedFact(key, label, value, basis = "Stated fact") {
    guidedFacts.set(key, { label, value, basis });
    guidedFactsList.replaceChildren();
    guidedFacts.forEach((fact) => {
      const item = document.createElement("li");
      const tag = addText("span", fact.basis, "basis");
      item.append(tag, document.createTextNode(fact.label + ": " + fact.value));
      guidedFactsList.appendChild(item);
    });
  }

  function setCalculatorValue(name, value) {
    const control = form.elements.namedItem(name);
    if (control && "value" in control) control.value = String(value);
  }

  function setDocumentValue(name, value) {
    const control = documentForm.elements.namedItem(name);
    if (control && "value" in control) control.value = String(value);
  }

  function documentSourceType() {
    if (guideIncomeSituation === "unemployment") return "unemployment";
    if (guideIncomeSituation === "self_employment") return "self_employment";
    if (guideIncomeSituation === "employment") return "employment";
    return "other";
  }

  function sourceTypeLabel(value) {
    const labels = {
      employment: "Employment",
      self_employment: "Self-employment",
      contract: "Contract / gig income",
      unemployment: "Unemployment compensation",
      other: "Other taxable income"
    };
    return labels[value] || "Other taxable income";
  }

  function evidenceStatusLabel(value) {
    if (value === "documented") return "Evidence in hand (borrower-stated)";
    if (value === "identified") return "Evidence identified (borrower-stated)";
    return "Needs evidence / review";
  }

  function sourceEvidenceGuidance(sourceType) {
    if (sourceType === "employment") return "Recent pay stub(s) or an employer statement showing gross pay and pay frequency.";
    if (sourceType === "self_employment" || sourceType === "contract") return "Recent client/business payment records, invoices paired with payment evidence, or a payer statement that reflects current taxable income.";
    if (sourceType === "unemployment") return "Recent unemployment-benefits statement or payment history.";
    return "A recent payer/source record showing the current taxable amount and payment frequency, or another item requested by the servicer.";
  }

  function sourceDocumentReady(source) {
    return Boolean(source && source.sourceType && typeof source.grossAmount === "number" && source.paymentFrequency);
  }

  function sourceApplicationReady(source) {
    return sourceDocumentReady(source) && Boolean(source.name) && ["documented", "identified"].includes(source.evidenceStatus);
  }

  function savedEvidenceToGuide(value) {
    if (value === "evidence_in_hand") return "documented";
    if (value === "evidence_identified") return "identified";
    return "missing";
  }

  function guideEvidenceToSaved(value) {
    if (value === "documented") return "evidence_in_hand";
    if (value === "identified") return "evidence_identified";
    return "needs_evidence_review";
  }

  async function advisorApi(path, init = {}) {
    const headers = new Headers(init.headers || {});
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (advisorCsrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method || "GET")) headers.set("x-csrf-token", advisorCsrfToken);
    const response = await fetch(path, { ...init, headers });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { throw new Error("Advisor workspace returned an invalid response."); }
    if (!response.ok || !body?.ok) {
      const error = new Error(body?.error || "Advisor workspace request failed.");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function guidedIncomeForPersistence() {
    if (guidedIncomeSources.length) {
      const data = new FormData(form);
      return guidedIncomeSources.map((source) => source.paymentFrequency === "hourly"
        ? { cadence: "hourly", hourlyRate: source.grossAmount, hoursPerWeek: Number(data.get("hoursPerWeek")), weeksPerYear: Number(data.get("weeksPerYear")) }
        : { cadence: source.paymentFrequency, amount: source.grossAmount });
    }
    if (guideIncomeSituation === "none") return [{ cadence: "annual", amount: 0 }];
    return Array.isArray(advisorSavedIncome) ? advisorSavedIncome : [];
  }

  function advisorReadinessForPersistence() {
    if (guideIncomeSituation === "none") return "document_ready";
    if (!guidedIncomeSources.length) return advisorClient?.readinessState || "needs_evidence";
    if (guidedIncomeSources.every(sourceApplicationReady)) return "application_ready";
    if (guidedIncomeSources.every(sourceDocumentReady)) return "document_ready";
    return "needs_evidence";
  }

  function hydrateAdvisorClient(client) {
    advisorClient = client;
    advisorClientBar.hidden = false;
    advisorClientName.textContent = client.contact.displayName + (advisorIdentity?.displayName ? " · advisor: " + advisorIdentity.displayName : "");
    advisorSaveStatus.textContent = "Saved client loaded. Continue the guided workflow and save when you want to persist confirmed normalized facts.";
    setDocumentValue("borrowerName", client.contact.displayName);
    if (client.servicerName) setDocumentValue("servicerName", client.servicerName);

    guidedFacts.clear();
    guidedFactsList.replaceChildren(addText("li", "No guided facts confirmed yet.", "muted"));
    const facts = client.confirmedFacts || {};
    advisorSavedIncome = Array.isArray(facts.income) ? facts.income : null;
    guidedIncomeSources = Array.isArray(facts.incomeSources) ? facts.incomeSources.map((source) => ({
      sourceType: source.sourceType || "other",
      ...(source.name ? { name: source.name } : {}),
      ...(source.address ? { address: source.address } : {}),
      ...(typeof source.grossAmount === "number" ? { grossAmount: source.grossAmount } : {}),
      ...(source.paymentFrequency ? { paymentFrequency: source.paymentFrequency } : {}),
      evidenceStatus: savedEvidenceToGuide(source.evidenceState)
    })).filter((source) => typeof source.grossAmount === "number" && source.paymentFrequency) : [];

    if (guidedIncomeSources.length) {
      guideIncomeSituation = guidedIncomeSources.length > 1 ? "multiple" : guidedIncomeSources[0].sourceType;
      guidedIncomeSources.forEach((source, index) => recordGuidedFact(
        "income_source_" + (index + 1),
        "Taxable income source " + (index + 1),
        sourceTypeLabel(source.sourceType) + " · " + money.format(source.grossAmount) + " · " + source.paymentFrequency + " · " + evidenceStatusLabel(source.evidenceStatus)
      ));
      const first = guidedIncomeSources[0];
      guideIncomeCadence = first.paymentFrequency;
      guideIncomeAmount = first.grossAmount;
      cadence.value = first.paymentFrequency;
      setCalculatorValue("incomeAmount", first.grossAmount);
      syncHourlyFields();
    } else if (advisorSavedIncome?.length) {
      const first = advisorSavedIncome[0];
      recordGuidedFact("saved_income", "Saved taxable income inputs", String(advisorSavedIncome.length) + " source(s)", "Stated fact");
      if (first.cadence) cadence.value = first.cadence;
      const firstAmount = typeof first.amount === "number" ? first.amount : first.hourlyRate;
      if (typeof firstAmount === "number") setCalculatorValue("incomeAmount", firstAmount);
      syncHourlyFields();
    }

    if (facts.region) {
      setCalculatorValue("region", facts.region);
      recordGuidedFact("region", "Poverty-guideline region", facts.region === "contiguous_us" ? "48 states + D.C." : facts.region === "alaska" ? "Alaska" : "Hawaii");
    }
    if (typeof facts.familySize === "number") {
      setCalculatorValue("familySize", facts.familySize);
      recordGuidedFact("family_size", "Legacy IDR family size", String(facts.familySize));
    }
    if (typeof facts.dependentsClaimedOnFederalTaxReturn === "number") {
      setCalculatorValue("dependents", facts.dependentsClaimedOnFederalTaxReturn);
      recordGuidedFact("dependents", "Federal tax-return dependents for RAP", String(facts.dependentsClaimedOnFederalTaxReturn));
    }
    if (facts.taxFilingStatus) setCalculatorValue("taxFilingStatus", facts.taxFilingStatus);
    if (typeof facts.newBorrowerOnOrAfterJuly1_2014 === "boolean") {
      setCalculatorValue("ibrNewBorrower", facts.newBorrowerOnOrAfterJuly1_2014);
      recordGuidedFact("ibr_borrower_timing", "IBR borrower timing", facts.newBorrowerOnOrAfterJuly1_2014 ? "New borrower on/after July 1, 2014" : "Earlier borrower");
    }
    advisorComparisonWorkspace.hidden = false;
    advisorComparisonStatus.textContent = "Saved facts loaded. Compare after saving any changes you make in this session.";

    if (client.normalizedLoanPortfolio?.repaymentLoans?.length || client.normalizedLoanPortfolio?.loans?.length) {
      const repaymentLoans = client.normalizedLoanPortfolio.repaymentLoans || [];
      const eligibilityLoans = client.normalizedLoanPortfolio.eligibilityLoans;
      const savedLoans = client.normalizedLoanPortfolio.loans?.length
        ? client.normalizedLoanPortfolio.loans
        : repaymentLoans.map((loan, loanIndex) => ({ loanIndex, outstandingPrincipal: loan.principal, interestRatePercent: loan.annualInterestRatePercent, provenance: { outstandingPrincipal: "imported_studentaid", interestRatePercent: "imported_studentaid" } }));
      const totalPrincipal = client.normalizedLoanPortfolio.summary?.totalOutstandingPrincipal ?? repaymentLoans.reduce((sum, loan) => sum + loan.principal, 0);
      const totalInterest = client.normalizedLoanPortfolio.summary?.totalOutstandingInterest ?? savedLoans.reduce((sum, loan) => sum + (loan.outstandingInterest || 0), 0);
      importedFieldProvenance = { ...(client.fieldProvenance || {}) };
      importedPortfolio = {
        loans: savedLoans,
        repaymentLoans,
        ...(eligibilityLoans ? { eligibilityLoans } : {}),
        summary: client.normalizedLoanPortfolio.summary || { loanCount: savedLoans.length, activeLoanCount: repaymentLoans.length, totalOutstandingPrincipal: totalPrincipal, totalOutstandingInterest: totalInterest, repaymentLoanCount: repaymentLoans.length, eligibilityMappedLoanCount: eligibilityLoans?.length || 0, ambiguousEligibilityLoanCount: eligibilityLoans ? 0 : repaymentLoans.length, hasLoanDisbursedOnOrAfterJuly1_2026: Boolean(eligibilityLoans?.some((loan) => loan.disbursementPeriod === "on_or_after_2026_07_01")) },
        totalPrincipal,
        totalInterest,
        ambiguousCount: client.normalizedLoanPortfolio.summary?.ambiguousEligibilityLoanCount ?? (eligibilityLoans ? 0 : repaymentLoans.length),
        borrower: { ...client.contact, provenance: { ...(client.fieldProvenance || {}) } },
        servicerName: client.servicerName || null,
        fileRequestDate: client.studentAidImport?.fileRequestDate || null
      };
      renderPortfolio(importedPortfolio);
      importStatus.textContent = "Saved normalized StudentAid facts loaded. The raw StudentAid.gov file was never stored on the server.";
    }

    renderIncomeReadiness();
    guideTranscript.replaceChildren();
    guideAnswers.replaceChildren();
    guideSay("Resumed " + client.contact.displayName + " from the advisor workspace. Only previously saved normalized facts were loaded; raw StudentAid files and evidence files are not stored here.");
    const hasIncome = guidedIncomeSources.length > 0 || Boolean(advisorSavedIncome?.length) || guideIncomeSituation === "none";
    guideStep = !hasIncome ? "income_situation"
      : typeof facts.familySize !== "number" ? "family_size"
      : typeof facts.dependentsClaimedOnFederalTaxReturn !== "number" ? "dependents"
      : !facts.region ? "region"
      : "done";
    if (guideStep === "done") guideSay("Saved application facts are loaded. Review them, update anything that changed, import a fresh StudentAid file locally if needed, calculate, regenerate documents, then save progress.");
    else showGuideStep();
  }

  async function initializeAdvisorClientMode() {
    advisorClientBar.hidden = false;
    advisorSaveStatus.textContent = "Loading authenticated advisor session and saved client facts…";
    try {
      const session = await fetch("/api/advisor/session", { headers: { accept: "application/json" } });
      if (session.status === 401) {
        window.location.replace("/advisor");
        return;
      }
      const sessionBody = await session.json();
      if (!session.ok || !sessionBody.ok) throw new Error(sessionBody.error || "Unable to resume advisor session.");
      advisorCsrfToken = sessionBody.csrfToken;
      advisorIdentity = sessionBody.advisor;
      const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClientId));
      hydrateAdvisorClient(body.client);
    } catch (error) {
      advisorSaveStatus.textContent = error instanceof Error ? error.message : "Unable to load the saved client.";
      guideTranscript.replaceChildren();
      guideAnswers.replaceChildren();
      guideSay("This saved client could not be loaded. Return to the advisor dashboard and reopen the client.");
    }
  }

  function reviewedStudentAidContact() {
    const values = { ...(advisorClient?.contact || {}) };
    studentAidReview.querySelectorAll("[data-import-field]").forEach((input) => {
      const field = input.dataset.importField;
      if (!field) return;
      const value = String(input.value || "").trim();
      if (value) values[field] = value; else delete values[field];
    });
    if (!values.displayName) values.displayName = advisorClient?.contact?.displayName || "Client";
    return values;
  }

  async function saveAdvisorClientProgress() {
    if (!advisorClient || !advisorCsrfToken) return false;
    advisorSaveProgress.disabled = true;
    advisorSaveStatus.textContent = "Saving normalized client facts…";
    try {
      const facts = { ...(advisorClient.confirmedFacts || {}) };
      const income = guidedIncomeForPersistence();
      if (income.length) facts.income = income;
      if (guidedIncomeSources.length) facts.incomeSources = guidedIncomeSources.map((source) => ({
        sourceType: source.sourceType,
        ...(source.name ? { name: source.name } : {}),
        ...(source.address ? { address: source.address } : {}),
        grossAmount: source.grossAmount,
        paymentFrequency: source.paymentFrequency,
        evidenceState: guideEvidenceToSaved(source.evidenceStatus)
      }));
      const formData = new FormData(form);
      if (guidedFacts.has("region")) facts.region = String(formData.get("region"));
      if (guidedFacts.has("family_size")) facts.familySize = Number(formData.get("familySize"));
      if (guidedFacts.has("dependents")) facts.dependentsClaimedOnFederalTaxReturn = Number(formData.get("dependents"));
      const taxFilingStatus = String(formData.get("taxFilingStatus") || "");
      if (taxFilingStatus) facts.taxFilingStatus = taxFilingStatus;
      const ibrNewBorrower = String(formData.get("ibrNewBorrower") || "");
      if (ibrNewBorrower) facts.newBorrowerOnOrAfterJuly1_2014 = ibrNewBorrower === "true";

      const body = {
        expectedUpdatedAt: advisorClient.updatedAt,
        confirmedFacts: facts,
        readinessState: advisorReadinessForPersistence()
      };
      if (studentAidReview.querySelector("[data-import-field]")) {
        body.contact = reviewedStudentAidContact();
        body.fieldProvenance = { ...importedFieldProvenance };
      }
      const servicerControl = documentForm.elements.namedItem("servicerName");
      if (servicerControl && "value" in servicerControl) body.servicerName = String(servicerControl.value).trim();
      if (importedPortfolio?.repaymentLoans?.length || importedPortfolio?.loans?.length) {
        body.normalizedLoanPortfolio = {
          repaymentLoans: importedPortfolio.repaymentLoans || [],
          ...(importedPortfolio.eligibilityLoans ? { eligibilityLoans: importedPortfolio.eligibilityLoans } : {}),
          ...(importedPortfolio.loans ? { loans: importedPortfolio.loans } : {}),
          ...(importedPortfolio.summary ? { summary: importedPortfolio.summary } : {})
        };
      }
      if ((loanFile.files && loanFile.files[0]) || advisorClient.studentAidImport || importedPortfolio?.loans?.length) {
        body.studentAidImport = {
          source: "studentaid_download",
          importedAt: loanFile.files && loanFile.files[0] ? new Date().toISOString() : advisorClient.studentAidImport?.importedAt,
          ...(importedPortfolio?.fileRequestDate ? { fileRequestDate: importedPortfolio.fileRequestDate } : advisorClient.studentAidImport?.fileRequestDate ? { fileRequestDate: advisorClient.studentAidImport.fileRequestDate } : {}),
          mappingVersion: "2026-08-28-v1",
          rawFileRetained: false
        };
      }
      const saved = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId), { method: "PUT", body: JSON.stringify(body) });
      advisorClient = saved.client;
      advisorSaveStatus.textContent = "Saved " + new Date(saved.client.updatedAt).toLocaleString() + ". Raw StudentAid data and evidence files were not retained.";
      return true;
    } catch (error) {
      advisorSaveStatus.textContent = error instanceof Error ? error.message : "Unable to save client progress.";
      return false;
    } finally {
      advisorSaveProgress.disabled = false;
    }
  }

  const svgNs = "http://www.w3.org/2000/svg";
  function svgNode(tag, attrs = {}, text = "") {
    const node = document.createElementNS(svgNs, tag);
    Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, String(value)));
    if (text) node.textContent = text;
    return node;
  }
  function emptyChart(svg, message) {
    svg.replaceChildren(svgNode("text", { x: 360, y: 130, "text-anchor": "middle" }, message));
  }
  function chartPlanStyle(index) {
    return [
      { dash: "", opacity: "1" },
      { dash: "11 5", opacity: ".9" },
      { dash: "3 5", opacity: ".82" },
      { dash: "15 5 3 5", opacity: ".75" }
    ][index % 4];
  }
  function renderLineChart(svg, projections, valueForPoint, paymentMode = false) {
    const usable = projections.filter((projection) => projection.series?.length);
    if (!usable.length) { emptyChart(svg, "No bounded projection available"); return; }
    const values = [];
    let maxMonth = 1;
    usable.forEach((projection) => projection.series.forEach((point) => {
      maxMonth = Math.max(maxMonth, point.month);
      values.push(paymentMode ? projection.currentMonthlyPayment : valueForPoint(point));
    }));
    const maxValue = Math.max(1, ...values);
    const left = 70, top = 22, width = 610, height = 190, bottom = top + height;
    const x = (month) => left + month / maxMonth * width;
    const y = (value) => bottom - value / maxValue * height;
    svg.replaceChildren(
      svgNode("line", { x1: left, y1: top, x2: left, y2: bottom, class: "axis" }),
      svgNode("line", { x1: left, y1: bottom, x2: left + width, y2: bottom, class: "axis" }),
      svgNode("text", { x: left, y: 238, "text-anchor": "middle" }, "Now"),
      svgNode("text", { x: left + width, y: 238, "text-anchor": "end" }, (maxMonth / 12).toFixed(maxMonth % 12 ? 1 : 0) + " yr"),
      svgNode("text", { x: 62, y: bottom + 4, "text-anchor": "end" }, "$0"),
      svgNode("text", { x: 62, y: top + 4, "text-anchor": "end" }, money.format(maxValue))
    );
    usable.forEach((projection, index) => {
      const style = chartPlanStyle(index);
      const points = projection.series.map((point) => ({ month: point.month, value: paymentMode ? projection.currentMonthlyPayment : valueForPoint(point) }));
      const d = points.map((point, pointIndex) => (pointIndex ? "L" : "M") + x(point.month).toFixed(1) + " " + y(point.value).toFixed(1)).join(" ");
      const path = svgNode("path", { d, class: "series", opacity: style.opacity, "stroke-dasharray": style.dash });
      const last = points[points.length - 1];
      const label = svgNode("text", { x: Math.min(690, x(last.month) + 5), y: Math.max(14, y(last.value) - 5 + index * 12), "text-anchor": "end" }, projection.plan);
      svg.append(path, label);
    });
  }
  function renderForgivenessChart(svg, projections) {
    const usable = projections.filter((projection) => typeof projection.projectedForgiveness === "number");
    if (!usable.length) { emptyChart(svg, "Forgiveness withheld for current saved facts"); return; }
    const maxValue = Math.max(1, ...usable.map((projection) => projection.projectedForgiveness));
    const left = 85, top = 22, width = 570, rowHeight = 50;
    svg.replaceChildren();
    usable.forEach((projection, index) => {
      const y = top + index * rowHeight;
      const barWidth = projection.projectedForgiveness / maxValue * width;
      svg.append(
        svgNode("text", { x: left - 10, y: y + 21, "text-anchor": "end" }, projection.plan),
        svgNode("rect", { x: left, y, width: Math.max(1, barWidth), height: 28, fill: "currentColor", opacity: String(.85 - index * .12), rx: 5 }),
        svgNode("text", { x: Math.min(700, left + barWidth + 7), y: y + 20 }, money.format(projection.projectedForgiveness))
      );
    });
  }
  function renderAdvisorComparison(comparison) {
    advisorComparisonWorkspace.hidden = false;
    advisorComparisonCards.replaceChildren();
    comparison.projections.forEach((projection) => {
      const card = document.createElement("article");
      card.className = "comparison-card";
      const title = document.createElement("div");
      title.className = "plan-head";
      const name = document.createElement("div");
      name.append(addText("h3", projection.plan), addText("span", projection.eligibilityStatus, "badge"));
      title.append(name, addText("span", money.format(projection.currentMonthlyPayment) + "/mo", "payment"));
      card.append(title, addText("p", projection.horizonLabel, "muted"));
      const metrics = document.createElement("div");
      metrics.className = "comparison-metrics";
      [
        ["Modeled borrower paid", projection.projectedBorrowerPaid],
        ["Modeled remaining balance", projection.projectedRemainingBalance],
        ["Estimated forgiveness", projection.projectedForgiveness],
        ["RAP principal match", projection.projectedPrincipalMatch]
      ].forEach(([label, value]) => {
        const box = document.createElement("div");
        box.append(addText("span", label, "muted"), addText("strong", typeof value === "number" ? money.format(value) : "Withheld"));
        metrics.appendChild(box);
      });
      card.appendChild(metrics);
      if (typeof projection.projectedInterestWaived === "number") card.appendChild(addText("p", "Modeled RAP interest waived: " + money.format(projection.projectedInterestWaived), "muted"));
      if (projection.payoffMonth) card.appendChild(addText("p", "Modeled payoff before horizon: month " + projection.payoffMonth + ".", "muted"));
      if (projection.warnings?.length) {
        const details = document.createElement("details");
        details.appendChild(addText("summary", "Projection caveats"));
        const list = document.createElement("ul");
        projection.warnings.forEach((warning) => list.appendChild(addText("li", warning)));
        details.appendChild(list);
        card.appendChild(details);
      }
      advisorComparisonCards.appendChild(card);
    });
    renderLineChart(advisorPaymentChart, comparison.projections, () => 0, true);
    renderLineChart(advisorPaidChart, comparison.projections, (point) => point.cumulativeBorrowerPaid);
    renderLineChart(advisorBalanceChart, comparison.projections, (point) => point.remainingBalance);
    renderForgivenessChart(advisorForgivenessChart, comparison.projections);
    advisorComparisonAssumptions.replaceChildren(addText("strong", "Model assumptions"));
    const assumptions = document.createElement("ul");
    comparison.assumptions.forEach((assumption) => assumptions.appendChild(addText("li", assumption)));
    advisorComparisonAssumptions.appendChild(assumptions);
    advisorComparisonStatus.textContent = "Comparison generated from the saved client record under policy snapshot " + comparison.policySnapshot + ".";
    advisorComparisonWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  async function retainedNamePrompt(label) {
    const value = window.prompt(label + " name", label + " · " + new Date().toLocaleString());
    return value && value.trim() ? value.trim() : null;
  }
  async function retainCurrentDocument() {
    if (!advisorClient || !documentDraft || !documentReviewed.checked) return;
    const name = await retainedNamePrompt("Document draft"); if (!name) return;
    try {
      const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/artifacts", { method:"POST", body:JSON.stringify({ name, templateRequest:documentRequest("text") }) });
      advisorSaveStatus.textContent = "Retained document draft: " + body.artifact.name + ".";
      await loadAdvisorHistory();
    } catch (error) { advisorSaveStatus.textContent = error instanceof Error ? error.message : "Unable to retain document draft."; }
  }
  async function retainCurrentSnapshot(kind) {
    if (!advisorClient) return;
    const name = await retainedNamePrompt(kind === "comparison" ? "Comparison snapshot" : "Calculation snapshot"); if (!name) return;
    const saved = await saveAdvisorClientProgress(); if (!saved) return;
    try {
      const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/snapshots", { method:"POST", body:JSON.stringify({ name, snapshotKind:kind }) });
      advisorSaveStatus.textContent = "Retained " + body.snapshot.snapshotKind + " snapshot: " + body.snapshot.name + ".";
      await loadAdvisorHistory();
    } catch (error) { advisorSaveStatus.textContent = error instanceof Error ? error.message : "Unable to retain calculation snapshot."; }
  }
  async function deleteHistoryItem(kind, itemId, name) {
    if (!advisorClient || !window.confirm("Permanently delete retained history item “" + name + "”?")) return;
    try { await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/" + kind + "/" + encodeURIComponent(itemId), { method:"DELETE", body:"{}" }); await loadAdvisorHistory(); }
    catch (error) { advisorHistoryStatus.textContent = error instanceof Error ? error.message : "Unable to delete retained history."; }
  }
  function historyAction(label, handler) { const button=addText("button",label); button.type="button"; button.addEventListener("click",handler); return button; }
  async function loadAdvisorHistory() {
    if (!advisorClient) return;
    advisorHistoryWorkspace.hidden = false; advisorHistoryStatus.textContent = "Loading retained history…";
    try {
      const [artifactBody,snapshotBody] = await Promise.all([
        advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/artifacts"),
        advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/snapshots")
      ]);
      advisorArtifactHistory.replaceChildren(); advisorSnapshotHistory.replaceChildren();
      if (!artifactBody.artifacts.length) advisorArtifactHistory.appendChild(addText("p","No retained document drafts yet.","muted"));
      artifactBody.artifacts.forEach((artifact) => {
        const card=document.createElement("article"); card.className="history-item"; card.append(addText("strong",artifact.name),addText("div","Retained " + new Date(artifact.createdAt).toLocaleString() + " · engine " + artifact.engineVersion,"muted"));
        const actions=document.createElement("div"); actions.className="actions";
        actions.append(historyAction("Regenerate",async()=>{ const body=await advisorApi("/api/advisor/clients/"+encodeURIComponent(advisorClient.clientId)+"/artifacts/"+encodeURIComponent(artifact.artifactId)+"/regenerate",{method:"POST",body:"{}"}); documentDraft={text:body.regenerated.documentText,html:body.regenerated.documentHtml}; documentPreview.textContent=documentDraft.text; documentDraftArea.hidden=false; documentReviewed.checked=false; syncDocumentActions(); documentWorkspace.hidden=false; documentWorkspace.scrollIntoView({behavior:"smooth",block:"start"}); }),historyAction("Export JSON",async()=>{ const body=await advisorApi("/api/advisor/clients/"+encodeURIComponent(advisorClient.clientId)+"/artifacts/"+encodeURIComponent(artifact.artifactId)); downloadJson("retained-document-"+artifact.artifactId+".json",body); }),historyAction("Delete",()=>{void deleteHistoryItem("artifacts",artifact.artifactId,artifact.name);})); card.appendChild(actions); advisorArtifactHistory.appendChild(card);
      });
      if (!snapshotBody.snapshots.length) advisorSnapshotHistory.appendChild(addText("p","No retained calculation snapshots yet.","muted"));
      snapshotBody.snapshots.forEach((snapshot) => {
        const card=document.createElement("article"); card.className="history-item"; card.append(addText("strong",snapshot.name),addText("div",snapshot.snapshotKind+" · policy "+snapshot.policySnapshot+" · "+new Date(snapshot.createdAt).toLocaleString(),"muted"));
        const actions=document.createElement("div"); actions.className="actions";
        actions.append(historyAction("Rerun retained basis",async()=>{ const body=await advisorApi("/api/advisor/clients/"+encodeURIComponent(advisorClient.clientId)+"/snapshots/"+encodeURIComponent(snapshot.snapshotId)+"/rerun",{method:"POST",body:"{}"}); if(snapshot.snapshotKind==="comparison") renderAdvisorComparison(body.rerun.result); else { render(body.rerun.result); results.scrollIntoView({behavior:"smooth",block:"start"}); } }),historyAction("Export JSON",async()=>{ const body=await advisorApi("/api/advisor/clients/"+encodeURIComponent(advisorClient.clientId)+"/snapshots/"+encodeURIComponent(snapshot.snapshotId)); downloadJson("retained-snapshot-"+snapshot.snapshotId+".json",body); }),historyAction("Delete",()=>{void deleteHistoryItem("snapshots",snapshot.snapshotId,snapshot.name);})); card.appendChild(actions); advisorSnapshotHistory.appendChild(card);
      });
      advisorHistoryStatus.textContent = artifactBody.artifacts.length + " document draft(s) and " + snapshotBody.snapshots.length + " snapshot(s) retained.";
    } catch (error) { advisorHistoryStatus.textContent = error instanceof Error ? error.message : "Unable to load retained history."; }
  }
  async function runAdvisorComparison() {
    if (!advisorClient) return;
    advisorComparePlans.disabled = true;
    advisorComparisonWorkspace.hidden = false;
    advisorComparisonStatus.textContent = "Calculating saved repayment paths…";
    try {
      const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/comparison");
      renderAdvisorComparison(body.comparison);
    } catch (error) {
      advisorComparisonCards.replaceChildren();
      emptyChart(advisorPaymentChart, "Comparison unavailable");
      emptyChart(advisorPaidChart, "Comparison unavailable");
      emptyChart(advisorBalanceChart, "Comparison unavailable");
      emptyChart(advisorForgivenessChart, "Comparison unavailable");
      advisorComparisonStatus.textContent = error instanceof Error ? error.message : "Unable to compare repayment programs.";
    } finally {
      advisorComparePlans.disabled = false;
    }
  }

  function refreshDocumentScopeOptions() {
    const previous = documentScope.value;
    documentScope.replaceChildren();
    const combined = document.createElement("option");
    combined.value = "combined";
    combined.textContent = "Combined confirmed income sources";
    documentScope.appendChild(combined);
    guidedIncomeSources.forEach((source, index) => {
      const option = document.createElement("option");
      option.value = "source:" + index;
      option.textContent = "Source " + (index + 1) + " — " + sourceTypeLabel(source.sourceType) + (source.name ? " — " + source.name : "");
      documentScope.appendChild(option);
    });
    const values = Array.from(documentScope.options).map((option) => option.value);
    documentScope.value = values.includes(previous) ? previous : "combined";
  }

  function renderIncomeReadiness() {
    incomeSourceReadiness.replaceChildren();
    if (!guidedIncomeSources.length) {
      readinessSummary.textContent = guideIncomeSituation === "none"
        ? "No current taxable income was stated. A no-current-taxable-income draft can be prepared, but the borrower should still review current servicer instructions before submission."
        : "No current income sources confirmed yet.";
      refreshDocumentScopeOptions();
      return;
    }

    let documentReadyCount = 0;
    let applicationReadyCount = 0;
    guidedIncomeSources.forEach((source, index) => {
      const documentReady = sourceDocumentReady(source);
      const applicationReady = sourceApplicationReady(source);
      if (documentReady) documentReadyCount += 1;
      if (applicationReady) applicationReadyCount += 1;

      const card = document.createElement("div");
      card.className = "readiness-card";
      const head = document.createElement("div");
      head.className = "readiness-head";
      const title = addText("strong", "Source " + (index + 1) + " — " + sourceTypeLabel(source.sourceType));
      const state = addText("span", applicationReady ? "Application-ready" : documentReady ? "Document-ready" : "Needs review", "badge");
      head.append(title, state);
      card.appendChild(head);
      card.appendChild(addText("p", (source.name || "[payer / source name still missing]") + " · " + money.format(source.grossAmount) + " · " + source.paymentFrequency, "muted"));

      const checklist = document.createElement("ul");
      const checks = [
        [Boolean(source.sourceType), "Income source type confirmed"],
        [typeof source.grossAmount === "number" && Boolean(source.paymentFrequency), "Gross taxable amount and payment frequency confirmed"],
        [Boolean(source.name), "Payer / source name confirmed"],
        [["documented", "identified"].includes(source.evidenceStatus), evidenceStatusLabel(source.evidenceStatus)]
      ];
      checks.forEach(([ok, label]) => checklist.appendChild(addText("li", (ok ? "✓ " : "□ ") + label)));
      card.appendChild(checklist);
      card.appendChild(addText("p", "Typical evidence for this source: " + sourceEvidenceGuidance(source.sourceType), "muted"));
      incomeSourceReadiness.appendChild(card);
    });

    if (applicationReadyCount === guidedIncomeSources.length) {
      readinessSummary.textContent = "Application-ready: every confirmed source has core facts, a payer/source name, and evidence that the borrower says is in hand or identified. Final servicer review is still required.";
    } else if (documentReadyCount === guidedIncomeSources.length) {
      readinessSummary.textContent = "Document-ready: every confirmed source has enough core facts for a draft, but one or more sources still need a payer/source name, evidence, or review before this session should be treated as application-ready.";
    } else {
      readinessSummary.textContent = "Needs review: one or more income sources are missing core amount/frequency facts needed for a source-specific draft.";
    }
    refreshDocumentScopeOptions();
  }

  function documentIncomeSources() {
    const sources = guidedIncomeSources.map((source) => ({
      sourceType: source.sourceType,
      ...(source.name ? { name: source.name } : {}),
      ...(source.address ? { address: source.address } : {}),
      ...(typeof source.grossAmount === "number" ? { grossAmount: source.grossAmount } : {}),
      ...(source.paymentFrequency ? { paymentFrequency: source.paymentFrequency } : {})
    }));

    const sourceNameControl = documentForm.elements.namedItem("sourceName");
    const sourceAddressControl = documentForm.elements.namedItem("sourceAddress");
    const grossAmountControl = documentForm.elements.namedItem("grossAmount");
    const paymentFrequencyControl = documentForm.elements.namedItem("paymentFrequency");
    const sourceName = sourceNameControl && "value" in sourceNameControl ? String(sourceNameControl.value).trim() : "";
    const sourceAddress = sourceAddressControl && "value" in sourceAddressControl ? String(sourceAddressControl.value).trim() : "";
    const grossAmount = grossAmountControl && "value" in grossAmountControl ? numberOrUndefined(String(grossAmountControl.value)) : undefined;
    const paymentFrequency = paymentFrequencyControl && "value" in paymentFrequencyControl ? String(paymentFrequencyControl.value).trim() : "";

    if (sources.length) {
      if (sourceName) sources[0].name = sourceName;
      if (sourceAddress) sources[0].address = sourceAddress;
      if (grossAmount !== undefined) sources[0].grossAmount = grossAmount;
      if (paymentFrequency) sources[0].paymentFrequency = paymentFrequency;
      return sources;
    }

    const source = { sourceType: documentSourceType() };
    if (sourceName) source.name = sourceName;
    if (sourceAddress) source.address = sourceAddress;
    if (grossAmount !== undefined) source.grossAmount = grossAmount;
    if (paymentFrequency) source.paymentFrequency = paymentFrequency;
    return [source];
  }

  function documentRequest(outputFormat) {
    const allSources = documentIncomeSources();
    const scope = documentScope.value;
    const sourceIndex = scope.startsWith("source:") ? Number(scope.slice(7)) : -1;
    const selectedSources = sourceIndex >= 0 && allSources[sourceIndex] ? [allSources[sourceIndex]] : allSources;
    let templateType = guideDocumentGoal || "current_income_statement";
    if (templateType === "auto") templateType = "current_income_statement";
    if (templateType !== "no_current_taxable_income_statement") {
      templateType = selectedSources.length === 1 && selectedSources[0]?.sourceType === "unemployment"
        ? "unemployment_income_statement"
        : "current_income_statement";
    }
    const payload = { templateType, outputFormat };
    for (const name of ["documentDate", "borrowerName", "servicerName", "notes"]) {
      const control = documentForm.elements.namedItem(name);
      const value = control && "value" in control ? String(control.value).trim() : "";
      if (value) payload[name] = value;
    }
    if (templateType !== "no_current_taxable_income_statement") payload.incomeSources = selectedSources;
    return payload;
  }

  async function requestDocument(outputFormat) {
    const response = await fetch("/api/document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(documentRequest(outputFormat))
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Unable to generate document draft.");
    return body.document;
  }

  function syncDocumentActions() {
    const enabled = Boolean(documentDraft) && documentReviewed.checked;
    documentPrint.disabled = !enabled;
    documentDownload.disabled = !enabled;
    advisorRetainDocument.hidden = !advisorClient;
    advisorRetainDocument.disabled = !enabled || !advisorClient;
  }

  async function generateDocumentDraft() {
    documentGenerate.disabled = true;
    documentStatus.textContent = "Generating draft…";
    documentDraft = null;
    documentReviewed.checked = false;
    syncDocumentActions();
    try {
      const [text, html] = await Promise.all([requestDocument("text"), requestDocument("html")]);
      documentDraft = { text, html };
      documentPreview.textContent = text;
      documentDraftArea.hidden = false;
      documentStatus.textContent = "Draft ready. Review every fact before signing or sharing it.";
    } catch (error) {
      documentDraftArea.hidden = true;
      documentStatus.textContent = error instanceof Error ? error.message : "Unable to generate document draft.";
    } finally {
      documentGenerate.disabled = false;
      syncDocumentActions();
    }
  }

  function openGuidedDocumentWorkspace() {
    const primarySource = guidedIncomeSources[0];
    if (primarySource) {
      if (primarySource.name) setDocumentValue("sourceName", primarySource.name);
      if (primarySource.address) setDocumentValue("sourceAddress", primarySource.address);
      if (typeof primarySource.grossAmount === "number") setDocumentValue("grossAmount", primarySource.grossAmount);
      if (primarySource.paymentFrequency) setDocumentValue("paymentFrequency", primarySource.paymentFrequency);
    } else {
      if (guideIncomeAmount !== null && guideIncomeAmount !== undefined) setDocumentValue("grossAmount", guideIncomeAmount);
      if (guideIncomeCadence) setDocumentValue("paymentFrequency", guideIncomeCadence);
    }
    renderIncomeReadiness();
    documentWorkspace.hidden = false;
    documentWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
    void generateDocumentDraft();
  }

  function documentFilename() {
    if (guideDocumentGoal === "unemployment_income_statement") return "unemployment-compensation-income-statement.html";
    if (guideDocumentGoal === "no_current_taxable_income_statement") return "no-current-taxable-income-statement.html";
    return "current-taxable-income-supporting-statement.html";
  }

  const guidePrompts = {
    goal: {
      text: "What would you like help with first?",
      options: [["Could my IBR payment be $0?", "ibr_zero"], ["Estimate my payment", "estimate"], ["Prepare income documents", "documents"], ["Both", "both"]]
    },
    ibr_zero_region: {
      text: "Which poverty-guideline region applies to you? I’ll show the 2026 IBR $0-payment AGI line for family sizes 1–6.",
      options: [["48 states + D.C.", "contiguous_us"], ["Alaska", "alaska"], ["Hawaii", "hawaii"]]
    },
    ibr_zero_followup: {
      text: "Want help preparing the income documentation next?",
      options: [["Prepare stated income document", "current_income_doc"], ["Prepare unemployment statement", "unemployment_doc"], ["Continue to calculator", "calculator"]]
    },
    income_situation: {
      text: "Which best describes your current taxable income situation?",
      options: [["Employment", "employment"], ["Self-employed / contract", "self_employment"], ["Unemployment compensation", "unemployment"], ["Multiple taxable sources", "multiple"], ["No current taxable income", "none"]]
    },
    income_source_type: {
      text: "What type of taxable income source is this? I’ll keep each source separate instead of collapsing them together.",
      options: [["Employment", "employment"], ["Self-employment", "self_employment"], ["Contract / gig income", "contract"], ["Unemployment compensation", "unemployment"], ["Other taxable income", "other"]]
    },
    income_cadence: {
      text: "How often is the income amount for this source paid or received?",
      options: [["Annual", "annual"], ["Monthly", "monthly"], ["Twice monthly", "semimonthly"], ["Every two weeks", "biweekly"], ["Weekly", "weekly"], ["Hourly", "hourly"]]
    },
    income_amount: { text: "What is the gross taxable income amount for this source at that cadence? Type a number, without an SSN or account number.", options: [] },
    source_name: { text: "What payer, employer, agency, client, or source name belongs to this income source? You can leave it as a visible placeholder for the draft, but it will not be application-ready until the source is identified.", options: [["Leave as placeholder", "__skip__"]] },
    source_evidence: { text: "What is the evidence status for this source? This is only your statement about readiness; no evidence file is uploaded or verified here.", options: [["I have recent evidence in hand", "documented"], ["I know what evidence I’ll use", "identified"], ["I still need evidence / review", "missing"]] },
    another_source: { text: "Do you have another current taxable income source to add?", options: [["Yes — add another source", "yes"], ["No — continue", "no"]] },
    doc_borrower_name: { text: "What borrower name should appear on the statement? You can leave it as a visible placeholder and fill it in later.", options: [["Leave as placeholder", "__skip__"]] },
    doc_source_name: { text: "What payer, employer, or unemployment agency name should appear? You can leave it as a visible placeholder.", options: [["Leave as placeholder", "__skip__"]] },
    doc_servicer_name: { text: "What loan servicer name should appear? You can leave it as a visible placeholder and fill it in later.", options: [["Leave as placeholder", "__skip__"]] },
    family_size: { text: "What is your current legacy IDR family size under the support-based definition? You can tap 1–6 or type any valid whole number; there is no six-person cap.", options: [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]] },
    dependents: { text: "How many dependents do you claim on your federal tax return for the RAP dependent reduction? This is intentionally separate from legacy IDR family size.", options: [["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]] },
    region: { text: "Which poverty-guideline region applies to you?", options: [["48 states + D.C.", "contiguous_us"], ["Alaska", "alaska"], ["Hawaii", "hawaii"]] }
  };

  function showGuideStep() {
    guideAnswers.replaceChildren();
    const prompt = guidePrompts[guideStep];
    if (!prompt) return;
    guideSay(prompt.text);
    prompt.options.forEach(([label, value]) => {
      const button = addText("button", label);
      button.type = "button";
      button.addEventListener("click", () => handleGuideAnswer(value, label));
      guideAnswers.appendChild(button);
    });
    guideInput.placeholder = prompt.options.length ? "Or type one of these answers" : "Type your answer";
    guideInput.focus();
  }

  function normalizedChoice(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function resolveTypedChoice(step, rawValue) {
    const normalized = normalizedChoice(rawValue);
    const aliases = {
      goal: { ibr_zero: "ibr_zero", could_my_ibr_payment_be_0: "ibr_zero", zero_payment: "ibr_zero", estimate: "estimate", estimate_my_payment: "estimate", payment: "estimate", documents: "documents", prepare_income_documents: "documents", document: "documents", both: "both" },
      ibr_zero_region: { contiguous_us: "contiguous_us", us: "contiguous_us", mainland: "contiguous_us", _48_states_dc: "contiguous_us", alaska: "alaska", hawaii: "hawaii" },
      ibr_zero_followup: { current_income_doc: "current_income_doc", stated_income: "current_income_doc", prepare_stated_income_document: "current_income_doc", unemployment_doc: "unemployment_doc", unemployment_statement: "unemployment_doc", prepare_unemployment_statement: "unemployment_doc", calculator: "calculator", continue_to_calculator: "calculator" },
      income_situation: { employment: "employment", employed: "employment", job: "employment", self_employed: "self_employment", self_employment: "self_employment", contract: "self_employment", contractor: "self_employment", unemployment: "unemployment", unemployment_compensation: "unemployment", multiple: "multiple", multiple_taxable_sources: "multiple", none: "none", no_income: "none", no_current_taxable_income: "none" },
      income_source_type: { employment: "employment", employed: "employment", self_employment: "self_employment", self_employed: "self_employment", contract: "contract", contractor: "contract", gig: "contract", unemployment: "unemployment", unemployment_compensation: "unemployment", other: "other", other_taxable_income: "other" },
      source_evidence: { documented: "documented", evidence_in_hand: "documented", identified: "identified", evidence_identified: "identified", missing: "missing", need_evidence: "missing", needs_review: "missing" },
      another_source: { yes: "yes", add_another_source: "yes", no: "no", continue: "no" },
      income_cadence: { annual: "annual", annually: "annual", yearly: "annual", monthly: "monthly", semimonthly: "semimonthly", twice_monthly: "semimonthly", biweekly: "biweekly", every_two_weeks: "biweekly", weekly: "weekly", hourly: "hourly" },
      region: { contiguous_us: "contiguous_us", us: "contiguous_us", mainland: "contiguous_us", _48_states_dc: "contiguous_us", alaska: "alaska", hawaii: "hawaii" }
    };
    return aliases[step] ? aliases[step][normalized] : rawValue;
  }

  async function showIbrZeroInfo(region) {
    guideAnswers.replaceChildren();
    guideInput.disabled = true;
    try {
      const response = await fetch("/api/ibr-zero-payment?region=" + encodeURIComponent(region));
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Unable to load IBR quick info.");
      guideSay("For IBR, the estimated payment is $0 when the AGI used for the calculation is at or below 150% of the poverty guideline. Here are the 2026 cutoffs for " + body.regionLabel + ".");
      const table = document.createElement("table");
      table.className = "quick-info";
      const headerRow = document.createElement("tr");
      ["Family size", "$0 IBR AGI cutoff"].forEach((text) => headerRow.appendChild(addText("th", text)));
      const head = document.createElement("thead");
      head.appendChild(headerRow);
      table.appendChild(head);
      const tableBody = document.createElement("tbody");
      body.thresholds.forEach((row) => {
        const tr = document.createElement("tr");
        tr.append(addText("td", String(row.familySize)), addText("td", money.format(row.maxAgiForZeroPayment)));
        tableBody.appendChild(tr);
      });
      table.appendChild(tableBody);
      guideTranscript.appendChild(table);
      if (region === "contiguous_us") {
        const example = addText("div", "$60,000 example: with family size 6, $60,000 is below the 2026 $66,540 IBR $0-payment AGI cutoff, so the formula estimates a $0 monthly IBR payment if the borrower and loans are otherwise IBR-eligible.", "quick-callout");
        guideTranscript.appendChild(example);
      }
      guideSay("Important: these are AGI thresholds, not automatic eligibility guarantees. Loan type/date rules still matter, spouse income can matter depending on the borrower’s situation, annual recertification still applies, and interest may still accrue.");
      guideTranscript.scrollTop = guideTranscript.scrollHeight;
      guideStep = "ibr_zero_followup";
    } catch (error) {
      guideSay(error instanceof Error ? error.message : "Unable to load IBR quick info.");
      guideStep = "goal";
    } finally {
      guideInput.disabled = false;
      showGuideStep();
    }
  }

  function finalizePendingIncomeSource(evidenceStatus) {
    if (!pendingIncomeSource) return;
    pendingIncomeSource.evidenceStatus = evidenceStatus;
    const source = { ...pendingIncomeSource };
    guidedIncomeSources.push(source);
    const sourceNumber = guidedIncomeSources.length;
    const evidenceLabel = evidenceStatusLabel(evidenceStatus);
    recordGuidedFact(
      "income_source_" + sourceNumber,
      "Taxable income source " + sourceNumber,
      sourceTypeLabel(source.sourceType) + " · " + money.format(source.grossAmount) + " · " + source.paymentFrequency + " · " + evidenceLabel
    );
    if (sourceNumber === 1) {
      guideIncomeCadence = source.paymentFrequency;
      guideIncomeAmount = source.grossAmount;
      cadence.value = source.paymentFrequency;
      setCalculatorValue("incomeAmount", source.grossAmount);
      syncHourlyFields();
    }
    pendingIncomeSource = null;
    renderIncomeReadiness();
  }

  function handleGuideAnswer(rawValue, displayValue) {
    const value = resolveTypedChoice(guideStep, rawValue);
    const shown = displayValue || String(rawValue).trim();
    if (!shown) return;

    if (guideStep === "income_amount") {
      const amount = numericValue(shown);
      if (amount === undefined || amount < 0) {
        guideSay("Please enter a valid non-negative gross income amount.");
        return;
      }
      guideSay(shown, "user");
      if (!pendingIncomeSource) pendingIncomeSource = { sourceType: documentSourceType() };
      pendingIncomeSource.grossAmount = amount;
      pendingIncomeSource.paymentFrequency = guideIncomeCadence;
      guideStep = "source_name";
    } else if (guideStep === "source_name") {
      guideSay(shown, "user");
      if (!pendingIncomeSource) pendingIncomeSource = { sourceType: documentSourceType(), paymentFrequency: guideIncomeCadence, grossAmount: guideIncomeAmount };
      if (value !== "__skip__") pendingIncomeSource.name = shown;
      guideStep = "source_evidence";
    } else if (guideStep === "source_evidence") {
      if (!["documented", "identified", "missing"].includes(value)) {
        guideSay("Choose evidence in hand, evidence identified, or needs evidence / review.");
        return;
      }
      guideSay(shown, "user");
      finalizePendingIncomeSource(value);
      guideStep = collectMultipleSources ? "another_source" : guideDocumentGoal ? "doc_borrower_name" : "family_size";
    } else if (guideStep === "another_source") {
      if (!["yes", "no"].includes(value)) {
        guideSay("Choose whether to add another current taxable income source.");
        return;
      }
      guideSay(shown, "user");
      if (value === "yes") {
        pendingIncomeSource = null;
        guideStep = "income_source_type";
      } else {
        collectMultipleSources = false;
        guideStep = guideDocumentGoal ? "doc_borrower_name" : "family_size";
      }
    } else if (guideStep === "income_source_type") {
      if (!["employment", "self_employment", "contract", "unemployment", "other"].includes(value)) {
        guideSay("Choose employment, self-employment, contract/gig income, unemployment compensation, or other taxable income.");
        return;
      }
      guideSay(shown, "user");
      pendingIncomeSource = { sourceType: value };
      guideIncomeSituation = value;
      guideStep = "income_cadence";
    } else if (guideStep === "family_size" || guideStep === "dependents") {
      const count = Number(value);
      const minimum = guideStep === "family_size" ? 1 : 0;
      if (!Number.isInteger(count) || count < minimum) {
        guideSay("Please enter a valid whole number" + (minimum ? " of at least 1." : " of 0 or more."));
        return;
      }
      guideSay(shown, "user");
      if (guideStep === "family_size") {
        setCalculatorValue("familySize", count);
        recordGuidedFact("family_size", "Legacy IDR family size", String(count));
        guideStep = "dependents";
      } else {
        setCalculatorValue("dependents", count);
        recordGuidedFact("dependents", "Federal tax-return dependents for RAP", String(count));
        guideStep = "region";
      }
    } else if (guideStep === "goal") {
      if (!["ibr_zero", "estimate", "documents", "both"].includes(value)) {
        guideSay("Choose the IBR $0 quick check, estimate, documents, or both.");
        return;
      }
      guideSay(shown, "user");
      if (value === "ibr_zero") {
        recordGuidedFact("goal", "Requested help", "IBR $0-payment quick check");
        guideStep = "ibr_zero_region";
      } else {
        recordGuidedFact("goal", "Requested help", value === "both" ? "Payment estimate and income-document help" : value === "documents" ? "Income-document help" : "Payment estimate");
        guideDocumentGoal = value === "documents" || value === "both" ? "auto" : null;
        guideContinueToCalculator = value === "both";
        guideStep = "income_situation";
      }
    } else if (guideStep === "ibr_zero_region") {
      if (!["contiguous_us", "alaska", "hawaii"].includes(value)) {
        guideSay("Choose 48 states + D.C., Alaska, or Hawaii.");
        return;
      }
      guideSay(shown, "user");
      setCalculatorValue("region", value);
      recordGuidedFact("region", "Poverty-guideline region", shown);
      void showIbrZeroInfo(value);
      return;
    } else if (guideStep === "ibr_zero_followup") {
      if (!["current_income_doc", "unemployment_doc", "calculator"].includes(value)) {
        guideSay("Choose stated income document, unemployment statement, or continue to calculator.");
        return;
      }
      guideSay(shown, "user");
      if (value === "current_income_doc") {
        guideDocumentGoal = "current_income_statement";
        guideContinueToCalculator = false;
        recordGuidedFact("document_goal", "Requested document", "Current / stated income supporting statement");
        guideStep = "income_situation";
      } else if (value === "unemployment_doc") {
        guideDocumentGoal = "unemployment_income_statement";
        guideContinueToCalculator = false;
        guideIncomeSituation = "unemployment";
        recordGuidedFact("document_goal", "Requested document", "Unemployment compensation income statement");
        recordGuidedFact("income_situation", "Current income situation", "Unemployment compensation");
        guideStep = "income_cadence";
      } else {
        guideDocumentGoal = null;
        guideContinueToCalculator = false;
        guideStep = "income_situation";
      }
    } else if (guideStep === "doc_borrower_name" || guideStep === "doc_source_name" || guideStep === "doc_servicer_name") {
      guideSay(shown, "user");
      if (guideStep === "doc_borrower_name") {
        if (value !== "__skip__") {
          setDocumentValue("borrowerName", shown);
          recordGuidedFact("document_borrower_name", "Document borrower name", shown);
        }
        guideStep = "doc_servicer_name";
      } else if (guideStep === "doc_source_name") {
        if (value !== "__skip__") {
          setDocumentValue("sourceName", shown);
          recordGuidedFact("document_source_name", "Document payer / employer / agency", shown);
        }
        guideStep = "doc_servicer_name";
      } else {
        if (value !== "__skip__") {
          setDocumentValue("servicerName", shown);
          recordGuidedFact("document_servicer_name", "Document loan servicer", shown);
        }
        guideInput.value = "";
        guideAnswers.replaceChildren();
        guideSay("Your draft is ready for review below. Missing facts remain visible placeholders. Review or edit the fields, generate again if needed, then explicitly confirm your review before print/download controls are enabled.");
        openGuidedDocumentWorkspace();
        if (guideContinueToCalculator) {
          guideSay("You also asked for a payment estimate, so I’ll continue collecting the remaining calculator facts here.");
          guideStep = "family_size";
          showGuideStep();
        } else {
          guideStep = "document_ready";
        }
        return;
      }
    } else if (guideStep === "income_situation") {
      if (!["employment", "self_employment", "unemployment", "multiple", "none"].includes(value)) {
        guideSay("Choose employment, self-employed/contract, unemployment compensation, multiple taxable sources, or no current taxable income.");
        return;
      }
      guideSay(shown, "user");
      guideIncomeSituation = value;
      guidedIncomeSources = [];
      pendingIncomeSource = null;
      collectMultipleSources = value === "multiple";
      const labels = { employment: "Employment", self_employment: "Self-employment / contract", unemployment: "Unemployment compensation", multiple: "Multiple taxable sources", none: "No current taxable income" };
      recordGuidedFact("income_situation", "Current income situation", labels[value]);
      if (guideDocumentGoal === "auto") {
        guideDocumentGoal = value === "unemployment" ? "unemployment_income_statement" : value === "none" ? "no_current_taxable_income_statement" : "current_income_statement";
      } else if (guideDocumentGoal && value === "unemployment") {
        guideDocumentGoal = "unemployment_income_statement";
      } else if (guideDocumentGoal && value === "none") {
        guideDocumentGoal = "no_current_taxable_income_statement";
      }
      if (value === "none") {
        setCalculatorValue("cadence", "annual");
        setCalculatorValue("incomeAmount", 0);
        guideIncomeCadence = "annual";
        guideIncomeAmount = 0;
        recordGuidedFact("income_amount", "Current gross taxable income", money.format(0));
        cadence.value = "annual";
        syncHourlyFields();
        renderIncomeReadiness();
        guideStep = guideDocumentGoal ? "doc_borrower_name" : "family_size";
      } else if (value === "multiple") {
        guideStep = "income_source_type";
      } else {
        pendingIncomeSource = { sourceType: value === "self_employment" ? "self_employment" : value };
        guideStep = "income_cadence";
      }
    } else if (guideStep === "income_cadence") {
      if (!["annual", "monthly", "semimonthly", "biweekly", "weekly", "hourly"].includes(value)) {
        guideSay("Choose annual, monthly, twice monthly, every two weeks, weekly, or hourly.");
        return;
      }
      guideSay(shown, "user");
      cadence.value = value;
      guideIncomeCadence = value;
      if (!pendingIncomeSource) pendingIncomeSource = { sourceType: documentSourceType() };
      pendingIncomeSource.paymentFrequency = value;
      syncHourlyFields();
      guideStep = "income_amount";
    } else if (guideStep === "region") {
      if (!["contiguous_us", "alaska", "hawaii"].includes(value)) {
        guideSay("Choose 48 states + D.C., Alaska, or Hawaii.");
        return;
      }
      guideSay(shown, "user");
      setCalculatorValue("region", value);
      recordGuidedFact("region", "Poverty-guideline region", shown);
      guideStep = "done";
    }

    guideInput.value = "";
    if (guideStep === "done") {
      guideAnswers.replaceChildren();
      guideSay("Your confirmed facts are now prefilled in the calculator. Review them, add or import your loan facts, then calculate. Document drafts, when requested, use this same confirmed fact ledger and keep missing information as explicit placeholders.");
      return;
    }
    showGuideStep();
  }

  guideForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleGuideAnswer(guideInput.value);
  });

  documentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void generateDocumentDraft();
  });
  documentReviewed.addEventListener("change", syncDocumentActions);
  documentScope.addEventListener("change", () => {
    documentDraft = null;
    documentReviewed.checked = false;
    documentDraftArea.hidden = true;
    syncDocumentActions();
  });
  advisorSaveProgress.addEventListener("click", () => { void saveAdvisorClientProgress(); });
  advisorRetainDocument.addEventListener("click", () => { void retainCurrentDocument(); });
  advisorRetainCalculation.addEventListener("click", () => { void retainCurrentSnapshot("calculation"); });
  advisorRetainComparison.addEventListener("click", () => { void retainCurrentSnapshot("comparison"); });
  advisorOpenHistory.addEventListener("click", () => { void loadAdvisorHistory().then(() => advisorHistoryWorkspace.scrollIntoView({ behavior:"smooth", block:"start" })); });
  advisorRefreshHistory.addEventListener("click", () => { void loadAdvisorHistory(); });
  advisorComparePlans.addEventListener("click", async () => {
    const saved = await saveAdvisorClientProgress();
    if (saved) await runAdvisorComparison();
  });
  advisorRegenerateDocument.addEventListener("click", () => {
    if (!advisorClient) return;
    guideDocumentGoal = guideIncomeSituation === "none" ? "no_current_taxable_income_statement" : "auto";
    openGuidedDocumentWorkspace();
  });
  addIncomeSource.addEventListener("click", () => {
    collectMultipleSources = true;
    pendingIncomeSource = null;
    guideStep = "income_source_type";
    guideSay("Add another source here. I’ll keep its facts and evidence readiness separate from the sources already confirmed.");
    showGuideStep();
    documentWorkspace.hidden = true;
    document.getElementById("guided-assistant").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  documentDownload.addEventListener("click", () => {
    if (!documentDraft || !documentReviewed.checked) return;
    const blob = new Blob([documentDraft.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = documentFilename();
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  documentPrint.addEventListener("click", () => {
    if (!documentDraft || !documentReviewed.checked) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      documentStatus.textContent = "Your browser blocked the print window. Allow pop-ups for this page and try again.";
      return;
    }
    printWindow.document.open();
    printWindow.document.write(documentDraft.html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  });

  cadence.addEventListener("change", syncHourlyFields);
  syncHourlyFields();
  if (advisorClientId) void initializeAdvisorClientMode();
  else {
    guideSay("I can help turn your answers into clearly labeled application facts and a repayment estimate. You can use the bubbles or type.");
    showGuideStep();
  }

  loanFile.addEventListener("change", async () => {
    importedPortfolio = null;
    importedFieldProvenance = {};
    portfolioSummary.replaceChildren();
    studentAidReview.replaceChildren();
    const file = loanFile.files && loanFile.files[0];
    if (!file) {
      importStatus.textContent = "No loan file loaded. Manual loan fields remain available below.";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      importStatus.textContent = "That file is larger than the 2 MiB local-import limit.";
      loanFile.value = "";
      return;
    }
    try {
      const text = await file.text();
      const portfolio = parseStudentAidData(text);
      if (!portfolio.loans.length) throw new Error("No active loan records with an outstanding principal balance were found.");
      importedPortfolio = portfolio;
      importedFieldProvenance = { ...(portfolio.borrower?.provenance || {}) };
      renderPortfolio(portfolio);
      importStatus.textContent = advisorClientId
        ? "Client facts prefilled locally. Review them, then use Save progress to persist only normalized facts. The raw StudentAid.gov file has not been uploaded."
        : "Borrower facts and loan details prefilled locally for this private session. The raw StudentAid.gov file has not been uploaded or persisted.";
    } catch (error) {
      importStatus.textContent = error instanceof Error ? error.message : "Unable to read that loan-data file.";
      loanFile.value = "";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "Calculating…";
    results.replaceChildren();

    try {
      const data = new FormData(form);
      const selectedPlans = data.getAll("plans").map(String);
      if (!selectedPlans.length) throw new Error("Select at least one repayment plan.");

      const cadenceValue = String(data.get("cadence"));
      const amount = Number(data.get("incomeAmount"));
      const guidedCalculatorIncome = guidedIncomeSources
        .filter((source) => typeof source.grossAmount === "number" && source.paymentFrequency)
        .map((source) => source.paymentFrequency === "hourly"
          ? { cadence: "hourly", hourlyRate: source.grossAmount, hoursPerWeek: Number(data.get("hoursPerWeek")), weeksPerYear: Number(data.get("weeksPerYear")) }
          : { cadence: source.paymentFrequency, amount: source.grossAmount });
      const income = guidedCalculatorIncome.length
        ? guidedCalculatorIncome
        : cadenceValue === "hourly"
          ? [{ cadence: cadenceValue, hourlyRate: amount, hoursPerWeek: Number(data.get("hoursPerWeek")), weeksPerYear: Number(data.get("weeksPerYear")) }]
          : [{ cadence: cadenceValue, amount }];

      const payload = {
        income,
        region: String(data.get("region")),
        familySize: Number(data.get("familySize")),
        dependentsClaimedOnFederalTaxReturn: Number(data.get("dependents")),
        plans: selectedPlans
      };

      const adjustments = numberOrUndefined(String(data.get("adjustments")));
      const agiOverride = numberOrUndefined(String(data.get("agiOverride")));
      const taxFilingStatus = String(data.get("taxFilingStatus"));
      if (adjustments !== undefined) payload.estimatedAboveTheLineAdjustments = adjustments;
      if (agiOverride !== undefined) payload.adjustedGrossIncomeOverride = agiOverride;
      if (taxFilingStatus) payload.taxFilingStatus = taxFilingStatus;

      const loan = {};
      const principal = numberOrUndefined(String(data.get("principal")));
      const interestRate = numberOrUndefined(String(data.get("interestRate")));
      const loanType = String(data.get("loanType"));
      const ibrNewBorrower = String(data.get("ibrNewBorrower"));
      if (importedPortfolio) {
        if (importedPortfolio.repaymentLoans.length) loan.repaymentLoans = importedPortfolio.repaymentLoans;
        if (importedPortfolio.eligibilityLoans) loan.eligibilityLoans = importedPortfolio.eligibilityLoans;
      } else {
        if (principal !== undefined) loan.principal = principal;
        if (interestRate !== undefined) loan.annualInterestRatePercent = interestRate;
        if (loanType) {
          loan.eligibilityLoans = [{
            loanType,
            disbursementPeriod: String(data.get("disbursementPeriod"))
          }];
        }
      }
      if (ibrNewBorrower) loan.newBorrowerOnOrAfterJuly1_2014 = ibrNewBorrower === "true";
      if (Object.keys(loan).length) payload.loan = loan;

      const response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Calculation failed.");
      render(body.result);
      status.textContent = "Estimate ready.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Calculation failed.";
    } finally {
      submit.disabled = false;
    }
  });
})();
</script>
<script>
(() => {
  var toggle = document.getElementById("field-color-toggle");
  var completion = document.getElementById("field-completion");
  var fields = Array.prototype.slice.call(document.querySelectorAll("[data-fill-state]"));
  function isFilled(input) {
    if (!input) return false;
    if (input.type === "checkbox" || input.type === "radio") return input.checked;
    return String(input.value == null ? "" : input.value).trim().length > 0;
  }
  function ensureStatusEl(label) {
    var el = label.querySelector(".fill-status-text");
    if (!el) {
      el = document.createElement("span");
      el.className = "fill-status-text";
      label.appendChild(el);
    }
    return el;
  }
  function updateField(label) {
    var input = label.querySelector("input, select, textarea");
    if (!input) return;
    var state = label.getAttribute("data-fill-state");
    var statusEl = ensureStatusEl(label);
    label.classList.remove("fill-red", "fill-green", "fill-purple");
    if (isFilled(input)) {
      label.classList.add("fill-green");
      statusEl.textContent = "✓ Filled";
    } else if (state === "required") {
      label.classList.add("fill-red");
      statusEl.textContent = "! Required";
    } else {
      label.classList.add("fill-purple");
      statusEl.textContent = "○ Optional";
    }
  }
  function updateCompletion() {
    if (!completion) return;
    var visible = fields.filter(function (label) { return !label.hidden; });
    var required = visible.filter(function (label) { return label.getAttribute("data-fill-state") === "required"; });
    var optional = visible.filter(function (label) { return label.getAttribute("data-fill-state") === "optional"; });
    var requiredFilled = required.filter(function (label) { return isFilled(label.querySelector("input, select, textarea")); }).length;
    var optionalFilled = optional.filter(function (label) { return isFilled(label.querySelector("input, select, textarea")); }).length;
    completion.textContent = "Required: " + requiredFilled + "/" + required.length + " filled · Optional: " + optionalFilled + "/" + optional.length + " filled";
  }
  var completionTimer = null;
  function scheduleCompletionUpdate() {
    if (completionTimer) window.clearTimeout(completionTimer);
    completionTimer = window.setTimeout(updateCompletion, 400);
  }
  function refreshAll() { fields.forEach(updateField); updateCompletion(); }
  fields.forEach(function (label) {
    var input = label.querySelector("input, select, textarea");
    if (!input) return;
    input.addEventListener("input", function () { updateField(label); scheduleCompletionUpdate(); });
    input.addEventListener("change", function () { updateField(label); scheduleCompletionUpdate(); });
  });
  var cadenceControl = document.getElementById("cadence");
  if (cadenceControl) cadenceControl.addEventListener("change", function () { window.setTimeout(refreshAll, 0); });
  refreshAll();
  if (toggle) {
    toggle.addEventListener("change", function () {
      document.body.classList.toggle("field-colors-off", !toggle.checked);
    });
  }
})();
</script>
</body>
</html>`;

const ADVISOR_UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Advisor Workspace · Student Loan IDR</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: Canvas; color: CanvasText; line-height: 1.5; }
    main { width: min(1100px, calc(100% - 28px)); margin: 0 auto; padding: 32px 0 60px; }
    h1 { font-size: clamp(2rem, 6vw, 3.8rem); line-height: 1; letter-spacing: -.04em; margin: 8px 0 14px; }
    h2, h3 { margin-top: 0; }
    .muted { color: color-mix(in srgb, CanvasText 66%, transparent); }
    .notice, .panel, .client-card { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 16px; padding: 16px; background: color-mix(in srgb, CanvasText 3%, Canvas); }
    .notice { margin: 20px 0; }
    .panel { margin: 18px 0; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    label { display: grid; gap: 7px; font-weight: 650; }
    input, button { font: inherit; }
    input { width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, CanvasText 24%, transparent); background: Canvas; color: CanvasText; }
    button, .button-link { border: 0; border-radius: 999px; padding: 11px 16px; font-weight: 750; cursor: pointer; background: CanvasText; color: Canvas; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
    .secondary { background: color-mix(in srgb, CanvasText 8%, Canvas); color: CanvasText; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); }
    .actions { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; margin-top: 14px; }
    .topbar { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
    .client-list { display: grid; gap: 12px; margin-top: 14px; }
    .client-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    .badges { display: flex; gap: 7px; flex-wrap: wrap; }
    .badge { display: inline-flex; border: 1px solid currentColor; border-radius: 999px; padding: 2px 8px; font-size: .78rem; text-transform: capitalize; }
    [hidden] { display: none !important; }
    #status, #auth-status { min-height: 1.5em; }
    a { color: inherit; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } main { width: min(100% - 20px, 1100px); padding-top: 22px; } }
  </style>
</head>
<body>
<main>
  <p><strong>Student Loan IDR</strong> · advisor / manager workspace</p>
  <h1>Manage many borrower clients without mixing their facts.</h1>
  <p class="muted">Create a client, open that client’s guided workflow, save normalized application facts, resume later, and regenerate supporting documents. Client lists stay intentionally minimized.</p>
  <div class="notice"><strong>Privacy boundary:</strong> do not store SSNs, FSA credentials, raw StudentAid.gov downloads, or raw evidence files here. StudentAid imports remain browser-local; only normalized loan facts can be saved to a client record.</div>

  <section id="auth-panel" class="panel" aria-labelledby="auth-title">
    <h2 id="auth-title">Advisor sign in</h2>
    <div class="grid">
      <form id="login-form">
        <h3>Sign in</h3>
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" minlength="12" required></label>
        <div class="actions"><button type="submit">Sign in</button></div>
      </form>
      <form id="register-form">
        <h3>Create advisor account</h3>
        <label>Advisor display name<input name="displayName" autocomplete="name" maxlength="120" required></label>
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" minlength="12" required></label>
        <div class="actions"><button type="submit">Create account</button></div>
      </form>
    </div>
    <p id="auth-status" class="muted" role="status" aria-live="polite"></p>
  </section>

  <section id="workspace" hidden>
    <div class="panel">
      <div class="topbar">
        <div><h2 id="advisor-name">Advisor workspace</h2><p class="muted">Saved client facts are owner-scoped to this authenticated advisor account.</p></div>
        <div class="actions"><a class="button-link secondary" href="/">Private borrower calculator</a><button type="button" id="logout" class="secondary">Sign out</button></div>
      </div>
    </div>

    <section class="panel" aria-labelledby="new-client-title">
      <h2 id="new-client-title">Add a client</h2>
      <form id="create-client-form" class="grid">
        <label>Client display name<input name="displayName" maxlength="120" required></label>
        <label>Email <span class="muted">(optional)</span><input name="email" type="email" maxlength="254"></label>
        <label>Phone <span class="muted">(optional)</span><input name="phone" maxlength="80"></label>
        <div class="actions"><button type="submit">Create & open client</button></div>
      </form>
    </section>

    <section class="panel" aria-labelledby="clients-title">
      <div class="topbar">
        <div><h2 id="clients-title">Clients</h2><p class="muted">Dashboard cards show only the minimum workflow summary, never private contact, income, loan, evidence, note, or draft details.</p></div>
        <form id="search-form" class="actions"><input id="search" aria-label="Search clients" placeholder="Search client name"><button type="submit" class="secondary">Search</button></form>
      </div>
      <p id="status" class="muted" role="status" aria-live="polite"></p>
      <div id="client-list" class="client-list"></div>
    </section>
  </section>
</main>
<script>
(() => {
  const authPanel = document.getElementById("auth-panel");
  const workspace = document.getElementById("workspace");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const authStatus = document.getElementById("auth-status");
  const advisorName = document.getElementById("advisor-name");
  const logout = document.getElementById("logout");
  const createClientForm = document.getElementById("create-client-form");
  const searchForm = document.getElementById("search-form");
  const search = document.getElementById("search");
  const status = document.getElementById("status");
  const clientList = document.getElementById("client-list");
  let csrfToken = null;
  let advisor = null;

  async function api(path, init = {}) {
    const headers = new Headers(init.headers || {});
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method || "GET")) headers.set("x-csrf-token", csrfToken);
    const response = await fetch(path, { ...init, headers });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { throw new Error("Advisor service returned an invalid response."); }
    if (!response.ok || !body?.ok) {
      const error = new Error(body?.error || "Advisor request failed.");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function showAuth(message = "") {
    advisor = null;
    csrfToken = null;
    authPanel.hidden = false;
    workspace.hidden = true;
    authStatus.textContent = message;
  }

  function showWorkspace(session) {
    advisor = session.advisor;
    csrfToken = session.csrfToken;
    authPanel.hidden = true;
    workspace.hidden = false;
    advisorName.textContent = session.advisor.displayName + " · clients";
  }

  function addText(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  async function downloadClient(clientId) {
    try {
      const body = await api("/api/advisor/clients/" + encodeURIComponent(clientId) + "/export");
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "advisor-client-" + clientId + ".json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Unable to export client."; }
  }

  async function archiveClient(client) {
    if (!window.confirm("Archive " + client.displayName + "? The record remains saved and can still be exported.")) return;
    try {
      await api("/api/advisor/clients/" + encodeURIComponent(client.clientId) + "/archive", { method: "POST", body: JSON.stringify({ expectedUpdatedAt: client.updatedAt }) });
      await loadClients();
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Unable to archive client."; }
  }

  function renderClients(clients) {
    clientList.replaceChildren();
    if (!clients.length) {
      clientList.appendChild(addText("p", "No matching clients yet.", "muted"));
      return;
    }
    clients.forEach((client) => {
      const card = document.createElement("article");
      card.className = "client-card";
      const head = document.createElement("div");
      head.className = "client-head";
      const title = document.createElement("div");
      title.appendChild(addText("strong", client.displayName));
      title.appendChild(addText("div", "Updated " + new Date(client.updatedAt).toLocaleString(), "muted"));
      const badges = document.createElement("div");
      badges.className = "badges";
      badges.append(addText("span", client.lifecycleState.replace(/_/g, " "), "badge"), addText("span", client.readinessState.replace(/_/g, " "), "badge"));
      head.append(title, badges);
      card.appendChild(head);
      const actions = document.createElement("div");
      actions.className = "actions";
      const open = addText("button", "Open guided workflow");
      open.type = "button";
      open.addEventListener("click", () => { window.location.href = "/?advisorClient=" + encodeURIComponent(client.clientId); });
      const exportButton = addText("button", "Export", "secondary");
      exportButton.type = "button";
      exportButton.addEventListener("click", () => { void downloadClient(client.clientId); });
      const archiveButton = addText("button", "Archive", "secondary");
      archiveButton.type = "button";
      archiveButton.disabled = client.lifecycleState === "archived";
      archiveButton.addEventListener("click", () => { void archiveClient(client); });
      actions.append(open, exportButton, archiveButton);
      card.appendChild(actions);
      clientList.appendChild(card);
    });
  }

  async function loadClients() {
    status.textContent = "Loading clients…";
    try {
      const query = search.value.trim();
      const body = await api("/api/advisor/clients" + (query ? "?search=" + encodeURIComponent(query) : ""));
      renderClients(body.clients || []);
      status.textContent = String((body.clients || []).length) + " client(s) shown.";
    } catch (error) {
      if (error?.status === 401) { showAuth("Your advisor session expired. Sign in again."); return; }
      status.textContent = error instanceof Error ? error.message : "Unable to load clients.";
    }
  }

  async function authenticateWith(path, form) {
    authStatus.textContent = "Working…";
    const data = new FormData(form);
    const payload = { email: String(data.get("email") || ""), password: String(data.get("password") || "") };
    if (path.endsWith("register")) payload.displayName = String(data.get("displayName") || "");
    try {
      const body = await api(path, { method: "POST", body: JSON.stringify(payload) });
      showWorkspace(body);
      form.reset();
      await loadClients();
    } catch (error) { authStatus.textContent = error instanceof Error ? error.message : "Unable to authenticate."; }
  }

  loginForm.addEventListener("submit", (event) => { event.preventDefault(); void authenticateWith("/api/advisor/login", loginForm); });
  registerForm.addEventListener("submit", (event) => { event.preventDefault(); void authenticateWith("/api/advisor/register", registerForm); });
  searchForm.addEventListener("submit", (event) => { event.preventDefault(); void loadClients(); });
  createClientForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(createClientForm);
    const payload = { displayName: String(data.get("displayName") || "") };
    const email = String(data.get("email") || "").trim();
    const phone = String(data.get("phone") || "").trim();
    if (email) payload.email = email;
    if (phone) payload.phone = phone;
    status.textContent = "Creating client…";
    try {
      const body = await api("/api/advisor/clients", { method: "POST", body: JSON.stringify(payload) });
      window.location.href = "/?advisorClient=" + encodeURIComponent(body.client.clientId);
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Unable to create client."; }
  });
  logout.addEventListener("click", async () => {
    try { await api("/api/advisor/logout", { method: "POST", body: "{}" }); } catch {}
    showAuth("Signed out.");
  });

  (async () => {
    try {
      const response = await fetch("/api/advisor/session", { headers: { accept: "application/json" } });
      if (response.status === 401) { showAuth(); return; }
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Unable to resume advisor session.");
      showWorkspace(body);
      await loadClients();
    } catch (error) { showAuth(error instanceof Error ? error.message : "Unable to resume advisor session."); }
  })();
})();
</script>
</body>
</html>`;

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
    endpoints: ["GET /", "GET /advisor", "GET /health", "GET /api/ibr-zero-payment", "POST /api/calculate", "POST /api/document", "POST /mcp", "POST /api/advisor/register", "POST /api/advisor/login", "GET /api/advisor/session", "GET|POST /api/advisor/clients", "GET|PUT|DELETE /api/advisor/clients/:clientId", "GET /api/advisor/clients/:clientId/comparison", "GET|POST /api/advisor/clients/:clientId/artifacts", "GET|DELETE /api/advisor/clients/:clientId/artifacts/:artifactId", "POST /api/advisor/clients/:clientId/artifacts/:artifactId/regenerate", "GET|POST /api/advisor/clients/:clientId/snapshots", "GET|DELETE /api/advisor/clients/:clientId/snapshots/:snapshotId", "POST /api/advisor/clients/:clientId/snapshots/:snapshotId/rerun"],
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
      student_aid_provenance_review: true,
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
    if (request.method === "GET" && url.pathname === "/health") return home(request, env);
    if (request.method === "GET" && url.pathname === "/api/ibr-zero-payment") return ibrZeroPaymentResponse(request, env);
    if (url.pathname.startsWith("/api/advisor/")) return handleAdvisorApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/calculate") return handleCalculatorApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/document") return handleDocumentApi(request, env);
    if (url.pathname === "/mcp" && request.method === "GET") {
      if (!allowedOrigin(request, env)) return jsonResponse(jsonRpcErrorObject(null, -32600, "Forbidden Origin"), 403, request, env);
      return new Response("SSE listening is not implemented by this stateless server.", { status: 405, headers: { allow: "POST, OPTIONS" } });
    }
    if (request.method === "POST" && url.pathname === "/mcp") return handleMcp(request, env);
    return new Response("Not Found", { status: 404 });
  }
};
