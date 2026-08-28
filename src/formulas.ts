import {
  FEDERAL_STUDENT_AID_IDR_URL,
  ICR_FACTOR_EFFECTIVE_FROM,
  ICR_FACTOR_EFFECTIVE_THROUGH,
  ICR_INCOME_PERCENTAGE_FACTORS_2026,
  POLICY_SNAPSHOT,
  POVERTY_ADDITIONAL_PERSON_2026,
  POVERTY_GUIDELINES_2026,
  RAP_PERCENT_BY_AGI,
  SOURCE_URLS
} from "./constants.ts";
import type {
  CalculatorRequest,
  CalculatorResult,
  EligibilityLoanInput,
  IcrIncomeFactorCategory,
  IncomeInput,
  LoanEligibilityAssessment,
  LoanEligibilityStatus,
  LoanType,
  PlanEligibility,
  PlanEstimate,
  PolicyStatusResult,
  Region,
  RepaymentPlan,
  TaxFilingStatus
} from "./types.ts";

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const roundFactor = (value: number): number => Math.round((value + Number.EPSILON) * 10000) / 10000;

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

export function ibrZeroPaymentAgiThreshold(region: Region, familySize: number): number {
  return povertyGuideline(region, familySize) * 1.5;
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

export function icrIncomePercentageFactor(agi: number, category: IcrIncomeFactorCategory): number {
  assertFiniteNonNegative(agi, "agi");
  const table = ICR_INCOME_PERCENTAGE_FACTORS_2026[category];
  const first = table[0]!;
  const last = table[table.length - 1]!;
  if (agi <= first.agi) return first.factor;
  if (agi >= last.agi) return last.factor;

  for (let index = 1; index < table.length; index += 1) {
    const upper = table[index]!;
    if (agi === upper.agi) return upper.factor;
    if (agi < upper.agi) {
      const lower = table[index - 1]!;
      const position = (agi - lower.agi) / (upper.agi - lower.agi);
      return roundFactor(lower.factor + position * (upper.factor - lower.factor));
    }
  }

  return last.factor;
}

const DIRECT_STANDARD_TYPES = new Set<LoanType>([
  "direct_subsidized",
  "direct_unsubsidized",
  "direct_grad_plus",
  "direct_consolidation_no_parent_plus"
]);

const FFEL_NON_PARENT_TYPES = new Set<LoanType>([
  "ffel_subsidized_stafford",
  "ffel_unsubsidized_stafford",
  "ffel_grad_plus",
  "ffel_consolidation_no_parent_plus"
]);

function loanAssessment(
  plan: RepaymentPlan,
  loan: EligibilityLoanInput,
  loanIndex: number,
  request: CalculatorRequest
): LoanEligibilityAssessment {
  const result = (status: LoanEligibilityStatus, ...reasons: string[]): LoanEligibilityAssessment => ({
    loanIndex,
    loanType: loan.loanType,
    disbursementPeriod: loan.disbursementPeriod,
    status,
    reasons
  });

  if (loan.inDefault === true) {
    return result("ineligible", "Defaulted loans are not eligible for an IDR plan until the default is resolved through an eligible path such as rehabilitation or consolidation.");
  }

  const beforeJuly2026 = loan.disbursementPeriod === "before_2026_07_01";

  if (plan === "RAP") {
    if (DIRECT_STANDARD_TYPES.has(loan.loanType)) return result("eligible", "Federal Student Aid lists this Direct Loan category as RAP-eligible regardless of whether it was disbursed before or after July 1, 2026.");
    if (loan.loanType === "direct_parent_plus" || loan.loanType === "direct_consolidation_with_parent_plus" || loan.loanType === "ffel_parent_plus" || loan.loanType === "ffel_consolidation_with_parent_plus") {
      return result("ineligible", "Parent PLUS loans and consolidation loans that paid off parent PLUS debt are not eligible for RAP.");
    }
    if (FFEL_NON_PARENT_TYPES.has(loan.loanType)) {
      return result("conditional", "This FFEL category is not directly repayable under RAP; Federal Student Aid lists it as potentially eligible after consolidation into an eligible Direct Consolidation Loan.");
    }
    return result("conditional", "Federal Perkins Loans are not directly repayable under RAP; current Federal Student Aid guidance lists a consolidation path with additional conditions that require borrower-specific review.");
  }

  if (plan === "IBR") {
    if (!beforeJuly2026) return result("ineligible", "IBR applies to otherwise eligible Direct and FFEL loans disbursed before July 1, 2026.");
    if (loan.loanType === "direct_consolidation_with_parent_plus") {
      if (loan.madeIcrPaymentBeforeJuly1_2028 === true) return result("eligible", "Federal Student Aid lists this pre-July-1-2026 Direct Consolidation category as IBR-eligible when the required ICR payment condition is satisfied before July 1, 2028.");
      if (loan.madeIcrPaymentBeforeJuly1_2028 === false) return result("ineligible", "The required ICR payment condition for this parent-PLUS-related Direct Consolidation loan was not satisfied before July 1, 2028.");
      return result("conditional", "Federal Student Aid lists this parent-PLUS-related Direct Consolidation category as IBR-eligible only after the required ICR payment condition is satisfied before July 1, 2028.");
    }
    if (DIRECT_STANDARD_TYPES.has(loan.loanType) || FFEL_NON_PARENT_TYPES.has(loan.loanType)) {
      return result("eligible", "Federal Student Aid lists this pre-July-1-2026 Direct/FFEL loan category as IBR-eligible.");
    }
    return result("ineligible", "Federal Student Aid does not list this loan category as directly eligible for IBR.");
  }

  if (plan === "PAYE") {
    if (!beforeJuly2026) return result("ineligible", "PAYE applies only to otherwise eligible Direct Loans disbursed before July 1, 2026.");
    if (!DIRECT_STANDARD_TYPES.has(loan.loanType)) return result("ineligible", "Federal Student Aid does not list this loan category as PAYE-eligible.");

    const borrowerDate = request.loan?.payeNewBorrowerOnOrAfterOct1_2007;
    const directDisbursementDate = request.loan?.payeDirectLoanDisbursementOnOrAfterOct1_2011;
    if (borrowerDate === false || directDisbursementDate === false) {
      return result("ineligible", "PAYE requires the borrower to be a new borrower on or after Oct. 1, 2007 and to have received a Direct Loan disbursement on or after Oct. 1, 2011.");
    }
    if (borrowerDate !== true || directDisbursementDate !== true) {
      return result("conditional", "Loan type/date are compatible with PAYE, but the Oct. 1, 2007 new-borrower and Oct. 1, 2011 Direct Loan disbursement conditions were not fully supplied.");
    }
    return result("eligible", "Loan type and supplied borrower/disbursement-date conditions are compatible with PAYE; the payment-to-Standard comparison is evaluated separately by the calculator.");
  }

  if (!beforeJuly2026) return result("ineligible", "ICR applies only to otherwise eligible Direct Loans disbursed before July 1, 2026 and ends no later than July 1, 2028.");
  if (DIRECT_STANDARD_TYPES.has(loan.loanType) || loan.loanType === "direct_consolidation_with_parent_plus") {
    return result("eligible", "Federal Student Aid lists this pre-July-1-2026 Direct Loan category as ICR-eligible.");
  }
  if (loan.loanType === "direct_parent_plus" || loan.loanType === "ffel_parent_plus" || loan.loanType === "ffel_consolidation_with_parent_plus") {
    return result("ineligible", "Federal Student Aid does not list this parent-loan category as directly eligible for ICR.");
  }
  if (FFEL_NON_PARENT_TYPES.has(loan.loanType) || loan.loanType === "perkins") {
    return result("conditional", "This loan is not directly repayable under ICR; borrower-specific Direct Consolidation eligibility must be reviewed before the July 1, 2028 ICR sunset.");
  }
  return result("ineligible", "This loan category is not modeled as directly eligible for ICR.");
}

export function evaluatePlanEligibility(plan: RepaymentPlan, request: CalculatorRequest): PlanEligibility {
  const loans = request.loan?.eligibilityLoans;
  if (!loans || loans.length === 0) {
    return {
      status: "unknown",
      loanAssessments: [],
      reasons: ["No explicit eligibilityLoans portfolio was supplied, so the calculator will not infer official plan eligibility from payment inputs alone."],
      sourceUrls: [FEDERAL_STUDENT_AID_IDR_URL]
    };
  }

  const loanAssessments = loans.map((loan, index) => loanAssessment(plan, loan, index, request));
  const statuses = new Set(loanAssessments.map((assessment) => assessment.status));
  let status: PlanEligibility["status"];
  if (statuses.size === 1 && statuses.has("eligible")) status = "eligible";
  else if (statuses.size === 1 && statuses.has("ineligible")) status = "ineligible";
  else if (statuses.has("ineligible") && statuses.size > 1) status = "mixed";
  else status = "conditional";

  const reasons = status === "mixed"
    ? ["The supplied portfolio contains loans with different eligibility outcomes; mixed-date/type portfolios can require separate plan treatment."]
    : status === "conditional"
      ? ["At least one supplied loan requires an additional consolidation, borrower-date, or plan-specific condition before eligibility can be treated as resolved."]
      : [`All supplied eligibility loans evaluated as ${status} for ${plan} under this policy snapshot.`];

  return {
    status,
    loanAssessments,
    reasons,
    sourceUrls: [FEDERAL_STUDENT_AID_IDR_URL]
  };
}

function repaymentPortfolioPayment(request: CalculatorRequest, years: number): number | null {
  const repaymentLoans = request.loan?.repaymentLoans;
  if (repaymentLoans && repaymentLoans.length > 0) {
    return repaymentLoans.reduce((sum, loan, index) => {
      assertFiniteNonNegative(loan.principal, `repaymentLoans[${index}].principal`);
      assertFiniteNonNegative(loan.annualInterestRatePercent, `repaymentLoans[${index}].annualInterestRatePercent`);
      return sum + amortizedMonthlyPayment(loan.principal, loan.annualInterestRatePercent, years);
    }, 0);
  }

  const principal = request.loan?.principal;
  const rate = request.loan?.annualInterestRatePercent;
  if (principal === undefined || rate === undefined) return null;
  return amortizedMonthlyPayment(principal, rate, years);
}

function standard10YearCap(request: CalculatorRequest): number | null {
  return repaymentPortfolioPayment(request, 10);
}

function eligibilityNote(plan: RepaymentPlan, request: CalculatorRequest, eligibility: PlanEligibility): string {
  if (eligibility.status !== "unknown") {
    return `${plan} eligibility assessment: ${eligibility.status}. See eligibility.loanAssessments for the deterministic loan-type/disbursement branches used.`;
  }
  const hasNewLoan = request.loan?.hasLoanDisbursedOnOrAfterJuly1_2026;
  if (plan === "RAP") {
    return "RAP is available for eligible Direct Loans; Parent PLUS-related debt is excluded. Supply loan.eligibilityLoans for an explicit deterministic assessment.";
  }
  if (hasNewLoan === true) {
    return `${plan} generally applies only to eligible loans disbursed before July 1, 2026. Supply loan.eligibilityLoans for explicit mixed-portfolio treatment.`;
  }
  if (plan === "PAYE") return "PAYE has loan-type and borrower-date eligibility requirements and ends no later than July 1, 2028. Supply loan.eligibilityLoans and PAYE date flags for an explicit assessment.";
  if (plan === "ICR") return "ICR has loan-type eligibility requirements and ends no later than July 1, 2028. Supply loan.eligibilityLoans for an explicit assessment.";
  return "IBR eligibility depends on eligible Direct/FFEL loan types and disbursement dates. Supply loan.eligibilityLoans for an explicit assessment.";
}

function rapEstimate(agi: number, dependents: number, request: CalculatorRequest): PlanEstimate {
  const bracket = RAP_PERCENT_BY_AGI.find((candidate) => agi <= candidate.maxInclusive)!;
  const annualBase = bracket.percent === null ? 120 : agi * bracket.percent;
  const monthly = Math.max(10, annualBase / 12 - dependents * 50);
  const eligibility = evaluatePlanEligibility("RAP", request);
  return {
    plan: "RAP",
    monthlyPaymentEstimate: roundMoney(monthly),
    annualPaymentEstimate: roundMoney(monthly * 12),
    formulaSummary: bracket.percent === null
      ? "AGI ≤ $10,000 uses a $120 annual base payment; after dependent reduction the statutory monthly floor is $10."
      : `${Math.round(bracket.percent * 100)}% of AGI ÷ 12, minus $50 per claimed dependent, with a $10 monthly floor.`,
    completeness: "estimate",
    eligibility,
    eligibilityNote: eligibilityNote("RAP", request, eligibility),
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
  let eligibility = evaluatePlanEligibility(plan, request);

  if (cap === null) {
    warnings.push("No loan principal/interest rate was supplied, so the 10-year Standard payment cap is not modeled.");
    if (plan === "PAYE" && eligibility.status === "eligible") {
      eligibility = {
        ...eligibility,
        status: "conditional",
        reasons: [...eligibility.reasons, "PAYE initial enrollment also requires the calculated PAYE amount to be less than the 10-year Standard amount; principal/rate were not supplied to test that condition."]
      };
    }
  } else if (plan === "PAYE" && uncapped >= cap && eligibility.status === "eligible") {
    eligibility = {
      ...eligibility,
      status: "ineligible",
      reasons: [...eligibility.reasons, "The modeled uncapped PAYE amount is not less than the modeled 10-year Standard amount, so the PAYE payment-amount eligibility condition is not satisfied for these inputs."]
    };
  }

  return {
    plan,
    monthlyPaymentEstimate: roundMoney(monthly),
    annualPaymentEstimate: roundMoney(monthly * 12),
    formulaSummary: `${Math.round(rate * 100)}% of discretionary income, where discretionary income is estimated AGI above 150% of the 2026 HHS poverty guideline, divided by 12${cap === null ? "." : ", capped at the modeled 10-year Standard payment."}`,
    completeness: cap === null ? "partial" : "estimate",
    eligibility,
    eligibilityNote: eligibilityNote(plan, request, eligibility),
    warnings
  };
}

function categoryFromTaxFilingStatus(status: TaxFilingStatus | undefined): IcrIncomeFactorCategory | undefined {
  if (status === undefined) return undefined;
  return status === "single" ? "single" : "married_or_head_of_household";
}

function icrEstimate(agi: number, poverty: number, request: CalculatorRequest): PlanEstimate {
  const discretionaryIncome = Math.max(0, agi - poverty);
  const incomeArm = discretionaryIncome * 0.20 / 12;
  const twelveYearBase = repaymentPortfolioPayment(request, 12);
  const suppliedFactor = request.loan?.icrIncomePercentageFactor;
  const factorCategory = request.loan?.icrIncomeFactorCategory ?? categoryFromTaxFilingStatus(request.taxFilingStatus);
  const warnings: string[] = [];
  let factor: number | undefined;
  let factorSource: "caller_override" | "2026_table" | undefined;
  let monthly = incomeArm;
  let completeness: "estimate" | "partial" = "partial";

  if (suppliedFactor !== undefined) {
    if (!Number.isFinite(suppliedFactor) || suppliedFactor <= 0) throw new Error("icrIncomePercentageFactor must be greater than 0.");
    factor = suppliedFactor;
    factorSource = "caller_override";
  } else if (factorCategory !== undefined) {
    factor = icrIncomePercentageFactor(agi, factorCategory);
    factorSource = "2026_table";
  }

  if (twelveYearBase !== null && factor !== undefined) {
    const twelveYearAdjusted = twelveYearBase * factor;
    monthly = Math.min(incomeArm, twelveYearAdjusted);
    completeness = "estimate";
  } else {
    if (twelveYearBase === null) warnings.push("ICR's 12-year adjusted arm requires either loan.repaymentLoans or a single loan principal and annual interest rate.");
    if (factor === undefined) warnings.push("ICR's 12-year adjusted arm requires taxFilingStatus or loan.icrIncomeFactorCategory so the built-in 2026 income-percentage factor table can be applied.");
  }

  const eligibility = evaluatePlanEligibility("ICR", request);
  const factorDescription = factorSource === "2026_table"
    ? "the built-in 2026 Federal Register income-percentage factor table (with linear interpolation)"
    : factorSource === "caller_override"
      ? "the caller-supplied income-percentage factor override"
      : "no income-percentage factor";

  return {
    plan: "ICR",
    monthlyPaymentEstimate: roundMoney(monthly),
    annualPaymentEstimate: roundMoney(monthly * 12),
    formulaSummary: completeness === "estimate"
      ? `Lesser of 20% of discretionary income (AGI above 100% of poverty guideline) ÷ 12 or a modeled 12-year fixed payment multiplied by ${factorDescription}.`
      : "20% discretionary-income arm only; the alternative 12-year adjusted arm is partial until principal, interest rate, and an ICR factor category (or explicit override) are available.",
    completeness,
    eligibility,
    eligibilityNote: eligibilityNote("ICR", request, eligibility),
    warnings
  };
}

export function getPolicyStatus(): PolicyStatusResult {
  return {
    policySnapshot: POLICY_SNAPSHOT,
    supportedPlans: [
      {
        plan: "RAP",
        supported: true,
        effectiveDate: "2026-07-01",
        notes: ["Available for eligible Direct Loans; Parent PLUS-related debt is excluded under current Federal Student Aid guidance."]
      },
      {
        plan: "IBR",
        supported: true,
        notes: ["Modeled for eligible pre-July-1-2026 Direct/FFEL loans with the 10%/15% borrower distinction and optional 10-year Standard cap."]
      },
      {
        plan: "PAYE",
        supported: true,
        sunsetDate: "2028-07-01",
        notes: ["Ends no later than July 1, 2028; borrower/date and modeled Standard-payment eligibility conditions are surfaced explicitly when inputs are available."]
      },
      {
        plan: "ICR",
        supported: true,
        sunsetDate: "2028-07-01",
        notes: [`The built-in 2026 income-percentage factor table applies ${ICR_FACTOR_EFFECTIVE_FROM} through ${ICR_FACTOR_EFFECTIVE_THROUGH} and uses linear interpolation between published AGI rows.`]
      }
    ],
    icrFactorTable: {
      year: 2026,
      effectiveFrom: ICR_FACTOR_EFFECTIVE_FROM,
      effectiveThrough: ICR_FACTOR_EFFECTIVE_THROUGH,
      interpolation: "linear"
    },
    knownPlanChanges: [
      "RAP became available July 1, 2026.",
      "PAYE and ICR are scheduled to end no later than July 1, 2028.",
      "SAVE is not modeled in this snapshot; Federal Student Aid states that a federal court order ended the plan."
    ],
    sources: [...SOURCE_URLS]
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
      "Eligibility objects are deterministic screening results for the supplied loan-type/disbursement facts; official eligibility and billing remain with the U.S. Department of Education and the loan servicer.",
      "When loan.repaymentLoans is supplied, Standard-payment and ICR fixed-payment arms are modeled as the sum of per-loan amortized payments rather than a blended interest-rate approximation."
    ],
    warnings: [
      "Do not use this tool to fabricate income, deductions, dependents, loan details, or supporting documentation.",
      "Federal repayment law changed materially on July 1, 2026; mixed loan types and disbursement dates can require separate plan treatment.",
      "SAVE is not included in this policy snapshot."
    ],
    sources: [...SOURCE_URLS]
  };
}
