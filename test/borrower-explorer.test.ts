import test from "node:test";
import assert from "node:assert/strict";
import { BORROWER_UI_HTML } from "../src/ui/pages/borrower.ts";

test("V0.9.11 explorer is mounted inside Household step without replacing calculation form", () => {
  const profile = BORROWER_UI_HTML.indexOf('data-step-panel="profile"');
  const explorer = BORROWER_UI_HTML.indexOf('id="income-explorer-heading"');
  const form = BORROWER_UI_HTML.indexOf('id="calculator-form"');
  assert.ok(profile !== -1 && explorer > profile && form > explorer);
  assert.match(BORROWER_UI_HTML, /id="explorer-range"/);
  assert.match(BORROWER_UI_HTML, /id="explorer-income"/);
  assert.match(BORROWER_UI_HTML, /id="explorer-plan-results"/);
});

test("V0.9.11 uses the existing deterministic calculator and keeps advisor calculations manual", () => {
  assert.match(BORROWER_UI_HTML, /mainSubmit\.click\(\)/);
  assert.match(BORROWER_UI_HTML, /if \(isAdvisor \|\| cadence\.value !== "annual"/);
  assert.match(BORROWER_UI_HTML, /if \(advisorClient\)/);
  assert.match(BORROWER_UI_HTML, /fetch\("\/api\/calculate"/);
  assert.match(BORROWER_UI_HTML, /id="advisor-client-bar"/);
  assert.match(BORROWER_UI_HTML, /id="loan-file"/);
  assert.match(BORROWER_UI_HTML, /id="borrower-consultation-workspace"/);
});
