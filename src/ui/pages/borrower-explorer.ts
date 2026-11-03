// V0.9.11 presentation layer. All payment math remains in /api/calculate.
export const BORROWER_EXPLORER_MARKUP = String.raw`
<section class="income-explorer" aria-labelledby="income-explorer-heading">
  <div class="explorer-intro">
    <span class="basis">V0.9.12 · Repayment sandbox</span>
    <h2 id="income-explorer-heading">Explore one repayment plan at a time</h2>
    <p class="muted">Adjust the household facts and switch plans. Every amount comes from the existing repayment calculator; a modeled payment is not an eligibility decision or servicer bill.</p>
  </div>
  <div class="explorer-plan-tabs" role="group" aria-label="Choose repayment plan">
    <button type="button" class="explorer-plan-tab" data-explorer-plan="RAP" aria-pressed="true">RAP</button>
    <button type="button" class="explorer-plan-tab" data-explorer-plan="IBR" aria-pressed="false">IBR</button>
    <button type="button" class="explorer-plan-tab" data-explorer-plan="PAYE" aria-pressed="false">PAYE</button>
    <button type="button" class="explorer-plan-tab" data-explorer-plan="ICR" aria-pressed="false">ICR</button>
  </div>
  <div class="explorer-grid">
    <div class="explorer-controls">
      <div class="explorer-slider-field">
        <label for="explorer-income">Annual gross taxable income</label>
        <div class="explorer-amount"><span aria-hidden="true">$</span><input id="explorer-income" type="number" inputmode="decimal" min="0" max="1000000" step="1000" value="50000" aria-describedby="explorer-income-help"></div>
        <input id="explorer-range" aria-label="Annual income slider" type="range" min="0" max="200000" step="1000" value="50000">
        <div class="explorer-range-ends"><span>$0</span><span>$200k</span></div>
        <p id="explorer-income-help" class="muted">Annual income only. Guided multi-source income takes priority when present.</p>
      </div>
      <div class="explorer-slider-field">
        <label for="explorer-family">Legacy IDR family size</label>
        <div class="explorer-compact-field"><input id="explorer-family" type="number" inputmode="numeric" min="1" step="1" value="1" aria-describedby="explorer-family-help"><span class="muted">people</span></div>
        <input id="explorer-family-range" aria-label="Family size slider from one to twelve" type="range" min="1" max="12" step="1" value="1">
        <p id="explorer-family-help" class="muted">The slider covers 1–12; type a larger supported size if needed.</p>
      </div>
      <div class="explorer-slider-field">
        <label for="explorer-dependents">Dependents on federal tax return</label>
        <div class="explorer-compact-field"><input id="explorer-dependents" type="number" inputmode="numeric" min="0" step="1" value="0"><span class="muted">dependents</span></div>
        <input id="explorer-dependents-range" aria-label="Claimed dependents slider from zero to eight" type="range" min="0" max="8" step="1" value="0">
        <p class="muted">Separate from family size; used by RAP.</p>
      </div>
      <div class="explorer-slider-field">
        <label for="explorer-filing">Tax filing status</label>
        <select id="explorer-filing">
          <option value="">Not supplied</option>
          <option value="single">Single</option>
          <option value="married_filing_jointly">Married filing jointly</option>
          <option value="married_filing_separately">Married filing separately</option>
          <option value="head_of_household">Head of household</option>
        </select>
        <p class="muted">Used when relevant to a selected plan; does not replace eligibility screening.</p>
      </div>
      <button id="explorer-run" type="button">Update repayment estimate</button>
    </div>
    <div class="explorer-result" aria-live="polite" aria-atomic="true">
      <span class="basis" id="explorer-plan-heading">RAP · monthly estimate</span>
      <strong id="explorer-amount-result">Not calculated</strong>
      <span id="explorer-eligibility" class="explorer-eligibility">Eligibility not assessed</span>
      <p id="explorer-result-status">Change a control to calculate with the existing Worker.</p>
      <div id="explorer-plan-detail" class="explorer-plan-detail"></div>
      <details class="explorer-disclosure"><summary>Assumptions and plan warnings</summary><ul id="explorer-warnings"></ul></details>
      <button type="button" id="explorer-view-analysis" disabled>View full analysis</button>
    </div>
  </div>
  <p id="explorer-advisor-note" class="muted" hidden>Advisor mode: this sandbox is read-only. Use Save progress and Calculate estimate to preserve client history.</p>
</section>
`;
export const BORROWER_EXPLORER_CSS = String.raw`
.income-explorer { border: 1px solid color-mix(in srgb, #0f6e56 30%, Canvas); border-radius: 22px; padding: clamp(16px,4vw,28px); margin: 10px 0 24px; background: color-mix(in srgb,#0f6e56 5%,Canvas); }
.explorer-intro h2 { margin: 6px 0; font-size: clamp(1.4rem,5vw,2.1rem); line-height: 1.15; letter-spacing: -.03em; }
.explorer-intro p { max-width: 72ch; }
.explorer-plan-tabs { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 6px; margin: 16px 0; }
.explorer-plan-tab { border-radius: 12px; background: Canvas; color: CanvasText; border: 1px solid var(--line); min-height: 46px; padding: 8px; }
.explorer-plan-tab[aria-pressed="true"] { background:#0f6e56; color:white; border-color:#0f6e56; }
.explorer-plan-tab:focus-visible, .explorer-controls input:focus-visible, .explorer-controls select:focus-visible { outline: 3px solid #0f6e56; outline-offset: 2px; }
.explorer-grid { display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap:16px; align-items:start; }
.explorer-controls,.explorer-result { min-width:0; border: 1px solid var(--line); padding:20px; border-radius:18px; background:Canvas; }
.explorer-controls { display:grid; gap:16px; }
.explorer-slider-field { display:grid; gap:4px; padding-bottom:12px; border-bottom:1px solid var(--line); }
.explorer-slider-field label { font-weight:750; }
.explorer-slider-field p { font-size:.78rem; margin:1px 0; }
.explorer-amount { display:flex; align-items:center; gap:6px; font-size:1.6rem; font-weight:800; }
.explorer-amount input { font-size:1.45rem; font-weight:800; min-width:0; }
.explorer-compact-field { display:flex; align-items:center; gap:12px; }
.explorer-compact-field input { width:112px; }
#explorer-range,#explorer-family-range,#explorer-dependents-range { width:100%; accent-color:#0f6e56; cursor:pointer; min-height:44px; }
.explorer-range-ends { display:flex; justify-content:space-between; font-size:.8rem; opacity:.75; }
.explorer-result { display:flex; flex-direction:column; gap:12px; position:sticky; top:82px; }
#explorer-amount-result { font-size:clamp(2rem,6vw,3.1rem); line-height:1.1; overflow-wrap:anywhere; }
.explorer-eligibility { font-size:.82rem; font-weight:750; }
#explorer-result-status { font-size:.88rem; margin:0; color:color-mix(in srgb,CanvasText 70%,transparent); }
.explorer-plan-detail { font-size:.87rem; }
.explorer-plan-detail p { margin:0 0 8px; }
.explorer-disclosure { font-size:.84rem; }
.explorer-disclosure summary { cursor:pointer; font-weight:700; }
.explorer-disclosure ul { padding-left:20px; }
#explorer-run,#explorer-view-analysis { min-height:46px; }
#explorer-view-analysis { margin-top:8px; background:#0f6e56; color:#fff; }
@media(max-width:700px) { .explorer-grid { grid-template-columns:1fr; } .explorer-controls,.explorer-result { padding:14px; } .explorer-result { position:static; } .income-explorer { margin-top:0; } .step-rail { grid-template-columns:repeat(4,minmax(0,1fr));gap:3px; } .step-tab { font-size:.69rem;padding:9px 3px;min-height:48px; } }
@media(prefers-reduced-motion:reduce) { .income-explorer * { scroll-behavior:auto; } }
`;
export const BORROWER_EXPLORER_SCRIPT = String.raw`(() => {
  const form = document.getElementById("calculator-form");
  if (!form) return;
  const source = (name) => form.elements.namedItem(name);
  const amount = document.getElementById("explorer-income");
  const range = document.getElementById("explorer-range");
  const family = document.getElementById("explorer-family");
  const familyRange = document.getElementById("explorer-family-range");
  const dependents = document.getElementById("explorer-dependents");
  const dependentsRange = document.getElementById("explorer-dependents-range");
  const filing = document.getElementById("explorer-filing");
  const run = document.getElementById("explorer-run");
  const view = document.getElementById("explorer-view-analysis");
  const display = document.getElementById("explorer-amount-result");
  const status = document.getElementById("explorer-result-status");
  const eligibility = document.getElementById("explorer-eligibility");
  const heading = document.getElementById("explorer-plan-heading");
  const detail = document.getElementById("explorer-plan-detail");
  const warnings = document.getElementById("explorer-warnings");
  const mainSubmit = document.getElementById("submit");
  const tabs = Array.from(document.querySelectorAll("[data-explorer-plan]"));
  const isAdvisor = new URLSearchParams(location.search).has("advisorClient");
  const money = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2});
  let active = "RAP";
  let latestResult = null;
  let waiting = false;
  let dirty = false;
  let timer = null;
  if (!amount || !range || !family || !familyRange || !dependents || !dependentsRange || !filing || !mainSubmit) return;
  function syncFromSource() {
    const annual = source("cadence").value === "annual";
    amount.value = annual ? source("incomeAmount").value : "";
    range.value = annual ? String(Math.min(200000,Math.max(0,Number(source("incomeAmount").value)||0))) : "0";
    family.value = source("familySize").value;
    familyRange.value = String(Math.min(12,Math.max(1,Number(family.value)||1)));
    dependents.value = source("dependents").value;
    dependentsRange.value = String(Math.min(8,Math.max(0,Number(dependents.value)||0)));
    filing.value = source("taxFilingStatus").value;
    amount.disabled = !annual || isAdvisor;
    range.disabled = !annual || isAdvisor;
    [family,familyRange,dependents,dependentsRange,filing].forEach((input) => { input.disabled = isAdvisor; });
    run.disabled = isAdvisor;
    document.getElementById("explorer-advisor-note").hidden = !isAdvisor;
  }
  function selectPlan(name) {
    active = name;
    tabs.forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.explorerPlan === name)));
    heading.textContent = name + " · monthly estimate";
    const checkbox = Array.from(form.querySelectorAll('input[name="plans"]')).find((x) => x.value === name);
    if (checkbox && !checkbox.checked && !isAdvisor) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change",{bubbles:true}));
      queueUpdate();
    }
    renderActive();
  }
  function renderActive() {
    const plan = latestResult?.planEstimates?.find((item) => item.plan === active);
    detail.replaceChildren();
    warnings.replaceChildren();
    if (!plan) {
      display.textContent = "Not calculated";
      eligibility.textContent = "Eligibility not assessed";
      status.textContent = isAdvisor ? "Advisor calculations remain manual." : "Adjust a control or select Update repayment estimate.";
      view.disabled = true;
      return;
    }
    display.textContent = money.format(plan.monthlyPaymentEstimate) + " /mo";
    eligibility.textContent = "Eligibility: " + (plan.eligibility?.status || "unknown");
    status.textContent = "Modeled estimate from the existing Worker. Review eligibility and warnings.";
    for (const message of [plan.formulaSummary,plan.eligibilityNote]) {
      if (!message) continue;
      const p = document.createElement("p"); p.textContent = message; detail.appendChild(p);
    }
    for (const message of [...(plan.warnings || []),...(latestResult?.warnings || [])]) {
      const li = document.createElement("li"); li.textContent = message; warnings.appendChild(li);
    }
    if (!warnings.childElementCount) {
      const li = document.createElement("li"); li.textContent = "Review full analysis for assumptions and policy context."; warnings.appendChild(li);
    }
    view.disabled = false;
  }
  function queueUpdate() {
    if (isAdvisor) return;
    dirty = true;
    latestResult = null;
    renderActive();
    status.textContent = "Inputs changed · recalculating with the Worker…";
    if (timer) clearTimeout(timer);
    timer = setTimeout(runCalculation,500);
  }
  function runCalculation() {
    if (isAdvisor || !dirty || waiting) return;
    if (!form.reportValidity()) { status.textContent = "Complete the required Household fields before calculating."; return; }
    if (mainSubmit.disabled) { timer = setTimeout(runCalculation,250); return; }
    dirty = false;
    waiting = true;
    status.textContent = "Calculating with the existing repayment engine…";
    mainSubmit.click();
  }
  function updateNumber(value, input, slider, original, min, max) {
    if (value === "" || !Number.isFinite(Number(value)) || Number(value) < min) return;
    const n = Number(value);
    if (original.name !== "incomeAmount" && !Number.isInteger(n)) return;
    original.value = String(n);
    input.value = String(n);
    slider.value = String(Math.min(max,Math.max(min,n)));
    original.dispatchEvent(new Event("input",{bubbles:true}));
    queueUpdate();
  }
  function wireNumber(input, slider, field, min, max) {
    const original = source(field);
    input.addEventListener("input",() => updateNumber(input.value,input,slider,original,min,max));
    slider.addEventListener("input",() => updateNumber(slider.value,input,slider,original,min,max));
    original.addEventListener("input",() => { if (document.activeElement !== input && document.activeElement !== slider) syncFromSource(); });
    original.addEventListener("change",() => { if (document.activeElement !== input && document.activeElement !== slider) syncFromSource(); });
  }
  wireNumber(amount,range,"incomeAmount",0,200000);
  wireNumber(family,familyRange,"familySize",1,12);
  wireNumber(dependents,dependentsRange,"dependents",0,8);
  filing.addEventListener("change",() => {
    source("taxFilingStatus").value = filing.value;
    source("taxFilingStatus").dispatchEvent(new Event("change",{bubbles:true}));
    queueUpdate();
  });
  form.addEventListener("change", (event) => {
    if (event.target !== filing && !event.target.id?.startsWith("explorer-")) {
      syncFromSource();
      queueUpdate();
    }
  });
  source("cadence").addEventListener("change", syncFromSource);
  run.addEventListener("click",() => { dirty=true; runCalculation(); });
  tabs.forEach((tab) => tab.addEventListener("click",() => selectPlan(tab.dataset.explorerPlan)));
  view.addEventListener("click",() => document.querySelector('.step-tab[data-step="analysis"]')?.click());
  document.addEventListener("borrower:calculated",(event) => {
    waiting = false;
    latestResult = event.detail;
    renderActive();
    if (dirty) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(runCalculation,250);
    }
  });
  syncFromSource();
  renderActive();
})();`;
