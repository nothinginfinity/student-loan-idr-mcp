// V0.9.11 presentation layer. All payment math remains in /api/calculate.
export const BORROWER_EXPLORER_MARKUP = String.raw`
<section class="income-explorer" aria-labelledby="income-explorer-heading">
  <div class="explorer-intro"><span class="basis">Interactive income explorer</span><h2 id="income-explorer-heading">Explore your estimated payment</h2><p class="muted">Move the slider to change annual gross taxable income. Estimates use the existing Worker calculation endpoint, not a separate browser formula.</p></div>
  <div class="explorer-grid">
    <div class="explorer-controls">
      <label for="explorer-income">Annual gross taxable income</label>
      <div class="explorer-amount"><span aria-hidden="true">$</span><input id="explorer-income" type="number" inputmode="decimal" min="0" max="1000000" step="1000" value="50000" aria-describedby="explorer-help"></div>
      <input id="explorer-range" aria-label="Explore annual income from zero to two hundred thousand dollars" type="range" min="0" max="200000" step="1000" value="50000">
      <div class="explorer-range-ends"><span>$0</span><span>$200,000</span></div>
      <p id="explorer-help" class="muted">Annual income is linked to the Household form below. It does not override imported or guided income sources.</p>
      <button id="explorer-run" type="button">Update repayment estimates</button>
    </div>
    <div class="explorer-result" aria-live="polite" aria-atomic="true">
      <span class="basis">Monthly repayment comparison</span>
      <strong id="explorer-amount-result">Not calculated</strong>
      <p id="explorer-result-status">Enter your income and update to calculate with the existing repayment engine.</p>
      <div id="explorer-plan-results" class="explorer-plan-results"></div>
      <button type="button" id="explorer-view-analysis" disabled>View full analysis</button>
    </div>
  </div>
</section>
`;
export const BORROWER_EXPLORER_CSS = String.raw`
.income-explorer { border: 1px solid color-mix(in srgb, #0f6e56 30%, Canvas); border-radius: 22px; padding: clamp(16px, 4vw, 28px); margin: 10px 0 24px; background: color-mix(in srgb, #0f6e56 5%, Canvas); }
.explorer-intro h2 { margin: 6px 0; font-size: clamp(1.45rem, 5vw, 2.1rem); line-height: 1.15; letter-spacing: -.03em; }
.explorer-intro p { max-width: 68ch; }
.explorer-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
.explorer-controls,.explorer-result { min-width: 0; border: 1px solid var(--line); padding: 20px; border-radius: 18px; background: Canvas; }
.explorer-controls label { display: block; font-weight: 750; }
.explorer-amount { display: flex; align-items: center; gap: 6px; font-size: 1.9rem; font-weight: 800; margin: 12px 0; }
.explorer-amount input { font-size: 1.6rem; font-weight: 800; min-width: 0; }
#explorer-range { width: 100%; accent-color: #0f6e56; cursor: pointer; min-height: 44px; }
.explorer-range-ends { display: flex; justify-content: space-between; font-size: .8rem; opacity: .75; }
.explorer-result { display: flex; flex-direction: column; gap: 10px; }
#explorer-amount-result { font-size: clamp(1.7rem, 6vw, 2.6rem); line-height: 1.1; overflow-wrap: anywhere; }
#explorer-result-status { font-size: .88rem; margin: 0; color: color-mix(in srgb, CanvasText 70%, transparent); }
.explorer-plan-results { display: grid; gap: 6px; }
.explorer-plan-row { display: flex; gap: 10px; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); padding: 7px 0; font-size: .88rem; }
#explorer-run,#explorer-view-analysis { min-height: 44px; }
#explorer-view-analysis { margin-top: auto; background: #0f6e56; color: #fff; }
@media(max-width:700px) { .explorer-grid { grid-template-columns: 1fr; } .explorer-controls,.explorer-result { padding: 14px; } .income-explorer { margin-top: 0; } .step-rail { grid-template-columns: repeat(4,minmax(0,1fr)); gap: 3px; } .step-tab { font-size: .69rem; padding: 9px 3px; min-height: 48px; } }
@media(prefers-reduced-motion:reduce) { .income-explorer * { scroll-behavior: auto; } }
`;
export const BORROWER_EXPLORER_SCRIPT = String.raw`(() => {
  const form = document.getElementById("calculator-form");
  const amount = document.getElementById("explorer-income");
  const range = document.getElementById("explorer-range");
  const cadence = form?.elements.namedItem("cadence");
  const original = form?.elements.namedItem("incomeAmount");
  const run = document.getElementById("explorer-run");
  const view = document.getElementById("explorer-view-analysis");
  const display = document.getElementById("explorer-amount-result");
  const status = document.getElementById("explorer-result-status");
  const plans = document.getElementById("explorer-plan-results");
  const results = document.getElementById("results");
  const mainSubmit = document.getElementById("submit");
  if (!form || !amount || !range || !original || !cadence || !results || !mainSubmit) return;
  const isAdvisor = new URLSearchParams(location.search).has("advisorClient");
  let pending = null;
  let timer = null;
  let sequence = 0;
  const money = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
  function refreshFromForm() {
    const annual = cadence.value === "annual";
    if (document.activeElement !== amount && document.activeElement !== range) {
      amount.value = annual ? original.value : "";
      range.value = annual ? String(Math.min(200000,Math.max(0,Number(original.value)||0))) : "0";
    }
    amount.disabled = !annual;
    range.disabled = !annual;
    run.disabled = !annual || isAdvisor;
    status.textContent = isAdvisor ? "Advisor calculations stay manual to preserve client history." : annual ? "Change income to update the estimate from the Worker." : "Select Annual income cadence below to use this explorer.";
  }
  function readResults() {
    if (!pending || !results.querySelector(".plans") || mainSubmit.disabled) return;
    const rows = Array.from(results.querySelectorAll(".plan")).map((card) => ({
      name: card.querySelector(".plan-head strong")?.textContent || "Plan",
      payment: card.querySelector(".payment")?.textContent || "Unavailable",
      eligibility: card.querySelector(".badge")?.textContent || ""
    }));
    if (!rows.length) return;
    plans.replaceChildren();
    for (const row of rows) {
      const item = document.createElement("div");
      item.className = "explorer-plan-row";
      const label = document.createElement("span");
      label.textContent = row.name + " · " + row.eligibility;
      const value = document.createElement("strong");
      value.textContent = row.payment;
      item.append(label,value);
      plans.append(item);
    }
    const eligible = rows.filter((row) => row.eligibility.toLowerCase() === "eligible");
    display.textContent = eligible.length ? eligible[0].payment : "See plan details";
    status.textContent = "Calculated by the existing Worker. Review eligibility and full warnings before relying on an estimate.";
    view.disabled = false;
    pending = null;
  }
  function runCalculation() {
    if (isAdvisor || cadence.value !== "annual" || !form.reportValidity() || mainSubmit.disabled) return;
    pending = ++sequence;
    status.textContent = "Calculating with the existing repayment engine…";
    display.textContent = "Calculating…";
    view.disabled = true;
    mainSubmit.click();
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(runCalculation, 550);
  }
  function onExplorerInput(value) {
    if (value === "" || !Number.isFinite(Number(value)) || Number(value) < 0) return;
    const n = Number(value);
    original.value = String(n);
    range.value = String(Math.min(200000,n));
    original.dispatchEvent(new Event("input",{bubbles:true}));
    if (!isAdvisor) schedule();
  }
  amount.addEventListener("input",() => onExplorerInput(amount.value));
  range.addEventListener("input",() => { amount.value = range.value; onExplorerInput(range.value); });
  original.addEventListener("input", refreshFromForm);
  original.addEventListener("change", refreshFromForm);
  cadence.addEventListener("change", refreshFromForm);
  run.addEventListener("click",runCalculation);
  view.addEventListener("click",() => document.querySelector('.step-tab[data-step="analysis"]')?.click());
  new MutationObserver(() => { if (pending) queueMicrotask(readResults); }).observe(results,{childList:true,subtree:true});
  refreshFromForm();
})();`;
