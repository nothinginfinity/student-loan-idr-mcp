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
export type StudentAidFactProvenance = "imported_studentaid" | "derived_studentaid" | "advisor_entered" | "borrower_confirmed" | "missing_review";

export interface StudentAidLoanStatusFact {
  code?: string;
  description?: string;
  effectiveDate?: string;
}

export interface StudentAidLoanDisbursementFact {
  date?: string;
  amount?: number;
}

export interface StudentAidLoanDelinquencyFact {
  date?: string;
  endDate?: string;
}

export interface StudentAidParserDiagnostics {
  mappingVersion: string;
  rawLineCount: number;
  parsedLineCount: number;
  recognizedLabelCount: number;
  unmappedLabels: string[];
  structuralWarnings: string[];
  validationIssues: string[];
}

export interface StudentAidLoanContactFact {
  type?: string;
  code?: string;
  name?: string;
  streetAddress1?: string;
  streetAddress2?: string;
  city?: string;
  stateCode?: string;
  zipCode?: string;
  phoneNumber?: string;
  phoneExtension?: string;
  emailAddress?: string;
  websiteAddress?: string;
  mostRelevant?: boolean;
}

export interface StudentAidNormalizedLoanFact {
  loanIndex: number;
  maskedAwardId?: string;
  loanTypeCode?: string;
  loanTypeDescription?: string;
  mappedLoanType?: LoanType;
  disbursementPeriod?: LoanDisbursementPeriod;
  inDefault?: boolean;
  attendingSchoolName?: string;
  attendingSchoolOpeid?: string;
  loanDate?: string;
  repaymentBeginDate?: string;
  periodBeginDate?: string;
  periodEndDate?: string;
  originalAmount?: number;
  disbursedAmount?: number;
  canceledAmount?: number;
  canceledDate?: string;
  outstandingPrincipal?: number;
  outstandingPrincipalAsOfDate?: string;
  outstandingInterest?: number;
  outstandingInterestAsOfDate?: string;
  interestRateTypeCode?: string;
  interestRateTypeDescription?: string;
  interestRatePercent?: number;
  actualInterestRatePercent?: number;
  statutoryInterestRatePercent?: number;
  repaymentPlanTypeCode?: string;
  repaymentPlanDescription?: string;
  repaymentPlanBeginDate?: string;
  repaymentPlanScheduledAmount?: number;
  repaymentPlanIdrAnniversaryDate?: string;
  confirmedSubsidyStatus?: string;
  subsidizedUsageYears?: number;
  reaffirmationDate?: string;
  mostRecentPaymentEffectiveDate?: string;
  nextPaymentDueDate?: string;
  cumulativePaymentAmount?: number;
  pslfCumulativeMatchedMonths?: number;
  academicLevel?: string;
  awardYear?: string;
  capitalizedInterest?: number;
  netLoanAmount?: number;
  reaffirmationFlag?: string;
  calculatedSubsidizedAggregateOpb?: number;
  calculatedUnsubsidizedAggregateOpb?: number;
  calculatedCombinedAggregateOpb?: number;
  updateDate?: string;
  delinquencyDate?: string;
  delinquencyEndDate?: string;
  additionalUnsubsidizedLoanFlag?: string;
  jointConsolidationLoanIndicator?: string;
  jointConsolidationLoanSeparationIndicator?: string;
  loanSpecialContactReason?: string;
  loanSpecialContact?: string;
  currentLoanStatusCode?: string;
  currentLoanStatusDescription?: string;
  highestHistoricalOutstandingPrincipalBalance?: number;
  currentStandardSchedulePaymentAmount?: number;
  permanentStandardSchedulePaymentAmount?: number;
  parentPlusFirstLevelConsolidationIndicator?: string;
  consolidationLoanWithAnyParentPlusIndicator?: string;
  statuses?: StudentAidLoanStatusFact[];
  disbursements?: StudentAidLoanDisbursementFact[];
  delinquencies?: StudentAidLoanDelinquencyFact[];
  contacts?: StudentAidLoanContactFact[];
  provenance: Record<string, StudentAidFactProvenance>;
}

export interface StudentAidPortfolioSummary {
  loanCount: number;
  activeLoanCount: number;
  totalOutstandingPrincipal: number;
  totalOutstandingInterest: number;
  repaymentLoanCount: number;
  eligibilityMappedLoanCount: number;
  ambiguousEligibilityLoanCount: number;
  hasLoanDisbursedOnOrAfterJuly1_2026: boolean;
}

