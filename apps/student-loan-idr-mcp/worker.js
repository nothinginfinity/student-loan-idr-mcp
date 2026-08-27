var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/constants.ts
var POLICY_SNAPSHOT = "2026-08-27";
var FEDERAL_STUDENT_AID_IDR_URL = "https://studentaid.gov/articles/faqs-idr-plan/";
var FEDERAL_STUDENT_AID_IDR_FORM_URL = "https://studentaid.gov/sites/default/files/IncomeDrivenRepayment-en-us.pdf";
var HHS_POVERTY_GUIDELINES_URL = "https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines";
var ICR_2026_GOVINFO_URL = "https://www.govinfo.gov/content/pkg/FR-2026-06-09/pdf/2026-11540.pdf";
var SOURCE_URLS = [
  FEDERAL_STUDENT_AID_IDR_URL,
  FEDERAL_STUDENT_AID_IDR_FORM_URL,
  HHS_POVERTY_GUIDELINES_URL,
  ICR_2026_GOVINFO_URL
];
var POVERTY_GUIDELINES_2026 = {
  contiguous_us: [15960, 21640, 27320, 33e3, 38680, 44360, 50040, 55720],
  alaska: [19950, 27050, 34150, 41250, 48350, 55450, 62550, 69650],
  hawaii: [18360, 24890, 31420, 37950, 44480, 51010, 57540, 64070]
};
var POVERTY_ADDITIONAL_PERSON_2026 = {
  contiguous_us: 5680,
  alaska: 7100,
  hawaii: 6530
};
var RAP_PERCENT_BY_AGI = [
  { maxInclusive: 1e4, percent: null },
  { maxInclusive: 2e4, percent: 0.01 },
  { maxInclusive: 3e4, percent: 0.02 },
  { maxInclusive: 4e4, percent: 0.03 },
  { maxInclusive: 5e4, percent: 0.04 },
  { maxInclusive: 6e4, percent: 0.05 },
  { maxInclusive: 7e4, percent: 0.06 },
  { maxInclusive: 8e4, percent: 0.07 },
  { maxInclusive: 9e4, percent: 0.08 },
  { maxInclusive: 1e5, percent: 0.09 },
  { maxInclusive: Number.POSITIVE_INFINITY, percent: 0.1 }
];
var ICR_FACTOR_EFFECTIVE_FROM = "2026-07-01";
var ICR_FACTOR_EFFECTIVE_THROUGH = "2027-06-30";
var ICR_INCOME_PERCENTAGE_FACTORS_2026 = {
  single: [
    { agi: 13717, factor: 0.55 },
    { agi: 18873, factor: 0.5779 },
    { agi: 24285, factor: 0.6057 },
    { agi: 29819, factor: 0.6623 },
    { agi: 35104, factor: 0.7189 },
    { agi: 41769, factor: 0.8033 },
    { agi: 52462, factor: 0.8877 },
    { agi: 65798, factor: 1 },
    { agi: 79138, factor: 1 },
    { agi: 95112, factor: 1.118 },
    { agi: 121787, factor: 1.235 },
    { agi: 172492, factor: 1.412 },
    { agi: 197779, factor: 1.5 },
    { agi: 352277, factor: 2 }
  ],
  married_or_head_of_household: [
    { agi: 13717, factor: 0.5052 },
    { agi: 21641, factor: 0.5668 },
    { agi: 25790, factor: 0.5956 },
    { agi: 33717, factor: 0.6779 },
    { agi: 41769, factor: 0.7522 },
    { agi: 52462, factor: 0.8761 },
    { agi: 65797, factor: 1 },
    { agi: 79138, factor: 1 },
    { agi: 99146, factor: 1.094 },
    { agi: 132481, factor: 1.25 },
    { agi: 179158, factor: 1.406 },
    { agi: 250560, factor: 1.5 },
    { agi: 409433, factor: 2 }
  ]
};

