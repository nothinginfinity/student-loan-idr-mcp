import {
  POLICY_SNAPSHOT,
  POVERTY_ADDITIONAL_PERSON_2026,
  POVERTY_GUIDELINES_2026,
  RAP_PERCENT_BY_AGI,
  SOURCE_URLS
} from "./constants.ts";
import type {
  CalculatorRequest,
  CalculatorResult,
  IncomeInput,
  PlanEstimate,
  Region,
  RepaymentPlan
} from "./types.ts";

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const assertFiniteNonNegative = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite number greater than or equal to 0.`);
  }
};

export function normalizeIncomeToAnnual(input: IncomeInput): number {
  switch (input.cadence) {
    case "hourly": {
      const hourlyRate = input.hourlyRate ?? input.amount;
      if (hourlyRate === undefined) throw new Error("hourly income requires hourlyRate or amount.");
      const hoursPerWeek = input.hoursPerWeek ?? 40;
      const weeksPerYear = input.weeksPerYear ?? 52;
      assertFiniteNonNegative(hourlyRate, "hourlyRate");
      assertFiniteNonNegative(hoursPerWeek, "hoursPerWeek");
      assertFiniteNonNegative(weeksPerYear, "weeksPerYear");
      return hourlyRate * hoursPerWeek * weeksPerYear;
    }
    case "weekly":
      if (input.amount === undefined) throw new Error("weekly income requires amount.");
      assertFiniteNonNegative(input.amount, "amount");
      return input.amount * 52;
    case "biweekly":
      if (input.amount === undefined) throw new Error("biweekly income requires amount.");
      assertFiniteNonNegative(input.amount, "amount");
      return input.amount * 26;
    case "semimonthly":
      if (input.amount === undefined) throw new Error("semimonthly income requires amount.");
      assertFiniteNonNegative(input.amount, "amount");
      return input.amount * 24;
    case "monthly":
      if (input.amount === undefined) throw new Error("monthly income requires amount.");
      assertFiniteNonNegative(input.amount, "amount");
      return input.amount * 12;
    case "annual":
      if (input.amount === undefined) throw new Error("annual income requires amount.");
      assertFiniteNonNegative(input.amount, "amount");
      return input.amount;
    case "seasonal_lump_sum": {
      const payments = input.seasonalPayments ?? [];
      if (payments.length === 0) throw new Error("seasonal_lump_sum requires seasonalPayments.");
      for (const [index, payment] of payments.entries()) {
        assertFiniteNonNegative(payment, `seasonalPayments[${index}]`);
      }
      return payments.reduce((sum, payment) => sum + payment, 0);
    }
  }
}

export function povertyGuideline(region: Region, familySize: number): number {
  if (!Number.isInteger(familySize) || familySize < 1) {
    throw new Error("familySize must be a positive integer.");
  }
  const table = POVERTY_GUIDELINES_2026[region];
  if (familySize <= 8) return table[familySize - 1]!;
  return table[7]! + (familySize - 8) * POVERTY_ADDITIONAL_PERSON_2026[region];
}

export function amortizedMonthlyPayment(principal: number, annualInterestRatePercent: number, years: number): number {
  assertFiniteNonNegative(principal, "principal");
  assertFiniteNonNegative(annualInterestRatePercent, "annualInterestRatePercent");
  const months = years * 12;
  if (principal === 0) return 0;
  if (annualInterestRatePercent === 0) return principal / months;
  const monthlyRate = annualInterestRatePercent / 100 / 12;
  return principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
}

function standard10YearCap(request: CalculatorRequest): number | null {
  const principal = request.loan?.principal;
  const rate = request.loan?.annualInterestRatePercent;
  if (principal === undefined || rate === undefined) return null;
  return amortizedMonthlyPayment(principal, rate, 10);
}

function eligibilityNote(plan: RepaymentPlan, request: CalculatorRequest): string {
  const hasNewLoan = request.loan?.hasLoanDisbursedOnOrAfterJuly1_2026;
  if (plan === "RAP") {
    return "RAP is the current IDR option for eligible Direct Loans and is the only IDR plan for borrowers whose Direct Loans are all newly disbursed on or after July 1, 2026; Parent PLUS-related debt is excluded.";
  }
  if (hasNewLoan === true) {
    return `${plan} generally applies only to eligible loans disbursed before July 1, 2026. Mixed-date loan portfolios can require separate plan treatment.`;
  }
  if (plan === "PAYE") return "PAYE is limited by borrower/loan-date eligibility and is scheduled to end no later than July 1, 2028.";
  if (plan === "ICR") return "ICR is limited by loan eligibility and is scheduled to end no later than July 1, 2028.";
  return "IBR eligibility depends on eligible Direct/FFEL loan types and disbursement dates.";
}

function rapEstimate(agi: number, dependents: number, request: CalculatorRequest): PlanEstimate {
  const bracket = RAP_PERCENT_BY_AGI.find((candidate) => agi <= candidate.maxInclusive)!;
  const annualBase = bracket.percent === null ? 120 : agi * bracket.percent;
  const monthly = Math.max(10, annualBase / 12 - dependents * 50);
  return {
    plan: "RAP",
    monthlyPaymentEstimate: roundMoney(monthly),
    annualPaymentEstimate: roundMoney(monthly * 12),
    formulaSummary: bracket.percent === null
      ? "AGI ≤ $10,000 uses a $120 annual base payment; after dependent reduction the statutory monthly floor is $10."
      : `${Math.round(bracket.percent * 100)}% of AGI ÷ 12, minus $50 per claimed dependent, with a $10 monthly floor.`,
    completeness: "estimate",
    eligibilityNote: eligibilityNote("RAP", request),
    warnings: ["RAP uses tax-return dependents, which is not necessarily identical to legacy IDR family size."]
  };
}

function legacyDiscretionaryEstimate(plan: "IBR" | "PAYE", agi: number, poverty: number, request: CalculatorRequest): PlanEstimate {
  const discretionaryIncome = Math.max(0, agi - 1.5 * poverty);
  const rate = plan === "PAYE" ? 0.10 : (request.loan?.newBorrowerOnOrAfterJuly1_2014 ? 0.10 : 0.15);
  const uncapped = discretionaryIncome * rate / 12;
  const cap = standard10YearCap(request);
  const monthly = cap === null ? uncapped : Math.min(uncapped, cap);
  const warnings: string[] = [];
  if (cap === null) warnings.push("No loan principal/interest rate was supplied, so the 10-year Standard payment cap is not modeled.");
  return {
    plan,
    monthlyPaymentEstimate: roundMoney(monthly),
    annualPaymentEstimate: roundMoney(monthly * 12),
    formulaSummary: `${Math.round(rate * 100)}% of discretionary income, where discretionary income is estimated AGI above 150% of the 2026 HHS poverty guideline, divided by 12${cap === null ? "." : ", capped at the modeled 10-year Standard payment."}`,
    completeness: cap === null ? "partial" : "estimate",
    eligibilityNote: eligibilityNote(plan, request),
    warnings
  };
}

function icrEstimate(agi: number, poverty: number, request: CalculatorRequest): PlanEstimate {
  const discretionaryIncome = Math.max(0, agi - poverty);
  const incomeArm = discretionaryIncome * 0.20 / 12;
  const principal = request.loan?.principal;
  const interestRate = request.loan?.annualInterestRatePercent;
  const factor = request.loan?.icrIncomePercentageFactor;
  const warnings: string[] = [];
  let monthly = incomeArm;
  let completeness: "estimate" | "partial" = "partial";

  if (principal !== undefined && interestRate !== undefined && factor !== undefined) {
    if (!Number.isFinite(factor) || factor <= 0) throw new Error("icrIncomePercentageFactor must be greater than 0.");
    const twelveYearAdjusted = amortizedMonthlyPayment(principal, interestRate, 12) * factor;
    monthly = Math.min(incomeArm, twelveYearAdjusted);
    completeness = "estimate";
  } else {
    warnings.push("ICR is the lesser of 20% of discretionary income or a 12-year fixed payment adjusted by an official income-percentage factor. Supply principal, interest rate, and the applicable ICR factor for a fuller estimate.");
  }

  return {
    plan: "ICR",
    monthlyPaymentEstimate: roundMoney(monthly),
    annualPaymentEstimate: roundMoney(monthly * 12),
    formulaSummary: completeness === "estimate"
      ? "Lesser of 20% of discretionary income (AGI above 100% of poverty guideline) ÷ 12 or a modeled 12-year fixed payment multiplied by the supplied official income-percentage factor."
      : "20% discretionary-income arm only; the alternative 12-year adjusted arm is not modeled without the applicable ICR factor.",
    completeness,
    eligibilityNote: eligibilityNote("ICR", request),
    warnings
  };
}

export function calculateRepayment(request: CalculatorRequest): CalculatorResult {
  if (!Array.isArray(request.income) || request.income.length === 0) {
    throw new Error("income must contain at least one income source.");
  }
  if (!Number.isInteger(request.familySize) || request.familySize < 1) {
    throw new Error("familySize must be a positive integer.");
  }
  const dependents = request.dependentsClaimedOnFederalTaxReturn ?? 0;
  if (!Number.isInteger(dependents) || dependents < 0) {
    throw new Error("dependentsClaimedOnFederalTaxReturn must be a non-negative integer.");
  }

  const annualGross = request.income.reduce((sum, source) => sum + normalizeIncomeToAnnual(source), 0);
  const adjustments = request.estimatedAboveTheLineAdjustments ?? 0;
  assertFiniteNonNegative(adjustments, "estimatedAboveTheLineAdjustments");
  const agiOverride = request.adjustedGrossIncomeOverride;
  if (agiOverride !== undefined) assertFiniteNonNegative(agiOverride, "adjustedGrossIncomeOverride");
  const agi = agiOverride ?? Math.max(0, annualGross - adjustments);
  const poverty = povertyGuideline(request.region, request.familySize);
  const plans = request.plans ?? ["RAP", "IBR", "PAYE", "ICR"];

  const planEstimates = plans.map((plan): PlanEstimate => {
    switch (plan) {
      case "RAP": return rapEstimate(agi, dependents, request);
      case "IBR": return legacyDiscretionaryEstimate("IBR", agi, poverty, request);
      case "PAYE": return legacyDiscretionaryEstimate("PAYE", agi, poverty, request);
      case "ICR": return icrEstimate(agi, poverty, request);
    }
  });

  return {
    policySnapshot: POLICY_SNAPSHOT,
    normalizedAnnualTaxableGrossIncome: roundMoney(annualGross),
    estimatedAdjustedGrossIncome: roundMoney(agi),
    povertyGuideline: poverty,
    familySize: request.familySize,
    dependentsClaimedOnFederalTaxReturn: dependents,
    planEstimates,
    assumptions: [
      "Income cadence normalization annualizes the amounts supplied by the caller.",
      "The calculator does not invent a tax return. Estimated AGI equals the explicit AGI override when supplied; otherwise it equals annualized taxable gross income minus caller-supplied estimated above-the-line adjustments.",
      "2026 HHS poverty guidelines are used for legacy discretionary-income estimates.",
      "Results are estimates only; official eligibility and billing are determined by the U.S. Department of Education and the loan servicer."
    ],
    warnings: [
      "Do not use this tool to fabricate income, deductions, dependents, loan details, or supporting documentation.",
      "Federal repayment law changed materially on July 1, 2026; loan type and disbursement date can change plan eligibility.",
      "SAVE is not included in this policy snapshot."
    ],
    sources: [...SOURCE_URLS]
  };
}
