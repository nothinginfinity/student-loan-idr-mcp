import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateRepayment,
  evaluatePlanEligibility,
  getPolicyStatus,
  icrIncomePercentageFactor,
  normalizeIncomeToAnnual,
  povertyGuideline
} from "../src/formulas.ts";
import { getDocumentationTemplate } from "../src/templates.ts";
import type { CalculatorRequest, EligibilityStatus, LoanType, RepaymentPlan } from "../src/types.ts";

test("annualizes hourly income", () => {
  assert.equal(normalizeIncomeToAnnual({ cadence: "hourly", hourlyRate: 25, hoursPerWeek: 30, weeksPerYear: 50 }), 37500);
});

test("sums seasonal lump payments", () => {
  assert.equal(normalizeIncomeToAnnual({ cadence: "seasonal_lump_sum", seasonalPayments: [5000, 7500, 2500] }), 15000);
});

test("uses current contiguous-US poverty values and >8 increment", () => {
  assert.equal(povertyGuideline("contiguous_us", 1), 15960);
  assert.equal(povertyGuideline("contiguous_us", 9), 61400);
});

test("computes RAP with dependent reduction and floor", () => {
  const result = calculateRepayment({
    income: [{ cadence: "annual", amount: 50000 }],
    region: "contiguous_us",
    familySize: 2,
    dependentsClaimedOnFederalTaxReturn: 1,
    plans: ["RAP"]
  });
  assert.equal(result.planEstimates[0]?.monthlyPaymentEstimate, 116.67);
});

test("computes PAYE from estimated AGI and poverty guideline", () => {
  const result = calculateRepayment({
    income: [{ cadence: "annual", amount: 60000 }],
    adjustedGrossIncomeOverride: 50000,
    region: "contiguous_us",
    familySize: 1,
    plans: ["PAYE"]
  });
  assert.equal(result.planEstimates[0]?.monthlyPaymentEstimate, 217.17);
});

test("uses exact 2026 ICR income-percentage factors", () => {
  assert.equal(icrIncomePercentageFactor(35104, "single"), 0.7189);
  assert.equal(icrIncomePercentageFactor(99146, "married_or_head_of_household"), 1.094);
});

test("linearly interpolates the 2026 ICR factor table", () => {
  assert.equal(icrIncomePercentageFactor(50000, "single"), 0.8683);
});

test("matches the 2026 Federal Register ICR Kesha example", () => {
  const result = calculateRepayment({
    income: [{ cadence: "annual", amount: 35104 }],
    adjustedGrossIncomeOverride: 35104,
    taxFilingStatus: "single",
    region: "contiguous_us",
    familySize: 1,
    loan: {
      principal: 15000,
      annualInterestRatePercent: 6,
      eligibilityLoans: [{ loanType: "direct_unsubsidized", disbursementPeriod: "before_2026_07_01" }]
    },
    plans: ["ICR"]
  });
  assert.equal(result.planEstimates[0]?.monthlyPaymentEstimate, 105.23);
  assert.equal(result.planEstimates[0]?.completeness, "estimate");
});

test("matches the 2026 Federal Register ICR Santiago example", () => {
  const result = calculateRepayment({
    income: [{ cadence: "annual", amount: 41769 }],
    adjustedGrossIncomeOverride: 41769,
    taxFilingStatus: "single",
    region: "contiguous_us",
    familySize: 1,
    loan: {
      principal: 60000,
      annualInterestRatePercent: 6,
      eligibilityLoans: [{ loanType: "direct_unsubsidized", disbursementPeriod: "before_2026_07_01" }]
    },
    plans: ["ICR"]
  });
  assert.equal(result.planEstimates[0]?.monthlyPaymentEstimate, 430.15);
});

const baseEligibilityRequest = (overrides: CalculatorRequest["loan"]): CalculatorRequest => ({
  income: [{ cadence: "annual", amount: 50000 }],
  region: "contiguous_us",
  familySize: 1,
  loan: overrides
});

test("explicit eligibility objects distinguish new Direct loans from legacy plans", () => {
  const request = baseEligibilityRequest({
    eligibilityLoans: [{ loanType: "direct_subsidized", disbursementPeriod: "on_or_after_2026_07_01" }]
  });
  assert.equal(evaluatePlanEligibility("RAP", request).status, "eligible");
  assert.equal(evaluatePlanEligibility("IBR", request).status, "ineligible");
  assert.equal(evaluatePlanEligibility("PAYE", request).status, "ineligible");
  assert.equal(evaluatePlanEligibility("ICR", request).status, "ineligible");
});