// src/formulas.ts
var roundMoney = /* @__PURE__ */ __name((value) => Math.round((value + Number.EPSILON) * 100) / 100, "roundMoney");
var roundFactor = /* @__PURE__ */ __name((value) => Math.round((value + Number.EPSILON) * 1e4) / 1e4, "roundFactor");
var assertFiniteNonNegative = /* @__PURE__ */ __name((value, label) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite number greater than or equal to 0.`);
  }
}, "assertFiniteNonNegative");
function normalizeIncomeToAnnual(input) {
  switch (input.cadence) {
    case "hourly": {
      const hourlyRate = input.hourlyRate ?? input.amount;
      if (hourlyRate === void 0) throw new Error("hourly income requires hourlyRate or amount.");
      const hoursPerWeek = input.hoursPerWeek ?? 40;
      const weeksPerYear = input.weeksPerYear ?? 52;
      assertFiniteNonNegative(hourlyRate, "hourlyRate");
      assertFiniteNonNegative(hoursPerWeek, "hoursPerWeek");
      assertFiniteNonNegative(weeksPerYear, "weeksPerYear");
      return hourlyRate * hoursPerWeek * weeksPerYear;
    }
    case "weekly":
      if (input.amount === void 0) throw new Error("weekly income requires amount.");
      assertFiniteNonNegative(input.amount, "amount");
      return input.amount * 52;
    case "biweekly":
      if (input.amount === void 0) throw new Error("biweekly income requires amount.");
      assertFiniteNonNegative(input.amount, "amount");
      return input.amount * 26;
    case "semimonthly":
      if (input.amount === void 0) throw new Error("semimonthly income requires amount.");
      assertFiniteNonNegative(input.amount, "amount");
      return input.amount * 24;
    case "monthly":
      if (input.amount === void 0) throw new Error("monthly income requires amount.");
      assertFiniteNonNegative(input.amount, "amount");
      return input.amount * 12;
    case "annual":
      if (input.amount === void 0) throw new Error("annual income requires amount.");
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
__name(normalizeIncomeToAnnual, "normalizeIncomeToAnnual");
function povertyGuideline(region, familySize) {
  if (!Number.isInteger(familySize) || familySize < 1) {
    throw new Error("familySize must be a positive integer.");
  }
  const table = POVERTY_GUIDELINES_2026[region];
  if (familySize <= 8) return table[familySize - 1];
  return table[7] + (familySize - 8) * POVERTY_ADDITIONAL_PERSON_2026[region];
}
__name(povertyGuideline, "povertyGuideline");
function amortizedMonthlyPayment(principal, annualInterestRatePercent, years) {
  assertFiniteNonNegative(principal, "principal");
  assertFiniteNonNegative(annualInterestRatePercent, "annualInterestRatePercent");
  const months = years * 12;
  if (principal === 0) return 0;
  if (annualInterestRatePercent === 0) return principal / months;
  const monthlyRate = annualInterestRatePercent / 100 / 12;
  return principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
}
__name(amortizedMonthlyPayment, "amortizedMonthlyPayment");
function icrIncomePercentageFactor(agi, category) {
  assertFiniteNonNegative(agi, "agi");
  const table = ICR_INCOME_PERCENTAGE_FACTORS_2026[category];
  const first = table[0];
  const last = table[table.length - 1];
  if (agi <= first.agi) return first.factor;
  if (agi >= last.agi) return last.factor;
  for (let index = 1; index < table.length; index += 1) {
    const upper = table[index];
    if (agi === upper.agi) return upper.factor;
    if (agi < upper.agi) {
      const lower = table[index - 1];
      const position = (agi - lower.agi) / (upper.agi - lower.agi);
      return roundFactor(lower.factor + position * (upper.factor - lower.factor));
    }
  }
  return last.factor;
}
__name(icrIncomePercentageFactor, "icrIncomePercentageFactor");
var DIRECT_STANDARD_TYPES = /* @__PURE__ */ new Set([
  "direct_subsidized",
  "direct_unsubsidized",
  "direct_grad_plus",
  "direct_consolidation_no_parent_plus"
]);
var FFEL_NON_PARENT_TYPES = /* @__PURE__ */ new Set([
  "ffel_subsidized_stafford",
  "ffel_unsubsidized_stafford",
  "ffel_grad_plus",
  "ffel_consolidation_no_parent_plus"
]);
function loanAssessment(plan, loan, loanIndex, request) {
  const result = /* @__PURE__ */ __name((status, ...reasons) => ({
    loanIndex,
    loanType: loan.loanType,
    disbursementPeriod: loan.disbursementPeriod,
    status,
    reasons
  }), "result");
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
__name(loanAssessment, "loanAssessment");
function evaluatePlanEligibility(plan, request) {
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
  let status;
  if (statuses.size === 1 && statuses.has("eligible")) status = "eligible";
  else if (statuses.size === 1 && statuses.has("ineligible")) status = "ineligible";
  else if (statuses.has("ineligible") && statuses.size > 1) status = "mixed";
  else status = "conditional";
  const reasons = status === "mixed" ? ["The supplied portfolio contains loans with different eligibility outcomes; mixed-date/type portfolios can require separate plan treatment."] : status === "conditional" ? ["At least one supplied loan requires an additional consolidation, borrower-date, or plan-specific condition before eligibility can be treated as resolved."] : [`All supplied eligibility loans evaluated as ${status} for ${plan} under this policy snapshot.`];
  return {
    status,
    loanAssessments,
    reasons,
    sourceUrls: [FEDERAL_STUDENT_AID_IDR_URL]
  };
}
__name(evaluatePlanEligibility, "evaluatePlanEligibility");
function standard10YearCap(request) {
  const principal = request.loan?.principal;
  const rate = request.loan?.annualInterestRatePercent;
  if (principal === void 0 || rate === void 0) return null;
  return amortizedMonthlyPayment(principal, rate, 10);
}
__name(standard10YearCap, "standard10YearCap");
function eligibilityNote(plan, request, eligibility) {
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
__name(eligibilityNote, "eligibilityNote");
function rapEstimate(agi, dependents, request) {
  const bracket = RAP_PERCENT_BY_AGI.find((candidate) => agi <= candidate.maxInclusive);
  const annualBase = bracket.percent === null ? 120 : agi * bracket.percent;
  const monthly = Math.max(10, annualBase / 12 - dependents * 50);
  const eligibility = evaluatePlanEligibility("RAP", request);
  return {
    plan: "RAP",
    monthlyPaymentEstimate: roundMoney(monthly),
    annualPaymentEstimate: roundMoney(monthly * 12),
    formulaSummary: bracket.percent === null ? "AGI \u2264 $10,000 uses a $120 annual base payment; after dependent reduction the statutory monthly floor is $10." : `${Math.round(bracket.percent * 100)}% of AGI \xF7 12, minus $50 per claimed dependent, with a $10 monthly floor.`,
    completeness: "estimate",
    eligibility,
    eligibilityNote: eligibilityNote("RAP", request, eligibility),
    warnings: ["RAP uses tax-return dependents, which is not necessarily identical to legacy IDR family size."]
  };
}
__name(rapEstimate, "rapEstimate");
function legacyDiscretionaryEstimate(plan, agi, poverty, request) {
  const discretionaryIncome = Math.max(0, agi - 1.5 * poverty);
  const rate = plan === "PAYE" ? 0.1 : request.loan?.newBorrowerOnOrAfterJuly1_2014 ? 0.1 : 0.15;
  const uncapped = discretionaryIncome * rate / 12;
  const cap = standard10YearCap(request);
  const monthly = cap === null ? uncapped : Math.min(uncapped, cap);
  const warnings = [];
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
__name(legacyDiscretionaryEstimate, "legacyDiscretionaryEstimate");
function categoryFromTaxFilingStatus(status) {
  if (status === void 0) return void 0;
  return status === "single" ? "single" : "married_or_head_of_household";
}
__name(categoryFromTaxFilingStatus, "categoryFromTaxFilingStatus");
function icrEstimate(agi, poverty, request) {
  const discretionaryIncome = Math.max(0, agi - poverty);
  const incomeArm = discretionaryIncome * 0.2 / 12;
  const principal = request.loan?.principal;
  const interestRate = request.loan?.annualInterestRatePercent;
  const suppliedFactor = request.loan?.icrIncomePercentageFactor;
  const factorCategory = request.loan?.icrIncomeFactorCategory ?? categoryFromTaxFilingStatus(request.taxFilingStatus);
  const warnings = [];
  let factor;
  let factorSource;
  let monthly = incomeArm;
  let completeness = "partial";
  if (suppliedFactor !== void 0) {
    if (!Number.isFinite(suppliedFactor) || suppliedFactor <= 0) throw new Error("icrIncomePercentageFactor must be greater than 0.");
    factor = suppliedFactor;
    factorSource = "caller_override";
  } else if (factorCategory !== void 0) {
    factor = icrIncomePercentageFactor(agi, factorCategory);
    factorSource = "2026_table";
  }
  if (principal !== void 0 && interestRate !== void 0 && factor !== void 0) {
    const twelveYearAdjusted = amortizedMonthlyPayment(principal, interestRate, 12) * factor;
    monthly = Math.min(incomeArm, twelveYearAdjusted);
    completeness = "estimate";
  } else {
    if (principal === void 0 || interestRate === void 0) warnings.push("ICR's 12-year adjusted arm requires loan principal and annual interest rate.");
    if (factor === void 0) warnings.push("ICR's 12-year adjusted arm requires taxFilingStatus or loan.icrIncomeFactorCategory so the built-in 2026 income-percentage factor table can be applied.");
  }
  const eligibility = evaluatePlanEligibility("ICR", request);
  const factorDescription = factorSource === "2026_table" ? "the built-in 2026 Federal Register income-percentage factor table (with linear interpolation)" : factorSource === "caller_override" ? "the caller-supplied income-percentage factor override" : "no income-percentage factor";
  return {
    plan: "ICR",
    monthlyPaymentEstimate: roundMoney(monthly),
    annualPaymentEstimate: roundMoney(monthly * 12),
    formulaSummary: completeness === "estimate" ? `Lesser of 20% of discretionary income (AGI above 100% of poverty guideline) \xF7 12 or a modeled 12-year fixed payment multiplied by ${factorDescription}.` : "20% discretionary-income arm only; the alternative 12-year adjusted arm is partial until principal, interest rate, and an ICR factor category (or explicit override) are available.",
    completeness,
    eligibility,
    eligibilityNote: eligibilityNote("ICR", request, eligibility),
    warnings
  };
}
__name(icrEstimate, "icrEstimate");
function getPolicyStatus() {
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
__name(getPolicyStatus, "getPolicyStatus");
function calculateRepayment(request) {
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
  if (agiOverride !== void 0) assertFiniteNonNegative(agiOverride, "adjustedGrossIncomeOverride");
  const agi = agiOverride ?? Math.max(0, annualGross - adjustments);
  const poverty = povertyGuideline(request.region, request.familySize);
  const plans = request.plans ?? ["RAP", "IBR", "PAYE", "ICR"];
  const planEstimates = plans.map((plan) => {
    switch (plan) {
      case "RAP":
        return rapEstimate(agi, dependents, request);
      case "IBR":
        return legacyDiscretionaryEstimate("IBR", agi, poverty, request);
      case "PAYE":
        return legacyDiscretionaryEstimate("PAYE", agi, poverty, request);
      case "ICR":
        return icrEstimate(agi, poverty, request);
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
      "Eligibility objects are deterministic screening results for the supplied loan-type/disbursement facts; official eligibility and billing remain with the U.S. Department of Education and the loan servicer."
    ],
    warnings: [
      "Do not use this tool to fabricate income, deductions, dependents, loan details, or supporting documentation.",
      "Federal repayment law changed materially on July 1, 2026; mixed loan types and disbursement dates can require separate plan treatment.",
      "SAVE is not included in this policy snapshot."
    ],
    sources: [...SOURCE_URLS]
  };
}
__name(calculateRepayment, "calculateRepayment");

// src/templates.ts
var money = /* @__PURE__ */ __name((value) => value === void 0 ? "[gross amount]" : `$${value.toFixed(2)}`, "money");
var field = /* @__PURE__ */ __name((value, fallback) => value?.trim() || fallback, "field");
var sourceType = /* @__PURE__ */ __name((value) => value?.split("_").join(" ") || "[income source type]", "sourceType");
var header = /* @__PURE__ */ __name((request, title) => `# ${title}

Date: ${field(request.documentDate, "[date]")}

Borrower: ${field(request.borrowerName, "[borrower full name]")}

Loan servicer: ${field(request.servicerName, "[loan servicer]")}
`, "header");
var certification = `
## Certification

I certify that the information in this statement is true and complete to the best of my knowledge. I understand that intentionally false statements may carry legal penalties.

Signature: ______________________________

Date: ______________________________
`;
var evidenceChecklist = `## Supporting evidence checklist

- [ ] Review the loan servicer's current instructions for the exact documentation it requests.
- [ ] Recent pay stub(s) or an employer statement, if applicable.
- [ ] Recent client, contract, or business payment records that show current taxable income, if applicable.
- [ ] Unemployment benefits statement or payment history, if applicable.
- [ ] Other current-income records requested by the servicer, if applicable.

These are common examples only. A servicer may request different or additional evidence, and no single item guarantees acceptance.
`;
function hasLegacyIncomeSourceData(request) {
  return [request.incomeSourceName, request.incomeSourceAddress, request.paymentFrequency].some((value) => Boolean(value?.trim())) || request.grossAmount !== void 0;
}
__name(hasLegacyIncomeSourceData, "hasLegacyIncomeSourceData");
function normalizedIncomeSources(request) {
  if (request.templateType === "no_current_taxable_income_statement") {
    if ((request.incomeSources?.length ?? 0) > 0 || hasLegacyIncomeSourceData(request)) {
      throw new Error("no_current_taxable_income_statement cannot include current income sources.");
    }
    return [];
  }
  if (request.incomeSources?.length) return request.incomeSources;
  const legacySource = {};
  if (request.templateType === "unemployment_income_statement") legacySource.sourceType = "unemployment";
  if (request.incomeSourceName !== void 0) legacySource.name = request.incomeSourceName;
  if (request.incomeSourceAddress !== void 0) legacySource.address = request.incomeSourceAddress;
  if (request.grossAmount !== void 0) legacySource.grossAmount = request.grossAmount;
  if (request.paymentFrequency !== void 0) legacySource.paymentFrequency = request.paymentFrequency;
  return [legacySource];
}
__name(normalizedIncomeSources, "normalizedIncomeSources");
function incomeSourcesMarkdown(request) {
  return normalizedIncomeSources(request).map((source, index, all) => {
    const heading = all.length === 1 ? "### Income source" : `### Income source ${index + 1}`;
    return `${heading}

- Type: ${sourceType(source.sourceType)}
- Name / payer: ${field(source.name, "[income source / employer / client]")}
- Address: ${field(source.address, "[income source address]")}
- Gross amount received: ${money(source.grossAmount)}
- Payment frequency: ${field(source.paymentFrequency, "[payment frequency]")}
- Source notes: ${field(source.notes, "[source notes]")}`;
  }).join("\n\n");
}
__name(incomeSourcesMarkdown, "incomeSourcesMarkdown");
function markdownDocument(request) {
  const notes = field(request.notes, "[optional explanation]");
  const sources = incomeSourcesMarkdown(request);
  switch (request.templateType) {
    case "current_income_statement":
      return `${header(request, "Current Taxable Income Supporting Statement")}
I am providing this signed statement to explain my current sources of taxable income for an income-driven repayment request.

${sources}

Additional explanation:
${notes}

${evidenceChecklist}${certification}`;
    case "income_change_explanation":
      return `${header(request, "Significant Income Change Explanation")}
My current taxable income is materially different from the income reflected on my most recent federal tax return or transcript.

${sources}

Explanation of the change:
${notes}

${evidenceChecklist}${certification}`;
    case "unemployment_income_statement":
      return `${header(request, "Unemployment Compensation Income Statement")}
I currently receive unemployment compensation, which I am reporting as current taxable income for repayment-plan documentation.

${sources}

Additional explanation:
${notes}

${evidenceChecklist}${certification}`;
    case "no_current_taxable_income_statement":
      return `${header(request, "No Current Taxable Income Statement")}
I currently receive no taxable income. This statement should not be used if I receive taxable unemployment compensation, employment income, tips, interest, dividends, alimony, or another taxable income source.

Explanation of current circumstances:
${notes}

${evidenceChecklist}${certification}`;
  }
}
__name(markdownDocument, "markdownDocument");
function markdownToPlainText(markdown) {
  return markdown.split("\n").map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^- \[ \] /, "[ ] ")).join("\n");
}
__name(markdownToPlainText, "markdownToPlainText");
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}
__name(escapeHtml, "escapeHtml");
function markdownToPrintableHtml(markdown) {
  const body = [];
  let listOpen = false;
  const closeList = /* @__PURE__ */ __name(() => {
    if (listOpen) {
      body.push("</ul>");
      listOpen = false;
    }
  }, "closeList");
  for (const line of markdown.split("\n")) {
    if (line.startsWith("- [ ] ") || line.startsWith("- ")) {
      if (!listOpen) {
        body.push("<ul>");
        listOpen = true;
      }
      const item = line.startsWith("- [ ] ") ? `[ ] ${line.slice(6)}` : line.slice(2);
      body.push(`<li>${escapeHtml(item)}</li>`);
      continue;
    }
    closeList();
    if (!line) continue;
    if (line.startsWith("### ")) body.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    else if (line.startsWith("## ")) body.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    else if (line.startsWith("# ")) body.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    else body.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Student Loan Repayment Supporting Statement</title>
<style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:760px;margin:0 auto;padding:32px;color:#111;line-height:1.5}h1,h2,h3{line-height:1.2}ul{padding-left:24px}@media print{body{max-width:none;margin:0;padding:0}a{color:inherit}}</style>
</head>
<body>
${body.join("\n")}
</body>
</html>`;
}
__name(markdownToPrintableHtml, "markdownToPrintableHtml");
function getDocumentationTemplate(request) {
  const markdown = markdownDocument(request);
  const outputFormat = request.outputFormat ?? "markdown";
  if (outputFormat === "text") return markdownToPlainText(markdown);
  if (outputFormat === "html") return markdownToPrintableHtml(markdown);
  return markdown;
}
__name(getDocumentationTemplate, "getDocumentationTemplate");

// src/index.ts
var SERVER_VERSION = "0.4.0";
var SUPPORTED_PROTOCOL_VERSION = "2025-03-26";
var MAX_REQUEST_BYTES = 64 * 1024;
var JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-allow-methods": "GET, POST, OPTIONS"
};
var RequestTooLargeError = class extends Error {
  static {
    __name(this, "RequestTooLargeError");
  }
};
var loanTypeEnum = [
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
];
var toolDefinitions = [
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
];
var hasOwn = /* @__PURE__ */ __name((value, key) => Object.prototype.hasOwnProperty.call(value, key), "hasOwn");
var isObject = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null && !Array.isArray(value), "isObject");
function allowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  const allowlist = (env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return allowlist.includes(origin);
}
__name(allowedOrigin, "allowedOrigin");
function responseHeaders(request, env) {
  const headers = new Headers(JSON_HEADERS);
  const origin = request.headers.get("origin");
  if (origin !== null && allowedOrigin(request, env)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return headers;
}
__name(responseHeaders, "responseHeaders");
function jsonRpcResultObject(id, result) {
  return { jsonrpc: "2.0", id, result };
}
__name(jsonRpcResultObject, "jsonRpcResultObject");
function jsonRpcErrorObject(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: { code, message, ...data === void 0 ? {} : { data } } };
}
__name(jsonRpcErrorObject, "jsonRpcErrorObject");
function jsonResponse(payload, status, request, env, extraHeaders) {
  const headers = responseHeaders(request, env);
  for (const [key, value] of Object.entries(extraHeaders ?? {})) headers.set(key, value);
  return new Response(JSON.stringify(payload), { status, headers });
}
__name(jsonResponse, "jsonResponse");
function contentResult(value) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}
__name(contentResult, "contentResult");
function validateSchema(value, schema, path = "arguments") {
  const issues = [];
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
    if (schema.minItems !== void 0 && value.length < schema.minItems) issues.push(`${path} must contain at least ${schema.minItems} item(s).`);
    if (schema.maxItems !== void 0 && value.length > schema.maxItems) issues.push(`${path} must contain at most ${schema.maxItems} item(s).`);
    if (schema.items) value.forEach((item, index) => issues.push(...validateSchema(item, schema.items, `${path}[${index}]`)));
    return issues;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") return [`${path} must be a string.`];
    if (schema.maxLength !== void 0 && value.length > schema.maxLength) issues.push(`${path} exceeds the maximum length of ${schema.maxLength}.`);
    return issues;
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return [`${path} must be a finite ${schema.type}.`];
    if (schema.type === "integer" && !Number.isInteger(value)) issues.push(`${path} must be an integer.`);
    if (schema.minimum !== void 0 && value < schema.minimum) issues.push(`${path} must be greater than or equal to ${schema.minimum}.`);
    if (schema.exclusiveMinimum !== void 0 && value <= schema.exclusiveMinimum) issues.push(`${path} must be greater than ${schema.exclusiveMinimum}.`);
    return issues;
  }
  if (schema.type === "boolean" && typeof value !== "boolean") issues.push(`${path} must be a boolean.`);
  return issues;
}
__name(validateSchema, "validateSchema");
function validateInitializeParams(value) {
  if (!isObject(value)) return ["params must be an object."];
  const issues = [];
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
__name(validateInitializeParams, "validateInitializeParams");
function isJsonRpcResponse(value) {
  if (!isObject(value) || value.jsonrpc !== "2.0") return false;
  const id = value.id;
  if (typeof id !== "string" && typeof id !== "number") return false;
  return hasOwn(value, "result") !== hasOwn(value, "error") && !hasOwn(value, "method");
}
__name(isJsonRpcResponse, "isJsonRpcResponse");
async function handleJsonRpcMessage(value, batched) {
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
    const requestedVersion = value.params.protocolVersion;
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
    const issues = validateSchema(toolArguments, definition.inputSchema);
    if (issues.length > 0) return jsonRpcErrorObject(id, -32602, "Invalid tool arguments", { issues });
    try {
      if (params.name === "calculate_alt_income_student_loan") {
        return jsonRpcResultObject(id, contentResult(calculateRepayment(toolArguments)));
      }
      if (params.name === "get_repayment_documentation_template") {
        return jsonRpcResultObject(id, contentResult(getDocumentationTemplate(toolArguments)));
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
__name(handleJsonRpcMessage, "handleJsonRpcMessage");
async function readRequestText(request) {
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
__name(readRequestText, "readRequestText");
function requestMetadata(value) {
  if (Array.isArray(value)) return { method: "batch" };
  if (!isObject(value) || typeof value.method !== "string") return { method: "invalid" };
  if (value.method === "tools/call" && isObject(value.params) && typeof value.params.name === "string") {
    return { method: value.method, tool: value.params.name };
  }
  return { method: value.method };
}
__name(requestMetadata, "requestMetadata");
function logRequest(event) {
  console.log(JSON.stringify({
    service: "student-loan-idr-mcp",
    version: SERVER_VERSION,
    event: "mcp_request",
    method: event.method,
    ...event.tool === void 0 ? {} : { tool: event.tool },
    http_status: event.httpStatus,
    request_bytes: event.requestBytes,
    duration_ms: event.durationMs
  }));
}
__name(logRequest, "logRequest");
async function handleMcp(request, env) {
  const startedAt = Date.now();
  let requestBytes = 0;
  let metadata = { method: "unparsed" };
  const finish = /* @__PURE__ */ __name((response2) => {
    logRequest({ ...metadata, httpStatus: response2.status, requestBytes, durationMs: Date.now() - startedAt });
    return response2;
  }, "finish");
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
      if (!success) return finish(jsonResponse(jsonRpcErrorObject(null, -32e3, "Rate limit exceeded"), 429, request, env));
    } catch {
      return finish(jsonResponse(jsonRpcErrorObject(null, -32603, "Rate limiter unavailable"), 503, request, env));
    }
  }
  let text;
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
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return finish(jsonResponse(jsonRpcErrorObject(null, -32700, "Parse error"), 200, request, env));
  }
  metadata = requestMetadata(body);
  if (Array.isArray(body)) {
    if (body.length === 0) return finish(jsonResponse(jsonRpcErrorObject(null, -32600, "Invalid Request"), 200, request, env));
    const responses = [];
    for (const item of body) {
      const response2 = await handleJsonRpcMessage(item, true);
      if (response2) responses.push(response2);
    }
    if (responses.length === 0) return finish(new Response(null, { status: 202, headers: responseHeaders(request, env) }));
    return finish(jsonResponse(responses, 200, request, env));
  }
  const response = await handleJsonRpcMessage(body, false);
  if (!response) return finish(new Response(null, { status: 202, headers: responseHeaders(request, env) }));
  return finish(jsonResponse(response, 200, request, env));
}
__name(handleMcp, "handleMcp");
function home(request, env) {
  return jsonResponse({
    ok: true,
    name: "student-loan-idr-mcp",
    version: SERVER_VERSION,
    protocol_version: SUPPORTED_PROTOCOL_VERSION,
    policy_snapshot: "2026-08-27",
    tools: toolDefinitions.map((tool) => tool.name),
    endpoints: ["GET /", "GET /health", "POST /mcp"],
    hardening: {
      max_request_bytes: MAX_REQUEST_BYTES,
      bearer_auth_configured: Boolean(env.MCP_BEARER_TOKEN),
      origin_allowlist_configured: Boolean(env.MCP_ALLOWED_ORIGINS),
      rate_limit_configured: Boolean(env.MCP_RATE_LIMITER),
      sensitive_payload_logging: false
    }
  }, 200, request, env);
}
__name(home, "home");
var index_default = {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname === "/mcp") {
      if (!allowedOrigin(request, env)) return jsonResponse(jsonRpcErrorObject(null, -32600, "Forbidden Origin"), 403, request, env);
      return new Response(null, { status: 204, headers: responseHeaders(request, env) });
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) return home(request, env);
    if (url.pathname === "/mcp" && request.method === "GET") {
      if (!allowedOrigin(request, env)) return jsonResponse(jsonRpcErrorObject(null, -32600, "Forbidden Origin"), 403, request, env);
      return new Response("SSE listening is not implemented by this stateless server.", { status: 405, headers: { allow: "POST, OPTIONS" } });
    }
    if (request.method === "POST" && url.pathname === "/mcp") return handleMcp(request, env);
    return new Response("Not Found", { status: 404 });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
