import type { AdvisorPolicyEvidenceChunkV1, AdvisorPolicyRuleCardV1, FsaDataDictionaryEntryV1, IcrIncomeFactorCategory, Region } from "./types.ts";

export const POLICY_SNAPSHOT = "2026-08-27";

export const FEDERAL_STUDENT_AID_IDR_URL = "https://studentaid.gov/articles/faqs-idr-plan/";
export const FEDERAL_STUDENT_AID_IDR_FORM_URL = "https://studentaid.gov/sites/default/files/IncomeDrivenRepayment-en-us.pdf";
export const HHS_POVERTY_GUIDELINES_URL = "https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines";
export const ICR_2026_GOVINFO_URL = "https://www.govinfo.gov/content/pkg/FR-2026-06-09/pdf/2026-11540.pdf";

export const SOURCE_URLS = [
  FEDERAL_STUDENT_AID_IDR_URL,
  FEDERAL_STUDENT_AID_IDR_FORM_URL,
  HHS_POVERTY_GUIDELINES_URL,
  ICR_2026_GOVINFO_URL
] as const;

export const FSA_DATA_DICTIONARY_VERSION = "2026-09-05-v2";
export const FSA_DATA_DICTIONARY: readonly FsaDataDictionaryEntryV1[] = [
  { id:"loan-award-id", canonicalLabel:"Loan Award ID", aliases:[], normalizedTarget:"loans[].maskedAwardId", category:"loan_identity", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"masked_only", deterministicInfluence:false },
  { id:"loan-type-code", canonicalLabel:"Loan Type Code", aliases:["Loan Type"], normalizedTarget:"loans[].loanTypeCode", category:"loan_identity", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"loan-type-description", canonicalLabel:"Loan Type Description", aliases:[], normalizedTarget:"loans[].loanTypeDescription", category:"loan_identity", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"loan-date", canonicalLabel:"Loan Date", aliases:[], normalizedTarget:"loans[].loanDate", category:"loan_identity", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"outstanding-principal", canonicalLabel:"Loan Outstanding Principal Balance", aliases:[], normalizedTarget:"loans[].outstandingPrincipal", category:"balance", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"outstanding-interest", canonicalLabel:"Loan Outstanding Interest Balance", aliases:[], normalizedTarget:"loans[].outstandingInterest", category:"interest", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"interest-rate", canonicalLabel:"Loan Interest Rate", aliases:[], normalizedTarget:"loans[].interestRatePercent", category:"interest", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"repayment-plan-code", canonicalLabel:"Loan Repayment Plan Type Code", aliases:[], normalizedTarget:"loans[].repaymentPlanTypeCode", category:"repayment_plan", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"repayment-plan-description", canonicalLabel:"Loan Repayment Plan Type Code Description", aliases:[], normalizedTarget:"loans[].repaymentPlanDescription", category:"repayment_plan", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"scheduled-payment", canonicalLabel:"Loan Repayment Plan Scheduled Amount", aliases:[], normalizedTarget:"loans[].repaymentPlanScheduledAmount", category:"repayment_plan", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"idr-anniversary", canonicalLabel:"Loan Repayment Plan IDR Plan Anniversary Date", aliases:[], normalizedTarget:"loans[].repaymentPlanIdrAnniversaryDate", category:"repayment_plan", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"current-status", canonicalLabel:"Current Loan Status", aliases:[], normalizedTarget:"loans[].currentLoanStatusCode", category:"status", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"current-status-description", canonicalLabel:"Current Loan Status Description", aliases:[], normalizedTarget:"loans[].currentLoanStatusDescription", category:"status", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"delinquency-date", canonicalLabel:"Loan Delinquency Date", aliases:[], normalizedTarget:"loans[].delinquencies[].date", category:"delinquency", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"delinquency-end-date", canonicalLabel:"Loan Delinquency End Date", aliases:[], normalizedTarget:"loans[].delinquencies[].endDate", category:"delinquency", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"parent-plus-first-level", canonicalLabel:"Parent Plus First Level Consolidation Indicator", aliases:[], normalizedTarget:"loans[].parentPlusFirstLevelConsolidationIndicator", category:"consolidation", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"consolidation-parent-plus", canonicalLabel:"Consolidation Loan With Any Parent Plus Indicator", aliases:[], normalizedTarget:"loans[].consolidationLoanWithAnyParentPlusIndicator", category:"consolidation", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:true },
  { id:"aggregate-opb", canonicalLabel:"Calculated Combined Aggregate OPB", aliases:[], normalizedTarget:"loans[].calculatedCombinedAggregateOpb", category:"aggregate", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:false },
  { id:"updated-date", canonicalLabel:"Loan Updated Date", aliases:["UpdtDt"], normalizedTarget:"loans[].updateDate", category:"status", parserMappingVersion:FSA_DATA_DICTIONARY_VERSION, retention:"normalized", deterministicInfluence:false }
] as const;

