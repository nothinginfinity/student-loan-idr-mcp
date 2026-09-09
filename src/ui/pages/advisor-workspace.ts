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
    return normalized ? "••••" + normalized.slice(-4) : null;
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
        if (timestamp !== undefined && timestamp > latestTimestamp) { latest = statusFact; latestTimestamp = timestamp; }
      });
      return latest || (statuses || [])[0];
    };
    const textFields = {
      "Loan Attending School Name":"attendingSchoolName", "Loan Attending School OPEID":"attendingSchoolOpeid", "Loan Date":"loanDate", "Loan Repayment Begin Date":"repaymentBeginDate", "Loan Period Begin Date":"periodBeginDate", "Loan Period End Date":"periodEndDate", "Loan Canceled Date":"canceledDate", "Loan Outstanding Principal Balance as of Date":"outstandingPrincipalAsOfDate", "Loan Outstanding Interest Balance as of Date":"outstandingInterestAsOfDate", "Loan Interest Rate Type Code":"interestRateTypeCode", "Loan Interest Rate Type Description":"interestRateTypeDescription", "Loan Repayment Plan Type Code":"repaymentPlanTypeCode", "Loan Repayment Plan Type Code Description":"repaymentPlanDescription", "Loan Repayment Plan Begin Date":"repaymentPlanBeginDate", "Loan Repayment Plan IDR Plan Anniversary Date":"repaymentPlanIdrAnniversaryDate", "Loan Confirmed Subsidy Status":"confirmedSubsidyStatus", "Loan Reaffirmation Date":"reaffirmationDate", "Loan Most Recent Payment Effective Date":"mostRecentPaymentEffectiveDate", "Loan Next Payment Due Date":"nextPaymentDueDate", "Academic Level":"academicLevel", "Award Year":"awardYear", "Reaffirmation flag":"reaffirmationFlag", "UpdtDt":"updateDate", "Loan Updated Date":"updateDate", "Additional Unsubsidized Loan Flag":"additionalUnsubsidizedLoanFlag", "Joint Consolidation Loan Indicator":"jointConsolidationLoanIndicator", "Joint Consolidation Loan Separation Indicator":"jointConsolidationLoanSeparationIndicator", "Loan Special Contact Reason":"loanSpecialContactReason", "Loan Special Contact":"loanSpecialContact", "Current Loan Status":"currentLoanStatusCode", "Current Loan Status Description":"currentLoanStatusDescription", "Parent Plus First Level Consolidation Indicator":"parentPlusFirstLevelConsolidationIndicator", "Consolidation Loan With Any Parent Plus Indicator":"consolidationLoanWithAnyParentPlusIndicator"
    };
    const numericFields = {
      "Loan Amount":"originalAmount", "Loan Disbursed Amount":"disbursedAmount", "Loan Canceled Amount":"canceledAmount", "Loan Outstanding Principal Balance":"outstandingPrincipal", "Loan Outstanding Interest Balance":"outstandingInterest", "Loan Interest Rate":"interestRatePercent", "Loan Actual Interest Rate":"actualInterestRatePercent", "Loan Statutory Interest Rate":"statutoryInterestRatePercent", "Loan Repayment Plan Scheduled Amount":"repaymentPlanScheduledAmount", "Loan Subsidized Usage in Years":"subsidizedUsageYears", "Loan Cumulative Payment Amount":"cumulativePaymentAmount", "Loan PSLF Cumulative Matched Months":"pslfCumulativeMatchedMonths", "Capitalized Interest":"capitalizedInterest", "Net Loan Amount":"netLoanAmount", "Calculated Subsidized Aggregate OPB":"calculatedSubsidizedAggregateOpb", "Calculated Unsubsidized Aggregate OPB":"calculatedUnsubsidizedAggregateOpb", "Calculated Combined Aggregate OPB":"calculatedCombinedAggregateOpb", "Highest Historical Outstanding Principal Balance (OPB)":"highestHistoricalOutstandingPrincipalBalance", "Current Standard-Standard Schedule Payment Amount":"currentStandardSchedulePaymentAmount", "Permanent Standard-Standard Schedule Payment Amount":"permanentStandardSchedulePaymentAmount"
    };
    for (const token of tokens) {
      const { key, value, lineNumber } = token;
      if (!key) continue;
      if (key === "File Request Date") { recognizedLabels.add(key); fileRequestDate = value || null; continue; }
      if (key.startsWith("Student ") || key.startsWith("Grant ")) { recognizedLabels.add(key); if (key.startsWith("Student ")) student[key] = value; continue; }
      if (key === "Loan Award ID") {
        recognizedLabels.add(key);
        if (!current) current = newLoan();
        else if (current.__hasAwardAnchor) { pushCurrent(); current = newLoan(); }
        current.__hasAwardAnchor = true;
        const masked = maskStudentAidIdentifierLocal(value);
        if (masked) { current.maskedAwardId = masked; current.provenance.maskedAwardId = "derived_studentaid"; }
        continue;
      }
      if ((!hasAwardAnchors || !awardFirstLayout) && (key === "Loan Type Code" || key === "Loan Type")) {
        recognizedLabels.add(key);
        pushCurrent();
        current = newLoan();
        current[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = value || null;
        if (value) current.provenance[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = "imported_studentaid";
        continue;
      }
      if (key === "Loan Type Code" || key === "Loan Type") { recognizedLabels.add(key); const loan = ensureCurrent(); loan[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = value || null; if (value) loan.provenance[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = "imported_studentaid"; continue; }
      if (key === "Loan Type Description") { recognizedLabels.add(key); const loan = ensureCurrent(); loan.loanTypeDescription = value || null; if (value) loan.provenance.loanTypeDescription = "imported_studentaid"; continue; }
      if (textFields[key]) { recognizedLabels.add(key); const loan = ensureCurrent(); if (value) { loan[textFields[key]] = value; loan.provenance[textFields[key]] = "imported_studentaid"; } continue; }
      if (numericFields[key]) { recognizedLabels.add(key); const loan = ensureCurrent(); const number = numericValue(value); if (number !== undefined) { loan[numericFields[key]] = number; loan.provenance[numericFields[key]] = "imported_studentaid"; } continue; }
      if (key === "Loan Delinquency Date" || key === "DelinqDate") { recognizedLabels.add(key); const loan = ensureCurrent(); currentDelinquency = { date: value || undefined }; loan.delinquencies.push(currentDelinquency); loan.delinquencyDate = value || undefined; if (value) loan.provenance.delinquencyDate = "imported_studentaid"; continue; }
      if (key === "Loan Delinquency End Date") { recognizedLabels.add(key); const loan = ensureCurrent(); loan.delinquencyEndDate = value || undefined; if (value) loan.provenance.delinquencyEndDate = "imported_studentaid"; if (currentDelinquency) currentDelinquency.endDate = value || undefined; else structuralWarnings.push("Line " + lineNumber + ": Loan Delinquency End Date appeared without a preceding delinquency start date."); continue; }
      if (key === "Loan Status") { recognizedLabels.add(key); const loan = ensureCurrent(); currentStatus = { code: value || undefined }; loan.statuses.push(currentStatus); continue; }
      if (key === "Loan Status Description") { recognizedLabels.add(key); if (currentStatus) currentStatus.description = value || undefined; else structuralWarnings.push("Line " + lineNumber + ": Loan Status Description appeared without a preceding Loan Status."); continue; }
      if (key === "Loan Status Effective Date") { recognizedLabels.add(key); if (currentStatus) currentStatus.effectiveDate = value || undefined; else structuralWarnings.push("Line " + lineNumber + ": Loan Status Effective Date appeared without a preceding Loan Status."); continue; }
      if (key === "Loan Disbursement Date") { recognizedLabels.add(key); const loan = ensureCurrent(); currentDisbursement = { date: value || undefined }; loan.disbursements.push(currentDisbursement); continue; }
      if (key === "Loan Disbursement Amount") { recognizedLabels.add(key); if (currentDisbursement) currentDisbursement.amount = numericValue(value); else structuralWarnings.push("Line " + lineNumber + ": Loan Disbursement Amount appeared without a preceding disbursement date."); continue; }
      if (key === "Loan Contact Type") { recognizedLabels.add(key); const loan = ensureCurrent(); currentContact = { type: value || undefined }; loan.contacts.push(currentContact); continue; }
      if (key.startsWith("Loan Contact ")) {
        const contactFields = { "Loan Contact Code":"code", "Loan Contact Name":"name", "Loan Contact Street Address 1":"streetAddress1", "Loan Contact Street Address 2":"streetAddress2", "Loan Contact City":"city", "Loan Contact State Code":"stateCode", "Loan Contact Zip Code":"zipCode", "Loan Contact Phone Number":"phoneNumber", "Loan Contact Phone Extension":"phoneExtension", "Loan Contact Email Address":"emailAddress", "Loan Contact Web Site Address":"websiteAddress" };
        if (contactFields[key]) { recognizedLabels.add(key); if (currentContact && value) currentContact[contactFields[key]] = value; else if (!currentContact) structuralWarnings.push("Line " + lineNumber + ": " + key + " appeared without a preceding Loan Contact Type."); }
        else unmappedLabels.add(key);
        continue;
      }
      if (key === "Most Relevant") { recognizedLabels.add(key); if (currentContact) currentContact.mostRelevant = studentAidYesLocal(value) === true; else structuralWarnings.push("Line " + lineNumber + ": Most Relevant appeared without a preceding Loan Contact Type."); continue; }
      unmappedLabels.add(key);
    }
    pushCurrent();
    if (!hasAwardAnchors && records.length) structuralWarnings.push("Loan Award ID anchors were not present; parser used the conservative legacy loan-boundary fallback.");
    if (!records.length) validationIssues.push("No loan records were assembled from the StudentAid data.");
    const loans = records.map((loan, loanIndex) => {
      const dateForPeriod = loan.disbursements.find((item) => item.date)?.date || loan.loanDate;
      const mappedLoanType = mapLoanType(loan.loanTypeCode, loan.loanTypeDescription, loan.consolidationLoanWithAnyParentPlusIndicator);
      const period = disbursementPeriod(dateForPeriod);
      const newestStatus = latestStatus(loan.statuses || []);
      const explicitCode = String(loan.currentLoanStatusCode || "").trim().toUpperCase();
      const explicitDescription = String(loan.currentLoanStatusDescription || "").trim().toUpperCase();
      const newestCode = String(newestStatus?.code || "").trim().toUpperCase();
      const newestDescription = String(newestStatus?.description || "").trim().toUpperCase();
      if ((explicitCode && newestCode && explicitCode !== newestCode) || (explicitDescription && newestDescription && explicitDescription !== newestDescription)) structuralWarnings.push("Loan " + (loanIndex + 1) + ": explicit current status differs from the newest dated status timeline entry.");
      const status = explicitDescription || newestDescription;
      const inDefault = status.includes("DEFAULT") && !status.includes("NON-DEFAULT");
      const provenance = { ...loan.provenance };
      if (mappedLoanType) provenance.mappedLoanType = "derived_studentaid";
      if (period) provenance.disbursementPeriod = "derived_studentaid";
      provenance.inDefault = "derived_studentaid";
      const { __hasAwardAnchor, ...normalizedLoan } = loan;
      return { ...normalizedLoan, loanIndex, mappedLoanType, disbursementPeriod: period, inDefault, provenance };
    });
    const active = loans.filter((loan) => typeof loan.outstandingPrincipal === "number" && loan.outstandingPrincipal > 0);
    const repaymentLoans = active.filter((loan) => typeof loan.interestRatePercent === "number").map((loan) => ({ principal: loan.outstandingPrincipal, annualInterestRatePercent: loan.interestRatePercent }));
    const fullyMappedForEligibility = active.length > 0 && active.every((loan) => loan.mappedLoanType && loan.disbursementPeriod);
    const eligibilityLoans = fullyMappedForEligibility ? active.map((loan) => ({ loanType: loan.mappedLoanType, disbursementPeriod: loan.disbursementPeriod, ...(loan.inDefault ? { inDefault: true } : {}) })) : undefined;
    const totalPrincipal = active.reduce((sum, loan) => sum + loan.outstandingPrincipal, 0);
    const totalInterest = active.reduce((sum, loan) => sum + (loan.outstandingInterest || 0), 0);
    const ambiguousCount = active.filter((loan) => !loan.mappedLoanType || !loan.disbursementPeriod).length;
    const name = [student["Student First Name"], student["Student Middle Initial"], student["Student Last Name"]].filter(Boolean).join(" ").trim();
    const preferredPhoneKeys = [["Student Cell Phone Number","Student Cell Phone Country Code","Student Cell Phone Preferred"],["Student Home Phone Number","Student Home Phone Country Code","Student Home Phone Preferred"],["Student Work Phone Number","Student Work Phone Country Code","Student Work Phone Preferred"]];
    const phoneChoice = preferredPhoneKeys.find(([numberKey,,preferredKey]) => student[numberKey] && studentAidYesLocal(student[preferredKey]) === true) || preferredPhoneKeys.find(([numberKey]) => student[numberKey]);
    const phone = phoneChoice ? [student[phoneChoice[1]] ? "+" + String(student[phoneChoice[1]]).replace(/^\+/,"") : "", student[phoneChoice[0]]].filter(Boolean).join(" ") : "";
    const borrower = { provenance: {} };
    [["displayName",name],["email",student["Student Email Address"]],["phone",phone],["streetAddress1",student["Student Street Address 1"]],["streetAddress2",student["Student Street Address 2"]],["city",student["Student City"]],["stateCode",student["Student State Code"]],["countryCode",student["Student Country Code"]],["zipCode",student["Student Zip Code"]]].forEach(([field,value]) => { if (value) { borrower[field] = String(value).trim(); borrower.provenance[field] = "imported_studentaid"; } });
    const relevantContact = active.flatMap((loan) => loan.contacts || []).find((contact) => contact.mostRelevant && contact.name) || active.flatMap((loan) => loan.contacts || []).find((contact) => contact.name);
    const summary = { loanCount: loans.length, activeLoanCount: active.length, totalOutstandingPrincipal: totalPrincipal, totalOutstandingInterest: totalInterest, repaymentLoanCount: repaymentLoans.length, eligibilityMappedLoanCount: active.length - ambiguousCount, ambiguousEligibilityLoanCount: ambiguousCount, hasLoanDisbursedOnOrAfterJuly1_2026: active.some((loan) => loan.disbursementPeriod === "on_or_after_2026_07_01") };
    const diagnostics = { mappingVersion: "2026-09-05-v2", rawLineCount: rawLines.length, parsedLineCount: tokens.length, recognizedLabelCount: recognizedLabels.size, unmappedLabels: Array.from(unmappedLabels).filter(Boolean).sort(), structuralWarnings, validationIssues };
    return { fileRequestDate, borrower, loans, repaymentLoans, eligibilityLoans, totalPrincipal, totalInterest, ambiguousCount, summary, servicerName: relevantContact?.name || null, diagnostics };
  }

  async function api(path, init = {}) {
    const headers = new Headers(init.headers || {});
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method || "GET")) headers.set("x-csrf-token", csrfToken);
    const response = await fetch(path, { ...init, headers });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { throw new Error("Advisor service returned an invalid response."); }
    if (!response.ok || !body?.ok) {
      const error = new Error(body?.error || "Advisor request failed.");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function showAuth(message = "") {
    advisor = null;
    csrfToken = null;
    authPanel.hidden = false;
    workspace.hidden = true;
    authStatus.textContent = message;
  }

  function showWorkspace(session) {
    advisor = session.advisor;
    csrfToken = session.csrfToken;
    authPanel.hidden = true;
    workspace.hidden = false;
    advisorName.textContent = session.advisor.displayName + " · clients";
  }

  function addText(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  async function downloadClient(clientId) {
    try {
      const body = await api("/api/advisor/clients/" + encodeURIComponent(clientId) + "/export");
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "advisor-client-" + clientId + ".json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Unable to export client."; }
  }

  async function archiveClient(client) {
    if (!window.confirm("Archive " + client.displayName + "? The record remains saved and can still be exported.")) return;
    try {
      await api("/api/advisor/clients/" + encodeURIComponent(client.clientId) + "/archive", { method: "POST", body: JSON.stringify({ expectedUpdatedAt: client.updatedAt }) });
      await loadClients();
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Unable to archive client."; }
  }

  async function generateShareLink(client, box) {
    box.hidden = false;
    box.replaceChildren(addText("p", "Creating share link…", "muted"));
    try {
      const body = await api("/api/advisor/clients/" + encodeURIComponent(client.clientId) + "/plan-selections", { method: "POST", body: "{}" });
      const url = location.origin + "/share/" + body.selection.shareToken;
      box.replaceChildren();
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.marginTop = "8px";
      const input = document.createElement("input");
      input.value = url;
      input.readOnly = true;
      input.addEventListener("click", () => input.select());
      const copyButton = addText("button", "Copy", "secondary");
      copyButton.type = "button";
      copyButton.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(url); copyButton.textContent = "Copied"; setTimeout(() => { copyButton.textContent = "Copy"; }, 1500); }
        catch { input.select(); }
      });
      const openLink = document.createElement("a");
      openLink.href = url;
      openLink.target = "_blank";
      openLink.rel = "noopener";
      openLink.className = "button-link secondary";
      openLink.textContent = "Open";
      row.append(input, copyButton, openLink);
      box.appendChild(row);
      const note = addText("p", "This link expires 15 minutes after your borrower opens it unless they pick and confirm a plan first — only send it once they’re ready to look at it. It is not password-protected, so treat it as sensitive.", "muted");
      note.style.marginTop = "6px";
      box.appendChild(note);
    } catch (error) {
      box.replaceChildren(addText("p", error instanceof Error ? error.message : "Unable to create a share link.", "muted"));
    }
  }

  function renderClients(clients) {
    clientList.replaceChildren();
    if (!clients.length) {
      clientList.appendChild(addText("p", "No matching clients yet.", "muted"));
      return;
    }
    clients.forEach((client) => {
      const card = document.createElement("article");
      card.className = "client-card";
      const head = document.createElement("div");
      head.className = "client-head";
      const title = document.createElement("div");
      title.appendChild(addText("strong", client.displayName));
      title.appendChild(addText("div", "Updated " + new Date(client.updatedAt).toLocaleString(), "muted"));
      const badges = document.createElement("div");
      badges.className = "badges";
      (client.signals || []).slice(0, 4).forEach((signal) => badges.appendChild(addText("span", signal.label, "badge" + (signal.attention ? " attention" : ""))));
      head.append(title, badges);
      card.appendChild(head);
      const primary = client.signals?.[0];
      if (primary) {
        card.appendChild(addText("p", primary.reason + (primary.dueDate ? " Due " + primary.dueDate + "." : ""), "muted action-reason"));
        card.appendChild(addText("p", "Next best action: " + client.nextBestAction.label + ".", primary.attention ? "attention" : "muted"));
      }
      const actions = document.createElement("div");
      actions.className = "actions";
      const nextAction = addText("button", client.nextBestAction?.label || "Open guided workflow");
      nextAction.type = "button";
      const shareLinkBox = document.createElement("div");
      shareLinkBox.hidden = true;
      nextAction.addEventListener("click", () => {
        if (client.nextBestAction?.kind === "share_borrower_review") void generateShareLink(client, shareLinkBox);
        else window.location.href = client.nextBestAction?.href || ("/?advisorClient=" + encodeURIComponent(client.clientId));
      });
      const open = addText("button", "Open case", "secondary");
      open.type = "button";
      open.addEventListener("click", () => { window.location.href = "/?advisorClient=" + encodeURIComponent(client.clientId) + "#advisor-case-workspace"; });
      const shareButton = addText("button", "Share review", "secondary");
      shareButton.type = "button";
      shareButton.addEventListener("click", () => { void generateShareLink(client, shareLinkBox); });
      const exportButton = addText("button", "Export", "secondary");
      exportButton.type = "button";
      exportButton.addEventListener("click", () => { void downloadClient(client.clientId); });
      const archiveButton = addText("button", "Archive", "secondary");
      archiveButton.type = "button";
      archiveButton.disabled = client.lifecycleState === "archived";
      archiveButton.addEventListener("click", () => { void archiveClient(client); });
      actions.append(nextAction, open, shareButton, exportButton, archiveButton);
      card.appendChild(actions);
      card.appendChild(shareLinkBox);
      clientList.appendChild(card);
    });
  }

  async function loadClients() {
    status.textContent = "Deriving client action states…";
    try {
      const query = search.value.trim();
      const body = await api("/api/advisor/action-dashboard" + (query ? "?search=" + encodeURIComponent(query) : ""));
      const dashboard = body.dashboard;
      renderClients(dashboard.clients || []);
      actionSummary.replaceChildren(
        addText("strong", String(dashboard.counts.total) + " clients"),
        addText("strong", String(dashboard.counts.attention) + " need attention")
      );
      status.textContent = String((dashboard.clients || []).length) + " client(s) shown · deterministic action projection " + dashboard.schema + ".";
    } catch (error) {
      if (error?.status === 401) { showAuth("Your advisor session expired. Sign in again."); return; }
      status.textContent = error instanceof Error ? error.message : "Unable to load advisor action dashboard.";
    }
  }

  async function authenticateWith(path, form) {
    authStatus.textContent = "Working…";
    const data = new FormData(form);
    const payload = { email: String(data.get("email") || ""), password: String(data.get("password") || "") };
    if (path.endsWith("register")) payload.displayName = String(data.get("displayName") || "");
    try {
      const body = await api(path, { method: "POST", body: JSON.stringify(payload) });
      showWorkspace(body);
      form.reset();
      await loadClients();
    } catch (error) { authStatus.textContent = error instanceof Error ? error.message : "Unable to authenticate."; }
  }

  loginForm.addEventListener("submit", (event) => { event.preventDefault(); void authenticateWith("/api/advisor/login", loginForm); });
  registerForm.addEventListener("submit", (event) => { event.preventDefault(); void authenticateWith("/api/advisor/register", registerForm); });
  searchForm.addEventListener("submit", (event) => { event.preventDefault(); void loadClients(); });
  createClientForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(createClientForm);
    const payload = { displayName: String(data.get("displayName") || "") };
    const email = String(data.get("email") || "").trim();
    const phone = String(data.get("phone") || "").trim();
    if (email) payload.email = email;
    if (phone) payload.phone = phone;
    status.textContent = "Creating client…";
    try {
      const body = await api("/api/advisor/clients", { method: "POST", body: JSON.stringify(payload) });
      window.location.href = "/?advisorClient=" + encodeURIComponent(body.client.clientId);
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Unable to create client."; }
  });
  studentAidIntakeFile.addEventListener("change", async () => {
    const file = studentAidIntakeFile.files && studentAidIntakeFile.files[0];
    if (!file) return;
    studentAidIntakeStatus.textContent = "Reading file locally…";
    studentAidIntakePreview.hidden = true;
    studentAidIntakeMatches.hidden = true;
    studentAidMatches = [];
    try {
      const text = await file.text();
      studentAidPortfolio = parseStudentAidData(text);
      studentAidIntakeName.value = studentAidPortfolio.borrower.displayName || "";
      const summary = studentAidPortfolio.summary;
      studentAidIntakeFacts.innerHTML = "";
      const addFact = (label, value) => {
        const dt = document.createElement("dt"); dt.textContent = label;
        const dd = document.createElement("dd"); dd.textContent = value;
        studentAidIntakeFacts.append(dt, dd);
      };
      addFact("Loans found", String(summary.loanCount) + " (" + summary.activeLoanCount + " with an outstanding balance)");
      addFact("Total outstanding principal", summary.totalOutstandingPrincipal ? ("$" + summary.totalOutstandingPrincipal.toLocaleString()) : "Not found");
      if (studentAidPortfolio.servicerName) addFact("Servicer contact found", studentAidPortfolio.servicerName);
      if (studentAidPortfolio.borrower.email) addFact("Email found", studentAidPortfolio.borrower.email);
      if (studentAidPortfolio.borrower.phone) addFact("Phone found", studentAidPortfolio.borrower.phone);
      if (summary.ambiguousEligibilityLoanCount) addFact("Needs review", summary.ambiguousEligibilityLoanCount + " loan(s) have ambiguous consolidation/eligibility facts and will need manual review after creation.");
      if (studentAidPortfolio.diagnostics) {
        addFact("Parser mapping", studentAidPortfolio.diagnostics.mappingVersion + " · " + studentAidPortfolio.diagnostics.recognizedLabelCount + " FSA labels recognized");
        if (studentAidPortfolio.diagnostics.unmappedLabels?.length) addFact("Unmapped FSA labels", studentAidPortfolio.diagnostics.unmappedLabels.join(", "));
        const diagnosticReviewCount = (studentAidPortfolio.diagnostics.structuralWarnings || []).length + (studentAidPortfolio.diagnostics.validationIssues || []).length;
        if (diagnosticReviewCount) addFact("Parser review", diagnosticReviewCount + " structural/validation item(s) need advisor review before relying on the import.");
      }
      studentAidIntakeStatus.textContent = "Raw file was read locally and will not be uploaded. Review the facts and parser diagnostics below, then create the client.";
      studentAidIntakePreview.hidden = false;
      const matchBody = {};
      if (studentAidPortfolio.borrower.displayName) matchBody.displayName = studentAidPortfolio.borrower.displayName;
      if (studentAidPortfolio.borrower.email) matchBody.email = studentAidPortfolio.borrower.email;
      if (studentAidPortfolio.borrower.phone) matchBody.phone = studentAidPortfolio.borrower.phone;
      if (Object.keys(matchBody).length) {
        try {
          const matchResult = await api("/api/advisor/clients/match", { method: "POST", body: JSON.stringify(matchBody) });
          studentAidMatches = matchResult.matches || [];
        } catch { studentAidMatches = []; }
      }
      studentAidIntakeMatchList.innerHTML = "";
      if (studentAidMatches.length) {
        studentAidMatches.forEach((match) => {
          const row = document.createElement("div");
          row.className = "client-head";
          const label = document.createElement("span");
          label.textContent = match.displayName + " — " + (match.matchStrength === "strong" ? "likely match" : "possible name match") + " (" + match.matchedOn.join(", ") + ")";
          const open = document.createElement("button");
          open.type = "button"; open.textContent = "Open existing client";
          open.addEventListener("click", () => { window.location.href = "/?advisorClient=" + encodeURIComponent(match.clientId); });
          row.append(label, open);
          studentAidIntakeMatchList.appendChild(row);
        });
        studentAidIntakeMatches.hidden = false;
      } else {
        studentAidIntakeMatches.hidden = true;
      }
    } catch (error) {
      studentAidIntakeStatus.textContent = error instanceof Error ? error.message : "Unable to read that file.";
      studentAidPortfolio = null;
    } finally {
      studentAidIntakeFile.value = "";
    }
  });
  studentAidIntakeCreate.addEventListener("click", async () => {
    if (!studentAidPortfolio) { studentAidIntakeStatus.textContent = "Choose a StudentAid file first."; return; }
    const name = studentAidIntakeName.value.trim();
    if (!name) { studentAidIntakeStatus.textContent = "Enter a client display name before creating."; return; }
    studentAidIntakeStatus.textContent = "Creating client…";
    const borrower = studentAidPortfolio.borrower;
    const contact = { displayName: name };
    ["email","phone","streetAddress1","streetAddress2","city","stateCode","countryCode","zipCode"].forEach((field) => { if (borrower[field]) contact[field] = borrower[field]; });
    const payload = { contact, fieldProvenance: { ...(borrower.provenance || {}) } };
    if (name !== borrower.displayName) payload.fieldProvenance.displayName = "advisor_entered";
    if (studentAidPortfolio.servicerName) payload.servicerName = studentAidPortfolio.servicerName;
    if (studentAidPortfolio.loans && studentAidPortfolio.loans.length) {
      payload.normalizedLoanPortfolio = { repaymentLoans: studentAidPortfolio.repaymentLoans || [], ...(studentAidPortfolio.eligibilityLoans ? { eligibilityLoans: studentAidPortfolio.eligibilityLoans } : {}), loans: studentAidPortfolio.loans, summary: studentAidPortfolio.summary };
    }
    payload.studentAidImport = { source: "studentaid_download", importedAt: new Date().toISOString(), mappingVersion: "2026-09-05-v2", rawFileRetained: false, ...(studentAidPortfolio.fileRequestDate ? { fileRequestDate: studentAidPortfolio.fileRequestDate } : {}) };
    try {
      const body = await api("/api/advisor/clients", { method: "POST", body: JSON.stringify(payload) });
      window.location.href = "/?advisorClient=" + encodeURIComponent(body.client.clientId);
    } catch (error) { studentAidIntakeStatus.textContent = error instanceof Error ? error.message : "Unable to create client."; }
  });
  logout.addEventListener("click", async () => {
    try { await api("/api/advisor/logout", { method: "POST", body: "{}" }); } catch {}
    showAuth("Signed out.");
  });

  (async () => {
    try {
      const response = await fetch("/api/advisor/session", { headers: { accept: "application/json" } });
      if (response.status === 401) { showAuth(); return; }
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Unable to resume advisor session.");
      showWorkspace(body);
      await loadClients();
    } catch (error) { showAuth(error instanceof Error ? error.message : "Unable to resume advisor session."); }
  })();
})();
</script>
</body>
</html>`;
