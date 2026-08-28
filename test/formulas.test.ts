import test from "node:test";
import assert from "node:assert/strict";
import {
  amortizedMonthlyPayment,
  calculateRepayment,
  evaluatePlanEligibility,
  getPolicyStatus,
  ibrZeroPaymentAgiThreshold,
  icrIncomePercentageFactor,
  normalizeIncomeToAnnual,
  povertyGuideline
} from "../src/formulas.ts";
import { getDocumentationTemplate } from "../src/templates.ts";
import worker, { advisorCanAccessClient, assertAdvisorClientAccess, clientDashboardSummary } from "../src/index.ts";
import type { AdvisorClientRecordV1, AdvisorPrincipal, CalculatorRequest, EligibilityStatus, LoanType, RepaymentPlan } from "../src/types.ts";

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

test("IBR zero-payment AGI thresholds equal 150% of the 2026 poverty guideline", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((familySize) => ibrZeroPaymentAgiThreshold("contiguous_us", familySize)),
    [23940, 32460, 40980, 49500, 58020, 66540]
  );
  assert.equal(ibrZeroPaymentAgiThreshold("alaska", 6), 83175);
  assert.equal(ibrZeroPaymentAgiThreshold("hawaii", 6), 76515);
});

test("IBR estimates $0 at the threshold and positive payment immediately above it", () => {
  const atThreshold = calculateRepayment({
    income: [{ cadence: "annual", amount: 66540 }],
    adjustedGrossIncomeOverride: 66540,
    region: "contiguous_us",
    familySize: 6,
    plans: ["IBR"]
  });
  const aboveThreshold = calculateRepayment({
    income: [{ cadence: "annual", amount: 66541 }],
    adjustedGrossIncomeOverride: 66541,
    region: "contiguous_us",
    familySize: 6,
    loan: { newBorrowerOnOrAfterJuly1_2014: true },
    plans: ["IBR"]
  });
  assert.equal(atThreshold.planEstimates[0]?.monthlyPaymentEstimate, 0);
  assert.equal(aboveThreshold.planEstimates[0]?.monthlyPaymentEstimate, 0.01);
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

test("multi-loan portfolio models the sum of per-loan Standard payments", () => {
  const result = calculateRepayment({
    income: [{ cadence: "annual", amount: 250000 }],
    adjustedGrossIncomeOverride: 250000,
    region: "contiguous_us",
    familySize: 1,
    loan: {
      newBorrowerOnOrAfterJuly1_2014: false,
      repaymentLoans: [
        { principal: 10000, annualInterestRatePercent: 5 },
        { principal: 20000, annualInterestRatePercent: 7 }
      ]
    },
    plans: ["IBR"]
  });
  const expected = amortizedMonthlyPayment(10000, 5, 10) + amortizedMonthlyPayment(20000, 7, 10);
  assert.equal(result.planEstimates[0]?.monthlyPaymentEstimate, Math.round((expected + Number.EPSILON) * 100) / 100);
  assert.match(result.assumptions.join("\n"), /sum of per-loan amortized payments/i);
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

test("V0.8 advisor/client authority is exact-owner scoped and dashboard summaries do not leak client detail", () => {
  const client = {
    schemaVersion: 1,
    clientId: "client-001",
    ownerAdvisorId: "advisor-alpha",
    createdAt: "2026-08-28T00:00:00Z",
    updatedAt: "2026-08-28T01:00:00Z",
    lifecycleState: "active",
    readinessState: "needs_evidence",
    contact: {
      displayName: "Example Borrower",
      email: "borrower-private@example.test",
      phone: "555-0100"
    },
    normalizedLoanPortfolio: {
      repaymentLoans: [{ principal: 25000, annualInterestRatePercent: 6.5 }]
    },
    confirmedFacts: {
      income: [{ cadence: "annual", amount: 50000 }],
      region: "contiguous_us",
      familySize: 2
    },
    retainedDraftIds: ["draft-private-001"],
    notes: "PRIVATE-CLIENT-NOTE",
    studentAidImport: {
      source: "studentaid_download",
      importedAt: "2026-08-28T00:30:00Z",
      rawFileRetained: false
    }
  } satisfies AdvisorClientRecordV1;
  const owner = { advisorId: "advisor-alpha", status: "active" } satisfies AdvisorPrincipal;
  const otherAdvisor = { advisorId: "advisor-beta", status: "active" } satisfies AdvisorPrincipal;
  const suspendedOwner = { advisorId: "advisor-alpha", status: "suspended" } satisfies AdvisorPrincipal;

  assert.equal(advisorCanAccessClient(owner, client), true);
  assert.equal(advisorCanAccessClient(otherAdvisor, client), false);
  assert.equal(advisorCanAccessClient(suspendedOwner, client), false);
  assert.throws(() => assertAdvisorClientAccess(otherAdvisor, client), /Client not found or not accessible/);
  assert.throws(() => assertAdvisorClientAccess(suspendedOwner, client), /Client not found or not accessible/);

  const summary = clientDashboardSummary(owner, client);
  assert.deepEqual(summary, {
    clientId: "client-001",
    displayName: "Example Borrower",
    lifecycleState: "active",
    readinessState: "needs_evidence",
    updatedAt: "2026-08-28T01:00:00Z"
  });
  const serializedSummary = JSON.stringify(summary);
  assert.doesNotMatch(serializedSummary, /borrower-private/);
  assert.doesNotMatch(serializedSummary, /555-0100/);
  assert.doesNotMatch(serializedSummary, /PRIVATE-CLIENT-NOTE/);
  assert.doesNotMatch(serializedSummary, /draft-private-001/);
  assert.equal(client.studentAidImport.rawFileRetained, false);
});

test("borrower UI serves a privacy-safe same-origin calculator shell", async () => {
  const response = await worker.fetch(new Request("https://student-loan-idr-mcp.example/"), {});
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.match(response.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.match(html, /id="calculator-form"/);
  assert.match(html, /id="guided-assistant"/);
  assert.match(html, /id="guide-answers"/);
  assert.match(html, /id="guide-input"/);
  assert.match(html, /Could my IBR payment be \$0\?/);
  assert.match(html, /Prepare stated income document/);
  assert.match(html, /Prepare unemployment statement/);
  assert.match(html, /id="document-workspace"/);
  assert.match(html, /id="income-readiness-panel"/);
  assert.match(html, /id="readiness-summary"/);
  assert.match(html, /id="income-source-readiness"/);
  assert.match(html, /id="document-scope"/);
  assert.match(html, /Source-by-source income readiness/);
  assert.match(html, /Application-ready/);
  assert.match(html, /Document-ready/);
  assert.match(html, /Evidence in hand \(borrower-stated\)/);
  assert.match(html, /Combined confirmed income sources/);
  assert.match(html, /guidedCalculatorIncome/);
  assert.match(html, /id="document-reviewed"/);
  assert.match(html, /Print \/ Save PDF/);
  assert.match(html, /Download HTML/);
  assert.match(html, /must sign it myself/i);
  assert.match(html, /\/api\/document/);
  assert.match(html, /\/api\/ibr-zero-payment/);
  assert.match(html, /Facts collected in this session/);
  assert.match(html, /No account is required/);
  assert.match(html, /guidedFacts/);
  assert.match(html, /id="loan-file"/);
  assert.match(html, /Download My Aid Data/);
  assert.match(html, /raw file is never uploaded/i);
  assert.match(html, /no six-person cap/i);
  assert.match(html, /90 days/i);
  assert.match(html, /Stated fact/);
  assert.match(html, /Documented fact/);
  assert.match(html, /Imported fact/);
  assert.match(html, /Derived estimate/);
  assert.match(html, /\/api\/calculate/);
  assert.doesNotMatch(html, /\/api\/import/);
  assert.match(html, /no analytics, no external assets, and no browser storage/i);
  assert.doesNotMatch(html, /<(?:img|script|link)[^>]+(?:src|href)="https?:\/\//i);
});

test("IBR zero-payment quick-info API returns deterministic 2026 family-size cutoffs", async () => {
  const response = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/ibr-zero-payment?region=contiguous_us"), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.plan, "IBR");
  assert.equal(body.policySnapshot, "2026-08-27");
  assert.deepEqual(body.thresholds.map((row: { maxAgiForZeroPayment: number }) => row.maxAgiForZeroPayment), [23940, 32460, 40980, 49500, 58020, 66540]);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const hawaii = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/ibr-zero-payment?region=hawaii"), {});
  assert.equal((await hawaii.json()).thresholds[5].maxAgiForZeroPayment, 76515);

  const invalid = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/ibr-zero-payment?region=invalid"), {});
  assert.equal(invalid.status, 400);
});

test("borrower document API reuses the truthful template engine for reviewable text and HTML drafts", async () => {
  const requestBody = {
    templateType: "current_income_statement",
    outputFormat: "text",
    borrowerName: "Browser Draft Borrower",
    servicerName: "Example Servicer",
    incomeSources: [
      {
        sourceType: "employment",
        name: "Example Employer",
        grossAmount: 1200,
        paymentFrequency: "biweekly"
      },
      {
        sourceType: "contract",
        name: "Example Side Client",
        grossAmount: 300,
        paymentFrequency: "monthly"
      }
    ]
  };
  const response = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/document", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody)
  }), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.format, "text");
  assert.match(body.document, /Browser Draft Borrower/);
  assert.match(body.document, /Example Employer/);
  assert.match(body.document, /Example Side Client/);
  assert.match(body.document, /Income source 2/);
  assert.match(body.document, /\$1200\.00/);
  assert.match(body.document, /Supporting evidence checklist/);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const htmlResponse = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/document", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...requestBody, outputFormat: "html", borrowerName: "<script>unsafe</script>" })
  }), {});
  const htmlBody = await htmlResponse.json();
  assert.equal(htmlResponse.status, 200);
  assert.match(htmlBody.document, /^<!doctype html>/);
  assert.match(htmlBody.document, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(htmlBody.document, /<script>unsafe<\/script>/);
});

test("borrower document API is same-origin, schema-validated, and bounded", async () => {
  const forbidden = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/document", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: "{}"
  }), {});
  assert.equal(forbidden.status, 403);

  const invalid = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/document", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateType: "current_income_statement", privateUnexpectedField: "VERY-SENSITIVE-DOCUMENT-VALUE" })
  }), {});
  const invalidText = await invalid.text();
  assert.equal(invalid.status, 400);
  assert.match(invalidText, /privateUnexpectedField/);
  assert.doesNotMatch(invalidText, /VERY-SENSITIVE-DOCUMENT-VALUE/);

  const oversized = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/document", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x".repeat(70 * 1024)
  }), {});
  assert.equal(oversized.status, 413);
});

