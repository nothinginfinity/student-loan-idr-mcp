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

export interface IncomeInput {
  cadence: IncomeCadence;
  amount?: number;
  hourlyRate?: number;
  hoursPerWeek?: number;
  weeksPerYear?: number;
  seasonalPayments?: number[];
}

export interface LoanInputs {
  principal?: number;
  annualInterestRatePercent?: number;
  newBorrowerOnOrAfterJuly1_2014?: boolean;
  hasLoanDisbursedOnOrAfterJuly1_2026?: boolean;
  icrIncomePercentageFactor?: number;
}

export interface CalculatorRequest {
  income: IncomeInput[];
  region: Region;
  familySize: number;
  dependentsClaimedOnFederalTaxReturn?: number;
  estimatedAboveTheLineAdjustments?: number;
  adjustedGrossIncomeOverride?: number;
  loan?: LoanInputs;
  plans?: RepaymentPlan[];
}

export interface PlanEstimate {
  plan: RepaymentPlan;
  monthlyPaymentEstimate: number;
  annualPaymentEstimate: number;
  formulaSummary: string;
  completeness: "estimate" | "partial";
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
