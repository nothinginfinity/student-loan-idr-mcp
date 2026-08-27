import type { Region } from "./types.ts";

export const POLICY_SNAPSHOT = "2026-08-27";

export const SOURCE_URLS = [
  "https://studentaid.gov/articles/faqs-idr-plan/",
  "https://studentaid.gov/sites/default/files/IncomeDrivenRepayment-en-us.pdf",
  "https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines"
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
