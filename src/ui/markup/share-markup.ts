export const SHARE_MARKUP = String.raw`<main>
  <p class="muted"><strong>Student Loan IDR</strong> · plan comparison</p>
  <h1>Here's what your monthly payment could look like.</h1>
  <p class="muted">This is a modeled estimate, not an official eligibility or billing decision. Your advisor prepared this comparison from the facts on file.</p>

  <p id="status-line" class="muted" role="status" aria-live="polite">Loading your comparison…</p>
  <p id="countdown-line" aria-hidden="true"></p>

  <section id="chart-panel" class="panel" hidden>
    <h2>Monthly payment by plan</h2>
    <div id="plan-rows"></div>
    <p id="flrs-note" class="muted" hidden></p>
    <p id="assumptions-note" class="muted"></p>
  </section>

  <section id="select-panel" class="panel" hidden>
    <h3>Pick the plan you'd like to move forward with</h3>
    <p class="muted">You can change your mind until you confirm below.</p>
    <div id="select-buttons"></div>
  </section>

  <section id="sign-panel" class="panel" hidden>
    <h3>Confirm your choice</h3>
    <p class="muted">You selected <strong id="selected-plan-label"></strong>. Type your initials to confirm this is the plan you want to move forward with.</p>
    <p class="muted">This is <strong>not</strong> a binding electronic signature or loan-program enrollment — it just tells your advisor you're ready to move ahead.</p>
    <label>Initials<input id="sign-initials" maxlength="10" autocomplete="off"></label>
    <div style="margin-top: 14px; display: flex; gap: 10px;">
      <button type="button" id="sign-confirm">Confirm plan choice</button>
      <button type="button" id="sign-back" class="secondary">Choose a different plan</button>
    </div>
  </section>

  <section id="signed-panel" class="panel" hidden>
    <h3>You're all set, for now</h3>
    <p id="signed-summary"></p>
    <p class="muted">Book a time to enroll below, or your advisor can help schedule directly.</p>
    <iframe id="booking-embed" src="https://cal.com/jared-edwards-gscxmo?embed=true" style="width:100%;min-height:640px;border:0;border-radius:12px;" loading="lazy" title="Book your enrollment call"></iframe>
    <div class="actions"><button type="button" id="download-document">Download supporting document</button></div>
    <p id="download-status" class="muted" role="status" aria-live="polite"></p>
  </section>

  <section id="closed-panel" class="panel" hidden>
    <h3 id="closed-title"></h3>
    <p id="closed-body" class="muted"></p>
  </section>
</main>
`;