export const POLICY_SOURCE_HASHES = {
  [FEDERAL_STUDENT_AID_IDR_URL]: "81da0a0537db047cb286ef61da3fd13e508c2638c529aa27163f80fba1dd7b44",
  [FEDERAL_STUDENT_AID_IDR_FORM_URL]: "b82861a7779fa0d90aca963ae8318c1d1a6dc2259b59b8d21457d8747deae97d",
  [ICR_2026_GOVINFO_URL]: "5252a7656d172641f0fbd6f30723c6258f4c72016bce8bc571670a90ea282a85"
} as const;

export const POLICY_EVIDENCE_CORPUS: readonly AdvisorPolicyEvidenceChunkV1[] = [
  { id:"rap-direct-parent-plus", policySnapshot:POLICY_SNAPSHOT, title:"RAP Direct Loan and Parent PLUS boundary", keywords:["rap","direct","parent plus","consolidation"], content:"RAP is available for eligible Direct Loans; Parent PLUS debt and consolidation loans that repaid Parent PLUS debt are excluded.", sourceUrl:FEDERAL_STUDENT_AID_IDR_URL, sourceDocumentHash:POLICY_SOURCE_HASHES[FEDERAL_STUDENT_AID_IDR_URL], effectiveFrom:"2026-07-01", locator:"Federal Student Aid IDR FAQ · RAP eligibility", contentHash:"1e75ff01d3d6d9812c98cfeaff18e903bc811ed3bd76c6fdc213b91006eab674" },
  { id:"ffel-perkins-consolidation", policySnapshot:POLICY_SNAPSHOT, title:"FFEL and Perkins consolidation review", keywords:["ffel","perkins","consolidation","rap","icr"], content:"FFEL and Perkins loans are not directly repayable under RAP or ICR in the modeled rules; borrower-specific Direct Consolidation eligibility must be reviewed.", sourceUrl:FEDERAL_STUDENT_AID_IDR_URL, sourceDocumentHash:POLICY_SOURCE_HASHES[FEDERAL_STUDENT_AID_IDR_URL], locator:"Federal Student Aid IDR FAQ · eligible loan types", contentHash:"3e62788fc9cd370b0e697c0c99685f1e715e40fe14c92199a8d765ca25da479e" },
  { id:"ibr-pre-july-2026", policySnapshot:POLICY_SNAPSHOT, title:"IBR pre-July-2026 and Parent PLUS consolidation rule", keywords:["ibr","parent plus","ffel","direct","july 1 2026","july 1 2028"], content:"IBR is modeled for otherwise eligible Direct and FFEL loans disbursed before July 1, 2026. Parent-PLUS-related Direct Consolidation loans require the modeled ICR-payment condition before July 1, 2028.", sourceUrl:FEDERAL_STUDENT_AID_IDR_URL, sourceDocumentHash:POLICY_SOURCE_HASHES[FEDERAL_STUDENT_AID_IDR_URL], locator:"Federal Student Aid IDR FAQ · IBR eligible loans and transition condition", contentHash:"652a239451453cd4267c710c9a299c9ded0baae63eca56b941c67dc885682fa7" },
  { id:"paye-icr-sunset", policySnapshot:POLICY_SNAPSHOT, title:"PAYE and ICR sunset", keywords:["paye","icr","sunset","2028"], content:"PAYE and ICR apply only to otherwise eligible pre-July-1-2026 loans in this snapshot and end no later than July 1, 2028.", sourceUrl:FEDERAL_STUDENT_AID_IDR_URL, sourceDocumentHash:POLICY_SOURCE_HASHES[FEDERAL_STUDENT_AID_IDR_URL], effectiveThrough:"2028-07-01", locator:"Federal Student Aid IDR FAQ · PAYE/ICR transition", contentHash:"7b2f0e1feda748db34a870440e914fb8e6f9099bdc05f68c8980e6a2e00f0f57" },
  { id:"save-ended", policySnapshot:POLICY_SNAPSHOT, title:"Legacy SAVE state", keywords:["save","repaye","legacy","court"], content:"SAVE is not modeled in this policy snapshot because accepted Federal Student Aid guidance says a federal court order ended the plan.", sourceUrl:FEDERAL_STUDENT_AID_IDR_URL, sourceDocumentHash:POLICY_SOURCE_HASHES[FEDERAL_STUDENT_AID_IDR_URL], locator:"Federal Student Aid IDR FAQ · SAVE status", contentHash:"d8e2e46b2d33f5e0440d730fcd33f595c4fa2db5f2fcb49566d99ba9710402bc" }
] as const;

