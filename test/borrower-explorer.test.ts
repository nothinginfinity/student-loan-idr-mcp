import test from "node:test";
import assert from "node:assert/strict";
import { BORROWER_UI_HTML } from "../src/ui/pages/borrower.ts";
import { BORROWER_CALCULATOR } from "../src/ui/behavior/borrower-calculator.ts";
import { BORROWER_DOCUMENTS_GUIDE } from "../src/ui/behavior/borrower-documents-guide.ts";

test("V0.9.12 plan sandbox is mounted in Household without replacing existing form", () => {
  const profile = BORROWER_UI_HTML.indexOf('data-step-panel="profile"');
  const explorer = BORROWER_UI_HTML.indexOf('id="income-explorer-heading"');
  const form = BORROWER_UI_HTML.indexOf('id="calculator-form"');
  assert.ok(profile !== -1 && explorer > profile && form > explorer);
  for (const id of ["explorer-range","explorer-income","explorer-family","explorer-family-range",
    "explorer-dependents","explorer-dependents-range","explorer-filing","explorer-plan-detail",
    "explorer-eligibility","explorer-warnings","explorer-amount-result"]) {
    assert.ok(BORROWER_UI_HTML.includes('id="' + id + '"'), id + " missing");
  }
});

test("V0.9.12 exposes four accessible plan tabs with one selected", () => {
  for (const plan of ["RAP","IBR","PAYE","ICR"]) {
    assert.ok(BORROWER_UI_HTML.includes('data-explorer-plan="' + plan + '"'));
  }
  assert.match(BORROWER_UI_HTML, /data-explorer-plan="RAP" aria-pressed="true"/);
  assert.match(BORROWER_UI_HTML, /role="group" aria-label="Choose repayment plan"/);
  assert.match(BORROWER_UI_HTML, /document\.querySelector\('\.step-tab\[data-step="analysis"\]'\)/);
});

test("V0.9.12 reuses canonical calculation, supports other cadences, and keeps advisor mode manual", () => {
  assert.match(BORROWER_UI_HTML, /mainSubmit\.click\(\)/);
  assert.match(BORROWER_UI_HTML, /isAdvisor = new URLSearchParams/);
  assert.match(BORROWER_UI_HTML, /if \(isAdvisor \|\| !dirty \|\| waiting\) return/);
  assert.match(BORROWER_UI_HTML, /source\("cadence"\)\.value === "annual"/);
  assert.match(BORROWER_UI_HTML, /Guided multi-source income takes priority/);
  assert.match(BORROWER_UI_HTML, /if \(!form\.reportValidity\(\)\)/);
  assert.match(BORROWER_UI_HTML, /fetch\("\/api\/calculate"/);
  assert.match(BORROWER_UI_HTML, /id="advisor-client-bar"/);
  assert.match(BORROWER_UI_HTML, /id="loan-file"/);
  assert.match(BORROWER_UI_HTML, /id="borrower-consultation-workspace"/);
});

test("V0.9.12 keeps formula results and errors connected without introducing client-side payment math", () => {
  assert.match(BORROWER_CALCULATOR, /document\.dispatchEvent\(new CustomEvent\("borrower:calculated"/);
  assert.match(BORROWER_DOCUMENTS_GUIDE, /document\.dispatchEvent\(new CustomEvent\("borrower:calculate-error"/);
  assert.match(BORROWER_UI_HTML, /event\.detail/);
  assert.match(BORROWER_UI_HTML, /latestResult\?\.planEstimates\?\.find/);
  assert.match(BORROWER_UI_HTML, /latestResult = dirty \? null : event\.detail/);
  assert.match(BORROWER_UI_HTML, /input\.disabled = isAdvisor/);
  assert.ok(!BORROWER_UI_HTML.includes("explorer-plan-results"), "replaced legacy comparison list");
});
