export const ADVISOR_UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Advisor Workspace · Student Loan IDR</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: Canvas; color: CanvasText; line-height: 1.5; }
    main { width: min(1100px, calc(100% - 28px)); margin: 0 auto; padding: 32px 0 60px; }
    h1 { font-size: clamp(2rem, 6vw, 3.8rem); line-height: 1; letter-spacing: -.04em; margin: 8px 0 14px; }
    h2, h3 { margin-top: 0; }
    .muted { color: color-mix(in srgb, CanvasText 66%, transparent); }
    .notice, .panel, .client-card { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 16px; padding: 16px; background: color-mix(in srgb, CanvasText 3%, Canvas); }
    .notice { margin: 20px 0; }
    .panel { margin: 18px 0; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    label { display: grid; gap: 7px; font-weight: 650; }
    input, button { font: inherit; }
    input { width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, CanvasText 24%, transparent); background: Canvas; color: CanvasText; }
    button, .button-link { border: 0; border-radius: 999px; padding: 11px 16px; font-weight: 750; cursor: pointer; background: CanvasText; color: Canvas; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
    .secondary { background: color-mix(in srgb, CanvasText 8%, Canvas); color: CanvasText; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); }
    .actions { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; margin-top: 14px; }
    .topbar { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
    .client-list { display: grid; gap: 12px; margin-top: 14px; }
    .client-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    .badges { display: flex; gap: 7px; flex-wrap: wrap; }
    .badge { display: inline-flex; border: 1px solid currentColor; border-radius: 999px; padding: 2px 8px; font-size: .78rem; text-transform: capitalize; }
    .action-summary { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0 4px; }
    .action-summary strong { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 999px; padding: 5px 10px; }
    .action-reason { margin: 10px 0 0; }
    .attention { font-weight: 800; }
    [hidden] { display: none !important; }
    #status, #auth-status { min-height: 1.5em; }
    a { color: inherit; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } main { width: min(100% - 20px, 1100px); padding-top: 22px; } }
  </style>
