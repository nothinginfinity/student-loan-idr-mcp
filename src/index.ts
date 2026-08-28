import { calculateRepayment, getPolicyStatus } from "./formulas.ts";
import { getDocumentationTemplate } from "./templates.ts";
import type { CalculatorRequest, TemplateRequest } from "./types.ts";

const SERVER_VERSION = "0.6.0";
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
    input, select, button { font: inherit; }
    input, select { width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); background: Canvas; color: CanvasText; }
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
    .basis { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 8px; font-size: .78rem; font-weight: 750; border: 1px solid currentColor; margin-right: 6px; }
    .fact-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .fact { border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius: 12px; padding: 12px; }
    .fact strong { display: block; margin-bottom: 4px; }
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
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const numberOrUndefined = (value) => value === "" ? undefined : Number(value);
  let importedPortfolio = null;

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
      if (value.includes("UNSUBSID")) return "ffel_unsubsidized_stafford";
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

  cadence.addEventListener("change", syncHourlyFields);
  syncHourlyFields();

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
      const income = cadenceValue === "hourly"
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
    endpoints: ["GET /", "GET /health", "POST /api/calculate", "POST /mcp"],
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
    if (request.method === "POST" && url.pathname === "/api/calculate") return handleCalculatorApi(request, env);
    if (url.pathname === "/mcp" && request.method === "GET") {
      if (!allowedOrigin(request, env)) return jsonResponse(jsonRpcErrorObject(null, -32600, "Forbidden Origin"), 403, request, env);
      return new Response("SSE listening is not implemented by this stateless server.", { status: 405, headers: { allow: "POST, OPTIONS" } });
    }
    if (request.method === "POST" && url.pathname === "/mcp") return handleMcp(request, env);
    return new Response("Not Found", { status: 404 });
  }
};
