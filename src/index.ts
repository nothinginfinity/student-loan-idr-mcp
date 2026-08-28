import { calculateRepayment, getPolicyStatus, ibrZeroPaymentAgiThreshold } from "./formulas.ts";
import { getDocumentationTemplate } from "./templates.ts";
import { handleAdvisorApi } from "./advisor.ts";
import type { D1DatabaseBinding } from "./advisor.ts";
import type {
  AdvisorClientDashboardSummary,
  AdvisorClientRecordV1,
  AdvisorPrincipal,
  CalculatorRequest,
  Region,
  TemplateRequest
} from "./types.ts";

const SERVER_VERSION = "0.8.2";
const SUPPORTED_PROTOCOL_VERSION = "2025-03-26";
const MAX_REQUEST_BYTES = 64 * 1024;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-allow-methods": "GET, POST, OPTIONS"
};

interface RateLimiterBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  MCP_BEARER_TOKEN?: string;
  MCP_ALLOWED_ORIGINS?: string;
  MCP_RATE_LIMITER?: RateLimiterBinding;
  ADVISOR_DB?: D1DatabaseBinding;
}

export function advisorCanAccessClient(principal: AdvisorPrincipal, client: AdvisorClientRecordV1): boolean {
  return principal.status === "active"
    && principal.advisorId.length > 0
    && client.ownerAdvisorId.length > 0
    && principal.advisorId === client.ownerAdvisorId;
}

export function assertAdvisorClientAccess(principal: AdvisorPrincipal, client: AdvisorClientRecordV1): AdvisorClientRecordV1 {
  if (!advisorCanAccessClient(principal, client)) throw new Error("Client not found or not accessible.");
  return client;
}

export function clientDashboardSummary(principal: AdvisorPrincipal, client: AdvisorClientRecordV1): AdvisorClientDashboardSummary {
  const scopedClient = assertAdvisorClientAccess(principal, client);
  return {
    clientId: scopedClient.clientId,
    displayName: scopedClient.contact.displayName,
    lifecycleState: scopedClient.lifecycleState,
    readinessState: scopedClient.readinessState,
    updatedAt: scopedClient.updatedAt
  };
}

type JsonObject = Record<string, unknown>;
type JsonRpcId = string | number | null;
type RuntimeSchema = {
  readonly type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, RuntimeSchema>>;
  readonly items?: RuntimeSchema;
  readonly enum?: readonly unknown[];
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minimum?: number;
  readonly exclusiveMinimum?: number;
  readonly maxLength?: number;
};

class RequestTooLargeError extends Error {}

const loanTypeEnum = [
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
] as const;

const toolDefinitions = [
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
            repaymentLoans: {
              type: "array",
              minItems: 1,
              maxItems: 200,
              items: {
                type: "object",
                required: ["principal", "annualInterestRatePercent"],
                properties: {
                  principal: { type: "number", minimum: 0 },
                  annualInterestRatePercent: { type: "number", minimum: 0 }
                }
              }
            },
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
] as const;

