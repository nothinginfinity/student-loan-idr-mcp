import type { IcrIncomeFactorCategory, Region } from "./types.ts";

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