export type StudentAidIntervalCategory = "forbearance" | "repayment" | "default" | "other";
export type StudentAidCoverageState = "complete" | "partial" | "none";
export type StudentAidReconciliationStatus = "pass" | "warning" | "unavailable";

export interface StudentAidStatusIntervalIntelligence {
  startDate: string;
  endDate?: string;
  open: boolean;
  calendarDays?: number;
  code?: string;
  description?: string;
  category: StudentAidIntervalCategory;
}

export interface StudentAidDelinquencyPeriodIntelligence {
  startDate: string;
  endDate?: string;
  open: boolean;
  calendarDays?: number;
}

export interface StudentAidLoanPortfolioIntelligence {
  loanIndex: number;
  active: boolean;
  statusIntervals: StudentAidStatusIntervalIntelligence[];
  forbearance: {
    intervals: StudentAidStatusIntervalIntelligence[];
    boundedCalendarDays: number;
    complete: boolean;
    currentlyInForbearance: boolean;
    currentStartDate?: string;
    currentCalendarDays?: number;
  };
  delinquency: {
    periods: StudentAidDelinquencyPeriodIntelligence[];
    boundedCalendarDays: number;
    complete: boolean;
    currentlyDelinquent: boolean;
  };
  repaymentPlan?: {
    code?: string;
    description?: string;
    beginDate?: string;
    scheduledAmount?: number;
    idrAnniversaryDate?: string;
    nextPaymentDueDate?: string;
  };
  interest: {
    outstandingInterest?: number;
    capitalizedInterest?: number;
  };
  preferredServicerContact?: StudentAidLoanContactFact;
}

export interface StudentAidPortfolioIntelligence {
  schema: "student-aid-portfolio-intelligence-v1";
  asOfDate?: string;
  activeLoanCount: number;
  loans: StudentAidLoanPortfolioIntelligence[];
  forbearance: {
    portfolioCalendarIntervals: Array<{ startDate: string; endDate?: string; calendarDays?: number; open: boolean }>;
    boundedCalendarDays: number;
    complete: boolean;
    currentLoanCount: number;
  };
  scheduledPayment: {
    coverage: StudentAidCoverageState;
    activeLoanCount: number;
    reportedLoanCount: number;
    missingLoanCount: number;
    reportedAmountSum?: number;
  };
  planDistribution: Array<{
    key: string;
    code?: string;
    description?: string;
    loanCount: number;
    outstandingPrincipal: number;
  }>;
  interest: {
    outstandingInterestSum: number;
    outstandingInterestCoverage: StudentAidCoverageState;
    capitalizedInterestSum: number;
    capitalizedInterestCoverage: StudentAidCoverageState;
  };
  servicerRouting: {
    preferred?: { loanIndex: number; contact: StudentAidLoanContactFact };
    candidateCount: number;
  };
  reconciliation: {
    principal: {
      status: StudentAidReconciliationStatus;
      parsedPrincipalSum: number;
      aggregateContributionSum?: number;
      coveredActiveLoanCount: number;
      activeLoanCount: number;
      delta?: number;
      note: string;
    };
    interest: {
      status: StudentAidReconciliationStatus;
      parsedInterestSum: number;
      note: string;
    };
  };
  warnings: string[];
}

export type AdvisorCaseContextNeed = "comparison" | "eligibility_review" | "forgiveness_projection" | "advisor_review";

