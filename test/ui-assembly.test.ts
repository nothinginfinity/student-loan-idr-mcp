import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BORROWER_UI_HTML } from "../src/ui/pages/borrower.ts";
import { ADVISOR_UI_HTML } from "../src/ui/pages/advisor-workspace.ts";
import { SHARE_UI_HTML } from "../src/ui/pages/share.ts";

describe("V0.9.10C visual workflow contracts", () => {
  it("keeps frozen borrower IDs and four-step chrome", () => {
    for (const id of [
      "calculator-form",
      "guided-assistant",
      "guide-answers",
      "guide-input",
      "document-workspace",
      "income-readiness-panel",
      "readiness-summary",
      "income-source-readiness",
      "document-scope",
      "document-reviewed",
      "loan-file",
      "borrower-consultation-workspace"
    ]) {
      assert.match(BORROWER_UI_HTML, new RegExp(`id="${id}"`));
    }
    assert.match(BORROWER_UI_HTML, /class="step-rail"/);
    assert.match(BORROWER_UI_HTML, /data-step-panel="portfolio"/);
    assert.match(BORROWER_UI_HTML, /data-step-panel="profile"/);
    assert.match(BORROWER_UI_HTML, /data-step-panel="guide"/);
    assert.match(BORROWER_UI_HTML, /data-step-panel="analysis"/);
  });
  it("keeps frozen advisor workspace IDs", () => {
    for (const id of ["login-form", "register-form", "create-client-form", "client-list"]) {
      assert.match(ADVISOR_UI_HTML, new RegExp(`id="${id}"`));
    }
  });
  it("keeps frozen share page IDs", () => {
    for (const id of ["status-line", "chart-panel", "select-panel", "sign-panel", "signed-panel"]) {
      assert.match(SHARE_UI_HTML, new RegExp(`id="${id}"`));
    }
  });
});
