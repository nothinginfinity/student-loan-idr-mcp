import test from "node:test";
import assert from "node:assert/strict";
import { calculateRepayment, normalizeIncomeToAnnual, povertyGuideline } from "../src/formulas.ts";

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