const BORROWER_UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Student Loan IDR Estimate</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: Canvas; color: CanvasText; line-height: 1.5; }
    main { width: min(1040px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0 64px; }
    h1 { font-size: clamp(2rem, 7vw, 4rem); line-height: 1; letter-spacing: -0.045em; margin: 0 0 16px; }
    h2 { margin-top: 0; }
    .lede { max-width: 780px; font-size: 1.05rem; color: color-mix(in srgb, CanvasText 72%, transparent); }
    .notice { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 16px; padding: 16px; margin: 24px 0; background: color-mix(in srgb, CanvasText 4%, Canvas); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .span-2 { grid-column: 1 / -1; }
    label, legend { font-weight: 650; }
    label { display: grid; gap: 7px; }
    input, select, textarea, button { font: inherit; }
    input, select, textarea { width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); background: Canvas; color: CanvasText; }
    textarea { min-height: 96px; resize: vertical; }
    fieldset { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 12px; padding: 14px; margin: 0; }
    .checks { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; }
    .checks label { display: flex; align-items: center; gap: 7px; font-weight: 500; }
    .checks input { width: auto; }
    .actions { display: flex; gap: 12px; align-items: center; margin-top: 22px; flex-wrap: wrap; }
    button { border: 0; border-radius: 999px; padding: 12px 18px; font-weight: 750; cursor: pointer; background: CanvasText; color: Canvas; }
    button:disabled { opacity: .55; cursor: wait; }
    #status { min-height: 1.5em; color: color-mix(in srgb, CanvasText 70%, transparent); }
    #results { margin-top: 32px; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0 20px; }
    .metric, .plan { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 14px; padding: 16px; }
    .metric strong { display: block; font-size: 1.35rem; }
    .plans { display: grid; gap: 12px; }
    .plan-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .plan-head strong { font-size: 1.15rem; }
    .payment { font-size: 1.35rem; font-weight: 800; }
    .badge { display: inline-flex; padding: 3px 9px; border: 1px solid currentColor; border-radius: 999px; font-size: .82rem; text-transform: capitalize; }
    .muted { color: color-mix(in srgb, CanvasText 66%, transparent); }
    .workspace { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 16px; padding: 18px; margin: 24px 0; }
    .guide-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
    .guide-transcript { display: grid; gap: 10px; margin: 16px 0; max-height: 360px; overflow: auto; padding-right: 4px; }
    .message { max-width: min(720px, 92%); padding: 10px 13px; border-radius: 14px; border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    .message.guide { justify-self: start; background: color-mix(in srgb, CanvasText 4%, Canvas); }
    .message.user { justify-self: end; background: CanvasText; color: Canvas; }
    .answer-bubbles { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
    .answer-bubbles button { padding: 9px 13px; background: color-mix(in srgb, CanvasText 8%, Canvas); color: CanvasText; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); }
    .guide-entry { display: flex; gap: 8px; align-items: center; }
    .guide-entry input { flex: 1; }
    .fact-ledger { margin-top: 16px; padding-top: 14px; border-top: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    .fact-ledger ul { margin-bottom: 0; }
    .quick-info { width: 100%; border-collapse: collapse; margin: 10px 0; font-variant-numeric: tabular-nums; }
    .quick-info th, .quick-info td { padding: 8px 10px; text-align: left; border-bottom: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    .quick-info th:last-child, .quick-info td:last-child { text-align: right; }
    .quick-callout { border-left: 4px solid currentColor; padding: 10px 12px; margin: 10px 0; background: color-mix(in srgb, CanvasText 4%, Canvas); border-radius: 0 10px 10px 0; }
    .document-workspace[hidden], #document-draft-area[hidden] { display: none; }
    .document-preview { white-space: pre-wrap; overflow: auto; max-height: 520px; padding: 16px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 12px; background: color-mix(in srgb, CanvasText 3%, Canvas); font: 0.92rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .document-review { display: flex; align-items: flex-start; gap: 9px; font-weight: 600; margin-top: 14px; }
    .document-review input { width: auto; margin-top: 4px; }
    .basis { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 8px; font-size: .78rem; font-weight: 750; border: 1px solid currentColor; margin-right: 6px; }
    .fact-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .fact { border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius: 12px; padding: 12px; }
    .fact strong { display: block; margin-bottom: 4px; }
    .readiness-list { display: grid; gap: 10px; margin-top: 12px; }
    .readiness-card { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 12px; padding: 12px; }
    .readiness-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    .readiness-card ul { margin-bottom: 0; }
    .readiness-actions { margin-top: 12px; }
    #portfolio-summary { margin-top: 12px; }
    ul { padding-left: 22px; }
    a { color: inherit; }
    footer { margin-top: 36px; font-size: .9rem; color: color-mix(in srgb, CanvasText 65%, transparent); }
    @media (max-width: 700px) { .grid, .summary, .fact-grid { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } main { width: min(100% - 24px, 1040px); padding-top: 28px; } }
  </style>
</head>
<body>
<main>
  <p><strong>Student Loan IDR Estimate</strong> · policy snapshot 2026-08-27</p>
  <h1>Turn your real loan facts into a repayment estimate.</h1>
  <p class="lede">This calculator annualizes the income facts you enter and applies the same deterministic RAP, IBR, PAYE, and ICR formulas exposed by this Worker’s MCP tools. It is an estimate—not an official eligibility or billing decision.</p>
  <div class="notice"><strong>Privacy:</strong> this page has no analytics, no external assets, and no browser storage. Calculation inputs are sent only to this same Worker for the current request. A StudentAid.gov loan-data file is parsed locally in your browser and the raw file is never uploaded. Do not enter SSNs, account numbers, or fabricated facts.</div>

  <section class="workspace" id="guided-assistant" aria-labelledby="guided-assistant-title">
    <div class="guide-head">
      <div>
        <h2 id="guided-assistant-title">Guided IDR assistant</h2>
        <p class="muted">Answer by tapping a bubble or typing. This first version is deterministic: it records only what you confirm, labels the fact source, and prefills the calculator below. No account is required.</p>
      </div>
      <span class="badge">Private session</span>
    </div>
    <div id="guide-transcript" class="guide-transcript" role="log" aria-live="polite"></div>
    <div id="guide-answers" class="answer-bubbles" aria-label="Suggested answers"></div>
    <form id="guide-form" class="guide-entry">
      <input id="guide-input" autocomplete="off" placeholder="Type your answer" aria-label="Type your answer">
      <button type="submit">Send</button>
    </form>
    <div class="fact-ledger">
      <strong>Facts collected in this session</strong>
      <p class="muted">These remain browser-local until you choose to calculate. Imported loan facts and deterministic results are labeled separately.</p>
      <ul id="guided-facts"><li class="muted">No guided facts confirmed yet.</li></ul>
    </div>
  </section>

  <section class="workspace document-workspace" id="document-workspace" aria-labelledby="document-workspace-title" hidden>
    <h2 id="document-workspace-title">Review your supporting statement</h2>
    <p><span class="basis">Draft only</span>This uses only facts you supplied. Missing facts stay as visible placeholders. It does not create employer records, evidence, or signatures, and it does not submit anything to Federal Student Aid or a loan servicer.</p>
    <div class="fact-ledger" id="income-readiness-panel">
      <strong>Source-by-source income readiness</strong>
      <p class="muted">Each taxable source stays separate in this browser-local session. Evidence readiness is borrower-stated only: this page does not upload, inspect, or verify evidence files.</p>
      <p id="readiness-summary" class="muted">No current income sources confirmed yet.</p>
      <div id="income-source-readiness" class="readiness-list"></div>
      <div class="readiness-actions"><button type="button" id="add-income-source">Add another income source</button></div>
    </div>
    <form id="document-form">
      <div class="grid">
        <label class="span-2">Draft scope
          <select name="documentScope" id="document-scope">
            <option value="combined">Combined confirmed income sources</option>
          </select>
          <span class="muted">Choose a single source for a source-specific statement, or keep all confirmed sources together.</span>
        </label>
        <label>Document date <span class="muted">(optional)</span>
          <input name="documentDate" type="text" placeholder="Leave blank for [date]">
        </label>
        <label>Borrower name <span class="muted">(optional)</span>
          <input name="borrowerName" type="text" placeholder="Leave blank for [borrower full name]">
        </label>
        <label>Loan servicer <span class="muted">(optional)</span>
          <input name="servicerName" type="text" placeholder="Leave blank for [loan servicer]">
        </label>
        <label>Payer / employer / agency <span class="muted">(optional)</span>
          <input name="sourceName" type="text" placeholder="Leave blank for a placeholder">
        </label>
        <label>Source address <span class="muted">(optional)</span>
          <input name="sourceAddress" type="text" placeholder="Leave blank for a placeholder">
        </label>
        <label>Gross amount for the stated cadence <span class="muted">(optional)</span>
          <input name="grossAmount" type="number" min="0" step="0.01" placeholder="Leave blank for a placeholder">
        </label>
        <label>Payment frequency <span class="muted">(optional)</span>
          <input name="paymentFrequency" type="text" placeholder="e.g. biweekly">
        </label>
        <label class="span-2">Additional explanation <span class="muted">(optional)</span>
          <textarea name="notes" placeholder="Leave blank for [optional explanation]"></textarea>
        </label>
      </div>
      <div class="actions">
        <button type="submit" id="document-generate">Generate / refresh draft</button>
        <span id="document-status" role="status" aria-live="polite"></span>
      </div>
    </form>
    <div id="document-draft-area" hidden>
      <h3>Draft preview</h3>
      <pre id="document-preview" class="document-preview"></pre>
      <label class="document-review"><input type="checkbox" id="document-reviewed"> <span>I reviewed the draft facts. I understand this is not signed or submitted, and I must sign it myself if I choose to use it.</span></label>
      <div class="actions">
        <button type="button" id="document-print" disabled>Print / Save PDF</button>
        <button type="button" id="document-download" disabled>Download HTML</button>
      </div>
    </div>
  </section>

  <section class="workspace" aria-labelledby="loan-import-title">
    <h2 id="loan-import-title">Import your federal loan portfolio</h2>
    <p><span class="basis">Imported fact</span>Choose the <strong>Download My Aid Data</strong> text file from StudentAid.gov. The raw file can contain personal contact information, so this page reads it only on this device, extracts active loan balance/rate/type/date facts, and never uploads the raw text.</p>
    <label>StudentAid.gov My Aid Data file
      <input id="loan-file" type="file" accept=".txt,text/plain">
    </label>
    <p id="import-status" role="status" aria-live="polite" class="muted">No loan file loaded. Manual loan fields remain available below.</p>
    <div id="portfolio-summary"></div>
  </section>

  <section class="workspace" aria-labelledby="fact-basis-title">
    <h2 id="fact-basis-title">Know what each answer is based on</h2>
    <div class="fact-grid">
      <div class="fact"><strong><span class="basis">Stated fact</span>Family size</strong>Use the current IDR definition, not a guessed tax-household count. It includes you; a spouse when appropriate; supported children (including qualifying unborn children); and other people only when the current support/living requirements are met. There is no six-person cap in the current IDR form.</div>
      <div class="fact"><strong><span class="basis">Documented fact</span>Current taxable income</strong>If current income must be documented instead of using tax information, current Federal Student Aid instructions generally require documentation no older than 90 days, gross pay and pay frequency, and at least one item for each taxable income source. A signed source-by-source statement is the fallback when documentation is unavailable or needs explanation.</div>
      <div class="fact"><strong><span class="basis">Imported fact</span>Loan portfolio</strong>Balances, interest rates, loan descriptions, dates, status, and servicer fields can come from your StudentAid.gov data file. Ambiguous consolidation history is not guessed.</div>
      <div class="fact"><strong><span class="basis">Derived estimate</span>Payment result</strong>Plan amounts are deterministic calculations from the facts above and the versioned policy snapshot. They are not official approval, certification, or a servicer bill.</div>
    </div>
  </section>

  <form id="calculator-form">
    <p id="calculator-income-note" class="muted">If you use the guided source-by-source workflow, calculation uses every confirmed guided taxable income source. The visible income controls remain the manual fallback and the first-source preview. Hourly guided sources use the displayed hours-per-week and weeks-per-year controls, so review those before calculating.</p>
    <div class="grid">
      <label>Income cadence
        <select name="cadence" id="cadence">
          <option value="annual">Annual</option>
          <option value="monthly">Monthly</option>
          <option value="semimonthly">Twice monthly</option>
          <option value="biweekly">Every two weeks</option>
          <option value="weekly">Weekly</option>
          <option value="hourly">Hourly</option>
        </select>
      </label>
      <label><span><span class="basis">Stated fact</span>Gross taxable income amount for that cadence</span>
        <input name="incomeAmount" type="number" min="0" step="0.01" value="50000" required>
      </label>
      <label id="hours-field" hidden>Hours per week
        <input name="hoursPerWeek" type="number" min="0" step="0.01" value="40">
      </label>
      <label id="weeks-field" hidden>Weeks per year
        <input name="weeksPerYear" type="number" min="0" step="0.01" value="52">
      </label>
      <label>Region
        <select name="region">
          <option value="contiguous_us">48 states + D.C.</option>
          <option value="alaska">Alaska</option>
          <option value="hawaii">Hawaii</option>
        </select>
      </label>
      <label><span><span class="basis">Stated fact</span>Legacy IDR family size</span>
        <input name="familySize" type="number" min="1" step="1" value="1" required aria-describedby="family-size-help">
        <span id="family-size-help" class="muted">Use the current Federal Student Aid support-based definition above; do not cap the value at 6.</span>
      </label>
      <label><span><span class="basis">Stated fact</span>Dependents claimed on federal tax return</span>
        <input name="dependents" type="number" min="0" step="1" value="0" required>
        <span class="muted">Used by RAP and intentionally separate from legacy IDR family size.</span>
      </label>
      <label>Estimated above-the-line adjustments <span class="muted">(optional)</span>
        <input name="adjustments" type="number" min="0" step="0.01" placeholder="0">
      </label>
      <label>AGI override <span class="muted">(optional)</span>
        <input name="agiOverride" type="number" min="0" step="0.01" placeholder="Use calculated estimate">
      </label>
      <label>Tax filing status <span class="muted">(helps ICR)</span>
        <select name="taxFilingStatus">
          <option value="">Not supplied</option>
          <option value="single">Single</option>
          <option value="married_filing_jointly">Married filing jointly</option>
          <option value="married_filing_separately">Married filing separately</option>
          <option value="head_of_household">Head of household</option>
        </select>
      </label>
      <label>Loan principal <span class="muted">(optional; improves caps/ICR)</span>
        <input name="principal" type="number" min="0" step="0.01" placeholder="e.g. 30000">
      </label>
      <label>Annual interest rate % <span class="muted">(optional)</span>
        <input name="interestRate" type="number" min="0" step="0.001" placeholder="e.g. 6.5">
      </label>
      <label>Loan type <span class="muted">(optional eligibility screen)</span>
        <select name="loanType">
          <option value="">Not supplied</option>
          <option value="direct_subsidized">Direct Subsidized</option>
          <option value="direct_unsubsidized">Direct Unsubsidized</option>
          <option value="direct_grad_plus">Direct Grad PLUS</option>
          <option value="direct_parent_plus">Direct Parent PLUS</option>
          <option value="direct_consolidation_no_parent_plus">Direct Consolidation — no Parent PLUS</option>
          <option value="direct_consolidation_with_parent_plus">Direct Consolidation — includes Parent PLUS</option>
          <option value="ffel_subsidized_stafford">FFEL Subsidized Stafford</option>
          <option value="ffel_unsubsidized_stafford">FFEL Unsubsidized Stafford</option>
          <option value="ffel_grad_plus">FFEL Grad PLUS</option>
          <option value="ffel_parent_plus">FFEL Parent PLUS</option>
          <option value="ffel_consolidation_no_parent_plus">FFEL Consolidation — no Parent PLUS</option>
          <option value="ffel_consolidation_with_parent_plus">FFEL Consolidation — includes Parent PLUS</option>
          <option value="perkins">Perkins</option>
        </select>
      </label>
      <label>Loan disbursement period
        <select name="disbursementPeriod">
          <option value="before_2026_07_01">Before July 1, 2026</option>
          <option value="on_or_after_2026_07_01">On/after July 1, 2026</option>
        </select>
      </label>
      <label>IBR borrower timing
        <select name="ibrNewBorrower">
          <option value="">Not supplied</option>
          <option value="true">New borrower on/after July 1, 2014</option>
          <option value="false">Earlier borrower</option>
        </select>
      </label>
      <fieldset class="span-2">
        <legend>Plans to estimate</legend>
        <div class="checks">
          <label><input type="checkbox" name="plans" value="RAP" checked> RAP</label>
          <label><input type="checkbox" name="plans" value="IBR" checked> IBR</label>
          <label><input type="checkbox" name="plans" value="PAYE" checked> PAYE</label>
          <label><input type="checkbox" name="plans" value="ICR" checked> ICR</label>
        </div>
      </fieldset>
    </div>
    <div class="actions">
      <button type="submit" id="submit">Calculate estimate</button>
      <span id="status" role="status" aria-live="polite"></span>
    </div>
  </form>

  <section id="results" aria-live="polite"></section>
  <footer>Official eligibility and payment amounts come from the U.S. Department of Education and your loan servicer. SAVE is not modeled in this 2026-08-27 policy snapshot.</footer>
</main>
<script>
(() => {
  const form = document.getElementById("calculator-form");
  const cadence = document.getElementById("cadence");
  const hoursField = document.getElementById("hours-field");
  const weeksField = document.getElementById("weeks-field");
  const status = document.getElementById("status");
  const results = document.getElementById("results");
  const submit = document.getElementById("submit");
  const loanFile = document.getElementById("loan-file");
  const importStatus = document.getElementById("import-status");
  const portfolioSummary = document.getElementById("portfolio-summary");
  const guideTranscript = document.getElementById("guide-transcript");
  const guideAnswers = document.getElementById("guide-answers");
  const guideForm = document.getElementById("guide-form");
  const guideInput = document.getElementById("guide-input");
  const guidedFactsList = document.getElementById("guided-facts");
  const documentWorkspace = document.getElementById("document-workspace");
  const documentForm = document.getElementById("document-form");
  const documentGenerate = document.getElementById("document-generate");
  const documentStatus = document.getElementById("document-status");
  const documentDraftArea = document.getElementById("document-draft-area");
  const documentPreview = document.getElementById("document-preview");
  const documentReviewed = document.getElementById("document-reviewed");
  const documentPrint = document.getElementById("document-print");
  const documentDownload = document.getElementById("document-download");
  const documentScope = document.getElementById("document-scope");
  const readinessSummary = document.getElementById("readiness-summary");
  const incomeSourceReadiness = document.getElementById("income-source-readiness");
  const addIncomeSource = document.getElementById("add-income-source");
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const numberOrUndefined = (value) => value === "" ? undefined : Number(value);
  let importedPortfolio = null;
  let documentDraft = null;
  let guideDocumentGoal = null;
  let guideContinueToCalculator = false;
  let guideIncomeCadence = null;
  let guideIncomeAmount = null;
  let guidedIncomeSources = [];
  let pendingIncomeSource = null;
  let collectMultipleSources = false;

  function numericValue(value) {
    if (!value) return undefined;
    const normalized = value.replace(/[$,%]/g, "").replace(/,/g, "").trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function mapLoanType(description) {
    const value = String(description || "").toUpperCase();
    if (!value) return null;
    if (value.includes("PERKINS")) return "perkins";
    const isDirect = value.includes("DIRECT");
    const isFfel = value.includes("FFEL") || value.includes("FEDERAL STAFFORD");
    if (value.includes("CONSOLIDAT")) return null;
    if (isDirect) {
      if (value.includes("PARENT") && value.includes("PLUS")) return "direct_parent_plus";
      if ((value.includes("GRAD") || value.includes("PROFESSIONAL")) && value.includes("PLUS")) return "direct_grad_plus";
      if (value.includes("UNSUBSID")) return "direct_unsubsidized";
      if (value.includes("SUBSID")) return "direct_subsidized";
      return null;
    }
    if (isFfel) {
      if (value.includes("PARENT") && value.includes("PLUS")) return "ffel_parent_plus";
      if ((value.includes("GRAD") || value.includes("PROFESSIONAL")) && value.includes("PLUS")) return "ffel_grad_plus";
      if (value.includes("UNSUBSID") || value.includes("NON-SUBSID")) return "ffel_unsubsidized_stafford";
      if (value.includes("SUBSID")) return "ffel_subsidized_stafford";
    }
    return null;
  }

  function disbursementPeriod(value) {
    const timestamp = Date.parse(value || "");
    if (!Number.isFinite(timestamp)) return null;
    return timestamp >= Date.UTC(2026, 6, 1) ? "on_or_after_2026_07_01" : "before_2026_07_01";
  }

  function parseStudentAidData(text) {
    const records = [];
    let current = null;
    const pushCurrent = () => { if (current) records.push(current); };
    for (const rawLine of text.split(/\r?\n/)) {
      const separator = rawLine.indexOf(":");
      if (separator < 0) continue;
      const key = rawLine.slice(0, separator).trim();
      const value = rawLine.slice(separator + 1).trim();
      if (key === "Loan Type Code" || key === "Loan Type") {
        pushCurrent();
        current = { typeCode: key === "Loan Type Code" ? value : "", typeDescription: key === "Loan Type" ? value : "" };
        continue;
      }
      if (!current) continue;
      if (key === "Loan Type Description" && !current.typeDescription) current.typeDescription = value;
      else if (key === "Loan Outstanding Principal Balance" && current.principal === undefined) current.principal = numericValue(value);
      else if (key === "Loan Interest Rate" && current.interestRate === undefined) current.interestRate = numericValue(value);
      else if (key === "Loan Disbursement Date" && !current.disbursementDate) current.disbursementDate = value;
      else if (key === "Loan Status Description" && !current.statusDescription) current.statusDescription = value;
      else if (key === "Loan Contact Name" && !current.servicer) current.servicer = value;
    }
    pushCurrent();

    const active = records.filter((loan) => typeof loan.principal === "number" && loan.principal > 0);
    const normalized = active.map((loan) => {
      const loanType = mapLoanType(loan.typeDescription);
      const period = disbursementPeriod(loan.disbursementDate);
      const status = String(loan.statusDescription || "").toUpperCase();
      const inDefault = status.includes("DEFAULT") && !status.includes("NON-DEFAULT");
      return { ...loan, loanType, period, inDefault };
    });
    const repaymentLoans = normalized
      .filter((loan) => typeof loan.interestRate === "number")
      .map((loan) => ({ principal: loan.principal, annualInterestRatePercent: loan.interestRate }));
    const fullyMappedForEligibility = normalized.length > 0 && normalized.every((loan) => loan.loanType && loan.period);
    const eligibilityLoans = fullyMappedForEligibility
      ? normalized.map((loan) => ({ loanType: loan.loanType, disbursementPeriod: loan.period, ...(loan.inDefault ? { inDefault: true } : {}) }))
      : undefined;
    return {
      loans: normalized,
      repaymentLoans,
      eligibilityLoans,
      totalPrincipal: normalized.reduce((sum, loan) => sum + loan.principal, 0),
      ambiguousCount: normalized.filter((loan) => !loan.loanType || !loan.period).length
    };
  }

  function renderPortfolio(portfolio) {
    portfolioSummary.replaceChildren();
    if (!portfolio.loans.length) return;
    const summary = document.createElement("div");
    summary.className = "summary";
    [["Active loans found", String(portfolio.loans.length)], ["Outstanding principal", money.format(portfolio.totalPrincipal)], ["Loans with balance + rate", String(portfolio.repaymentLoans.length)]].forEach(([label, value]) => {
      const metric = document.createElement("div");
      metric.className = "metric";
      metric.append(addText("span", label, "muted"), addText("strong", value));
      summary.appendChild(metric);
    });
    portfolioSummary.appendChild(summary);
    if (portfolio.ambiguousCount) portfolioSummary.appendChild(addText("p", String(portfolio.ambiguousCount) + " active loan record(s) have an ambiguous type/date for eligibility screening. Their balances can still be modeled when an interest rate is present, but this calculator will not guess consolidation/Parent PLUS history.", "muted"));
  }

  function syncHourlyFields() {
    const hourly = cadence.value === "hourly";
    hoursField.hidden = !hourly;
    weeksField.hidden = !hourly;
  }

  function addText(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function render(result) {
    results.replaceChildren();
    results.appendChild(addText("h2", "Estimate"));

    const summary = document.createElement("div");
    summary.className = "summary";
    [
      ["Annualized taxable gross", money.format(result.normalizedAnnualTaxableGrossIncome)],
      ["Estimated AGI", money.format(result.estimatedAdjustedGrossIncome)],
      ["2026 poverty guideline", money.format(result.povertyGuideline)]
    ].forEach(([label, value]) => {
      const metric = document.createElement("div");
      metric.className = "metric";
      metric.append(addText("span", label, "muted"), addText("strong", value));
      summary.appendChild(metric);
    });
    results.appendChild(summary);

    const plans = document.createElement("div");
    plans.className = "plans";
    result.planEstimates.forEach((plan) => {
      const card = document.createElement("article");
      card.className = "plan";
      const head = document.createElement("div");
      head.className = "plan-head";
      const title = document.createElement("div");
      title.append(addText("strong", plan.plan), document.createTextNode(" "), addText("span", plan.eligibility.status, "badge"));
      head.append(title, addText("span", money.format(plan.monthlyPaymentEstimate) + "/mo", "payment"));
      card.append(head);
      card.appendChild(addText("p", plan.formulaSummary));
      card.appendChild(addText("p", plan.eligibilityNote, "muted"));
      if (plan.warnings.length) {
        const list = document.createElement("ul");
        plan.warnings.forEach((warning) => list.appendChild(addText("li", warning)));
        card.appendChild(list);
      }
      plans.appendChild(card);
    });
    results.appendChild(plans);

    const caveats = document.createElement("details");
    const summaryNode = addText("summary", "Assumptions and warnings");
    caveats.appendChild(summaryNode);
    const list = document.createElement("ul");
    [...result.assumptions, ...result.warnings].forEach((item) => list.appendChild(addText("li", item)));
    caveats.appendChild(list);
    results.appendChild(caveats);
  }

  const guidedFacts = new Map();
  let guideStep = "goal";
  let guideIncomeSituation = null;

  function guideSay(text, role = "guide") {
    const node = addText("div", text, "message " + role);
    guideTranscript.appendChild(node);
    guideTranscript.scrollTop = guideTranscript.scrollHeight;
  }

  function recordGuidedFact(key, label, value, basis = "Stated fact") {
    guidedFacts.set(key, { label, value, basis });
    guidedFactsList.replaceChildren();
    guidedFacts.forEach((fact) => {
      const item = document.createElement("li");
      const tag = addText("span", fact.basis, "basis");
      item.append(tag, document.createTextNode(fact.label + ": " + fact.value));
      guidedFactsList.appendChild(item);
    });
  }

  function setCalculatorValue(name, value) {
    const control = form.elements.namedItem(name);
    if (control && "value" in control) control.value = String(value);
  }

  function setDocumentValue(name, value) {
    const control = documentForm.elements.namedItem(name);
    if (control && "value" in control) control.value = String(value);
  }

  function documentSourceType() {
    if (guideIncomeSituation === "unemployment") return "unemployment";
    if (guideIncomeSituation === "self_employment") return "self_employment";
    if (guideIncomeSituation === "employment") return "employment";
    return "other";
  }

  function sourceTypeLabel(value) {
    const labels = {
      employment: "Employment",
      self_employment: "Self-employment",
      contract: "Contract / gig income",
      unemployment: "Unemployment compensation",
      other: "Other taxable income"
    };
    return labels[value] || "Other taxable income";
  }

  function evidenceStatusLabel(value) {
    if (value === "documented") return "Evidence in hand (borrower-stated)";
    if (value === "identified") return "Evidence identified (borrower-stated)";
    return "Needs evidence / review";
  }

  function sourceEvidenceGuidance(sourceType) {
    if (sourceType === "employment") return "Recent pay stub(s) or an employer statement showing gross pay and pay frequency.";
    if (sourceType === "self_employment" || sourceType === "contract") return "Recent client/business payment records, invoices paired with payment evidence, or a payer statement that reflects current taxable income.";
    if (sourceType === "unemployment") return "Recent unemployment-benefits statement or payment history.";
    return "A recent payer/source record showing the current taxable amount and payment frequency, or another item requested by the servicer.";
  }

  function sourceDocumentReady(source) {
    return Boolean(source && source.sourceType && typeof source.grossAmount === "number" && source.paymentFrequency);
  }

  function sourceApplicationReady(source) {
    return sourceDocumentReady(source) && Boolean(source.name) && ["documented", "identified"].includes(source.evidenceStatus);
  }

  function refreshDocumentScopeOptions() {
    const previous = documentScope.value;
    documentScope.replaceChildren();
    const combined = document.createElement("option");
    combined.value = "combined";
    combined.textContent = "Combined confirmed income sources";
    documentScope.appendChild(combined);
    guidedIncomeSources.forEach((source, index) => {
      const option = document.createElement("option");
      option.value = "source:" + index;
      option.textContent = "Source " + (index + 1) + " — " + sourceTypeLabel(source.sourceType) + (source.name ? " — " + source.name : "");
      documentScope.appendChild(option);
    });
    const values = Array.from(documentScope.options).map((option) => option.value);
    documentScope.value = values.includes(previous) ? previous : "combined";
  }

  function renderIncomeReadiness() {
    incomeSourceReadiness.replaceChildren();
    if (!guidedIncomeSources.length) {
      readinessSummary.textContent = guideIncomeSituation === "none"
        ? "No current taxable income was stated. A no-current-taxable-income draft can be prepared, but the borrower should still review current servicer instructions before submission."
        : "No current income sources confirmed yet.";
      refreshDocumentScopeOptions();
      return;
    }

    let documentReadyCount = 0;
    let applicationReadyCount = 0;
    guidedIncomeSources.forEach((source, index) => {
      const documentReady = sourceDocumentReady(source);
      const applicationReady = sourceApplicationReady(source);
      if (documentReady) documentReadyCount += 1;
      if (applicationReady) applicationReadyCount += 1;

      const card = document.createElement("div");
      card.className = "readiness-card";
      const head = document.createElement("div");
      head.className = "readiness-head";
      const title = addText("strong", "Source " + (index + 1) + " — " + sourceTypeLabel(source.sourceType));
      const state = addText("span", applicationReady ? "Application-ready" : documentReady ? "Document-ready" : "Needs review", "badge");
      head.append(title, state);
      card.appendChild(head);
      card.appendChild(addText("p", (source.name || "[payer / source name still missing]") + " · " + money.format(source.grossAmount) + " · " + source.paymentFrequency, "muted"));

      const checklist = document.createElement("ul");
      const checks = [
        [Boolean(source.sourceType), "Income source type confirmed"],
        [typeof source.grossAmount === "number" && Boolean(source.paymentFrequency), "Gross taxable amount and payment frequency confirmed"],
        [Boolean(source.name), "Payer / source name confirmed"],
        [["documented", "identified"].includes(source.evidenceStatus), evidenceStatusLabel(source.evidenceStatus)]
      ];
      checks.forEach(([ok, label]) => checklist.appendChild(addText("li", (ok ? "✓ " : "□ ") + label)));
      card.appendChild(checklist);
      card.appendChild(addText("p", "Typical evidence for this source: " + sourceEvidenceGuidance(source.sourceType), "muted"));
      incomeSourceReadiness.appendChild(card);
    });

    if (applicationReadyCount === guidedIncomeSources.length) {
      readinessSummary.textContent = "Application-ready: every confirmed source has core facts, a payer/source name, and evidence that the borrower says is in hand or identified. Final servicer review is still required.";
    } else if (documentReadyCount === guidedIncomeSources.length) {
      readinessSummary.textContent = "Document-ready: every confirmed source has enough core facts for a draft, but one or more sources still need a payer/source name, evidence, or review before this session should be treated as application-ready.";
    } else {
      readinessSummary.textContent = "Needs review: one or more income sources are missing core amount/frequency facts needed for a source-specific draft.";
    }
    refreshDocumentScopeOptions();
  }

  function documentIncomeSources() {
    const sources = guidedIncomeSources.map((source) => ({
      sourceType: source.sourceType,
      ...(source.name ? { name: source.name } : {}),
      ...(source.address ? { address: source.address } : {}),
      ...(typeof source.grossAmount === "number" ? { grossAmount: source.grossAmount } : {}),
      ...(source.paymentFrequency ? { paymentFrequency: source.paymentFrequency } : {})
    }));

    const sourceNameControl = documentForm.elements.namedItem("sourceName");
    const sourceAddressControl = documentForm.elements.namedItem("sourceAddress");
    const grossAmountControl = documentForm.elements.namedItem("grossAmount");
    const paymentFrequencyControl = documentForm.elements.namedItem("paymentFrequency");
    const sourceName = sourceNameControl && "value" in sourceNameControl ? String(sourceNameControl.value).trim() : "";
    const sourceAddress = sourceAddressControl && "value" in sourceAddressControl ? String(sourceAddressControl.value).trim() : "";
    const grossAmount = grossAmountControl && "value" in grossAmountControl ? numberOrUndefined(String(grossAmountControl.value)) : undefined;
    const paymentFrequency = paymentFrequencyControl && "value" in paymentFrequencyControl ? String(paymentFrequencyControl.value).trim() : "";

    if (sources.length) {
      if (sourceName) sources[0].name = sourceName;
      if (sourceAddress) sources[0].address = sourceAddress;
      if (grossAmount !== undefined) sources[0].grossAmount = grossAmount;
      if (paymentFrequency) sources[0].paymentFrequency = paymentFrequency;
      return sources;
    }

    const source = { sourceType: documentSourceType() };
    if (sourceName) source.name = sourceName;
    if (sourceAddress) source.address = sourceAddress;
    if (grossAmount !== undefined) source.grossAmount = grossAmount;
    if (paymentFrequency) source.paymentFrequency = paymentFrequency;
    return [source];
  }

  function documentRequest(outputFormat) {
    const allSources = documentIncomeSources();
    const scope = documentScope.value;
    const sourceIndex = scope.startsWith("source:") ? Number(scope.slice(7)) : -1;
    const selectedSources = sourceIndex >= 0 && allSources[sourceIndex] ? [allSources[sourceIndex]] : allSources;
    let templateType = guideDocumentGoal || "current_income_statement";
    if (templateType === "auto") templateType = "current_income_statement";
    if (templateType !== "no_current_taxable_income_statement") {
      templateType = selectedSources.length === 1 && selectedSources[0]?.sourceType === "unemployment"
        ? "unemployment_income_statement"
        : "current_income_statement";
    }
    const payload = { templateType, outputFormat };
    for (const name of ["documentDate", "borrowerName", "servicerName", "notes"]) {
      const control = documentForm.elements.namedItem(name);
      const value = control && "value" in control ? String(control.value).trim() : "";
      if (value) payload[name] = value;
    }
    if (templateType !== "no_current_taxable_income_statement") payload.incomeSources = selectedSources;
    return payload;
  }

  async function requestDocument(outputFormat) {
    const response = await fetch("/api/document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(documentRequest(outputFormat))
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Unable to generate document draft.");
    return body.document;
  }

  function syncDocumentActions() {
    const enabled = Boolean(documentDraft) && documentReviewed.checked;
    documentPrint.disabled = !enabled;
    documentDownload.disabled = !enabled;
  }

  async function generateDocumentDraft() {
    documentGenerate.disabled = true;
    documentStatus.textContent = "Generating draft…";
    documentDraft = null;
    documentReviewed.checked = false;
    syncDocumentActions();
    try {
      const [text, html] = await Promise.all([requestDocument("text"), requestDocument("html")]);
      documentDraft = { text, html };
      documentPreview.textContent = text;
      documentDraftArea.hidden = false;
      documentStatus.textContent = "Draft ready. Review every fact before signing or sharing it.";
    } catch (error) {
      documentDraftArea.hidden = true;
      documentStatus.textContent = error instanceof Error ? error.message : "Unable to generate document draft.";
    } finally {
      documentGenerate.disabled = false;
      syncDocumentActions();
    }
  }

  function openGuidedDocumentWorkspace() {
    const primarySource = guidedIncomeSources[0];
    if (primarySource) {
      if (primarySource.name) setDocumentValue("sourceName", primarySource.name);
      if (primarySource.address) setDocumentValue("sourceAddress", primarySource.address);
      if (typeof primarySource.grossAmount === "number") setDocumentValue("grossAmount", primarySource.grossAmount);
      if (primarySource.paymentFrequency) setDocumentValue("paymentFrequency", primarySource.paymentFrequency);
    } else {
      if (guideIncomeAmount !== null && guideIncomeAmount !== undefined) setDocumentValue("grossAmount", guideIncomeAmount);
      if (guideIncomeCadence) setDocumentValue("paymentFrequency", guideIncomeCadence);
    }
    renderIncomeReadiness();
    documentWorkspace.hidden = false;
    documentWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
    void generateDocumentDraft();
  }

  function documentFilename() {
    if (guideDocumentGoal === "unemployment_income_statement") return "unemployment-compensation-income-statement.html";
    if (guideDocumentGoal === "no_current_taxable_income_statement") return "no-current-taxable-income-statement.html";
    return "current-taxable-income-supporting-statement.html";
  }

  const guidePrompts = {
    goal: {
      text: "What would you like help with first?",
      options: [["Could my IBR payment be $0?", "ibr_zero"], ["Estimate my payment", "estimate"], ["Prepare income documents", "documents"], ["Both", "both"]]
    },
    ibr_zero_region: {
      text: "Which poverty-guideline region applies to you? I’ll show the 2026 IBR $0-payment AGI line for family sizes 1–6.",
      options: [["48 states + D.C.", "contiguous_us"], ["Alaska", "alaska"], ["Hawaii", "hawaii"]]
    },
    ibr_zero_followup: {
      text: "Want help preparing the income documentation next?",
      options: [["Prepare stated income document", "current_income_doc"], ["Prepare unemployment statement", "unemployment_doc"], ["Continue to calculator", "calculator"]]
    },
    income_situation: {
      text: "Which best describes your current taxable income situation?",
      options: [["Employment", "employment"], ["Self-employed / contract", "self_employment"], ["Unemployment compensation", "unemployment"], ["Multiple taxable sources", "multiple"], ["No current taxable income", "none"]]
    },
    income_source_type: {
      text: "What type of taxable income source is this? I’ll keep each source separate instead of collapsing them together.",
      options: [["Employment", "employment"], ["Self-employment", "self_employment"], ["Contract / gig income", "contract"], ["Unemployment compensation", "unemployment"], ["Other taxable income", "other"]]
    },
    income_cadence: {
      text: "How often is the income amount for this source paid or received?",
      options: [["Annual", "annual"], ["Monthly", "monthly"], ["Twice monthly", "semimonthly"], ["Every two weeks", "biweekly"], ["Weekly", "weekly"], ["Hourly", "hourly"]]
    },
    income_amount: { text: "What is the gross taxable income amount for this source at that cadence? Type a number, without an SSN or account number.", options: [] },
    source_name: { text: "What payer, employer, agency, client, or source name belongs to this income source? You can leave it as a visible placeholder for the draft, but it will not be application-ready until the source is identified.", options: [["Leave as placeholder", "__skip__"]] },
    source_evidence: { text: "What is the evidence status for this source? This is only your statement about readiness; no evidence file is uploaded or verified here.", options: [["I have recent evidence in hand", "documented"], ["I know what evidence I’ll use", "identified"], ["I still need evidence / review", "missing"]] },
    another_source: { text: "Do you have another current taxable income source to add?", options: [["Yes — add another source", "yes"], ["No — continue", "no"]] },
    doc_borrower_name: { text: "What borrower name should appear on the statement? You can leave it as a visible placeholder and fill it in later.", options: [["Leave as placeholder", "__skip__"]] },
    doc_source_name: { text: "What payer, employer, or unemployment agency name should appear? You can leave it as a visible placeholder.", options: [["Leave as placeholder", "__skip__"]] },
    doc_servicer_name: { text: "What loan servicer name should appear? You can leave it as a visible placeholder and fill it in later.", options: [["Leave as placeholder", "__skip__"]] },
    family_size: { text: "What is your current legacy IDR family size under the support-based definition? You can tap 1–6 or type any valid whole number; there is no six-person cap.", options: [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]] },
    dependents: { text: "How many dependents do you claim on your federal tax return for the RAP dependent reduction? This is intentionally separate from legacy IDR family size.", options: [["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]] },
    region: { text: "Which poverty-guideline region applies to you?", options: [["48 states + D.C.", "contiguous_us"], ["Alaska", "alaska"], ["Hawaii", "hawaii"]] }
  };

  function showGuideStep() {
    guideAnswers.replaceChildren();
    const prompt = guidePrompts[guideStep];
    if (!prompt) return;
    guideSay(prompt.text);
    prompt.options.forEach(([label, value]) => {
      const button = addText("button", label);
      button.type = "button";
      button.addEventListener("click", () => handleGuideAnswer(value, label));
      guideAnswers.appendChild(button);
    });
    guideInput.placeholder = prompt.options.length ? "Or type one of these answers" : "Type your answer";
    guideInput.focus();
  }

  function normalizedChoice(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function resolveTypedChoice(step, rawValue) {
    const normalized = normalizedChoice(rawValue);
    const aliases = {
      goal: { ibr_zero: "ibr_zero", could_my_ibr_payment_be_0: "ibr_zero", zero_payment: "ibr_zero", estimate: "estimate", estimate_my_payment: "estimate", payment: "estimate", documents: "documents", prepare_income_documents: "documents", document: "documents", both: "both" },
      ibr_zero_region: { contiguous_us: "contiguous_us", us: "contiguous_us", mainland: "contiguous_us", _48_states_dc: "contiguous_us", alaska: "alaska", hawaii: "hawaii" },
      ibr_zero_followup: { current_income_doc: "current_income_doc", stated_income: "current_income_doc", prepare_stated_income_document: "current_income_doc", unemployment_doc: "unemployment_doc", unemployment_statement: "unemployment_doc", prepare_unemployment_statement: "unemployment_doc", calculator: "calculator", continue_to_calculator: "calculator" },
      income_situation: { employment: "employment", employed: "employment", job: "employment", self_employed: "self_employment", self_employment: "self_employment", contract: "self_employment", contractor: "self_employment", unemployment: "unemployment", unemployment_compensation: "unemployment", multiple: "multiple", multiple_taxable_sources: "multiple", none: "none", no_income: "none", no_current_taxable_income: "none" },
      income_source_type: { employment: "employment", employed: "employment", self_employment: "self_employment", self_employed: "self_employment", contract: "contract", contractor: "contract", gig: "contract", unemployment: "unemployment", unemployment_compensation: "unemployment", other: "other", other_taxable_income: "other" },
      source_evidence: { documented: "documented", evidence_in_hand: "documented", identified: "identified", evidence_identified: "identified", missing: "missing", need_evidence: "missing", needs_review: "missing" },
      another_source: { yes: "yes", add_another_source: "yes", no: "no", continue: "no" },
      income_cadence: { annual: "annual", annually: "annual", yearly: "annual", monthly: "monthly", semimonthly: "semimonthly", twice_monthly: "semimonthly", biweekly: "biweekly", every_two_weeks: "biweekly", weekly: "weekly", hourly: "hourly" },
      region: { contiguous_us: "contiguous_us", us: "contiguous_us", mainland: "contiguous_us", _48_states_dc: "contiguous_us", alaska: "alaska", hawaii: "hawaii" }
    };
    return aliases[step] ? aliases[step][normalized] : rawValue;
  }

  async function showIbrZeroInfo(region) {
    guideAnswers.replaceChildren();
    guideInput.disabled = true;
    try {
      const response = await fetch("/api/ibr-zero-payment?region=" + encodeURIComponent(region));
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Unable to load IBR quick info.");
      guideSay("For IBR, the estimated payment is $0 when the AGI used for the calculation is at or below 150% of the poverty guideline. Here are the 2026 cutoffs for " + body.regionLabel + ".");
      const table = document.createElement("table");
      table.className = "quick-info";
      const headerRow = document.createElement("tr");
      ["Family size", "$0 IBR AGI cutoff"].forEach((text) => headerRow.appendChild(addText("th", text)));
      const head = document.createElement("thead");
      head.appendChild(headerRow);
      table.appendChild(head);
      const tableBody = document.createElement("tbody");
      body.thresholds.forEach((row) => {
        const tr = document.createElement("tr");
        tr.append(addText("td", String(row.familySize)), addText("td", money.format(row.maxAgiForZeroPayment)));
        tableBody.appendChild(tr);
      });
      table.appendChild(tableBody);
      guideTranscript.appendChild(table);
      if (region === "contiguous_us") {
        const example = addText("div", "$60,000 example: with family size 6, $60,000 is below the 2026 $66,540 IBR $0-payment AGI cutoff, so the formula estimates a $0 monthly IBR payment if the borrower and loans are otherwise IBR-eligible.", "quick-callout");
        guideTranscript.appendChild(example);
      }
      guideSay("Important: these are AGI thresholds, not automatic eligibility guarantees. Loan type/date rules still matter, spouse income can matter depending on the borrower’s situation, annual recertification still applies, and interest may still accrue.");
      guideTranscript.scrollTop = guideTranscript.scrollHeight;
      guideStep = "ibr_zero_followup";
    } catch (error) {
      guideSay(error instanceof Error ? error.message : "Unable to load IBR quick info.");
      guideStep = "goal";
    } finally {
      guideInput.disabled = false;
      showGuideStep();
    }
  }

  function finalizePendingIncomeSource(evidenceStatus) {
    if (!pendingIncomeSource) return;
    pendingIncomeSource.evidenceStatus = evidenceStatus;
    const source = { ...pendingIncomeSource };
    guidedIncomeSources.push(source);
    const sourceNumber = guidedIncomeSources.length;
    const evidenceLabel = evidenceStatusLabel(evidenceStatus);
    recordGuidedFact(
      "income_source_" + sourceNumber,
      "Taxable income source " + sourceNumber,
      sourceTypeLabel(source.sourceType) + " · " + money.format(source.grossAmount) + " · " + source.paymentFrequency + " · " + evidenceLabel
    );
    if (sourceNumber === 1) {
      guideIncomeCadence = source.paymentFrequency;
      guideIncomeAmount = source.grossAmount;
      cadence.value = source.paymentFrequency;
      setCalculatorValue("incomeAmount", source.grossAmount);
      syncHourlyFields();
    }
    pendingIncomeSource = null;
    renderIncomeReadiness();
  }

  function handleGuideAnswer(rawValue, displayValue) {
    const value = resolveTypedChoice(guideStep, rawValue);
    const shown = displayValue || String(rawValue).trim();
    if (!shown) return;

    if (guideStep === "income_amount") {
      const amount = numericValue(shown);
      if (amount === undefined || amount < 0) {
        guideSay("Please enter a valid non-negative gross income amount.");
        return;
      }
      guideSay(shown, "user");
      if (!pendingIncomeSource) pendingIncomeSource = { sourceType: documentSourceType() };
      pendingIncomeSource.grossAmount = amount;
      pendingIncomeSource.paymentFrequency = guideIncomeCadence;
      guideStep = "source_name";
    } else if (guideStep === "source_name") {
      guideSay(shown, "user");
      if (!pendingIncomeSource) pendingIncomeSource = { sourceType: documentSourceType(), paymentFrequency: guideIncomeCadence, grossAmount: guideIncomeAmount };
      if (value !== "__skip__") pendingIncomeSource.name = shown;
      guideStep = "source_evidence";
    } else if (guideStep === "source_evidence") {
      if (!["documented", "identified", "missing"].includes(value)) {
        guideSay("Choose evidence in hand, evidence identified, or needs evidence / review.");
        return;
      }
      guideSay(shown, "user");
      finalizePendingIncomeSource(value);
      guideStep = collectMultipleSources ? "another_source" : guideDocumentGoal ? "doc_borrower_name" : "family_size";
    } else if (guideStep === "another_source") {
      if (!["yes", "no"].includes(value)) {
        guideSay("Choose whether to add another current taxable income source.");
        return;
      }
      guideSay(shown, "user");
      if (value === "yes") {
        pendingIncomeSource = null;
        guideStep = "income_source_type";
      } else {
        collectMultipleSources = false;
        guideStep = guideDocumentGoal ? "doc_borrower_name" : "family_size";
      }
    } else if (guideStep === "income_source_type") {
      if (!["employment", "self_employment", "contract", "unemployment", "other"].includes(value)) {
        guideSay("Choose employment, self-employment, contract/gig income, unemployment compensation, or other taxable income.");
        return;
      }
      guideSay(shown, "user");
      pendingIncomeSource = { sourceType: value };
      guideIncomeSituation = value;
      guideStep = "income_cadence";
    } else if (guideStep === "family_size" || guideStep === "dependents") {
      const count = Number(value);
      const minimum = guideStep === "family_size" ? 1 : 0;
      if (!Number.isInteger(count) || count < minimum) {
        guideSay("Please enter a valid whole number" + (minimum ? " of at least 1." : " of 0 or more."));
        return;
      }
      guideSay(shown, "user");
      if (guideStep === "family_size") {
        setCalculatorValue("familySize", count);
        recordGuidedFact("family_size", "Legacy IDR family size", String(count));
        guideStep = "dependents";
      } else {
        setCalculatorValue("dependents", count);
        recordGuidedFact("dependents", "Federal tax-return dependents for RAP", String(count));
        guideStep = "region";
      }
    } else if (guideStep === "goal") {
      if (!["ibr_zero", "estimate", "documents", "both"].includes(value)) {
        guideSay("Choose the IBR $0 quick check, estimate, documents, or both.");
        return;
      }
      guideSay(shown, "user");
      if (value === "ibr_zero") {
        recordGuidedFact("goal", "Requested help", "IBR $0-payment quick check");
        guideStep = "ibr_zero_region";
      } else {
        recordGuidedFact("goal", "Requested help", value === "both" ? "Payment estimate and income-document help" : value === "documents" ? "Income-document help" : "Payment estimate");
        guideDocumentGoal = value === "documents" || value === "both" ? "auto" : null;
        guideContinueToCalculator = value === "both";
        guideStep = "income_situation";
      }
    } else if (guideStep === "ibr_zero_region") {
      if (!["contiguous_us", "alaska", "hawaii"].includes(value)) {
        guideSay("Choose 48 states + D.C., Alaska, or Hawaii.");
        return;
      }
      guideSay(shown, "user");
      setCalculatorValue("region", value);
      recordGuidedFact("region", "Poverty-guideline region", shown);
      void showIbrZeroInfo(value);
      return;
    } else if (guideStep === "ibr_zero_followup") {
      if (!["current_income_doc", "unemployment_doc", "calculator"].includes(value)) {
        guideSay("Choose stated income document, unemployment statement, or continue to calculator.");
        return;
      }
      guideSay(shown, "user");
      if (value === "current_income_doc") {
        guideDocumentGoal = "current_income_statement";
        guideContinueToCalculator = false;
        recordGuidedFact("document_goal", "Requested document", "Current / stated income supporting statement");
        guideStep = "income_situation";
      } else if (value === "unemployment_doc") {
        guideDocumentGoal = "unemployment_income_statement";
        guideContinueToCalculator = false;
        guideIncomeSituation = "unemployment";
        recordGuidedFact("document_goal", "Requested document", "Unemployment compensation income statement");
        recordGuidedFact("income_situation", "Current income situation", "Unemployment compensation");
        guideStep = "income_cadence";
      } else {
        guideDocumentGoal = null;
        guideContinueToCalculator = false;
        guideStep = "income_situation";
      }
    } else if (guideStep === "doc_borrower_name" || guideStep === "doc_source_name" || guideStep === "doc_servicer_name") {
      guideSay(shown, "user");
      if (guideStep === "doc_borrower_name") {
        if (value !== "__skip__") {
          setDocumentValue("borrowerName", shown);
          recordGuidedFact("document_borrower_name", "Document borrower name", shown);
        }
        guideStep = "doc_servicer_name";
      } else if (guideStep === "doc_source_name") {
        if (value !== "__skip__") {
          setDocumentValue("sourceName", shown);
          recordGuidedFact("document_source_name", "Document payer / employer / agency", shown);
        }
        guideStep = "doc_servicer_name";
      } else {
        if (value !== "__skip__") {
          setDocumentValue("servicerName", shown);
          recordGuidedFact("document_servicer_name", "Document loan servicer", shown);
        }
        guideInput.value = "";
        guideAnswers.replaceChildren();
        guideSay("Your draft is ready for review below. Missing facts remain visible placeholders. Review or edit the fields, generate again if needed, then explicitly confirm your review before print/download controls are enabled.");
        openGuidedDocumentWorkspace();
        if (guideContinueToCalculator) {
          guideSay("You also asked for a payment estimate, so I’ll continue collecting the remaining calculator facts here.");
          guideStep = "family_size";
          showGuideStep();
        } else {
          guideStep = "document_ready";
        }
        return;
      }
    } else if (guideStep === "income_situation") {
      if (!["employment", "self_employment", "unemployment", "multiple", "none"].includes(value)) {
        guideSay("Choose employment, self-employed/contract, unemployment compensation, multiple taxable sources, or no current taxable income.");
        return;
      }
      guideSay(shown, "user");
      guideIncomeSituation = value;
      guidedIncomeSources = [];
      pendingIncomeSource = null;
      collectMultipleSources = value === "multiple";
      const labels = { employment: "Employment", self_employment: "Self-employment / contract", unemployment: "Unemployment compensation", multiple: "Multiple taxable sources", none: "No current taxable income" };
      recordGuidedFact("income_situation", "Current income situation", labels[value]);
      if (guideDocumentGoal === "auto") {
        guideDocumentGoal = value === "unemployment" ? "unemployment_income_statement" : value === "none" ? "no_current_taxable_income_statement" : "current_income_statement";
      } else if (guideDocumentGoal && value === "unemployment") {
        guideDocumentGoal = "unemployment_income_statement";
      } else if (guideDocumentGoal && value === "none") {
        guideDocumentGoal = "no_current_taxable_income_statement";
      }
      if (value === "none") {
        setCalculatorValue("cadence", "annual");
        setCalculatorValue("incomeAmount", 0);
        guideIncomeCadence = "annual";
        guideIncomeAmount = 0;
        recordGuidedFact("income_amount", "Current gross taxable income", money.format(0));
        cadence.value = "annual";
        syncHourlyFields();
        renderIncomeReadiness();
        guideStep = guideDocumentGoal ? "doc_borrower_name" : "family_size";
      } else if (value === "multiple") {
        guideStep = "income_source_type";
      } else {
        pendingIncomeSource = { sourceType: value === "self_employment" ? "self_employment" : value };
        guideStep = "income_cadence";
      }
    } else if (guideStep === "income_cadence") {
      if (!["annual", "monthly", "semimonthly", "biweekly", "weekly", "hourly"].includes(value)) {
        guideSay("Choose annual, monthly, twice monthly, every two weeks, weekly, or hourly.");
        return;
      }
      guideSay(shown, "user");
      cadence.value = value;
      guideIncomeCadence = value;
      if (!pendingIncomeSource) pendingIncomeSource = { sourceType: documentSourceType() };
      pendingIncomeSource.paymentFrequency = value;
      syncHourlyFields();
      guideStep = "income_amount";
    } else if (guideStep === "region") {
      if (!["contiguous_us", "alaska", "hawaii"].includes(value)) {
        guideSay("Choose 48 states + D.C., Alaska, or Hawaii.");
        return;
      }
      guideSay(shown, "user");
      setCalculatorValue("region", value);
      recordGuidedFact("region", "Poverty-guideline region", shown);
      guideStep = "done";
    }

    guideInput.value = "";
    if (guideStep === "done") {
      guideAnswers.replaceChildren();
      guideSay("Your confirmed facts are now prefilled in the calculator. Review them, add or import your loan facts, then calculate. Document drafts, when requested, use this same confirmed fact ledger and keep missing information as explicit placeholders.");
      return;
    }
    showGuideStep();
  }

  guideForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleGuideAnswer(guideInput.value);
  });

  documentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void generateDocumentDraft();
  });
  documentReviewed.addEventListener("change", syncDocumentActions);
  documentScope.addEventListener("change", () => {
    documentDraft = null;
    documentReviewed.checked = false;
    documentDraftArea.hidden = true;
    syncDocumentActions();
  });
  addIncomeSource.addEventListener("click", () => {
    collectMultipleSources = true;
    pendingIncomeSource = null;
    guideStep = "income_source_type";
    guideSay("Add another source here. I’ll keep its facts and evidence readiness separate from the sources already confirmed.");
    showGuideStep();
    documentWorkspace.hidden = true;
    document.getElementById("guided-assistant").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  documentDownload.addEventListener("click", () => {
    if (!documentDraft || !documentReviewed.checked) return;
    const blob = new Blob([documentDraft.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = documentFilename();
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  documentPrint.addEventListener("click", () => {
    if (!documentDraft || !documentReviewed.checked) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      documentStatus.textContent = "Your browser blocked the print window. Allow pop-ups for this page and try again.";
      return;
    }
    printWindow.document.open();
    printWindow.document.write(documentDraft.html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  });

  cadence.addEventListener("change", syncHourlyFields);
  syncHourlyFields();
  guideSay("I can help turn your answers into clearly labeled application facts and a repayment estimate. You can use the bubbles or type.");
  showGuideStep();

  loanFile.addEventListener("change", async () => {
    importedPortfolio = null;
    portfolioSummary.replaceChildren();
    const file = loanFile.files && loanFile.files[0];
    if (!file) {
      importStatus.textContent = "No loan file loaded. Manual loan fields remain available below.";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      importStatus.textContent = "That file is larger than the 2 MiB local-import limit.";
      loanFile.value = "";
      return;
    }
    try {
      const text = await file.text();
      const portfolio = parseStudentAidData(text);
      if (!portfolio.loans.length) throw new Error("No active loan records with an outstanding principal balance were found.");
      importedPortfolio = portfolio;
      renderPortfolio(portfolio);
      importStatus.textContent = "Portfolio loaded locally. The raw StudentAid.gov file has not been uploaded.";
    } catch (error) {
      importStatus.textContent = error instanceof Error ? error.message : "Unable to read that loan-data file.";
      loanFile.value = "";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "Calculating…";
    results.replaceChildren();

    try {
      const data = new FormData(form);
      const selectedPlans = data.getAll("plans").map(String);
      if (!selectedPlans.length) throw new Error("Select at least one repayment plan.");

      const cadenceValue = String(data.get("cadence"));
      const amount = Number(data.get("incomeAmount"));
      const guidedCalculatorIncome = guidedIncomeSources
        .filter((source) => typeof source.grossAmount === "number" && source.paymentFrequency)
        .map((source) => source.paymentFrequency === "hourly"
          ? { cadence: "hourly", hourlyRate: source.grossAmount, hoursPerWeek: Number(data.get("hoursPerWeek")), weeksPerYear: Number(data.get("weeksPerYear")) }
          : { cadence: source.paymentFrequency, amount: source.grossAmount });
      const income = guidedCalculatorIncome.length
        ? guidedCalculatorIncome
        : cadenceValue === "hourly"
          ? [{ cadence: cadenceValue, hourlyRate: amount, hoursPerWeek: Number(data.get("hoursPerWeek")), weeksPerYear: Number(data.get("weeksPerYear")) }]
          : [{ cadence: cadenceValue, amount }];

      const payload = {
        income,
        region: String(data.get("region")),
        familySize: Number(data.get("familySize")),
        dependentsClaimedOnFederalTaxReturn: Number(data.get("dependents")),
        plans: selectedPlans
      };

      const adjustments = numberOrUndefined(String(data.get("adjustments")));
      const agiOverride = numberOrUndefined(String(data.get("agiOverride")));
      const taxFilingStatus = String(data.get("taxFilingStatus"));
      if (adjustments !== undefined) payload.estimatedAboveTheLineAdjustments = adjustments;
      if (agiOverride !== undefined) payload.adjustedGrossIncomeOverride = agiOverride;
      if (taxFilingStatus) payload.taxFilingStatus = taxFilingStatus;

      const loan = {};
      const principal = numberOrUndefined(String(data.get("principal")));
      const interestRate = numberOrUndefined(String(data.get("interestRate")));
      const loanType = String(data.get("loanType"));
      const ibrNewBorrower = String(data.get("ibrNewBorrower"));
      if (importedPortfolio) {
        if (importedPortfolio.repaymentLoans.length) loan.repaymentLoans = importedPortfolio.repaymentLoans;
        if (importedPortfolio.eligibilityLoans) loan.eligibilityLoans = importedPortfolio.eligibilityLoans;
      } else {
        if (principal !== undefined) loan.principal = principal;
        if (interestRate !== undefined) loan.annualInterestRatePercent = interestRate;
        if (loanType) {
          loan.eligibilityLoans = [{
            loanType,
            disbursementPeriod: String(data.get("disbursementPeriod"))
          }];
        }
      }
      if (ibrNewBorrower) loan.newBorrowerOnOrAfterJuly1_2014 = ibrNewBorrower === "true";
      if (Object.keys(loan).length) payload.loan = loan;

      const response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Calculation failed.");
      render(body.result);
      status.textContent = "Estimate ready.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Calculation failed.";
    } finally {
      submit.disabled = false;
    }
  });
})();
</script>
</body>
</html>`;

function ibrZeroPaymentResponse(request: Request, env: Env): Response {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return jsonResponse({ ok: false, error: "Cross-origin quick-info requests are not allowed." }, 403, request, env, { "cache-control": "no-store" });
  }
  const region = new URL(request.url).searchParams.get("region") ?? "contiguous_us";
  if (!(["contiguous_us", "alaska", "hawaii"] as const).includes(region as Region)) {
    return jsonResponse({ ok: false, error: "Unknown poverty-guideline region." }, 400, request, env, { "cache-control": "no-store" });
  }
  const typedRegion = region as Region;
  const regionLabel = typedRegion === "contiguous_us" ? "48 states + D.C." : typedRegion === "alaska" ? "Alaska" : "Hawaii";
  const thresholds = Array.from({ length: 6 }, (_, index) => ({
    familySize: index + 1,
    maxAgiForZeroPayment: ibrZeroPaymentAgiThreshold(typedRegion, index + 1)
  }));
  return jsonResponse({
    ok: true,
    plan: "IBR",
    policySnapshot: "2026-08-27",
    region: typedRegion,
    regionLabel,
    rule: "Estimated IBR payment is $0 when the AGI used for IBR is at or below 150% of the applicable poverty guideline.",
    thresholds
  }, 200, request, env, { "cache-control": "no-store" });
}

function uiResponse(): Response {
  return new Response(BORROWER_UI_HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    }
  });
}

async function handleDocumentApi(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return jsonResponse({ ok: false, error: "Cross-origin document requests are not allowed." }, 403, request, env, { "cache-control": "no-store" });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return jsonResponse({ ok: false, error: "Content-Type must be application/json." }, 415, request, env, { "cache-control": "no-store" });
  }

  if (env.MCP_RATE_LIMITER) {
    try {
      const { success } = await env.MCP_RATE_LIMITER.limit({ key: "public:/api/document" });
      if (!success) return jsonResponse({ ok: false, error: "Rate limit exceeded." }, 429, request, env, { "cache-control": "no-store" });
    } catch {
      return jsonResponse({ ok: false, error: "Rate limiter unavailable." }, 503, request, env, { "cache-control": "no-store" });
    }
  }

  let text: string;
  try {
    text = (await readRequestText(request)).text;
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return jsonResponse({ ok: false, error: `Request body exceeds ${MAX_REQUEST_BYTES} bytes.` }, 413, request, env, { "cache-control": "no-store" });
    }
    return jsonResponse({ ok: false, error: "Unable to read request body." }, 400, request, env, { "cache-control": "no-store" });
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON." }, 400, request, env, { "cache-control": "no-store" });
  }

  const documentDefinition = toolDefinitions.find((tool) => tool.name === "get_repayment_documentation_template")!;
  const issues = validateSchema(body, documentDefinition.inputSchema as RuntimeSchema);
  if (issues.length > 0) {
    return jsonResponse({ ok: false, error: "Invalid document input.", issues }, 400, request, env, { "cache-control": "no-store" });
  }

  try {
    const requestBody = body as TemplateRequest;
    return jsonResponse({ ok: true, format: requestBody.outputFormat ?? "markdown", document: getDocumentationTemplate(requestBody) }, 200, request, env, { "cache-control": "no-store" });
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Document generation failed." }, 400, request, env, { "cache-control": "no-store" });
  }
}

async function handleCalculatorApi(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return jsonResponse({ ok: false, error: "Cross-origin calculator requests are not allowed." }, 403, request, env, { "cache-control": "no-store" });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return jsonResponse({ ok: false, error: "Content-Type must be application/json." }, 415, request, env, { "cache-control": "no-store" });
  }

  if (env.MCP_RATE_LIMITER) {
    try {
      const { success } = await env.MCP_RATE_LIMITER.limit({ key: "public:/api/calculate" });
      if (!success) return jsonResponse({ ok: false, error: "Rate limit exceeded." }, 429, request, env, { "cache-control": "no-store" });
    } catch {
      return jsonResponse({ ok: false, error: "Rate limiter unavailable." }, 503, request, env, { "cache-control": "no-store" });
    }
  }

  let text: string;
  try {
    text = (await readRequestText(request)).text;
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return jsonResponse({ ok: false, error: `Request body exceeds ${MAX_REQUEST_BYTES} bytes.` }, 413, request, env, { "cache-control": "no-store" });
    }
    return jsonResponse({ ok: false, error: "Unable to read request body." }, 400, request, env, { "cache-control": "no-store" });
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON." }, 400, request, env, { "cache-control": "no-store" });
  }

  const calculatorDefinition = toolDefinitions.find((tool) => tool.name === "calculate_alt_income_student_loan")!;
  const issues = validateSchema(body, calculatorDefinition.inputSchema as RuntimeSchema);
  if (issues.length > 0) {
    return jsonResponse({ ok: false, error: "Invalid calculator input.", issues }, 400, request, env, { "cache-control": "no-store" });
  }

  try {
    return jsonResponse({ ok: true, result: calculateRepayment(body as CalculatorRequest) }, 200, request, env, { "cache-control": "no-store" });
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Calculation failed." }, 400, request, env, { "cache-control": "no-store" });
  }
}

const hasOwn = (value: JsonObject, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

function allowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  const allowlist = (env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowlist.includes(origin);
}

function responseHeaders(request: Request, env: Env): Headers {
  const headers = new Headers(JSON_HEADERS);
  const origin = request.headers.get("origin");
  if (origin !== null && allowedOrigin(request, env)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return headers;
}

function jsonRpcResultObject(id: string | number, result: unknown): JsonObject {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcErrorObject(id: JsonRpcId, code: number, message: string, data?: unknown): JsonObject {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function jsonResponse(payload: unknown, status: number, request: Request, env: Env, extraHeaders?: Record<string, string>): Response {
  const headers = responseHeaders(request, env);
  for (const [key, value] of Object.entries(extraHeaders ?? {})) headers.set(key, value);
  return new Response(JSON.stringify(payload), { status, headers });
}

function contentResult(value: unknown): { content: { type: "text"; text: string }[]; structuredContent: unknown } {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

function validateSchema(value: unknown, schema: RuntimeSchema, path = "arguments"): string[] {
  const issues: string[] = [];

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
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(`${path} must contain at least ${schema.minItems} item(s).`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(`${path} must contain at most ${schema.maxItems} item(s).`);
    if (schema.items) value.forEach((item, index) => issues.push(...validateSchema(item, schema.items!, `${path}[${index}]`)));
    return issues;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") return [`${path} must be a string.`];
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(`${path} exceeds the maximum length of ${schema.maxLength}.`);
    return issues;
  }

  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return [`${path} must be a finite ${schema.type}.`];
    if (schema.type === "integer" && !Number.isInteger(value)) issues.push(`${path} must be an integer.`);
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(`${path} must be greater than or equal to ${schema.minimum}.`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) issues.push(`${path} must be greater than ${schema.exclusiveMinimum}.`);
    return issues;
  }

  if (schema.type === "boolean" && typeof value !== "boolean") issues.push(`${path} must be a boolean.`);
  return issues;
}

function validateInitializeParams(value: unknown): string[] {
  if (!isObject(value)) return ["params must be an object."];
  const issues: string[] = [];
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

function isJsonRpcResponse(value: unknown): boolean {
  if (!isObject(value) || value.jsonrpc !== "2.0") return false;
  const id = value.id;
  if (typeof id !== "string" && typeof id !== "number") return false;
  return hasOwn(value, "result") !== hasOwn(value, "error") && !hasOwn(value, "method");
}

async function handleJsonRpcMessage(value: unknown, batched: boolean): Promise<JsonObject | null> {
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
    const requestedVersion = (value.params as JsonObject).protocolVersion as string;
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
    const issues = validateSchema(toolArguments, definition.inputSchema as RuntimeSchema);
    if (issues.length > 0) return jsonRpcErrorObject(id, -32602, "Invalid tool arguments", { issues });

    try {
      if (params.name === "calculate_alt_income_student_loan") {
        return jsonRpcResultObject(id, contentResult(calculateRepayment(toolArguments as CalculatorRequest)));
      }
      if (params.name === "get_repayment_documentation_template") {
        return jsonRpcResultObject(id, contentResult(getDocumentationTemplate(toolArguments as TemplateRequest)));
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

async function readRequestText(request: Request): Promise<{ text: string; bytes: number }> {
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

function requestMetadata(value: unknown): { method: string; tool?: string } {
  if (Array.isArray(value)) return { method: "batch" };
  if (!isObject(value) || typeof value.method !== "string") return { method: "invalid" };
  if (value.method === "tools/call" && isObject(value.params) && typeof value.params.name === "string") {
    return { method: value.method, tool: value.params.name };
  }
  return { method: value.method };
}

function logRequest(event: { method: string; tool?: string; httpStatus: number; requestBytes: number; durationMs: number }): void {
  console.log(JSON.stringify({
    service: "student-loan-idr-mcp",
    version: SERVER_VERSION,
    event: "mcp_request",
    method: event.method,
    ...(event.tool === undefined ? {} : { tool: event.tool }),
    http_status: event.httpStatus,
    request_bytes: event.requestBytes,
    duration_ms: event.durationMs
  }));
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  let requestBytes = 0;
  let metadata: { method: string; tool?: string } = { method: "unparsed" };
  const finish = (response: Response): Response => {
    logRequest({ ...metadata, httpStatus: response.status, requestBytes, durationMs: Date.now() - startedAt });
    return response;
  };

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
      if (!success) return finish(jsonResponse(jsonRpcErrorObject(null, -32000, "Rate limit exceeded"), 429, request, env));
    } catch {
      return finish(jsonResponse(jsonRpcErrorObject(null, -32603, "Rate limiter unavailable"), 503, request, env));
    }
  }

  let text: string;
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

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return finish(jsonResponse(jsonRpcErrorObject(null, -32700, "Parse error"), 200, request, env));
  }
  metadata = requestMetadata(body);

  if (Array.isArray(body)) {
    if (body.length === 0) return finish(jsonResponse(jsonRpcErrorObject(null, -32600, "Invalid Request"), 200, request, env));
    const responses: JsonObject[] = [];
    for (const item of body) {
      const response = await handleJsonRpcMessage(item, true);
      if (response) responses.push(response);
    }
    if (responses.length === 0) return finish(new Response(null, { status: 202, headers: responseHeaders(request, env) }));
    return finish(jsonResponse(responses, 200, request, env));
  }

  const response = await handleJsonRpcMessage(body, false);
  if (!response) return finish(new Response(null, { status: 202, headers: responseHeaders(request, env) }));
  return finish(jsonResponse(response, 200, request, env));
}

function home(request: Request, env: Env): Response {
  return jsonResponse({
    ok: true,
    name: "student-loan-idr-mcp",
    version: SERVER_VERSION,
    protocol_version: SUPPORTED_PROTOCOL_VERSION,
    policy_snapshot: "2026-08-27",
    tools: toolDefinitions.map((tool) => tool.name),
    endpoints: ["GET /", "GET /health", "GET /api/ibr-zero-payment", "POST /api/calculate", "POST /api/document", "POST /mcp", "POST /api/advisor/register", "POST /api/advisor/login", "GET /api/advisor/session", "GET|POST /api/advisor/clients", "GET|PUT|DELETE /api/advisor/clients/:clientId"],
    advisor_workspace: {
      persistence: env.ADVISOR_DB ? "d1" : "unconfigured",
      authentication: "server_session_cookie",
      owner_scoped_client_crud: Boolean(env.ADVISOR_DB),
      raw_student_aid_retention: false
    },
    hardening: {
      max_request_bytes: MAX_REQUEST_BYTES,
      bearer_auth_configured: Boolean(env.MCP_BEARER_TOKEN),
      origin_allowlist_configured: Boolean(env.MCP_ALLOWED_ORIGINS),
      rate_limit_configured: Boolean(env.MCP_RATE_LIMITER),
      sensitive_payload_logging: false
    }
  }, 200, request, env);
}

export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname === "/mcp") {
      if (!allowedOrigin(request, env)) return jsonResponse(jsonRpcErrorObject(null, -32600, "Forbidden Origin"), 403, request, env);
      return new Response(null, { status: 204, headers: responseHeaders(request, env) });
    }
    if (request.method === "GET" && url.pathname === "/") return uiResponse();
    if (request.method === "GET" && url.pathname === "/health") return home(request, env);
    if (request.method === "GET" && url.pathname === "/api/ibr-zero-payment") return ibrZeroPaymentResponse(request, env);
    if (url.pathname.startsWith("/api/advisor/")) return handleAdvisorApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/calculate") return handleCalculatorApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/document") return handleDocumentApi(request, env);
    if (url.pathname === "/mcp" && request.method === "GET") {
      if (!allowedOrigin(request, env)) return jsonResponse(jsonRpcErrorObject(null, -32600, "Forbidden Origin"), 403, request, env);
      return new Response("SSE listening is not implemented by this stateless server.", { status: 405, headers: { allow: "POST, OPTIONS" } });
    }
    if (request.method === "POST" && url.pathname === "/mcp") return handleMcp(request, env);
    return new Response("Not Found", { status: 404 });
  }
};
