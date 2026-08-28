export type IncomeCadence =
  | "hourly"
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "annual"
  | "seasonal_lump_sum";

export type Region = "contiguous_us" | "alaska" | "hawaii";
export type RepaymentPlan = "RAP" | "IBR" | "PAYE" | "ICR";
export type TaxFilingStatus = "single" | "married_filing_jointly" | "married_filing_separately" | "head_of_household";
export type IcrIncomeFactorCategory = "single" | "married_or_head_of_household";
export type LoanDisbursementPeriod = "before_2026_07_01" | "on_or_after_2026_07_01";
export type LoanType =
  | "direct_subsidized"
  | "direct_unsubsidized"
  | "direct_grad_plus"
  | "direct_parent_plus"
  | "direct_consolidation_no_parent_plus"
  | "direct_consolidation_with_parent_plus"
  | "ffel_subsidized_stafford"
  | "ffel_unsubsidized_stafford"
  | "ffel_grad_plus"
  | "ffel_parent_plus"
  | "ffel_consolidation_no_parent_plus"
  | "ffel_consolidation_with_parent_plus"
  | "perkins";

export type EligibilityStatus = "eligible" | "ineligible" | "conditional" | "mixed" | "unknown";
export type LoanEligibilityStatus = Exclude<EligibilityStatus, "mixed" | "unknown">;

export interface IncomeInput {
  cadence: IncomeCadence;
  amount?: number;
  hourlyRate?: number;
  hoursPerWeek?: number;
  weeksPerYear?: number;
  seasonalPayments?: number[];
}

export interface EligibilityLoanInput {
  loanType: LoanType;
  disbursementPeriod: LoanDisbursementPeriod;
  inDefault?: boolean;
  madeIcrPaymentBeforeJuly1_2028?: boolean;
}

export interface RepaymentLoanInput {
  principal: number;
  annualInterestRatePercent: number;
}

export interface LoanInputs {
  principal?: number;
  annualInterestRatePercent?: number;
  repaymentLoans?: RepaymentLoanInput[];
  newBorrowerOnOrAfterJuly1_2014?: boolean;
  hasLoanDisbursedOnOrAfterJuly1_2026?: boolean;
  icrIncomePercentageFactor?: number;
  icrIncomeFactorCategory?: IcrIncomeFactorCategory;
  payeNewBorrowerOnOrAfterOct1_2007?: boolean;
  payeDirectLoanDisbursementOnOrAfterOct1_2011?: boolean;
  eligibilityLoans?: EligibilityLoanInput[];
}

export interface CalculatorRequest {
  income: IncomeInput[];
  region: Region;
  familySize: number;
  dependentsClaimedOnFederalTaxReturn?: number;
  estimatedAboveTheLineAdjustments?: number;
  adjustedGrossIncomeOverride?: number;
  taxFilingStatus?: TaxFilingStatus;
  loan?: LoanInputs;
  plans?: RepaymentPlan[];
}

export interface LoanEligibilityAssessment {
  loanIndex: number;
  loanType: LoanType;
  disbursementPeriod: LoanDisbursementPeriod;
  status: LoanEligibilityStatus;
  reasons: string[];
}

export interface PlanEligibility {
  status: EligibilityStatus;
  loanAssessments: LoanEligibilityAssessment[];
  reasons: string[];
  sourceUrls: string[];
}

export interface PlanEstimate {
  plan: RepaymentPlan;
  monthlyPaymentEstimate: number;
  annualPaymentEstimate: number;
  formulaSummary: string;
  completeness: "estimate" | "partial";
  eligibility: PlanEligibility;
  eligibilityNote: string;
  warnings: string[];
}

export interface CalculatorResult {
  policySnapshot: string;
  normalizedAnnualTaxableGrossIncome: number;
  estimatedAdjustedGrossIncome: number;
  povertyGuideline: number;
  familySize: number;
  dependentsClaimedOnFederalTaxReturn: number;
  planEstimates: PlanEstimate[];
  assumptions: string[];
  warnings: string[];
  sources: string[];
}

export interface PolicyPlanStatus {
  plan: RepaymentPlan;
  supported: true;
  effectiveDate?: string;
  sunsetDate?: string;
  notes: string[];
}

export interface PolicyStatusResult {
  policySnapshot: string;
  supportedPlans: PolicyPlanStatus[];
  icrFactorTable: {
    year: 2026;
    effectiveFrom: string;
    effectiveThrough: string;
    interpolation: "linear";
  };
  knownPlanChanges: string[];
  sources: string[];
}

export type DocumentationTemplateType =
  | "current_income_statement"
  | "income_change_explanation"
  | "unemployment_income_statement"
  | "no_current_taxable_income_statement";

export type DocumentationOutputFormat = "markdown" | "text" | "html";
export type DocumentationIncomeSourceType = "employment" | "self_employment" | "contract" | "unemployment" | "other";

export interface DocumentationIncomeSource {
  sourceType?: DocumentationIncomeSourceType;
  name?: string;
  address?: string;
  grossAmount?: number;
  paymentFrequency?: string;
  notes?: string;
}

export interface TemplateRequest {
  templateType: DocumentationTemplateType;
  outputFormat?: DocumentationOutputFormat;
  documentDate?: string;
  borrowerName?: string;
  servicerName?: string;
  incomeSources?: DocumentationIncomeSource[];
  incomeSourceName?: string;
  incomeSourceAddress?: string;
  paymentFrequency?: string;
  grossAmount?: number;
  notes?: string;
}

export type AdvisorAccountStatus = "active" | "suspended" | "closed";
export type AdvisorClientLifecycleState = "active" | "awaiting_borrower_review" | "completed" | "archived";
export type AdvisorClientReadinessState = "needs_evidence" | "document_ready" | "application_ready";
export type AdvisorEvidenceState = "evidence_in_hand" | "evidence_identified" | "needs_evidence_review";

export interface AdvisorPrincipal {
  advisorId: string;
  status: AdvisorAccountStatus;
}

export interface AdvisorClientIncomeSource extends DocumentationIncomeSource {
  evidenceState: AdvisorEvidenceState;
}

export interface AdvisorClientRecordV1 {
  schemaVersion: 1;
  clientId: string;
  ownerAdvisorId: string;
  createdAt: string;
  updatedAt: string;
  lifecycleState: AdvisorClientLifecycleState;
  readinessState: AdvisorClientReadinessState;
  contact: {
    displayName: string;
    email?: string;
    phone?: string;
  };
  servicerName?: string;
  normalizedLoanPortfolio?: {
    repaymentLoans: RepaymentLoanInput[];
    eligibilityLoans?: EligibilityLoanInput[];
  };
  confirmedFacts?: {
    income?: IncomeInput[];
    incomeSources?: AdvisorClientIncomeSource[];
    region?: Region;
    familySize?: number;
    dependentsClaimedOnFederalTaxReturn?: number;
    taxFilingStatus?: TaxFilingStatus;
    newBorrowerOnOrAfterJuly1_2014?: boolean;
  };
  consideredPlans?: RepaymentPlan[];
  retainedDraftIds?: string[];
  notes?: string;
  studentAidImport?: {
    source: "studentaid_download";
    importedAt?: string;
    rawFileRetained: false;
  };
}

export interface AdvisorClientDashboardSummary {
  clientId: string;
  displayName: string;
  lifecycleState: AdvisorClientLifecycleState;
  readinessState: AdvisorClientReadinessState;
  updatedAt: string;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}