</head>
<body>
<main>
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
<script>
(() => {
  const authPanel = document.getElementById("auth-panel");
  const workspace = document.getElementById("workspace");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const authStatus = document.getElementById("auth-status");
  const advisorName = document.getElementById("advisor-name");
  const logout = document.getElementById("logout");
  const createClientForm = document.getElementById("create-client-form");
  const searchForm = document.getElementById("search-form");
  const search = document.getElementById("search");
  const status = document.getElementById("status");
  const actionSummary = document.getElementById("action-summary");
  const clientList = document.getElementById("client-list");
  let csrfToken = null;
  let advisor = null;
  const studentAidIntakeFile = document.getElementById("studentaid-intake-file");
  const studentAidIntakeStatus = document.getElementById("studentaid-intake-status");
  const studentAidIntakePreview = document.getElementById("studentaid-intake-preview");
  const studentAidIntakeName = document.getElementById("studentaid-intake-name");
  const studentAidIntakeFacts = document.getElementById("studentaid-intake-facts");
  const studentAidIntakeMatches = document.getElementById("studentaid-intake-matches");
  const studentAidIntakeMatchList = document.getElementById("studentaid-intake-match-list");
  const studentAidIntakeCreate = document.getElementById("studentaid-intake-create");
  let studentAidPortfolio = null;
  let studentAidMatches = [];

  function numericValue(value) {
    if (!value) return undefined;
    const normalized = value.replace(/[$,%]/g, "").replace(/,/g, "").trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function studentAidYesLocal(value) {
    const normalized = String(value || "").trim().toUpperCase();
    if (["Y", "YES", "TRUE", "1"].includes(normalized)) return true;
    if (["N", "NO", "FALSE", "0"].includes(normalized)) return false;
    return undefined;
  }

  function maskStudentAidIdentifierLocal(value) {
    const normalized = String(value || "").trim();
    return normalized ? "\u2022\u2022\u2022\u2022" + normalized.slice(-4) : null;
  }

  function mapLoanType(code, description, parentPlusIndicator) {
    const c = String(code || "").trim().toUpperCase();
    const value = String(description || "").toUpperCase();
    const hasParentPlus = studentAidYesLocal(parentPlusIndicator);
    if (["D0", "D1"].includes(c)) return "direct_subsidized";
    if (["D2", "D8"].includes(c)) return "direct_unsubsidized";
    if (c === "D3") return "direct_grad_plus";
    if (c === "D4") return "direct_parent_plus";
    if (["D5", "D6", "D9"].includes(c)) return hasParentPlus === true ? "direct_consolidation_with_parent_plus" : hasParentPlus === false ? "direct_consolidation_no_parent_plus" : null;
    if (c === "GB") return "ffel_grad_plus";
    if (c === "PL") return "ffel_parent_plus";
    if (c === "SF") return "ffel_subsidized_stafford";
    if (["SU", "SN"].includes(c)) return "ffel_unsubsidized_stafford";
    if (c === "CL") return hasParentPlus === true ? "ffel_consolidation_with_parent_plus" : hasParentPlus === false ? "ffel_consolidation_no_parent_plus" : null;
    if (["PU", "DU", "NU"].includes(c) || value.includes("PERKINS")) return "perkins";
    if (!value || value.includes("CONSOLIDAT")) return null;
    const isDirect = value.includes("DIRECT");
    const isFfel = value.includes("FFEL") || value.includes("FEDERAL STAFFORD");
    if (isDirect) {
      if (value.includes("PARENT") && value.includes("PLUS")) return "direct_parent_plus";
      if ((value.includes("GRAD") || value.includes("PROFESSIONAL")) && value.includes("PLUS")) return "direct_grad_plus";
      if (value.includes("UNSUBSID")) return "direct_unsubsidized";
      if (value.includes("SUBSID")) return "direct_subsidized";
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
    const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const timestamp = match ? Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])) : Date.parse(value || "");
    if (!Number.isFinite(timestamp)) return null;
    return timestamp >= Date.UTC(2026, 6, 1) ? "on_or_after_2026_07_01" : "before_2026_07_01";
  }

  function parseStudentAidData(text) {
    const student = {};
    const records = [];
    const rawLines = text.split(/\r?\n/);
    const tokens = rawLines.flatMap((rawLine, lineIndex) => {
      const separator = rawLine.indexOf(":");
      if (separator < 0) return [];
      return [{ lineNumber: lineIndex + 1, key: rawLine.slice(0, separator).trim(), value: rawLine.slice(separator + 1).trim() }];
    });
    const hasAwardAnchors = tokens.some((token) => token.key === "Loan Award ID");
    const firstAwardIndex = tokens.findIndex((token) => token.key === "Loan Award ID");
    const firstTypeIndex = tokens.findIndex((token) => token.key === "Loan Type Code" || token.key === "Loan Type");
    const awardFirstLayout = hasAwardAnchors && (firstTypeIndex < 0 || firstAwardIndex < firstTypeIndex);
    const recognizedLabels = new Set();
    const unmappedLabels = new Set();
    const structuralWarnings = [];
    const validationIssues = [];
    let fileRequestDate = null;
    let current = null;
    let currentStatus = null;
    let currentDisbursement = null;
    let currentDelinquency = null;
    let currentContact = null;
    const newLoan = () => ({ statuses: [], disbursements: [], delinquencies: [], contacts: [], provenance: {} });
    const ensureCurrent = () => { if (!current) current = newLoan(); return current; };
    const pushCurrent = () => { if (current) records.push(current); current = null; currentStatus = null; currentDisbursement = null; currentDelinquency = null; currentContact = null; };
    const dateTimestamp = (value) => {
      if (!value) return undefined;
      const match = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const timestamp = match ? Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])) : Date.parse(value);
      return Number.isFinite(timestamp) ? timestamp : undefined;
    };
    const latestStatus = (statuses) => {
      let latest = undefined;
      let latestTimestamp = Number.NEGATIVE_INFINITY;
      (statuses || []).forEach((statusFact) => {
        const timestamp = dateTimestamp(statusFact.effectiveDate);