test("borrower calculator API uses the deterministic RAP engine", async () => {
  const response = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/calculate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      income: [{ cadence: "annual", amount: 50000 }],
      region: "contiguous_us",
      familySize: 2,
      dependentsClaimedOnFederalTaxReturn: 1,
      plans: ["RAP"]
    })
  }), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.result.planEstimates[0].monthlyPaymentEstimate, 116.67);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("borrower calculator API accepts a per-loan repayment portfolio", async () => {
  const response = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/calculate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      income: [{ cadence: "annual", amount: 250000 }],
      adjustedGrossIncomeOverride: 250000,
      region: "contiguous_us",
      familySize: 1,
      loan: {
        newBorrowerOnOrAfterJuly1_2014: false,
        repaymentLoans: [
          { principal: 10000, annualInterestRatePercent: 5 },
          { principal: 20000, annualInterestRatePercent: 7 }
        ]
      },
      plans: ["IBR"]
    })
  }), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  const expected = amortizedMonthlyPayment(10000, 5, 10) + amortizedMonthlyPayment(20000, 7, 10);
  assert.equal(body.result.planEstimates[0].monthlyPaymentEstimate, Math.round((expected + Number.EPSILON) * 100) / 100);
});

test("borrower calculator API rejects unknown fields without echoing their values", async () => {
  const response = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/calculate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      income: [{ cadence: "annual", amount: 50000 }],
      region: "contiguous_us",
      familySize: "2",
      privateUnexpectedField: "VERY-SENSITIVE-UI-VALUE"
    })
  }), {});
  const text = await response.text();
  const body = JSON.parse(text);
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.ok(body.issues.some((issue: string) => issue.includes("familySize")));
  assert.ok(body.issues.some((issue: string) => issue.includes("privateUnexpectedField")));
  assert.doesNotMatch(text, /VERY-SENSITIVE-UI-VALUE/);
});

