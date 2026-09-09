export const ADVISOR_WORKSPACE_MARKUP = String.raw`<main>
  <p><strong>Student Loan IDR</strong> · advisor / manager workspace</p>
  <h1>Manage many borrower clients without mixing their facts.</h1>
  <p class="muted">Create a client, open that client’s guided workflow, save normalized application facts, resume later, and regenerate supporting documents. Client lists stay intentionally minimized.</p>
  <div class="notice"><strong>Privacy boundary:</strong> do not store SSNs, FSA credentials, raw StudentAid.gov downloads, or raw evidence files here. StudentAid imports remain browser-local; only normalized loan facts can be saved to a client record.</div>

  <section id="auth-panel" class="panel" aria-labelledby="auth-title">
    <h2 id="auth-title">Advisor sign in</h2>
    <div class="grid">
      <form id="login-form">
        <h3>Sign in</h3>
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" minlength="12" required></label>
        <div class="actions"><button type="submit">Sign in</button></div>
      </form>
      <form id="register-form">
        <h3>Create advisor account</h3>
        <label>Advisor display name<input name="displayName" autocomplete="name" maxlength="120" required></label>
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" minlength="12" required></label>
        <div class="actions"><button type="submit">Create account</button></div>
      </form>
    </div>
    <p id="auth-status" class="muted" role="status" aria-live="polite"></p>
  </section>

  <section id="workspace" hidden>
    <div class="panel">
      <div class="topbar">
        <div><h2 id="advisor-name">Advisor workspace</h2><p class="muted">Saved client facts are owner-scoped to this authenticated advisor account.</p></div>
        <div class="actions"><a class="button-link secondary" href="/">Private borrower calculator</a><button type="button" id="logout" class="secondary">Sign out</button></div>
      </div>
    </div>

    <section class="panel" aria-labelledby="new-client-title">
      <h2 id="new-client-title">Add a client</h2>
      <form id="create-client-form" class="grid">
        <label>Client display name<input name="displayName" maxlength="120" required></label>
        <label>Email <span class="muted">(optional)</span><input name="email" type="email" maxlength="254"></label>
        <label>Phone <span class="muted">(optional)</span><input name="phone" maxlength="80"></label>
        <div class="actions"><button type="submit">Create & open client</button></div>
      </form>
    </section>

    <section class="panel" aria-labelledby="studentaid-intake-title">
      <h2 id="studentaid-intake-title">Create client from StudentAid file</h2>
      <p class="muted">Choose the borrower’s <strong>Download My Aid Data</strong> file from StudentAid.gov. It is parsed only on this device; the raw file is never uploaded or retained.</p>
      <label>StudentAid.gov My Aid Data file<input type="file" id="studentaid-intake-file" accept=".txt,text/plain"></label>
      <p id="studentaid-intake-status" class="muted" role="status" aria-live="polite"></p>
      <div id="studentaid-intake-preview" hidden>
        <label>Client display name<input id="studentaid-intake-name" maxlength="120"></label>
        <dl id="studentaid-intake-facts"></dl>
        <div id="studentaid-intake-matches" hidden>
          <p class="muted">Possible existing client match found. Open the existing client instead of creating a duplicate, or confirm this is a different person.</p>
          <div id="studentaid-intake-match-list"></div>
        </div>
        <p class="muted">Raw StudentAid.gov file remains local and will not be retained. Review the facts above before creating a client.</p>
        <div class="actions"><button type="button" id="studentaid-intake-create">Create separate client from this file</button></div>
      </div>
    </section>

    <section class="panel" aria-labelledby="clients-title">
      <div class="topbar">
        <div><h2 id="clients-title">Advisor action dashboard</h2><p class="muted">Who needs attention and why. States and next actions are derived deterministically from saved case facts, material timeline events, plan-review status, and due dates. Cards remain minimized: no income amounts, loan balances, contact details, evidence, notes, or calculation bodies are aggregated here.</p></div>
        <form id="search-form" class="actions"><input id="search" aria-label="Search clients" placeholder="Search client name"><button type="submit" class="secondary">Search</button></form>
      </div>
      <div id="action-summary" class="action-summary" aria-live="polite"></div>
      <p id="status" class="muted" role="status" aria-live="polite"></p>
      <div id="client-list" class="client-list"></div>
    </section>
  </section>
</main>
`;
