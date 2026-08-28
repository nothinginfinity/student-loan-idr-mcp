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
const migration = readFileSync(new URL("../migrations/0001_v0_8_2_advisor_workspace.sql", import.meta.url), "utf8");

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
  assert.equal(exportBody.schema, "student-loan-idr-advisor-client-export-v1");
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
  assert.match(advisorHtml, /Open guided workflow/);
  assert.match(advisorHtml, /raw StudentAid\.gov downloads/i);
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
        eligibilityLoans: [{ loanType: "direct_unsubsidized", disbursementPeriod: "before_2026_07_01" }]
      },
      studentAidImport: { source: "studentaid_download", importedAt: "2026-08-28T15:00:00Z", rawFileRetained: false }
    })
  });
  const saved = await save.json();
  assert.equal(save.status, 200);
  assert.equal(saved.client.readinessState, "application_ready");
  assert.equal(saved.client.confirmedFacts.familySize, 2);
  assert.equal(saved.client.confirmedFacts.incomeSources[0].name, "Example Employer");
  assert.equal(saved.client.normalizedLoanPortfolio.repaymentLoans[0].principal, 25000);
  assert.equal(saved.client.studentAidImport.rawFileRetained, false);

  const resumed = await advisorFetch(`/api/advisor/clients/${created.client.clientId}`, advisor, env);
  const resumedBody = await resumed.json();
  assert.equal(resumed.status, 200);
  assert.equal(resumedBody.client.servicerName, "Example Servicer");
  assert.equal(resumedBody.client.confirmedFacts.dependentsClaimedOnFederalTaxReturn, 1);
  assert.equal(resumedBody.client.normalizedLoanPortfolio.eligibilityLoans[0].loanType, "direct_unsubsidized");
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