export const POLICY_RULE_REGISTRY: readonly AdvisorPolicyRuleCardV1[] = [
  { id:"rap-loan-family", policySnapshot:POLICY_SNAPSHOT, title:"RAP loan-family screening", programs:["RAP"], loanFamilies:["Direct","Parent PLUS","FFEL","Perkins"], keywords:["rap","parent plus","ffel","perkins","consolidation"], deterministicAuthority:"evaluatePlanEligibility(RAP)", explanation:"Use the deterministic loan assessment for eligibility. Retrieval may explain Direct-loan eligibility, Parent-PLUS exclusions, and consolidation review paths but cannot override that result.", evidenceChunkIds:["rap-direct-parent-plus","ffel-perkins-consolidation"] },
  { id:"ibr-loan-family", policySnapshot:POLICY_SNAPSHOT, title:"IBR loan-family and timing screening", programs:["IBR"], loanFamilies:["Direct","FFEL","Parent PLUS consolidation"], keywords:["ibr","parent plus","ffel","july 2026","july 2028"], deterministicAuthority:"evaluatePlanEligibility(IBR)", explanation:"IBR screening is code-owned from saved loan family, disbursement period, and explicit transition facts; chat only explains the result.", evidenceChunkIds:["ibr-pre-july-2026"] },
  { id:"legacy-plan-transition", policySnapshot:POLICY_SNAPSHOT, title:"Legacy repayment-plan transition", programs:["PAYE","ICR","SAVE","REPAYE"], loanFamilies:["Direct"], keywords:["paye","icr","save","repaye","legacy","sunset"], deterministicAuthority:"getPolicyStatus / calculateRepayment", explanation:"Current plan availability and sunset handling come from the accepted policy snapshot. Retrieval cannot revive a stale plan state.", evidenceChunkIds:["paye-icr-sunset","save-ended"] }
] as const;

export const POVERTY_GUIDELINES_2026: Record<Region, readonly number[]> = {
  contiguous_us: [15960, 21640, 27320, 33000, 38680, 44360, 50040, 55720],
  alaska: [19950, 27050, 34150, 41250, 48350, 55450, 62550, 69650],
  hawaii: [18360, 24890, 31420, 37950, 44480, 51010, 57540, 64070]
};

export const POVERTY_ADDITIONAL_PERSON_2026: Record<Region, number> = {
  contiguous_us: 5680,
  alaska: 7100,
  hawaii: 6530
};

export const RAP_PERCENT_BY_AGI = [
  { maxInclusive: 10000, percent: null },
  { maxInclusive: 20000, percent: 0.01 },
  { maxInclusive: 30000, percent: 0.02 },
  { maxInclusive: 40000, percent: 0.03 },
  { maxInclusive: 50000, percent: 0.04 },
  { maxInclusive: 60000, percent: 0.05 },
  { maxInclusive: 70000, percent: 0.06 },
  { maxInclusive: 80000, percent: 0.07 },
  { maxInclusive: 90000, percent: 0.08 },
  { maxInclusive: 100000, percent: 0.09 },
  { maxInclusive: Number.POSITIVE_INFINITY, percent: 0.10 }
] as const;

export const ICR_FACTOR_EFFECTIVE_FROM = "2026-07-01";
export const ICR_FACTOR_EFFECTIVE_THROUGH = "2027-06-30";

export const ICR_INCOME_PERCENTAGE_FACTORS_2026: Record<IcrIncomeFactorCategory, readonly { agi: number; factor: number }[]> = {
  single: [
    { agi: 13717, factor: 0.55 },
    { agi: 18873, factor: 0.5779 },
    { agi: 24285, factor: 0.6057 },
    { agi: 29819, factor: 0.6623 },
    { agi: 35104, factor: 0.7189 },
    { agi: 41769, factor: 0.8033 },
    { agi: 52462, factor: 0.8877 },
    { agi: 65798, factor: 1.0 },
    { agi: 79138, factor: 1.0 },
    { agi: 95112, factor: 1.118 },
    { agi: 121787, factor: 1.235 },
    { agi: 172492, factor: 1.412 },
    { agi: 197779, factor: 1.5 },
    { agi: 352277, factor: 2.0 }
  ],
  married_or_head_of_household: [
    { agi: 13717, factor: 0.5052 },
    { agi: 21641, factor: 0.5668 },
    { agi: 25790, factor: 0.5956 },
    { agi: 33717, factor: 0.6779 },
    { agi: 41769, factor: 0.7522 },
    { agi: 52462, factor: 0.8761 },
    { agi: 65797, factor: 1.0 },
    { agi: 79138, factor: 1.0 },
    { agi: 99146, factor: 1.094 },
    { agi: 132481, factor: 1.25 },
    { agi: 179158, factor: 1.406 },
    { agi: 250560, factor: 1.5 },
    { agi: 409433, factor: 2.0 }
  ]
};
