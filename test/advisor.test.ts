import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.ts";
import type { D1DatabaseBinding, D1PreparedStatement } from "../src/advisor.ts";

class SqliteD1Statement implements D1PreparedStatement {
  statement: any;
  values: unknown[];
  constructor(statement: any, values: unknown[] = []) { this.statement = statement; this.values = values; }
  bind(...values: unknown[]): D1PreparedStatement { return new SqliteD1Statement(this.statement, values); }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.statement.get(...this.values) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.statement.all(...this.values) as T[] };
  }
  async run(): Promise<{ meta?: { changes?: number } }> {
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes ?? 0) } };
  }
}

class SqliteD1 implements D1DatabaseBinding {
  readonly database = new DatabaseSync(":memory:");
  prepare(sql: string): D1PreparedStatement { return new SqliteD1Statement(this.database.prepare(sql)); }
}

const BASE = "https://student-loan-idr-mcp.example";
const migration = [
  readFileSync(new URL("../migrations/0001_v0_8_2_advisor_workspace.sql", import.meta.url), "utf8"),
  readFileSync(new URL("../migrations/0002_v0_8_5_client_history.sql", import.meta.url), "utf8"),
  readFileSync(new URL("../migrations/0003_v0_9_1_plan_selections.sql", import.meta.url), "utf8"),
  readFileSync(new URL("../migrations/0004_v0_9_5_case_timeline.sql", import.meta.url), "utf8")
].join("\n");

function cookieHeader(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "expected a session cookie");
  return value.split(";", 1)[0]!;
}