export interface AdvisorClientCaseContextV1 {
  schema: "student-loan-idr-client-case-context-v1";
  schemaVersion: 1;
  clientId: string;
  clientUpdatedAt: string;
  lifecycleState: AdvisorClientLifecycleState;
  readinessState: AdvisorClientReadinessState;
  asOf: {
    caseUpdatedAt: string;
    studentAidImportedAt?: string;
    studentAidFileRequestDate?: string;
    portfolioAsOfDate?: string;
  };
  professionalSummary: {
    displayName: string;
    email?: string;
    phone?: string;
    servicerName?: string;
    activeLoanCount: number;
    totalOutstandingPrincipal: number;
    totalOutstandingInterest: number;
    currentRepaymentPlans: string[];
    reportedScheduledPaymentSum?: number;
    currentForbearanceLoanCount: number;
    currentDelinquencyLoanCount: number;
    idrAnniversaryDates: string[];
    nextPaymentDueDates: string[];
  };
  normalizedFacts: {
    contact: AdvisorClientRecordV1["contact"];
    servicerName?: string;
    confirmedFacts?: AdvisorClientRecordV1["confirmedFacts"];
    loanPortfolio?: AdvisorClientRecordV1["normalizedLoanPortfolio"];
    consideredPlans?: RepaymentPlan[];
  };
  provenance: {
    fields: Record<string, StudentAidFactProvenance>;
    loans: Array<{ loanIndex: number; fields: Record<string, StudentAidFactProvenance> }>;
  };
  deterministicIntelligence?: StudentAidPortfolioIntelligence;
  missingInformation: Array<{
    key: string;
    label: string;
    requiredFor: AdvisorCaseContextNeed[];
    blocking: boolean;
  }>;
  coverage: {
    contact: StudentAidCoverageState;
    loanPortfolio: StudentAidCoverageState;
    eligibilityMapping: StudentAidCoverageState;
    currentIncome: StudentAidCoverageState;
    familySize: StudentAidCoverageState;
    dependents: StudentAidCoverageState;
    region: StudentAidCoverageState;
    comparisonReadiness: StudentAidCoverageState;
    scheduledPayment: StudentAidCoverageState;
    outstandingInterest: StudentAidCoverageState;
  };
  warnings: string[];
}

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
    streetAddress1?: string;
    streetAddress2?: string;
    city?: string;
    stateCode?: string;
    countryCode?: string;
    zipCode?: string;
  };
  fieldProvenance?: Record<string, StudentAidFactProvenance>;
  servicerName?: string;
  normalizedLoanPortfolio?: {
    repaymentLoans: RepaymentLoanInput[];
    eligibilityLoans?: EligibilityLoanInput[];
    loans?: StudentAidNormalizedLoanFact[];
    summary?: StudentAidPortfolioSummary;
  };
  confirmedFacts?: {
    income?: IncomeInput[];
    incomeSources?: AdvisorClientIncomeSource[];
    region?: Region;
    familySize?: number;
    dependentsClaimedOnFederalTaxReturn?: number;
    estimatedAboveTheLineAdjustments?: number;
    adjustedGrossIncomeOverride?: number;
    taxFilingStatus?: TaxFilingStatus;
    newBorrowerOnOrAfterJuly1_2014?: boolean;
  };
  consideredPlans?: RepaymentPlan[];
  retainedDraftIds?: string[];
  notes?: string;
  studentAidImport?: {
    source: "studentaid_download";
    importedAt?: string;
    fileRequestDate?: string;
    mappingVersion?: string;
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

export type AdvisorActionState =
  | "needs_income"
  | "needs_family_size"
  | "needs_evidence"
  | "document_ready"
  | "application_ready"
  | "borrower_review_pending"
  | "plan_selected"
  | "booking_pending"
  | "idr_anniversary_approaching"
  | "in_forbearance"
  | "delinquency_attention"
  | "completed"
  | "archived";

export type AdvisorNextActionKind =
  | "collect_income"
  | "collect_family_size"
  | "review_evidence"
  | "prepare_document"
  | "review_application"
  | "share_borrower_review"
  | "review_plan_selection"
  | "book_enrollment"
  | "review_recertification"
  | "review_forbearance"
  | "review_delinquency"
  | "open_case";

export interface AdvisorClientActionSignalV1 {
  state: AdvisorActionState;
  label: string;
  reason: string;
  priority: number;
  attention: boolean;
  dueDate?: string;
  action: {
    kind: AdvisorNextActionKind;
    label: string;
    href: string;
  };
}

export interface AdvisorClientActionSummaryV1 {
  clientId: string;
  displayName: string;
  lifecycleState: AdvisorClientLifecycleState;
  readinessState: AdvisorClientReadinessState;
  updatedAt: string;
  primaryState: AdvisorActionState;
  nextBestAction: AdvisorClientActionSignalV1["action"];
  signals: AdvisorClientActionSignalV1[];
}

export interface AdvisorActionDashboardV1 {
  schema: "student-loan-idr-advisor-action-dashboard-v1";
  schemaVersion: 1;
  generatedAt: string;
  clients: AdvisorClientActionSummaryV1[];
  counts: {
    total: number;
    attention: number;
    byState: Partial<Record<AdvisorActionState, number>>;
  };
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}