test("borrower calculator API is same-origin and keeps the 64 KiB body ceiling", async () => {
  const forbidden = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/calculate", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: "{}"
  }), {});
  assert.equal(forbidden.status, 403);

  const oversized = await worker.fetch(new Request("https://student-loan-idr-mcp.example/api/calculate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x".repeat(70 * 1024)
  }), {});
  assert.equal(oversized.status, 413);
});

const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream"
};

async function mcpCall(payload: unknown, env: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(new Request("https://student-loan-idr-mcp.example/mcp", {
    method: "POST",
    headers: { ...MCP_HEADERS, ...extraHeaders },
    body: JSON.stringify(payload)
  }), env);
}

test("MCP initialize negotiates the declared protocol revision and current server version", async () => {
  const response = await mcpCall({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" }
    }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.result.protocolVersion, "2025-03-26");
  assert.equal(body.result.serverInfo.version, "0.8.4");
});

test("MCP notification-only requests return 202 with no response body", async () => {
  const response = await mcpCall({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "");
});

test("MCP accepts JSON-RPC batches but rejects initialize inside a batch", async () => {
  const response = await mcpCall([
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } }
  ]);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.length, 2);
  assert.deepEqual(body[0].result, {});
  assert.equal(body[1].error.code, -32600);
});