async function register(env: Record<string, unknown>, email: string, displayName: string) {
  const response = await worker.fetch(new Request(`${BASE}/api/advisor/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, displayName, password: "correct horse battery staple" })
  }), env);
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.ok, true);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
  assert.match(response.headers.get("set-cookie") ?? "", /Secure/);
  assert.match(response.headers.get("set-cookie") ?? "", /SameSite=Strict/);
  return { cookie: cookieHeader(response), csrf: result.csrfToken as string, advisor: result.advisor };
}

async function advisorFetch(path: string, auth: { cookie: string; csrf: string }, env: Record<string, unknown>, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", auth.cookie);
  headers.set("origin", BASE);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(init.method ?? "GET")) headers.set("x-csrf-token", auth.csrf);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env);
}

test("V0.8.2 advisor sessions and D1 client CRUD are exact-owner scoped", async () => {
  const d1 = new SqliteD1();
  d1.database.exec(migration);
  const env = { ADVISOR_DB: d1 };

  const alpha = await register(env, "alpha@example.test", "Advisor Alpha");
  const beta = await register(env, "beta@example.test", "Advisor Beta");
  assert.notEqual(alpha.advisor.advisorId, beta.advisor.advisorId);

  const alphaToken = alpha.cookie.slice(alpha.cookie.indexOf("=") + 1);
  const storedSession = d1.database.prepare("SELECT session_hash, csrf_token_hash FROM advisor_sessions WHERE advisor_id = ?").get(alpha.advisor.advisorId) as { session_hash: string; csrf_token_hash: string };
  assert.notEqual(storedSession.session_hash, alphaToken, "session token must only be stored as a hash");
  assert.notEqual(storedSession.csrf_token_hash, alpha.csrf, "CSRF token must only be stored as a hash");

  const create = await advisorFetch("/api/advisor/clients", alpha, env, {
    method: "POST",
    body: JSON.stringify({ displayName: "Private Borrower", email: "borrower@example.test", phone: "555-0100" })
  });
  const created = await create.json();
  assert.equal(create.status, 201);
  assert.equal(created.client.ownerAdvisorId, alpha.advisor.advisorId);
  const clientId = created.client.clientId as string;

  const list = await advisorFetch("/api/advisor/clients", alpha, env);
  const listed = await list.json();
  assert.equal(list.status, 200);
  assert.equal(listed.clients.length, 1);
  assert.deepEqual(Object.keys(listed.clients[0]).sort(), ["clientId", "displayName", "lifecycleState", "readinessState", "updatedAt"].sort());
  assert.doesNotMatch(JSON.stringify(listed), /borrower@example\.test|555-0100/);

  const deniedRead = await advisorFetch(`/api/advisor/clients/${clientId}`, beta, env);
  assert.equal(deniedRead.status, 404);
  assert.equal((await deniedRead.json()).error, "Client not found or not accessible.");

  const deniedWrite = await advisorFetch(`/api/advisor/clients/${clientId}`, beta, env, {
    method: "PUT",
    body: JSON.stringify({ expectedUpdatedAt: created.client.updatedAt, notes: "cross-owner write" })
  });
  assert.equal(deniedWrite.status, 404);
  assert.equal((await deniedWrite.json()).error, "Client not found or not accessible.");

  const rawRetention = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, {
    method: "PUT",
    body: JSON.stringify({ expectedUpdatedAt: created.client.updatedAt, studentAidImport: { source: "studentaid_download", rawFileRetained: true } })
  });
  assert.equal(rawRetention.status, 400);
  assert.match((await rawRetention.json()).error, /Raw StudentAid files cannot be retained/);

  const rawTextRetention = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, {
    method: "PUT",
    body: JSON.stringify({ expectedUpdatedAt: created.client.updatedAt, normalizedLoanPortfolio: { repaymentLoans: [], loans: [{ rawText: "RAW-STUDENTAID-SHOULD-NEVER-PERSIST" }] } })
  });
  assert.equal(rawTextRetention.status, 400);
  assert.match((await rawTextRetention.json()).error, /Forbidden persisted client field: rawText/);

  const update = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, {
    method: "PUT",
    body: JSON.stringify({ expectedUpdatedAt: created.client.updatedAt, notes: "Advisor-only workflow note", readinessState: "document_ready", studentAidImport: { source: "studentaid_download", importedAt: "2026-08-28T14:00:00Z", rawFileRetained: false } })
  });
  const updated = await update.json();
  assert.equal(update.status, 200);
  assert.equal(updated.client.readinessState, "document_ready");
  assert.equal(updated.client.studentAidImport.rawFileRetained, false);

  const exported = await advisorFetch(`/api/advisor/clients/${clientId}/export`, alpha, env);
  const exportBody = await exported.json();
  assert.equal(exported.status, 200);
  assert.equal(exportBody.schema, "student-loan-idr-advisor-client-export-v3");
  assert.deepEqual(exportBody.timelineEvents, []);
  assert.deepEqual(exportBody.retainedArtifacts, []);
  assert.deepEqual(exportBody.calculationSnapshots, []);
  assert.equal(exportBody.client.notes, "Advisor-only workflow note");

  const archive = await advisorFetch(`/api/advisor/clients/${clientId}/archive`, alpha, env, { method: "POST", body: JSON.stringify({ expectedUpdatedAt: updated.client.updatedAt }) });
  const archived = await archive.json();
  assert.equal(archive.status, 200);
  assert.equal(archived.client.lifecycleState, "archived");

  const badCsrf = await advisorFetch(`/api/advisor/clients/${clientId}`, { ...alpha, csrf: "wrong-token" }, env, { method: "DELETE", body: JSON.stringify({ confirm: "delete", expectedUpdatedAt: archived.client.updatedAt }) });
  assert.equal(badCsrf.status, 403);

  const deletion = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, { method: "DELETE", body: JSON.stringify({ confirm: "delete", expectedUpdatedAt: archived.client.updatedAt }) });
  assert.equal(deletion.status, 200);
  assert.equal((await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env)).status, 404);

  const auditRows = d1.database.prepare("SELECT action, metadata_json FROM advisor_audit_events WHERE advisor_id = ? ORDER BY created_at").all(alpha.advisor.advisorId) as Array<{ action: string; metadata_json: string }>;
  assert.ok(auditRows.some(row => row.action === "client.create"));
  assert.ok(auditRows.some(row => row.action === "client.delete"));
  assert.ok(auditRows.every(row => row.metadata_json === "{}"));

  const resumed = await advisorFetch("/api/advisor/session", alpha, env);
  const resumeBody = await resumed.json();
  assert.equal(resumed.status, 200);
  assert.ok(resumeBody.csrfToken);
  assert.notEqual(resumeBody.csrfToken, alpha.csrf, "session resume must rotate CSRF token");
});

test("V0.8.3 advisor dashboard and saved guided client workflow are wired to normalized persistence", async () => {
  const d1 = new SqliteD1();
  d1.database.exec(migration);
  const env = { ADVISOR_DB: d1 };

  const advisorUi = await worker.fetch(new Request(`${BASE}/advisor`), env);
  const advisorHtml = await advisorUi.text();
  assert.equal(advisorUi.status, 200);
  assert.match(advisorUi.headers.get("content-type") ?? "", /text\/html/);
  assert.match(advisorUi.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.match(advisorHtml, /advisor \/ manager workspace/i);
  assert.match(advisorHtml, /id="login-form"/);
  assert.match(advisorHtml, /id="register-form"/);
  assert.match(advisorHtml, /id="create-client-form"/);
  assert.match(advisorHtml, /id="client-list"/);
  assert.match(advisorHtml, /Advisor action dashboard/);
  assert.match(advisorHtml, /raw StudentAid\.gov downloads/i);
  assert.match(advisorHtml, /2026-09-05-v2/);
  assert.match(advisorHtml, /awardFirstLayout/);
  assert.match(advisorHtml, /Loan Delinquency End Date/);
  assert.match(advisorHtml, /Parser mapping/);
  assert.match(advisorHtml, /Unmapped FSA labels/);
  assert.match(advisorHtml, /parser diagnostics below/i);
  assert.ok(advisorHtml.includes("fieldProvenance: { ...(borrower.provenance || {}) }"), "one-click FSA client creation must carry imported contact provenance");
  assert.doesNotMatch(advisorHtml, /localStorage|sessionStorage/);

  const guidedUi = await worker.fetch(new Request(`${BASE}/?advisorClient=client_00000000-0000-0000-0000-000000000000`), env);
  const guidedHtml = await guidedUi.text();
  assert.equal(guidedUi.status, 200);
  assert.match(guidedHtml, /id="advisor-client-bar"/);
  assert.match(guidedHtml, /id="advisor-save-progress"/);
  assert.match(guidedHtml, /id="advisor-regenerate-document"/);
  assert.match(guidedHtml, /\/api\/advisor\/session/);
  assert.match(guidedHtml, /saveAdvisorClientProgress/);
  assert.match(guidedHtml, /Raw StudentAid data and evidence files were not retained/i);

  const advisor = await register(env, "workspace@example.test", "Workspace Advisor");
  const create = await advisorFetch("/api/advisor/clients", advisor, env, {
    method: "POST",
    body: JSON.stringify({ displayName: "Saved Workflow Borrower" })
  });
  const created = await create.json();
  assert.equal(create.status, 201);

  const save = await advisorFetch(`/api/advisor/clients/${created.client.clientId}`, advisor, env, {
    method: "PUT",
    body: JSON.stringify({
      expectedUpdatedAt: created.client.updatedAt,
      readinessState: "application_ready",
      contact: { displayName: "Saved Workflow Borrower", email: "borrower@example.test", phone: "555-0100", streetAddress1: "100 Example Way", city: "Denver", stateCode: "CO", countryCode: "US", zipCode: "80202" },
      fieldProvenance: { displayName: "imported_studentaid", email: "advisor_entered", city: "imported_studentaid" },
      servicerName: "Example Servicer",
      confirmedFacts: {
        income: [{ cadence: "biweekly", amount: 1200 }],
        incomeSources: [{ sourceType: "employment", name: "Example Employer", grossAmount: 1200, paymentFrequency: "biweekly", evidenceState: "evidence_in_hand" }],
        region: "contiguous_us",
        familySize: 2,
        dependentsClaimedOnFederalTaxReturn: 1
      },
      normalizedLoanPortfolio: {
        repaymentLoans: [{ principal: 25000, annualInterestRatePercent: 6.5 }],
        eligibilityLoans: [{ loanType: "direct_unsubsidized", disbursementPeriod: "before_2026_07_01" }],
        loans: [{ loanIndex: 0, maskedAwardId: "MASKED-1", loanTypeCode: "D2", loanTypeDescription: "DIRECT UNSUBSIDIZED LOAN", mappedLoanType: "direct_unsubsidized", disbursementPeriod: "before_2026_07_01", outstandingPrincipal: 25000, outstandingInterest: 125, interestRatePercent: 6.5, currentLoanStatusDescription: "IN REPAYMENT", contacts: [{ type: "Current Servicer", name: "Example Servicer", mostRelevant: true }], provenance: { loanTypeCode: "imported_studentaid", mappedLoanType: "derived_studentaid", disbursementPeriod: "derived_studentaid", outstandingPrincipal: "imported_studentaid" } }],
        summary: { loanCount: 1, activeLoanCount: 1, totalOutstandingPrincipal: 25000, totalOutstandingInterest: 125, repaymentLoanCount: 1, eligibilityMappedLoanCount: 1, ambiguousEligibilityLoanCount: 0, hasLoanDisbursedOnOrAfterJuly1_2026: false }
      },
      studentAidImport: { source: "studentaid_download", importedAt: "2026-08-28T15:00:00Z", fileRequestDate: "08/28/2026", mappingVersion: "2026-08-28-v1", rawFileRetained: false }
    })
  });
  const saved = await save.json();
  assert.equal(save.status, 200);
  assert.equal(saved.client.readinessState, "application_ready");
  assert.equal(saved.client.confirmedFacts.familySize, 2);
  assert.equal(saved.client.confirmedFacts.incomeSources[0].name, "Example Employer");
  assert.equal(saved.client.normalizedLoanPortfolio.repaymentLoans[0].principal, 25000);
  assert.equal(saved.client.studentAidImport.rawFileRetained, false);
  assert.equal(saved.client.studentAidImport.mappingVersion, "2026-08-28-v1");
  assert.equal(saved.client.contact.streetAddress1, "100 Example Way");
  assert.equal(saved.client.fieldProvenance.email, "advisor_entered");
  assert.equal(saved.client.normalizedLoanPortfolio.loans[0].loanTypeCode, "D2");
  assert.equal(saved.client.normalizedLoanPortfolio.loans[0].contacts[0].name, "Example Servicer");
  assert.equal(saved.client.normalizedLoanPortfolio.summary.totalOutstandingInterest, 125);

  const resumed = await advisorFetch(`/api/advisor/clients/${created.client.clientId}`, advisor, env);
  const resumedBody = await resumed.json();
  assert.equal(resumed.status, 200);
  assert.equal(resumedBody.client.servicerName, "Example Servicer");
  assert.equal(resumedBody.client.confirmedFacts.dependentsClaimedOnFederalTaxReturn, 1);
  assert.equal(resumedBody.client.normalizedLoanPortfolio.eligibilityLoans[0].loanType, "direct_unsubsidized");
  assert.equal(resumedBody.client.normalizedLoanPortfolio.loans[0].maskedAwardId, "MASKED-1");
  assert.equal(resumedBody.client.studentAidImport.fileRequestDate, "08/28/2026");
});

test("real-size normalized FSA portfolios can create and update advisor clients without weakening the default 64 KiB API ceiling", async () => {
  const d1 = new SqliteD1();
  d1.database.exec(migration);
  const env = { ADVISOR_DB: d1 };
  const health = await worker.fetch(new Request(`${BASE}/health`), env);
  const healthBody = await health.json();
  assert.equal(health.status, 200);
  assert.equal(healthBody.hardening.max_request_bytes, 64 * 1024, "general/MCP request ceiling must remain 64 KiB");
  assert.equal(healthBody.advisor_workspace.max_normalized_client_request_bytes, 512 * 1024, "normalized client create/update ceiling must be independently bounded");
  const advisor = await register(env, "large-fsa@example.test", "Large FSA Advisor");

  const loans = Array.from({ length: 32 }, (_, loanIndex) => ({
    loanIndex,
    maskedAwardId: `••••${String(loanIndex).padStart(4, "0")}`,
    loanTypeCode: "D2",
    loanTypeDescription: "DIRECT STAFFORD UNSUBSIDIZED",
    mappedLoanType: "direct_unsubsidized",
    disbursementPeriod: "before_2026_07_01",
    outstandingPrincipal: loanIndex < 6 ? 1000 : 0,
    outstandingInterest: loanIndex < 6 ? 25 : 0,
    interestRatePercent: 6.5,
    currentLoanStatusCode: "RP",
    currentLoanStatusDescription: "IN REPAYMENT",
    repaymentPlanTypeCode: "IB",
    repaymentPlanDescription: "INCOME-BASED REPAYMENT",
    repaymentPlanBeginDate: "01/01/2026",
    repaymentPlanScheduledAmount: 25,
    repaymentPlanIdrAnniversaryDate: "05/01/2027",
    nextPaymentDueDate: "04/15/2026",
    statuses: Array.from({ length: 10 }, (_, statusIndex) => ({
      code: statusIndex % 2 === 0 ? "RP" : "FB",
      description: statusIndex % 2 === 0 ? "IN REPAYMENT" : "FORBEARANCE",
      effectiveDate: `${String((statusIndex % 9) + 1).padStart(2, "0")}/01/2025`
    })),
    disbursements: [
      { date: "08/15/2024", amount: 1500 },
      { date: "01/15/2025", amount: 1500 },
      { date: "08/15/2025", amount: 1500 }
    ],
    contacts: [
      { type: "Current Servicer", name: "Example Department of Education Servicer", phoneNumber: "8005550101", mostRelevant: true },
      { type: "School", name: "Example State University", websiteAddress: "https://example.invalid/school" }
    ],
    provenance: {
      maskedAwardId: "derived_studentaid", loanTypeCode: "imported_studentaid", loanTypeDescription: "imported_studentaid",
      mappedLoanType: "derived_studentaid", disbursementPeriod: "derived_studentaid", outstandingPrincipal: "imported_studentaid",
      outstandingInterest: "imported_studentaid", interestRatePercent: "imported_studentaid", currentLoanStatusCode: "imported_studentaid",
      currentLoanStatusDescription: "imported_studentaid", repaymentPlanTypeCode: "imported_studentaid", repaymentPlanDescription: "imported_studentaid",
      repaymentPlanBeginDate: "imported_studentaid", repaymentPlanScheduledAmount: "imported_studentaid", repaymentPlanIdrAnniversaryDate: "imported_studentaid",
      nextPaymentDueDate: "imported_studentaid", statuses: "imported_studentaid", disbursements: "imported_studentaid", contacts: "imported_studentaid"
    }
  }));
  const normalizedLoanPortfolio = {
    repaymentLoans: Array.from({ length: 6 }, () => ({ principal: 1000, annualInterestRatePercent: 6.5 })),
    eligibilityLoans: Array.from({ length: 32 }, () => ({ loanType: "direct_unsubsidized", disbursementPeriod: "before_2026_07_01" })),
    loans,
    summary: { loanCount: 32, activeLoanCount: 6, totalOutstandingPrincipal: 6000, totalOutstandingInterest: 150, repaymentLoanCount: 6, eligibilityMappedLoanCount: 32, ambiguousEligibilityLoanCount: 0, hasLoanDisbursedOnOrAfterJuly1_2026: false }
  };
  const createPayload = {
    contact: { displayName: "Large Portfolio Borrower", email: "borrower@example.test", phone: "555-0100" },
    servicerName: "Example Department of Education Servicer",
    normalizedLoanPortfolio,
    studentAidImport: { source: "studentaid_download", fileRequestDate: "09/05/2026", mappingVersion: "2026-09-05-v2", rawFileRetained: false }
  };
  const createText = JSON.stringify(createPayload);
  const createBytes = new TextEncoder().encode(createText).byteLength;
  assert.ok(createBytes > 64 * 1024, `fixture must exceed the legacy 64 KiB advisor limit, got ${createBytes}`);
  assert.ok(createBytes < 512 * 1024, `fixture must stay inside the normalized-client ceiling, got ${createBytes}`);

  const create = await advisorFetch("/api/advisor/clients", advisor, env, { method: "POST", body: createText });
  const created = await create.json();
  assert.equal(create.status, 201);
  assert.equal(created.client.normalizedLoanPortfolio.loans.length, 32);
  assert.equal(created.client.normalizedLoanPortfolio.summary.activeLoanCount, 6);
  assert.equal(created.client.studentAidImport.rawFileRetained, false);

  const updateText = JSON.stringify({ expectedUpdatedAt: created.client.updatedAt, normalizedLoanPortfolio, notes: "Large normalized FSA portfolio saved successfully." });
  assert.ok(new TextEncoder().encode(updateText).byteLength > 64 * 1024, "save-progress fixture must also exceed 64 KiB");
  const update = await advisorFetch(`/api/advisor/clients/${created.client.clientId}`, advisor, env, { method: "PUT", body: updateText });
  const updated = await update.json();
  assert.equal(update.status, 200);
  assert.equal(updated.client.normalizedLoanPortfolio.loans.length, 32);
  assert.equal(updated.client.notes, "Large normalized FSA portfolio saved successfully.");

  const oversized = JSON.stringify({ contact: { displayName: "Too Large" }, normalizedLoanPortfolio: { loans: [{ note: "x".repeat(520 * 1024) }] } });
  assert.ok(new TextEncoder().encode(oversized).byteLength > 512 * 1024);
  const rejected = await advisorFetch("/api/advisor/clients", advisor, env, { method: "POST", body: oversized });
  assert.equal(rejected.status, 413);
  assert.equal((await rejected.json()).error, "Request body too large.");
});

test("V0.8.4 advisor comparison reuses saved facts, bounds forgiveness, and stays exact-owner scoped", async () => {
  const d1 = new SqliteD1();
  d1.database.exec(migration);
  const env = { ADVISOR_DB: d1 };
  const alpha = await register(env, "comparison-alpha@example.test", "Comparison Alpha");
  const beta = await register(env, "comparison-beta@example.test", "Comparison Beta");

  const ui = await worker.fetch(new Request(`${BASE}/?advisorClient=client_00000000-0000-0000-0000-000000000000`), env);
  const html = await ui.text();
  assert.equal(ui.status, 200);
  assert.match(html, /id="advisor-compare-plans"/);
  assert.match(html, /id="advisor-comparison-workspace"/);
  assert.match(html, /id="advisor-payment-chart"/);
  assert.match(html, /id="advisor-paid-chart"/);
  assert.match(html, /id="advisor-balance-chart"/);
  assert.match(html, /id="advisor-forgiveness-chart"/);
  assert.match(html, /Modeled estimate/);
  assert.match(html, /runAdvisorComparison/);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);

  const create = await advisorFetch("/api/advisor/clients", alpha, env, {
    method: "POST",
    body: JSON.stringify({ displayName: "Comparison Borrower" })
  });
  const created = await create.json();
  const clientId = created.client.clientId as string;

  const saveWithoutTiming = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, {
    method: "PUT",
    body: JSON.stringify({
      expectedUpdatedAt: created.client.updatedAt,
      confirmedFacts: {
        income: [{ cadence: "annual", amount: 25000 }],
        region: "contiguous_us",
        familySize: 1,
        dependentsClaimedOnFederalTaxReturn: 0,
        taxFilingStatus: "single"
      },
      normalizedLoanPortfolio: {
        repaymentLoans: [{ principal: 25000, annualInterestRatePercent: 6.5 }],
        eligibilityLoans: [{ loanType: "direct_unsubsidized", disbursementPeriod: "before_2026_07_01" }]
      }
    })
  });
  const withoutTiming = await saveWithoutTiming.json();
  assert.equal(saveWithoutTiming.status, 200);

  const unknown = await advisorFetch(`/api/advisor/clients/${clientId}/comparison`, alpha, env);
  const unknownBody = await unknown.json();
  assert.equal(unknown.status, 200);
  assert.equal(unknownBody.comparison.schema, "student-loan-idr-advisor-comparison-v1");
  assert.equal(unknownBody.comparison.projections.length, 4);
  const unknownIbr = unknownBody.comparison.projections.find((plan: any) => plan.plan === "IBR");
  assert.equal(unknownIbr.projectionKind, "horizon_unknown");
  assert.equal(unknownIbr.projectedForgiveness, null);

  const denied = await advisorFetch(`/api/advisor/clients/${clientId}/comparison`, beta, env);
  assert.equal(denied.status, 404);
  assert.equal((await denied.json()).error, "Client not found or not accessible.");

  const saveTiming = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, {
    method: "PUT",
    body: JSON.stringify({
      expectedUpdatedAt: withoutTiming.client.updatedAt,
      confirmedFacts: {
        ...withoutTiming.client.confirmedFacts,
        newBorrowerOnOrAfterJuly1_2014: true
      }
    })
  });
  const timed = await saveTiming.json();
  assert.equal(saveTiming.status, 200);
  assert.equal(timed.client.confirmedFacts.newBorrowerOnOrAfterJuly1_2014, true);

  const comparison = await advisorFetch(`/api/advisor/clients/${clientId}/comparison`, alpha, env);
  const body = await comparison.json();
  assert.equal(comparison.status, 200);
  assert.equal(body.comparison.policySnapshot, "2026-08-27");
  assert.match(body.comparison.assumptions.join("\n"), /modeled estimates/i);

  const rap = body.comparison.projections.find((plan: any) => plan.plan === "RAP");
  assert.equal(rap.projectionKind, "forgiveness_horizon");
  assert.equal(rap.horizonMonths, 360);
  assert.ok(rap.projectedInterestWaived > 0);
  assert.ok(rap.projectedPrincipalMatch > 0);
  assert.ok(rap.projectedForgiveness >= 0);
  assert.equal(rap.series[0].month, 0);
  assert.ok(rap.series.length > 2);

  const ibr = body.comparison.projections.find((plan: any) => plan.plan === "IBR");
  assert.equal(ibr.projectionKind, "forgiveness_horizon");
  assert.equal(ibr.horizonMonths, 240);
  assert.ok(ibr.projectedForgiveness > 0);
  assert.match(ibr.warnings.join("\n"), /interest subsidies/i);

  for (const planName of ["PAYE", "ICR"]) {
    const plan = body.comparison.projections.find((candidate: any) => candidate.plan === planName);
    assert.equal(plan.projectionKind, "sunset_only");
    assert.equal(plan.horizonMonths, 22);
    assert.equal(plan.projectedForgiveness, null);
    assert.match(plan.horizonLabel, /July 1, 2028/);
  }

  const postComparisonRead = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env);
  const postBody = await postComparisonRead.json();
  assert.equal(postBody.client.updatedAt, timed.client.updatedAt, "comparison must not mutate the client record");
  const auditRows = d1.database.prepare("SELECT action FROM advisor_audit_events WHERE advisor_id = ?").all(alpha.advisor.advisorId) as Array<{ action: string }>;
  assert.ok(auditRows.some((row) => row.action === "client.compare"));
});

test("V0.8.5 explicitly retains owner-scoped document and calculation history with immutable rerun basis", async () => {
  const d1 = new SqliteD1();
  d1.database.exec(migration);
  d1.database.exec("PRAGMA foreign_keys = ON");
  const env = { ADVISOR_DB: d1 };
  const alpha = await register(env, "history-alpha@example.test", "History Alpha");
  const beta = await register(env, "history-beta@example.test", "History Beta");

  const ui = await worker.fetch(new Request(`${BASE}/?advisorClient=client_00000000-0000-0000-0000-000000000000`), env);
  const html = await ui.text();
  assert.match(html, /id="advisor-history-workspace"/);
  assert.match(html, /id="advisor-retain-document"/);
  assert.match(html, /id="advisor-retain-calculation"/);
  assert.match(html, /id="advisor-retain-comparison"/);
  assert.match(html, /Rerun retained basis/);
  assert.match(html, /Raw StudentAid downloads and evidence files are never retained/);

  const create = await advisorFetch("/api/advisor/clients", alpha, env, { method:"POST", body:JSON.stringify({ displayName:"History Borrower" }) });
  const created = await create.json();
  const clientId = created.client.clientId as string;
  const save = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, { method:"PUT", body:JSON.stringify({
    expectedUpdatedAt:created.client.updatedAt,
    confirmedFacts:{ income:[{cadence:"annual",amount:25000}], region:"contiguous_us", familySize:1, dependentsClaimedOnFederalTaxReturn:0, taxFilingStatus:"single", newBorrowerOnOrAfterJuly1_2014:true },
    normalizedLoanPortfolio:{ repaymentLoans:[{principal:25000,annualInterestRatePercent:6.5}], eligibilityLoans:[{loanType:"direct_unsubsidized",disbursementPeriod:"before_2026_07_01"}] },
    consideredPlans:["RAP","IBR"]
  }) });
  const saved = await save.json();
  assert.equal(save.status, 200);

  const retainedDocument = await advisorFetch(`/api/advisor/clients/${clientId}/artifacts`, alpha, env, { method:"POST", body:JSON.stringify({ name:"August income statement", templateRequest:{ templateType:"current_income_statement", outputFormat:"text", borrowerName:"History Borrower", servicerName:"Example Servicer", incomeSources:[{sourceType:"employment",name:"Example Employer",grossAmount:1000,paymentFrequency:"biweekly"}] } }) });
  const documentBody = await retainedDocument.json();
  assert.equal(retainedDocument.status, 201);
  assert.equal(documentBody.artifact.name, "August income statement");
  assert.match(documentBody.artifact.documentText, /History Borrower/);
  assert.match(documentBody.artifact.documentHtml, /^<!doctype html>/);
  const artifactId = documentBody.artifact.artifactId as string;

  const artifacts = await advisorFetch(`/api/advisor/clients/${clientId}/artifacts`, alpha, env);
  const artifactsBody = await artifacts.json();
  assert.equal(artifactsBody.artifacts.length, 1);
  assert.deepEqual(Object.keys(artifactsBody.artifacts[0]).sort(), ["artifactId","artifactKind","createdAt","engineVersion","name"].sort());
  assert.doesNotMatch(JSON.stringify(artifactsBody), /Example Employer|History Borrower/);
  const betaArtifact = await advisorFetch(`/api/advisor/clients/${clientId}/artifacts/${artifactId}`, beta, env);
  assert.equal(betaArtifact.status, 404);
  const regenerate = await advisorFetch(`/api/advisor/clients/${clientId}/artifacts/${artifactId}/regenerate`, alpha, env, { method:"POST", body:"{}" });
  const regeneratedBody = await regenerate.json();
  assert.equal(regenerate.status, 200);
  assert.match(regeneratedBody.regenerated.documentText, /Example Employer/);

  const comparisonSnapshot = await advisorFetch(`/api/advisor/clients/${clientId}/snapshots`, alpha, env, { method:"POST", body:JSON.stringify({ name:"August forgiveness comparison", snapshotKind:"comparison" }) });
  const comparisonSnapshotBody = await comparisonSnapshot.json();
  assert.equal(comparisonSnapshot.status, 201);
  assert.equal(comparisonSnapshotBody.snapshot.snapshotKind, "comparison");
  assert.equal(comparisonSnapshotBody.snapshot.result.projections.length, 4);
  const snapshotId = comparisonSnapshotBody.snapshot.snapshotId as string;
  const retainedRapPayment = comparisonSnapshotBody.snapshot.result.projections.find((p:any)=>p.plan==="RAP").currentMonthlyPayment;

  const calculationSnapshot = await advisorFetch(`/api/advisor/clients/${clientId}/snapshots`, alpha, env, { method:"POST", body:JSON.stringify({ name:"August RAP and IBR calculation", snapshotKind:"calculation" }) });
  const calculationBody = await calculationSnapshot.json();
  assert.equal(calculationSnapshot.status, 201);
  assert.deepEqual(calculationBody.snapshot.result.planEstimates.map((p:any)=>p.plan), ["RAP","IBR"]);

  const changed = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, { method:"PUT", body:JSON.stringify({ expectedUpdatedAt:saved.client.updatedAt, confirmedFacts:{ ...saved.client.confirmedFacts, income:[{cadence:"annual",amount:90000}] } }) });
  assert.equal(changed.status, 200);
  const rerun = await advisorFetch(`/api/advisor/clients/${clientId}/snapshots/${snapshotId}/rerun`, alpha, env, { method:"POST", body:"{}" });
  const rerunBody = await rerun.json();
  assert.equal(rerun.status, 201);
  assert.equal(rerunBody.rerun.basis, "retained_snapshot_basis");
  assert.notEqual(rerunBody.rerun.snapshotId, snapshotId, "rerun must create a new immutable snapshot");
  assert.equal(rerunBody.rerun.result.projections.find((p:any)=>p.plan==="RAP").currentMonthlyPayment, retainedRapPayment, "rerun must use retained basis rather than the later client update");

  const snapshots = await advisorFetch(`/api/advisor/clients/${clientId}/snapshots`, alpha, env);
  const snapshotsBody = await snapshots.json();
  assert.equal(snapshotsBody.snapshots.length, 3);
  assert.deepEqual(Object.keys(snapshotsBody.snapshots[0]).sort(), ["createdAt","engineVersion","name","policySnapshot","snapshotId","snapshotKind"].sort());
  assert.doesNotMatch(JSON.stringify(snapshotsBody), /90000|25000/);
  assert.equal((await advisorFetch(`/api/advisor/clients/${clientId}/snapshots/${snapshotId}`, beta, env)).status, 404);

  const exported = await advisorFetch(`/api/advisor/clients/${clientId}/export`, alpha, env);
  const exportBody = await exported.json();
  assert.equal(exportBody.schema, "student-loan-idr-advisor-client-export-v3");
  assert.equal(exportBody.caseContext.schema, "student-loan-idr-client-case-context-v1");
  assert.equal(exportBody.caseContext.schemaVersion, 1);
  assert.equal(exportBody.timelineEvents.length, 5);
  assert.equal(exportBody.retainedArtifacts.length, 1);
  assert.equal(exportBody.calculationSnapshots.length, 3);

  assert.equal((await advisorFetch(`/api/advisor/clients/${clientId}/artifacts/${artifactId}`, alpha, env, { method:"DELETE", body:"{}" })).status, 200);
  assert.equal((await advisorFetch(`/api/advisor/clients/${clientId}/snapshots/${snapshotId}`, alpha, env, { method:"DELETE", body:"{}" })).status, 200);
  assert.equal((await advisorFetch(`/api/advisor/clients/${clientId}/artifacts`, alpha, env).then(r=>r.json())).artifacts.length, 0);

  const current = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env); const currentBody = await current.json();
  const deletion = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, { method:"DELETE", body:JSON.stringify({confirm:"delete",expectedUpdatedAt:currentBody.client.updatedAt}) });
  assert.equal(deletion.status, 200);
  const remaining = d1.database.prepare("SELECT COUNT(*) AS n FROM advisor_client_calculation_snapshots WHERE owner_advisor_id=? AND client_id=?").get(alpha.advisor.advisorId,clientId) as {n:number};
  assert.equal(remaining.n, 0, "client deletion must cascade retained history");

  const auditRows = d1.database.prepare("SELECT action,metadata_json FROM advisor_audit_events WHERE advisor_id=?").all(alpha.advisor.advisorId) as Array<{action:string;metadata_json:string}>;
  for (const action of ["client.artifact.retain","client.artifact.regenerate","client.artifact.delete","client.snapshot.retain","client.snapshot.rerun","client.snapshot.delete"]) assert.ok(auditRows.some(row=>row.action===action), action);
  assert.ok(auditRows.every(row=>row.metadata_json==="{}"));
});

test("V0.9.5 automatically records owner-scoped material case events with immutable reproducible basis", async () => {
  const d1 = new SqliteD1();
  d1.database.exec(migration);
  d1.database.exec("PRAGMA foreign_keys = ON");
  const env = { ADVISOR_DB: d1 };
  const alpha = await register(env, "timeline-alpha@example.test", "Timeline Alpha");
  const beta = await register(env, "timeline-beta@example.test", "Timeline Beta");

  const health = await worker.fetch(new Request(`${BASE}/health`), env);
  const healthBody = await health.json();
  assert.equal(healthBody.advisor_workspace.client_timeline_v1, true);
  assert.equal(healthBody.advisor_workspace.automatic_case_history, true);

  const ui = await worker.fetch(new Request(`${BASE}/?advisorClient=client_00000000-0000-0000-0000-000000000000`), env);
  const html = await ui.text();
  assert.match(html, /Client timeline & retained history/);
  assert.match(html, /id="advisor-timeline-history"/);
  assert.match(html, /Rename \/ annotate/);
  assert.match(html, /added to the client timeline/);
  assert.match(html, /\/calculations/);
  assert.match(html, /\/comparisons/);
  assert.match(html, /\/documents\/generate/);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);

  const create = await advisorFetch("/api/advisor/clients", alpha, env, { method:"POST", body:JSON.stringify({
    displayName:"Timeline Borrower",
    confirmedFacts:{ income:[{cadence:"annual",amount:42000}], region:"contiguous_us", familySize:3, dependentsClaimedOnFederalTaxReturn:1, estimatedAboveTheLineAdjustments:1200, adjustedGrossIncomeOverride:40500, taxFilingStatus:"single", newBorrowerOnOrAfterJuly1_2014:true },
    normalizedLoanPortfolio:{ repaymentLoans:[{principal:30000,annualInterestRatePercent:6.5}], eligibilityLoans:[{loanType:"direct_unsubsidized",disbursementPeriod:"before_2026_07_01"}] },
    consideredPlans:["RAP","IBR"]
  }) });
  const created = await create.json();
  assert.equal(create.status, 201);
  const clientId = created.client.clientId as string;

  const automaticCalculation = await advisorFetch(`/api/advisor/clients/${clientId}/calculations`, alpha, env, { method:"POST", body:JSON.stringify({ plans:["RAP","IBR"] }) });
  const calculationBody = await automaticCalculation.json();
  assert.equal(automaticCalculation.status, 201);
  assert.equal(calculationBody.event.schema, "student-loan-idr-client-timeline-event-v1");
  assert.equal(calculationBody.event.eventKind, "calculation");
  assert.deepEqual(calculationBody.result.planEstimates.map((plan:any)=>plan.plan), ["RAP","IBR"]);
  assert.equal(calculationBody.snapshot.basis.confirmedFacts.estimatedAboveTheLineAdjustments, 1200);
  assert.equal(calculationBody.snapshot.basis.confirmedFacts.adjustedGrossIncomeOverride, 40500);
  const calculationEventId = calculationBody.event.eventId as string;
  const calculationSnapshotId = calculationBody.snapshot.snapshotId as string;

  const automaticComparison = await advisorFetch(`/api/advisor/clients/${clientId}/comparisons`, alpha, env, { method:"POST", body:"{}" });
  const comparisonBody = await automaticComparison.json();
  assert.equal(automaticComparison.status, 201);
  assert.equal(comparisonBody.event.eventKind, "comparison");
  assert.equal(comparisonBody.comparison.schema, "student-loan-idr-advisor-comparison-v1");

  const generatedDocument = await advisorFetch(`/api/advisor/clients/${clientId}/documents/generate`, alpha, env, { method:"POST", body:JSON.stringify({ templateRequest:{ templateType:"current_income_statement", outputFormat:"text", borrowerName:"Timeline Borrower", incomeSources:[{sourceType:"employment",name:"Timeline Employer",grossAmount:1600,paymentFrequency:"biweekly"}] } }) });
  const documentBody = await generatedDocument.json();
  assert.equal(generatedDocument.status, 200);
  assert.equal(documentBody.event.eventKind, "document_generated");
  assert.equal(documentBody.event.basis.templateType, "current_income_statement");
  assert.match(documentBody.document.documentText, /Timeline Employer/);

  const issued = await advisorFetch(`/api/advisor/clients/${clientId}/plan-selections`, alpha, env, { method:"POST", body:"{}" });
  const issuedBody = await issued.json();
  assert.equal(issued.status, 201);
  const shareToken = issuedBody.selection.shareToken as string;
  const opened = await worker.fetch(new Request(`${BASE}/api/share/${shareToken}`), env);
  assert.equal(opened.status, 200);
  const selected = await worker.fetch(new Request(`${BASE}/api/share/${shareToken}/select`, { method:"POST", headers:{"content-type":"application/json",origin:BASE}, body:JSON.stringify({plan:"IBR"}) }), env);
  assert.equal(selected.status, 200);
  const signed = await worker.fetch(new Request(`${BASE}/api/share/${shareToken}/sign`, { method:"POST", headers:{"content-type":"application/json",origin:BASE}, body:JSON.stringify({initials:"TB"}) }), env);
  assert.equal(signed.status, 200);

  const timeline = await advisorFetch(`/api/advisor/clients/${clientId}/timeline`, alpha, env);
  const timelineBody = await timeline.json();
  assert.equal(timeline.status, 200);
  assert.equal(timelineBody.schema, "student-loan-idr-client-timeline-v1");
  assert.equal(timelineBody.events.length, 6);
  assert.ok(timelineBody.events.some((event:any)=>event.eventKind==="calculation"));
  assert.ok(timelineBody.events.some((event:any)=>event.eventKind==="comparison"));
  assert.ok(timelineBody.events.some((event:any)=>event.eventKind==="document_generated"));
  assert.ok(timelineBody.events.some((event:any)=>event.eventKind==="plan_selected"));
  assert.ok(timelineBody.events.some((event:any)=>event.eventKind==="plan_confirmed"));
  assert.ok(timelineBody.events.every((event:any)=>event.basis===undefined && event.result===undefined), "timeline list must remain compact");
  assert.match(timelineBody.events.find((event:any)=>event.eventKind==="calculation").summary, /income \$42,000 · family size 3 · policy snapshot 2026-08-27/);

  const detailed = await advisorFetch(`/api/advisor/clients/${clientId}/timeline/${calculationEventId}`, alpha, env);
  const detailedBody = await detailed.json();
  assert.equal(detailed.status, 200);
  assert.equal(detailedBody.event.basis.confirmedFacts.income[0].amount, 42000);
  assert.equal(detailedBody.event.basis.confirmedFacts.adjustedGrossIncomeOverride, 40500);
  assert.equal(detailedBody.event.result.policySnapshot, "2026-08-27");
  assert.equal((await advisorFetch(`/api/advisor/clients/${clientId}/timeline/${calculationEventId}`, beta, env)).status, 404);

  const renamed = await advisorFetch(`/api/advisor/clients/${clientId}/timeline/${calculationEventId}`, alpha, env, { method:"PATCH", body:JSON.stringify({ name:"September IBR/RAP consult", starred:true, annotation:"Borrower wants the lowest sustainable payment before enrollment." }) });
  const renamedBody = await renamed.json();
  assert.equal(renamed.status, 200);
  assert.equal(renamedBody.event.name, "September IBR/RAP consult");
  assert.equal(renamedBody.event.starred, true);
  assert.match(renamedBody.event.annotation, /lowest sustainable payment/);

  const publicCalculation = await worker.fetch(new Request(`${BASE}/api/calculate`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({income:[{cadence:"annual",amount:50000}],region:"contiguous_us",familySize:2,plans:["RAP"]}) }), env);
  assert.equal(publicCalculation.status, 200);
  const timelineAfterPrivate = await advisorFetch(`/api/advisor/clients/${clientId}/timeline`, alpha, env).then((response)=>response.json());
  assert.equal(timelineAfterPrivate.events.length, 6, "private borrower calculation must remain non-persistent");

  const changed = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, { method:"PUT", body:JSON.stringify({ expectedUpdatedAt:created.client.updatedAt, confirmedFacts:{ ...created.client.confirmedFacts, income:[{cadence:"annual",amount:90000}], adjustedGrossIncomeOverride:90000 } }) });
  assert.equal(changed.status, 200);
  const immutableDetailed = await advisorFetch(`/api/advisor/clients/${clientId}/timeline/${calculationEventId}`, alpha, env).then((response)=>response.json());
  assert.equal(immutableDetailed.event.basis.confirmedFacts.income[0].amount, 42000, "historical event basis must remain immutable after client facts change");

  const snapshotsBeforeTimelineDelete = await advisorFetch(`/api/advisor/clients/${clientId}/snapshots`, alpha, env).then((response)=>response.json());
  assert.ok(snapshotsBeforeTimelineDelete.snapshots.some((snapshot:any)=>snapshot.snapshotId===calculationSnapshotId));
  const deletedTimeline = await advisorFetch(`/api/advisor/clients/${clientId}/timeline/${calculationEventId}`, alpha, env, { method:"DELETE", body:"{}" });
  assert.equal(deletedTimeline.status, 200);
  const snapshotsAfterTimelineDelete = await advisorFetch(`/api/advisor/clients/${clientId}/snapshots`, alpha, env).then((response)=>response.json());
  assert.ok(snapshotsAfterTimelineDelete.snapshots.some((snapshot:any)=>snapshot.snapshotId===calculationSnapshotId), "deleting timeline metadata must not delete its immutable calculation snapshot");

  const exported = await advisorFetch(`/api/advisor/clients/${clientId}/export`, alpha, env);
  const exportBody = await exported.json();
  assert.equal(exportBody.schema, "student-loan-idr-advisor-client-export-v3");
  assert.ok(exportBody.timelineEvents.length >= 5);
  assert.ok(exportBody.calculationSnapshots.length >= 2);
  assert.doesNotMatch(JSON.stringify(exportBody), /RAW-STUDENTAID|socialsecuritynumber|sessiontoken/i);
});

test("V0.9.6 derives a minimized owner-scoped advisor action dashboard and deterministic next-best actions", async () => {
  const d1 = new SqliteD1();
  d1.database.exec(migration);
  d1.database.exec("PRAGMA foreign_keys = ON");
  const env = { ADVISOR_DB: d1 };
  const alpha = await register(env, "action-alpha@example.test", "Action Alpha");
  const beta = await register(env, "action-beta@example.test", "Action Beta");

  const health = await worker.fetch(new Request(`${BASE}/health`), env);
  const healthBody = await health.json();
  assert.equal(health.status, 200);
  assert.equal(healthBody.version, "0.9.6");
  assert.equal(healthBody.advisor_workspace.advisor_action_dashboard_v1, true);
  assert.equal(healthBody.advisor_workspace.deterministic_next_best_action, true);
  assert.ok(healthBody.endpoints.includes("GET /api/advisor/action-dashboard"));

  const advisorUi = await worker.fetch(new Request(`${BASE}/advisor`), env);
  const advisorHtml = await advisorUi.text();
  assert.match(advisorHtml, /Advisor action dashboard/);
  assert.match(advisorHtml, /Who needs attention and why/);
  assert.match(advisorHtml, /derived deterministically/i);
  assert.match(advisorHtml, /no income amounts, loan balances, contact details/i);
  assert.match(advisorHtml, /\/api\/advisor\/action-dashboard/);
  assert.match(advisorHtml, /Next best action:/);
  assert.doesNotMatch(advisorHtml, /localStorage|sessionStorage/);

  const privateCreate = await advisorFetch("/api/advisor/clients", beta, env, { method:"POST", body:JSON.stringify({ displayName:"Other Advisor Private Client", email:"other-owner-secret@example.test" }) });
  assert.equal(privateCreate.status, 201);

  const create = await advisorFetch("/api/advisor/clients", alpha, env, { method:"POST", body:JSON.stringify({ displayName:"Action Borrower", email:"action-secret@example.test", phone:"555-0199", notes:"PRIVATE-ACTION-NOTE" }) });
  const created = await create.json();
  assert.equal(create.status, 201);
  const clientId = created.client.clientId as string;

  const dashboard = async () => {
    const response = await advisorFetch("/api/advisor/action-dashboard", alpha, env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.dashboard.schema, "student-loan-idr-advisor-action-dashboard-v1");
    assert.equal(body.dashboard.schemaVersion, 1);
    return body.dashboard;
  };
  const actionClient = async () => (await dashboard()).clients.find((client:any)=>client.clientId===clientId);

  let action = await actionClient();
  assert.equal(action.primaryState, "needs_income");
  assert.equal(action.nextBestAction.kind, "collect_income");
  assert.ok(action.signals.some((signal:any)=>signal.state==="needs_income" && signal.attention));

  const incomeOnly = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, { method:"PUT", body:JSON.stringify({ expectedUpdatedAt:created.client.updatedAt, confirmedFacts:{ income:[{cadence:"annual",amount:87654}] } }) });
  const incomeOnlyBody = await incomeOnly.json();
  assert.equal(incomeOnly.status, 200);
  action = await actionClient();
  assert.equal(action.primaryState, "needs_family_size");
  assert.equal(action.nextBestAction.kind, "collect_family_size");

  const needsEvidence = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, { method:"PUT", body:JSON.stringify({ expectedUpdatedAt:incomeOnlyBody.client.updatedAt, readinessState:"needs_evidence", confirmedFacts:{ income:[{cadence:"annual",amount:87654}], incomeSources:[{sourceType:"employment",name:"Secret Employer",grossAmount:3371.31,paymentFrequency:"biweekly",evidenceState:"needs_evidence_review"}], region:"contiguous_us", familySize:2, dependentsClaimedOnFederalTaxReturn:1, taxFilingStatus:"single", newBorrowerOnOrAfterJuly1_2014:true } }) });
  const needsEvidenceBody = await needsEvidence.json();
  assert.equal(needsEvidence.status, 200);
  action = await actionClient();
  assert.equal(action.primaryState, "needs_evidence");
  assert.equal(action.nextBestAction.kind, "review_evidence");

  const documentReady = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, { method:"PUT", body:JSON.stringify({ expectedUpdatedAt:needsEvidenceBody.client.updatedAt, readinessState:"document_ready", confirmedFacts:{ ...needsEvidenceBody.client.confirmedFacts, incomeSources:[{sourceType:"employment",name:"Secret Employer",grossAmount:3371.31,paymentFrequency:"biweekly",evidenceState:"evidence_in_hand"}] } }) });
  const documentReadyBody = await documentReady.json();
  assert.equal(documentReady.status, 200);
  action = await actionClient();
  assert.equal(action.primaryState, "document_ready");
  assert.equal(action.nextBestAction.kind, "prepare_document");

  const applicationReady = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, { method:"PUT", body:JSON.stringify({ expectedUpdatedAt:documentReadyBody.client.updatedAt, readinessState:"application_ready", normalizedLoanPortfolio:{ repaymentLoans:[{principal:43210,annualInterestRatePercent:6.5}], eligibilityLoans:[{loanType:"direct_unsubsidized",disbursementPeriod:"before_2026_07_01"}] }, consideredPlans:["RAP","IBR"] }) });
  const applicationReadyBody = await applicationReady.json();
  assert.equal(applicationReady.status, 200);
  action = await actionClient();
  assert.equal(action.primaryState, "application_ready");
  assert.equal(action.nextBestAction.kind, "review_application");

  const issued = await advisorFetch(`/api/advisor/clients/${clientId}/plan-selections`, alpha, env, { method:"POST", body:"{}" });
  const issuedBody = await issued.json();
  assert.equal(issued.status, 201);
  const shareToken = issuedBody.selection.shareToken as string;
  action = await actionClient();
  assert.equal(action.primaryState, "borrower_review_pending");
  assert.equal(action.nextBestAction.kind, "share_borrower_review");
  assert.ok(action.signals.find((signal:any)=>signal.state==="borrower_review_pending")?.dueDate);

  assert.equal((await worker.fetch(new Request(`${BASE}/api/share/${shareToken}`), env)).status, 200);
  const selected = await worker.fetch(new Request(`${BASE}/api/share/${shareToken}/select`, { method:"POST", headers:{"content-type":"application/json",origin:BASE}, body:JSON.stringify({plan:"IBR"}) }), env);
  assert.equal(selected.status, 200);
  action = await actionClient();
  assert.equal(action.primaryState, "plan_selected");
  assert.equal(action.nextBestAction.kind, "review_plan_selection");

  const signed = await worker.fetch(new Request(`${BASE}/api/share/${shareToken}/sign`, { method:"POST", headers:{"content-type":"application/json",origin:BASE}, body:JSON.stringify({initials:"AB"}) }), env);
  assert.equal(signed.status, 200);
  action = await actionClient();
  assert.equal(action.primaryState, "booking_pending");
  assert.equal(action.nextBestAction.kind, "book_enrollment");

  const pad = (value:number) => String(value).padStart(2,"0");
  const formatFsaDate = (date:Date) => `${pad(date.getUTCMonth()+1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()}`;
  const now = new Date();
  const forbearanceStart = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
  const delinquencyStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const anniversary = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const current = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env).then((response)=>response.json());
  const intelligenceUpdate = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env, { method:"PUT", body:JSON.stringify({ expectedUpdatedAt:current.client.updatedAt, servicerName:"Secret Servicer", normalizedLoanPortfolio:{ repaymentLoans:[{principal:43210,annualInterestRatePercent:6.5}], eligibilityLoans:[{loanType:"direct_unsubsidized",disbursementPeriod:"before_2026_07_01"}], loans:[{loanIndex:0,outstandingPrincipal:43210,outstandingInterest:987,interestRatePercent:6.5,currentLoanStatusCode:"FB",currentLoanStatusDescription:"FORBEARANCE",repaymentPlanTypeCode:"IB",repaymentPlanDescription:"INCOME-BASED REPAYMENT",repaymentPlanIdrAnniversaryDate:formatFsaDate(anniversary),statuses:[{code:"FB",description:"FORBEARANCE",effectiveDate:formatFsaDate(forbearanceStart)}],delinquencies:[{date:formatFsaDate(delinquencyStart)}],contacts:[{type:"Current Servicer",name:"Secret Servicer",phoneNumber:"8005550199",mostRelevant:true}],provenance:{}}], summary:{loanCount:1,activeLoanCount:1,totalOutstandingPrincipal:43210,totalOutstandingInterest:987,repaymentLoanCount:1,eligibilityMappedLoanCount:1,ambiguousEligibilityLoanCount:0,hasLoanDisbursedOnOrAfterJuly1_2026:false} }, studentAidImport:{source:"studentaid_download",fileRequestDate:formatFsaDate(now),mappingVersion:"2026-09-05-v2",rawFileRetained:false} }) });
  assert.equal(intelligenceUpdate.status, 200);
  action = await actionClient();
  assert.equal(action.primaryState, "delinquency_attention");
  assert.ok(action.signals.some((signal:any)=>signal.state==="in_forbearance"));
  assert.ok(action.signals.some((signal:any)=>signal.state==="idr_anniversary_approaching" && signal.dueDate===formatFsaDate(anniversary)));
  assert.ok(action.signals.some((signal:any)=>signal.state==="booking_pending"));

  const beforeRead = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env).then((response)=>response.json());
  const beforeTimelineCount = (d1.database.prepare("SELECT COUNT(*) AS n FROM advisor_client_timeline_events WHERE owner_advisor_id=? AND client_id=?").get(alpha.advisor.advisorId,clientId) as {n:number}).n;
  const minimized = await dashboard();
  const minimizedJson = JSON.stringify(minimized);
  assert.equal(minimized.clients.some((client:any)=>client.displayName==="Other Advisor Private Client"), false, "dashboard must remain exact-owner scoped");
  assert.doesNotMatch(minimizedJson, /action-secret@example\.test|555-0199|PRIVATE-ACTION-NOTE|Secret Employer|3371\.31|87654|43210|987|Secret Servicer|8005550199|other-owner-secret@example\.test/);
  assert.doesNotMatch(minimizedJson, /ownerAdvisorId|confirmedFacts|normalizedLoanPortfolio|comparisonSnapshot|shareToken|bookingUrl|basis|result/);
  const afterRead = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env).then((response)=>response.json());
  const afterTimelineCount = (d1.database.prepare("SELECT COUNT(*) AS n FROM advisor_client_timeline_events WHERE owner_advisor_id=? AND client_id=?").get(alpha.advisor.advisorId,clientId) as {n:number}).n;
  assert.equal(afterRead.client.updatedAt, beforeRead.client.updatedAt, "dashboard GET must not mutate the client record");
  assert.equal(afterTimelineCount, beforeTimelineCount, "dashboard GET must not add timeline history");

  const archive = await advisorFetch(`/api/advisor/clients/${clientId}/archive`, alpha, env, { method:"POST", body:JSON.stringify({expectedUpdatedAt:beforeRead.client.updatedAt}) });
  assert.equal(archive.status, 200);
  action = await actionClient();
  assert.equal(action.primaryState, "archived");
  assert.equal(action.signals.length, 1, "archived must be a terminal dashboard state");

  const completedCreate = await advisorFetch("/api/advisor/clients", alpha, env, { method:"POST", body:JSON.stringify({displayName:"Completed Borrower"}) });
  const completedCreated = await completedCreate.json();
  const completedUpdate = await advisorFetch(`/api/advisor/clients/${completedCreated.client.clientId}`, alpha, env, { method:"PUT", body:JSON.stringify({expectedUpdatedAt:completedCreated.client.updatedAt,lifecycleState:"completed"}) });
  assert.equal(completedUpdate.status, 200);
  const completedDashboard = await dashboard();
  const completed = completedDashboard.clients.find((client:any)=>client.clientId===completedCreated.client.clientId);
  assert.equal(completed.primaryState, "completed");
  assert.equal(completed.signals.length, 1);
  assert.ok(completedDashboard.counts.byState.archived >= 1);
  assert.ok(completedDashboard.counts.byState.completed >= 1);
});

test("V0.9.3 derives owner-scoped FSA portfolio intelligence without double-counting overlapping forbearance", async () => {
  const d1 = new SqliteD1();
  d1.database.exec(migration);
  const env = { ADVISOR_DB: d1 };
  const alpha = await register(env, "intelligence-alpha@example.test", "Intelligence Alpha");
  const beta = await register(env, "intelligence-beta@example.test", "Intelligence Beta");

  const ui = await worker.fetch(new Request(`${BASE}/?advisorClient=client_00000000-0000-0000-0000-000000000000`), env);
  const html = await ui.text();
  assert.equal(ui.status, 200);
  assert.match(html, /id="advisor-view-intelligence"/);
  assert.match(html, /id="advisor-intelligence-workspace"/);
  assert.match(html, /advisor-view-case-file/);
  assert.match(html, /advisor-case-workspace/);
  assert.match(html, /Client case file/);
  assert.match(html, /Case context v1/);
  assert.match(html, /case-context/);
  assert.match(html, /FSA portfolio intelligence/);
  assert.match(html, /deterministic/i);

  const create = await advisorFetch("/api/advisor/clients", alpha, env, {
    method: "POST",
    body: JSON.stringify({
      displayName: "Portfolio Intelligence Borrower",
      normalizedLoanPortfolio: {
        repaymentLoans: [
          { principal: 10000, annualInterestRatePercent: 6.5 },
          { principal: 5000, annualInterestRatePercent: 5.5 }
        ],
        loans: [
          {
            loanIndex: 0,
            outstandingPrincipal: 10000,
            outstandingInterest: 100,
            capitalizedInterest: 50,
            interestRatePercent: 6.5,
            calculatedCombinedAggregateOpb: 10000,
            currentLoanStatusCode: "RP",
            currentLoanStatusDescription: "IN REPAYMENT",
            repaymentPlanTypeCode: "IB",
            repaymentPlanDescription: "INCOME-BASED REPAYMENT",
            repaymentPlanBeginDate: "01/01/2026",
            repaymentPlanScheduledAmount: 25,
            repaymentPlanIdrAnniversaryDate: "05/01/2027",
            nextPaymentDueDate: "04/15/2026",
            statuses: [
              { code: "RP", description: "IN REPAYMENT", effectiveDate: "03/01/2026" },
              { code: "FB", description: "FORBEARANCE", effectiveDate: "01/01/2026" }
            ],
            delinquencies: [{ date: "01/15/2026", endDate: "02/15/2026" }],
            contacts: [{ type: "Guaranty Agency", name: "Historical Contact" }],
            provenance: {}
          },
          {
            loanIndex: 1,
            outstandingPrincipal: 5000,
            outstandingInterest: 25,
            interestRatePercent: 5.5,
            calculatedCombinedAggregateOpb: 5000,
            currentLoanStatusCode: "FB",
            currentLoanStatusDescription: "FORBEARANCE",
            repaymentPlanTypeCode: "IB",
            repaymentPlanDescription: "INCOME-BASED REPAYMENT",
            repaymentPlanBeginDate: "02/01/2026",
            repaymentPlanIdrAnniversaryDate: "06/01/2027",
            statuses: [{ code: "FB", description: "FORBEARANCE", effectiveDate: "02/01/2026" }],
            contacts: [{ type: "Current Servicer", name: "Priority Servicer", phoneNumber: "555-0102", mostRelevant: true }],
            provenance: {}
          }
        ],
        summary: { loanCount: 2, activeLoanCount: 2, totalOutstandingPrincipal: 15000, totalOutstandingInterest: 125, repaymentLoanCount: 2, eligibilityMappedLoanCount: 0, ambiguousEligibilityLoanCount: 2, hasLoanDisbursedOnOrAfterJuly1_2026: false }
      },
      studentAidImport: { source: "studentaid_download", fileRequestDate: "04/01/2026", mappingVersion: "2026-09-05-v2", rawFileRetained: false }
    })
  });
  const created = await create.json();
  assert.equal(create.status, 201);
  const clientId = created.client.clientId as string;
  const updatedAt = created.client.updatedAt as string;

  const response = await advisorFetch(`/api/advisor/clients/${clientId}/intelligence`, alpha, env);
  const body = await response.json();
  assert.equal(response.status, 200);
  const intelligence = body.intelligence;
  assert.equal(intelligence.schema, "student-aid-portfolio-intelligence-v1");
  assert.equal(intelligence.asOfDate, "2026-04-01");
  assert.equal(intelligence.activeLoanCount, 2);
  assert.equal(intelligence.forbearance.boundedCalendarDays, 90, "overlapping loan forbearance must be unioned on the portfolio calendar");
  assert.equal(intelligence.forbearance.currentLoanCount, 1);
  assert.equal(intelligence.forbearance.portfolioCalendarIntervals.length, 1);
  assert.equal(intelligence.loans[0].forbearance.boundedCalendarDays, 59);
  assert.equal(intelligence.loans[1].forbearance.boundedCalendarDays, 59);
  assert.equal(intelligence.loans[1].forbearance.currentlyInForbearance, true);
  assert.equal(intelligence.loans[1].forbearance.currentStartDate, "2026-02-01");
  assert.equal(intelligence.loans[1].forbearance.currentCalendarDays, 59);
  assert.equal(intelligence.loans[0].delinquency.boundedCalendarDays, 31);
  assert.equal(intelligence.loans[0].repaymentPlan.idrAnniversaryDate, "05/01/2027");
  assert.equal(intelligence.scheduledPayment.coverage, "partial");
  assert.equal(intelligence.scheduledPayment.reportedLoanCount, 1);
  assert.equal(intelligence.scheduledPayment.missingLoanCount, 1);
  assert.equal(intelligence.scheduledPayment.reportedAmountSum, 25);
  assert.equal(intelligence.planDistribution.length, 1);
  assert.equal(intelligence.planDistribution[0].loanCount, 2);
  assert.equal(intelligence.planDistribution[0].outstandingPrincipal, 15000);
  assert.equal(intelligence.interest.outstandingInterestSum, 125);
  assert.equal(intelligence.interest.outstandingInterestCoverage, "complete");
  assert.equal(intelligence.interest.capitalizedInterestSum, 50);
  assert.equal(intelligence.interest.capitalizedInterestCoverage, "partial");
  assert.equal(intelligence.servicerRouting.preferred.loanIndex, 1);
  assert.equal(intelligence.servicerRouting.preferred.contact.name, "Priority Servicer");
  assert.equal(intelligence.reconciliation.principal.status, "pass");
  assert.equal(intelligence.reconciliation.principal.aggregateContributionSum, 15000);
  assert.equal(intelligence.reconciliation.principal.delta, 0);
  assert.equal(intelligence.reconciliation.interest.status, "unavailable");
  assert.match(intelligence.warnings.join("\n"), /scheduled-payment coverage is incomplete/i);

  const denied = await advisorFetch(`/api/advisor/clients/${clientId}/intelligence`, beta, env);
  assert.equal(denied.status, 404);
  assert.equal((await denied.json()).error, "Client not found or not accessible.");

  const caseResponse = await advisorFetch(`/api/advisor/clients/${clientId}/case-context`, alpha, env);
  const caseBody = await caseResponse.json();
  assert.equal(caseResponse.status, 200);
  const caseContext = caseBody.caseContext;
  assert.equal(caseContext.schema, "student-loan-idr-client-case-context-v1");
  assert.equal(caseContext.schemaVersion, 1);
  assert.equal(caseContext.clientId, clientId);
  assert.equal(caseContext.clientUpdatedAt, updatedAt);
  assert.equal(caseContext.asOf.caseUpdatedAt, updatedAt);
  assert.equal(caseContext.asOf.studentAidFileRequestDate, "04/01/2026");
  assert.equal(caseContext.asOf.portfolioAsOfDate, "2026-04-01");
  assert.equal(caseContext.professionalSummary.displayName, "Portfolio Intelligence Borrower");
  assert.equal(caseContext.professionalSummary.activeLoanCount, 2);
  assert.equal(caseContext.professionalSummary.totalOutstandingPrincipal, 15000);
  assert.equal(caseContext.professionalSummary.totalOutstandingInterest, 125);
  assert.equal(caseContext.professionalSummary.reportedScheduledPaymentSum, 25);
  assert.equal(caseContext.professionalSummary.currentForbearanceLoanCount, 1);
  assert.deepEqual(caseContext.professionalSummary.currentRepaymentPlans, ["INCOME-BASED REPAYMENT"]);
  assert.equal(caseContext.normalizedFacts.loanPortfolio.summary.totalOutstandingPrincipal, 15000);
  assert.equal(caseContext.provenance.fields.displayName, "missing_review");
  assert.equal(caseContext.provenance.loans.length, 2);
  assert.deepEqual(caseContext.deterministicIntelligence, intelligence);
  assert.equal(caseContext.coverage.loanPortfolio, "complete");
  assert.equal(caseContext.coverage.eligibilityMapping, "none");
  assert.equal(caseContext.coverage.comparisonReadiness, "partial");
  assert.equal(caseContext.coverage.currentIncome, "none");
  assert.ok(caseContext.missingInformation.some((item:any) => item.key === "current_income" && item.blocking));
  assert.ok(caseContext.missingInformation.some((item:any) => item.key === "eligibility_mapping" && !item.blocking));
  assert.match(caseContext.warnings.join("\n"), /blocking a complete repayment comparison/i);
  assert.match(caseContext.warnings.join("\n"), /ambiguous eligibility mapping/i);
  const secondCaseResponse = await advisorFetch(`/api/advisor/clients/${clientId}/case-context`, alpha, env);
  assert.equal(secondCaseResponse.status, 200);
  assert.deepEqual((await secondCaseResponse.json()).caseContext, caseContext, "case context must be deterministic for unchanged saved facts");
  const deniedCase = await advisorFetch(`/api/advisor/clients/${clientId}/case-context`, beta, env);
  assert.equal(deniedCase.status, 404);
  assert.equal((await deniedCase.json()).error, "Client not found or not accessible.");

  const postRead = await advisorFetch(`/api/advisor/clients/${clientId}`, alpha, env);
  assert.equal(postRead.status, 200);
  assert.equal((await postRead.json()).client.updatedAt, updatedAt, "portfolio intelligence and case context must be read-only derived views");
});