test("explicit eligibility objects reject Parent PLUS debt from RAP", () => {
  const request = baseEligibilityRequest({
    eligibilityLoans: [{ loanType: "direct_parent_plus", disbursementPeriod: "before_2026_07_01" }]
  });
  for (const plan of ["RAP", "IBR", "PAYE", "ICR"] satisfies RepaymentPlan[]) {
    assert.equal(evaluatePlanEligibility(plan, request).status, "ineligible");
  }
});

test("pre-2026 FFEL non-parent loan is IBR eligible but needs consolidation for RAP/ICR", () => {
  const request = baseEligibilityRequest({
    eligibilityLoans: [{ loanType: "ffel_subsidized_stafford", disbursementPeriod: "before_2026_07_01" }]
  });
  assert.equal(evaluatePlanEligibility("IBR", request).status, "eligible");
  assert.equal(evaluatePlanEligibility("RAP", request).status, "conditional");
  assert.equal(evaluatePlanEligibility("ICR", request).status, "conditional");
  assert.equal(evaluatePlanEligibility("PAYE", request).status, "ineligible");
});

test("parent-PLUS-related Direct Consolidation exposes the IBR ICR-payment condition", () => {
  const conditional = baseEligibilityRequest({
    eligibilityLoans: [{ loanType: "direct_consolidation_with_parent_plus", disbursementPeriod: "before_2026_07_01" }]
  });
  assert.equal(evaluatePlanEligibility("IBR", conditional).status, "conditional");

  const satisfied = baseEligibilityRequest({
    eligibilityLoans: [{
      loanType: "direct_consolidation_with_parent_plus",
      disbursementPeriod: "before_2026_07_01",
      madeIcrPaymentBeforeJuly1_2028: true
    }]
  });
  assert.equal(evaluatePlanEligibility("IBR", satisfied).status, "eligible");
  assert.equal(evaluatePlanEligibility("ICR", satisfied).status, "eligible");
  assert.equal(evaluatePlanEligibility("RAP", satisfied).status, "ineligible");
  assert.equal(evaluatePlanEligibility("PAYE", satisfied).status, "ineligible");
});

test("defaulted loans are ineligible across the modeled IDR plans", () => {
  const request = baseEligibilityRequest({
    eligibilityLoans: [{ loanType: "direct_unsubsidized", disbursementPeriod: "before_2026_07_01", inDefault: true }]
  });
  for (const plan of ["RAP", "IBR", "PAYE", "ICR"] satisfies RepaymentPlan[]) {
    assert.equal(evaluatePlanEligibility(plan, request).status, "ineligible");
  }
});

test("PAYE borrower-date conditions are explicit", () => {
  const missing = baseEligibilityRequest({
    eligibilityLoans: [{ loanType: "direct_unsubsidized", disbursementPeriod: "before_2026_07_01" }]
  });
  assert.equal(evaluatePlanEligibility("PAYE", missing).status, "conditional");

  const satisfied = baseEligibilityRequest({
    payeNewBorrowerOnOrAfterOct1_2007: true,
    payeDirectLoanDisbursementOnOrAfterOct1_2011: true,
    eligibilityLoans: [{ loanType: "direct_unsubsidized", disbursementPeriod: "before_2026_07_01" }]
  });
  assert.equal(evaluatePlanEligibility("PAYE", satisfied).status, "eligible");
});

test("mixed portfolios surface mixed plan eligibility", () => {
  const request = baseEligibilityRequest({
    eligibilityLoans: [
      { loanType: "direct_subsidized", disbursementPeriod: "before_2026_07_01" },
      { loanType: "direct_parent_plus", disbursementPeriod: "before_2026_07_01" }
    ]
  });
  assert.equal(evaluatePlanEligibility("RAP", request).status, "mixed");
});

test("policy status exposes snapshot, ICR factor effective period, sunset dates, and source links", () => {
  const status = getPolicyStatus();
  assert.equal(status.policySnapshot, "2026-08-27");
  assert.equal(status.icrFactorTable.effectiveFrom, "2026-07-01");
  assert.equal(status.icrFactorTable.effectiveThrough, "2027-06-30");
  assert.equal(status.supportedPlans.find((plan) => plan.plan === "PAYE")?.sunsetDate, "2028-07-01");
  assert.equal(status.supportedPlans.find((plan) => plan.plan === "ICR")?.sunsetDate, "2028-07-01");
  assert.ok(status.sources.some((url) => url.includes("2026-11540")));
});