test("MCP rejects null request ids and malformed initialize params", async () => {
  const nullId = await mcpCall({ jsonrpc: "2.0", id: null, method: "ping" });
  assert.equal((await nullId.json()).error.code, -32600);

  const badInitialize = await mcpCall({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} });
  assert.equal((await badInitialize.json()).error.code, -32602);
});

test("MCP runtime schema validation rejects unknown and mistyped tool fields", async () => {
  const response = await mcpCall({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "calculate_alt_income_student_loan",
      arguments: {
        income: [{ cadence: "annual", amount: 50000 }],
        region: "contiguous_us",
        familySize: "2",
        secretExtraField: "should-never-be-accepted"
      }
    }
  });
  const body = await response.json();
  assert.equal(body.error.code, -32602);
  assert.ok(body.error.data.issues.some((issue: string) => issue.includes("familySize")));
  assert.ok(body.error.data.issues.some((issue: string) => issue.includes("secretExtraField")));
  assert.doesNotMatch(JSON.stringify(body.error.data), /should-never-be-accepted/);
});

test("MCP enforces application/json and Streamable HTTP Accept media types", async () => {
  const wrongContentType = await worker.fetch(new Request("https://student-loan-idr-mcp.example/mcp", {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "text/plain" },
    body: "{}"
  }), {});
  assert.equal(wrongContentType.status, 415);

  const wrongAccept = await worker.fetch(new Request("https://student-loan-idr-mcp.example/mcp", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
  }), {});
  assert.equal(wrongAccept.status, 406);
});

test("MCP caps request bodies at 64 KiB before JSON parsing", async () => {
  const response = await worker.fetch(new Request("https://student-loan-idr-mcp.example/mcp", {
    method: "POST",
    headers: MCP_HEADERS,
    body: "x".repeat(70 * 1024)
  }), {});
  assert.equal(response.status, 413);
});

test("MCP optional bearer authentication fails closed when configured", async () => {
  const denied = await mcpCall({ jsonrpc: "2.0", id: 1, method: "ping" }, { MCP_BEARER_TOKEN: "top-secret-token" });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("www-authenticate"), "Bearer");

  const allowed = await mcpCall(
    { jsonrpc: "2.0", id: 2, method: "ping" },
    { MCP_BEARER_TOKEN: "top-secret-token" },
    { authorization: "Bearer top-secret-token" }
  );
  assert.equal(allowed.status, 200);
});

test("MCP validates browser origins against the configured allowlist", async () => {
  const denied = await mcpCall({ jsonrpc: "2.0", id: 1, method: "ping" }, {}, { origin: "https://evil.example" });
  assert.equal(denied.status, 403);

  const allowed = await mcpCall(
    { jsonrpc: "2.0", id: 2, method: "ping" },
    { MCP_ALLOWED_ORIGINS: "https://app.example, https://other.example" },
    { origin: "https://app.example" }
  );
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example");
});

test("MCP optional Cloudflare rate limiter returns 429 and fails closed on binding errors", async () => {
  const limited = await mcpCall(
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { MCP_RATE_LIMITER: { limit: async () => ({ success: false }) } }
  );
  assert.equal(limited.status, 429);

  const unavailable = await mcpCall(
    { jsonrpc: "2.0", id: 2, method: "ping" },
    { MCP_RATE_LIMITER: { limit: async () => { throw new Error("binding unavailable"); } } }
  );
  assert.equal(unavailable.status, 503);
});

test("MCP observability logs request metadata but never borrower payload content or auth secrets", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const response = await mcpCall(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "get_repayment_documentation_template",
          arguments: { templateType: "current_income_statement", borrowerName: "VERY-SENSITIVE-BORROWER" }
        }
      },
      { MCP_BEARER_TOKEN: "VERY-SENSITIVE-TOKEN" },
      { authorization: "Bearer VERY-SENSITIVE-TOKEN" }
    );
    assert.equal(response.status, 200);
  } finally {
    console.log = originalLog;
  }
  const serializedLogs = logs.join("\n");
  assert.match(serializedLogs, /\"tool\":\"get_repayment_documentation_template\"/);
  assert.doesNotMatch(serializedLogs, /VERY-SENSITIVE-BORROWER/);
  assert.doesNotMatch(serializedLogs, /VERY-SENSITIVE-TOKEN/);
});

test("MCP GET endpoint explicitly declines SSE listening with 405", async () => {
  const response = await worker.fetch(new Request("https://student-loan-idr-mcp.example/mcp", {
    method: "GET",
    headers: { accept: "text/event-stream" }
  }), {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS");
});
