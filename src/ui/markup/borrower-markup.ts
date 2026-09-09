export const BORROWER_MARKUP = String.raw`<main>
  <p><strong>Student Loan IDR Estimate</strong> · policy snapshot 2026-08-27</p>
  <h1>Turn your real loan facts into a repayment estimate.</h1>
  <p class="lede">This calculator annualizes the income facts you enter and applies the same deterministic RAP, IBR, PAYE, and ICR formulas exposed by this Worker’s MCP tools. It is an estimate—not an official eligibility or billing decision.</p>
  <div class="notice"><strong>Privacy:</strong> this page has no analytics, no external assets, and no browser storage. Calculation inputs are sent only to this same Worker for the current request. A StudentAid.gov loan-data file is parsed locally in your browser and the raw file is never uploaded. Do not enter SSNs, account numbers, or fabricated facts.</div>
  <p class="muted">Working with multiple borrowers? <a href="/advisor">Open the advisor / manager workspace</a>. The direct borrower workflow remains available without an account.</p>
  <nav class="step-rail" aria-label="Borrower workflow steps">
    <button type="button" class="step-tab" data-step="portfolio" aria-current="step">1. Portfolio</button>
    <button type="button" class="step-tab" data-step="profile">2. Household</button>
    <button type="button" class="step-tab" data-step="guide">3. Guided assistant</button>
    <button type="button" class="step-tab" data-step="analysis">4. Analysis</button>
  </nav>

  <section class="advisor-savebar" id="advisor-client-bar" hidden aria-labelledby="advisor-client-title">
    <div class="advisor-savebar-head">
      <div>
        <span class="basis">Advisor client</span>
        <strong id="advisor-client-title">Saved client workflow</strong>
        <div id="advisor-client-name" class="muted"></div>
      </div>
      <div class="actions">
        <button type="button" id="advisor-save-progress">Save progress</button>
        <button type="button" id="advisor-regenerate-document">Regenerate document</button>
        <button type="button" id="advisor-view-case-file">Case file</button>
        <button type="button" id="advisor-open-consultation">Ask this case</button>
        <button type="button" id="advisor-view-intelligence">Portfolio intelligence</button>
        <button type="button" id="advisor-compare-plans">Compare repayment paths</button>
        <button type="button" id="advisor-retain-calculation">Retain calculation</button>
        <button type="button" id="advisor-open-history">History</button>
        <a class="link-button" href="/advisor">Client dashboard</a>
      </div>
    </div>
    <p id="advisor-save-status" class="muted" role="status" aria-live="polite">Loading saved client facts…</p>
  </section>

  <section class="workspace case-workspace" id="advisor-case-workspace" hidden aria-labelledby="advisor-case-title">
    <div class="guide-head"><div><h2 id="advisor-case-title">Client case file</h2><p class="muted">A professional working summary derived from the saved normalized client record. It is versioned for later structured retrieval and does not retain raw StudentAid or evidence files.</p></div><span class="badge">Case context v1</span></div>
    <p id="advisor-case-status" class="muted" role="status" aria-live="polite">Loading case context…</p>
    <div id="advisor-case-summary" class="summary"></div>
    <div id="advisor-case-details" class="readiness-list"></div>
  </section>

  <section class="workspace consultation-workspace" id="advisor-consultation-workspace" hidden aria-labelledby="advisor-consultation-title">
    <div class="guide-head"><div><h2 id="advisor-consultation-title">Ask this saved case</h2><p class="muted">Ask about missing facts, Parent PLUS / FFEL history, repayment-path comparisons, policy rules, portfolio history, documents, or the next best action. Answers are assembled from this advisor-owned saved case plus reviewed policy evidence pinned to the current snapshot. Deterministic code remains authoritative for eligibility and payment math.</p></div><span class="badge">Read-only evidence</span></div>
    <div id="advisor-consultation-transcript" class="guide-transcript" role="log" aria-live="polite"></div>
    <div class="answer-bubbles" aria-label="Suggested case questions">
      <button type="button" data-consult-question="What is still missing before I can compare plans?">What’s missing?</button>
      <button type="button" data-consult-question="What does the loan history change for Parent PLUS, FFEL, IBR, and RAP eligibility?">Eligibility history</button>
      <button type="button" data-consult-question="Compare plans and tell me the lowest modeled payment.">Lowest payment</button>
      <button type="button" data-consult-question="What should I ask the borrower next?">Next borrower question</button>
    </div>
    <form id="advisor-consultation-form" class="guide-entry">
      <input id="advisor-consultation-question" maxlength="2000" autocomplete="off" placeholder="Ask a question about this saved case" aria-label="Ask a question about this saved case">
      <button type="submit" id="advisor-consultation-submit">Ask</button>
    </form>
    <p id="advisor-consultation-status" class="muted" role="status" aria-live="polite">No question asked yet. Consultation does not change client facts or create timeline history.</p>
  </section>

  <section class="workspace intelligence-workspace" id="advisor-intelligence-workspace" hidden aria-labelledby="advisor-intelligence-title">
    <h2 id="advisor-intelligence-title">FSA portfolio intelligence</h2>
    <p><span class="basis">Deterministic derived facts</span>Status chronology, forbearance windows, reported payments, delinquency, repayment-plan state, interest, servicer routing, and reconciliation are computed from saved normalized StudentAid facts. No LLM is used for chronology or balance math.</p>
    <p id="advisor-intelligence-status" class="muted" role="status" aria-live="polite">Save normalized per-loan StudentAid facts to derive portfolio intelligence.</p>
    <div id="advisor-intelligence-summary" class="summary"></div>
    <div id="advisor-intelligence-details" class="readiness-list"></div>
  </section>

  <section class="workspace comparison-workspace" id="advisor-comparison-workspace" hidden aria-labelledby="advisor-comparison-title">
    <h2 id="advisor-comparison-title">Repayment & forgiveness comparison</h2>
    <p><span class="basis">Modeled estimate</span>These scenarios reuse this Worker’s deterministic repayment formulas and the client’s saved normalized facts. They are not guaranteed forgiveness, eligibility, approval, tax treatment, or servicer outcomes.</p>
    <p id="advisor-comparison-status" class="muted" role="status" aria-live="polite">Save the client’s current facts, then compare repayment paths.</p>
    <div class="actions"><button type="button" id="advisor-print-comparison" disabled>Print / Save PDF</button><button type="button" id="advisor-download-comparison-svg" disabled>Download SVG</button><button type="button" id="advisor-share-comparison" disabled>Create secure borrower link</button><button type="button" id="advisor-retain-comparison">Retain another comparison</button></div>
    <div id="advisor-comparison-cards" class="comparison-cards"></div>
    <div class="chart-grid">
      <article class="chart-panel"><h3>Monthly payment path</h3><p class="muted">Current calculated payment held constant for this bounded scenario.</p><svg id="advisor-payment-chart" viewBox="0 0 720 260" role="img" aria-label="Modeled monthly payment by repayment plan"></svg></article>
      <article class="chart-panel"><h3>Cumulative borrower paid</h3><p class="muted">Modeled dollars paid by the borrower over time.</p><svg id="advisor-paid-chart" viewBox="0 0 720 260" role="img" aria-label="Modeled cumulative borrower payments by repayment plan"></svg></article>
      <article class="chart-panel"><h3>Remaining balance</h3><p class="muted">Modeled principal plus tracked unpaid interest where applicable.</p><svg id="advisor-balance-chart" viewBox="0 0 720 260" role="img" aria-label="Modeled remaining loan balance by repayment plan"></svg></article>
      <article class="chart-panel"><h3>Estimated forgiveness</h3><p class="muted">Shown only when this policy snapshot supports a bounded forgiveness horizon and required timing facts are saved.</p><svg id="advisor-forgiveness-chart" viewBox="0 0 720 260" role="img" aria-label="Modeled forgiveness amount by repayment plan"></svg></article>
    </div>
    <div id="advisor-comparison-assumptions" class="comparison-assumptions"></div>
  </section>

  <section class="workspace history-workspace" id="advisor-history-workspace" hidden aria-labelledby="advisor-history-title">
    <div class="guide-head"><div><h2 id="advisor-history-title">Client timeline & retained history</h2><p class="muted">Material advisor calculations, comparisons, document actions, and borrower plan decisions are recorded automatically. Timeline cards stay compact; full deterministic bases/results are available only inside this saved client workspace or exports. Raw StudentAid downloads and evidence files are never retained.</p></div><button type="button" id="advisor-refresh-history">Refresh history</button></div>
    <p id="advisor-history-status" class="muted" role="status" aria-live="polite"></p>
    <div><h3>Case timeline</h3><div id="advisor-timeline-history" class="history-list"></div></div>
    <div class="history-grid">
      <div><h3>Document drafts</h3><div id="advisor-artifact-history" class="history-list"></div></div>
      <div><h3>Calculation snapshots</h3><div id="advisor-snapshot-history" class="history-list"></div></div>
    </div>
  </section>

  <div class="step-panel" data-step-panel="guide" hidden>
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
        <button type="button" id="advisor-retain-document" disabled hidden>Retain draft in client history</button>
      </div>
    </div>
  </section>

  </div>
  <div class="step-panel" data-step-panel="portfolio">
  <section class="workspace" id="loan-import" aria-labelledby="loan-import-title">
    <h2 id="loan-import-title">Import your federal loan portfolio</h2>
    <p><span class="basis">Imported fact</span>Choose the <strong>Download My Aid Data</strong> text file from StudentAid.gov. The raw file can contain personal contact information, so this page reads it only on this device, extracts active loan balance/rate/type/date facts, and never uploads the raw text.</p>
    <label>StudentAid.gov My Aid Data file
      <input id="loan-file" type="file" accept=".txt,text/plain">
    </label>
    <p id="import-status" role="status" aria-live="polite" class="muted">No loan file loaded. Manual loan fields remain available below.</p>
    <div id="portfolio-summary"></div>
    <div id="studentaid-review"></div>
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

  </div>
  <div class="step-panel" data-step-panel="profile" hidden>
  <form id="calculator-form">
    <label class="field-color-toggle"><input type="checkbox" id="field-color-toggle" checked> Show field-status colors (green = has a value, red = required &amp; missing, purple = optional)</label>
    <p id="field-completion" class="field-completion muted" role="status" aria-live="polite"></p>
    <p class="muted"><strong>Field status shows completeness only.</strong> A filled field is not automatically correct, verified, eligible, or advisor-approved.</p>
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
      <label data-fill-state="required"><span><span class="basis">Stated fact</span>Gross taxable income amount for that cadence</span>
        <input name="incomeAmount" type="number" min="0" step="0.01" value="50000" required>
      </label>
      <label id="hours-field" data-fill-state="optional" hidden>Hours per week
        <input name="hoursPerWeek" type="number" min="0" step="0.01" value="40">
      </label>
      <label id="weeks-field" data-fill-state="optional" hidden>Weeks per year
        <input name="weeksPerYear" type="number" min="0" step="0.01" value="52">
      </label>
      <label>Region
        <select name="region">
          <option value="contiguous_us">48 states + D.C.</option>
          <option value="alaska">Alaska</option>
          <option value="hawaii">Hawaii</option>
        </select>
      </label>
      <label data-fill-state="required"><span><span class="basis">Stated fact</span>Legacy IDR family size</span>
        <input name="familySize" type="number" min="1" step="1" value="1" required aria-describedby="family-size-help">
        <span id="family-size-help" class="muted">Use the current Federal Student Aid support-based definition above; do not cap the value at 6.</span>
      </label>
      <label data-fill-state="required"><span><span class="basis">Stated fact</span>Dependents claimed on federal tax return</span>
        <input name="dependents" type="number" min="0" step="1" value="0" required>
        <span class="muted">Used by RAP and intentionally separate from legacy IDR family size.</span>
      </label>
      <label data-fill-state="optional">Estimated above-the-line adjustments <span class="muted">(optional)</span>
        <input name="adjustments" type="number" min="0" step="0.01" placeholder="0">
      </label>
      <label data-fill-state="optional">AGI override <span class="muted">(optional)</span>
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
      <label data-fill-state="optional">Loan principal <span class="muted">(optional; improves caps/ICR)</span>
        <input name="principal" type="number" min="0" step="0.01" placeholder="e.g. 30000">
      </label>
      <label data-fill-state="optional">Annual interest rate % <span class="muted">(optional)</span>
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

  </div>
  <div class="step-panel" data-step-panel="analysis" hidden>
  <section id="results" aria-live="polite"></section>

  <section class="workspace consultation-workspace" id="borrower-consultation-workspace" hidden aria-labelledby="borrower-consultation-title">
    <div class="guide-head"><div><h2 id="borrower-consultation-title">Ask about this estimate</h2><p class="muted">Uses only the calculator facts from your latest private-session estimate plus reviewed policy evidence. Nothing is saved, no advisor case is queried, and raw StudentAid text is never sent.</p></div><span class="badge">Private · not saved</span></div>
    <div id="borrower-consultation-transcript" class="guide-transcript" role="log" aria-live="polite"></div>
    <div class="answer-bubbles" aria-label="Suggested estimate questions">
      <button type="button" data-borrower-consult-question="Which selected plan has the lowest modeled monthly payment?">Lowest payment</button>
      <button type="button" data-borrower-consult-question="Why is a selected plan marked ineligible?">Eligibility</button>
      <button type="button" data-borrower-consult-question="What does Parent PLUS or FFEL history change for eligibility?">Loan history</button>
      <button type="button" data-borrower-consult-question="Explain the policy evidence behind this estimate.">Policy evidence</button>
    </div>
    <form id="borrower-consultation-form" class="guide-entry">
      <input id="borrower-consultation-question" maxlength="2000" autocomplete="off" placeholder="Ask about your latest estimate" aria-label="Ask about your latest estimate">
      <button type="submit" id="borrower-consultation-submit">Ask</button>
    </form>
    <p id="borrower-consultation-status" class="muted" role="status" aria-live="polite">Calculate first, then ask about that estimate. This consultation is not persisted.</p>
  </section>
  </div>
  <footer>Official eligibility and payment amounts come from the U.S. Department of Education and your loan servicer. SAVE is not modeled in this 2026-08-27 policy snapshot.</footer>
</main>
`;