test("covers the current Federal Student Aid pre-July-2026 loan eligibility matrix", () => {
  const fixtures: Array<{
    loanType: LoanType;
    expected: Record<RepaymentPlan, EligibilityStatus>;
  }> = [
    { loanType: "direct_subsidized", expected: { IBR: "eligible", ICR: "eligible", PAYE: "conditional", RAP: "eligible" } },
    { loanType: "direct_unsubsidized", expected: { IBR: "eligible", ICR: "eligible", PAYE: "conditional", RAP: "eligible" } },
    { loanType: "direct_grad_plus", expected: { IBR: "eligible", ICR: "eligible", PAYE: "conditional", RAP: "eligible" } },
    { loanType: "direct_parent_plus", expected: { IBR: "ineligible", ICR: "ineligible", PAYE: "ineligible", RAP: "ineligible" } },
    { loanType: "direct_consolidation_no_parent_plus", expected: { IBR: "eligible", ICR: "eligible", PAYE: "conditional", RAP: "eligible" } },
    { loanType: "direct_consolidation_with_parent_plus", expected: { IBR: "conditional", ICR: "eligible", PAYE: "ineligible", RAP: "ineligible" } },
    { loanType: "ffel_subsidized_stafford", expected: { IBR: "eligible", ICR: "conditional", PAYE: "ineligible", RAP: "conditional" } },
    { loanType: "ffel_unsubsidized_stafford", expected: { IBR: "eligible", ICR: "conditional", PAYE: "ineligible", RAP: "conditional" } },
    { loanType: "ffel_grad_plus", expected: { IBR: "eligible", ICR: "conditional", PAYE: "ineligible", RAP: "conditional" } },
    { loanType: "ffel_parent_plus", expected: { IBR: "ineligible", ICR: "ineligible", PAYE: "ineligible", RAP: "ineligible" } },
    { loanType: "ffel_consolidation_no_parent_plus", expected: { IBR: "eligible", ICR: "conditional", PAYE: "ineligible", RAP: "conditional" } },
    { loanType: "ffel_consolidation_with_parent_plus", expected: { IBR: "ineligible", ICR: "ineligible", PAYE: "ineligible", RAP: "ineligible" } },
    { loanType: "perkins", expected: { IBR: "ineligible", ICR: "conditional", PAYE: "ineligible", RAP: "conditional" } }
  ];

  for (const fixture of fixtures) {
    const request = baseEligibilityRequest({
      eligibilityLoans: [{ loanType: fixture.loanType, disbursementPeriod: "before_2026_07_01" }]
    });
    for (const plan of ["IBR", "ICR", "PAYE", "RAP"] satisfies RepaymentPlan[]) {
      assert.equal(evaluatePlanEligibility(plan, request).status, fixture.expected[plan], `${fixture.loanType} ${plan}`);
    }
  }
});

test("post-July-2026 Direct student loans route to RAP instead of legacy IDR plans", () => {
  for (const loanType of ["direct_subsidized", "direct_unsubsidized", "direct_grad_plus", "direct_consolidation_no_parent_plus"] satisfies LoanType[]) {
    const request = baseEligibilityRequest({
      eligibilityLoans: [{ loanType, disbursementPeriod: "on_or_after_2026_07_01" }]
    });
    assert.equal(evaluatePlanEligibility("RAP", request).status, "eligible", `${loanType} RAP`);
    for (const plan of ["IBR", "ICR", "PAYE"] satisfies RepaymentPlan[]) {
      assert.equal(evaluatePlanEligibility(plan, request).status, "ineligible", `${loanType} ${plan}`);
    }
  }
});

