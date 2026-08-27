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

export interface LoanInputs {
  principal?: number;
  annualInterestRatePercent?: number;
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

export interface TemplateRequest {
  templateType: DocumentationTemplateType;
  borrowerName?: string;
  servicerName?: string;
  incomeSourceName?: string;
  incomeSourceAddress?: string;
  paymentFrequency?: string;
  grossAmount?: number;
  notes?: string;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}