test("IBR fixtures cover both statutory percentage branches", () => {
  const legacy = calculateRepayment({
    income: [{ cadence: "annual", amount: 50000 }],
    adjustedGrossIncomeOverride: 50000,
    region: "contiguous_us",
    familySize: 1,
    loan: { newBorrowerOnOrAfterJuly1_2014: false },
    plans: ["IBR"]
  });
  const newer = calculateRepayment({
    income: [{ cadence: "annual", amount: 50000 }],
    adjustedGrossIncomeOverride: 50000,
    region: "contiguous_us",
    familySize: 1,
    loan: { newBorrowerOnOrAfterJuly1_2014: true },
    plans: ["IBR"]
  });
  assert.equal(legacy.planEstimates[0]?.monthlyPaymentEstimate, 325.75);
  assert.equal(newer.planEstimates[0]?.monthlyPaymentEstimate, 217.17);
});

test("PAYE rejects initial enrollment when modeled PAYE amount is not below 10-year Standard", () => {
  const result = calculateRepayment({
    income: [{ cadence: "annual", amount: 100000 }],
    adjustedGrossIncomeOverride: 100000,
    region: "contiguous_us",
    familySize: 1,
    loan: {
      principal: 5000,
      annualInterestRatePercent: 5,
      payeNewBorrowerOnOrAfterOct1_2007: true,
      payeDirectLoanDisbursementOnOrAfterOct1_2011: true,
      eligibilityLoans: [{ loanType: "direct_unsubsidized", disbursementPeriod: "before_2026_07_01" }]
    },
    plans: ["PAYE"]
  });
  assert.equal(result.planEstimates[0]?.monthlyPaymentEstimate, 53.03);
  assert.equal(result.planEstimates[0]?.eligibility.status, "ineligible");
});

test("documentation workflow renders multiple structured income sources without inventing missing facts", () => {
  const document = getDocumentationTemplate({
    templateType: "current_income_statement",
    borrowerName: "Alex Example",
    incomeSources: [
      {
        sourceType: "employment",
        name: "Northwind Services",
        address: "100 Main Street",
        grossAmount: 1200,
        paymentFrequency: "biweekly"
      },
      {
        sourceType: "contract",
        name: "Side Client"
      }
    ]
  });

  assert.match(document, /Income source 1/);
  assert.match(document, /Northwind Services/);
  assert.match(document, /Income source 2/);
  assert.match(document, /Side Client/);
  assert.match(document, /\[income source address\]/);
  assert.match(document, /\[gross amount\]/);
  assert.match(document, /no single item guarantees acceptance/i);
});

test("documentation workflow renders plain text while preserving the evidence checklist", () => {
  const document = getDocumentationTemplate({
    templateType: "income_change_explanation",
    outputFormat: "text",
    incomeSources: [{ name: "Example Employer" }]
  });

  assert.doesNotMatch(document, /^# /m);
  assert.match(document, /Supporting evidence checklist/);
  assert.match(document, /\[ \] Review the loan servicer's current instructions/);
});

test("printable HTML escapes caller-supplied markup and makes no external requests", () => {
  const document = getDocumentationTemplate({
    templateType: "current_income_statement",
    outputFormat: "html",
    borrowerName: "<script>alert('x')</script>",
    incomeSources: [{ name: "<img src=https://example.com/x>" }]
  });

  assert.match(document, /^<!doctype html>/);
  assert.match(document, /default-src 'none'/);
  assert.match(document, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.match(document, /&lt;img src=https:\/\/example.com\/x&gt;/);
  assert.doesNotMatch(document, /<script>/);
  assert.doesNotMatch(document, /<img src=/);
});

test("minimal documentation requests expose placeholders for every unsupplied fact", () => {
  const document = getDocumentationTemplate({ templateType: "current_income_statement" });
  for (const placeholder of [
    "[date]",
    "[borrower full name]",
    "[loan servicer]",
    "[income source type]",
    "[income source / employer / client]",
    "[income source address]",
    "[gross amount]",
    "[payment frequency]",
    "[source notes]",
    "[optional explanation]"
  ]) {
    assert.match(document, new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("legacy single-source documentation fields remain supported and no-income statements reject contradictory sources", () => {
  const legacy = getDocumentationTemplate({
    templateType: "current_income_statement",
    incomeSourceName: "Legacy Employer",
    incomeSourceAddress: "10 Legacy Road",
    paymentFrequency: "monthly",
    grossAmount: 900
  });
  assert.match(legacy, /Legacy Employer/);
  assert.match(legacy, /\$900\.00/);

  assert.throws(
    () => getDocumentationTemplate({
      templateType: "no_current_taxable_income_statement",
      incomeSources: [{ name: "Contradictory Employer" }]
    }),
    /cannot include current income sources/
  );
});
