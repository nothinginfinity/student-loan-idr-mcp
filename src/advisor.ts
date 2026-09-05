import { scryptSync } from "node:crypto";
import { calculateRepayment } from "./formulas.ts";
import { getDocumentationTemplate } from "./templates.ts";
import type { AdvisorAccountStatus, AdvisorClientDashboardSummary, AdvisorClientIncomeSource, AdvisorClientLifecycleState, AdvisorClientReadinessState, AdvisorClientRecordV1, AdvisorPrincipal, CalculatorRequest, DocumentationIncomeSource, RepaymentPlan, RepaymentLoanInput, StudentAidLoanContactFact, StudentAidNormalizedLoanFact, StudentAidPortfolioIntelligence, StudentAidStatusIntervalIntelligence, TemplateRequest } from "./types.ts";

const COOKIE = "sl_advisor_session";
const TTL_SECONDS = 12 * 60 * 60;
const ENGINE_VERSION = "0.8.6";
// V0.8.2 uses the Workers-native Node crypto scrypt implementation.
// The persisted password_iterations column stores the scrypt N work factor for this bounded schema.
const PASSWORD_WORK_FACTOR = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 32 * 1024 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 8;

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface D1DatabaseBinding { prepare(sql: string): D1PreparedStatement; }
export interface AdvisorWorkspaceEnv { ADVISOR_DB?: D1DatabaseBinding; RESEND_API_KEY?: string; }

type JsonObject = Record<string, unknown>;
type AccountRow = {
  advisor_id: string; email_normalized: string; display_name: string; password_salt: string; password_hash: string;
  password_iterations: number; status: AdvisorAccountStatus; created_at: string; updated_at: string;
};
type SessionRow = AccountRow & {
  session_hash: string; csrf_token_hash: string; session_created_at: string; expires_at: string; last_seen_at: string; revoked_at: string | null;
};
type ClientRow = {
  owner_advisor_id: string; client_id: string; display_name: string; lifecycle_state: AdvisorClientLifecycleState;
  readiness_state: AdvisorClientReadinessState; record_json: string; created_at: string; updated_at: string;
};
type ArtifactRow = {
  owner_advisor_id: string; client_id: string; artifact_id: string; artifact_kind: "document_draft"; name: string;
  template_request_json: string; document_text: string; document_html: string; engine_version: string; created_at: string;
};
type SnapshotRow = {
  owner_advisor_id: string; client_id: string; snapshot_id: string; snapshot_kind: "calculation" | "comparison"; name: string;
  basis_json: string; result_json: string; policy_snapshot: string; engine_version: string; created_at: string;
};
type PlanSelectionRow = {
  selection_id: string; owner_advisor_id: string; client_id: string; share_token_hash: string;
  status: "issued" | "opened" | "selected" | "signed" | "booked" | "expired" | "revoked";
  comparison_snapshot_json: string; selected_plan: string | null; selected_at: string | null;
  sign_initials: string | null; signed_at: string | null; booking_url: string | null; booked_at: string | null;
  link_opened_at: string | null; select_sign_deadline_at: string | null; booking_deadline_at: string | null;
  revoked_at: string | null; created_at: string; updated_at: string;
};

type Auth = { principal: AdvisorPrincipal; account: AccountRow; session: SessionRow };

class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
const enc = new TextEncoder();

function json(payload: unknown, status = 200, extra: Record<string, string> = {}): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra });
  return new Response(JSON.stringify(payload), { status, headers });
}
function cookie(token: string): string { return `${COOKIE}=${token}; Path=/; Max-Age=${TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`; }
function clearCookie(): string { return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`; }
function token(bytes = 32): string {
  const b = new Uint8Array(bytes); crypto.getRandomValues(b);
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function randomHex(bytes = 16): string { const b = new Uint8Array(bytes); crypto.getRandomValues(b); return Array.from(b, x => x.toString(16).padStart(2, "0")).join(""); }
function hex(buf: ArrayBuffer): string { return Array.from(new Uint8Array(buf), x => x.toString(16).padStart(2, "0")).join(""); }
async function sha(value: string): Promise<string> { return hex(await crypto.subtle.digest("SHA-256", enc.encode(value))); }
async function passwordHash(password: string, saltHex: string, workFactor: number): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)?.map(v => Number.parseInt(v, 16)) ?? []);
  return scryptSync(password, salt, 32, { N: workFactor, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM }).toString("hex");
}
function equal(a: string, b: string): boolean { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function db(env: AdvisorWorkspaceEnv): D1DatabaseBinding { if (!env.ADVISOR_DB) throw new ApiError(503, "Advisor workspace is not configured."); return env.ADVISOR_DB; }
function bodyObject(value: unknown): JsonObject { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "JSON body must be an object."); return value as JsonObject; }
async function body(request: Request): Promise<JsonObject> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) throw new ApiError(415, "Content-Type must be application/json.");
  const declared = Number(request.headers.get("content-length")); if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new ApiError(413, "Request body too large.");
  const bytes = new Uint8Array(await request.arrayBuffer()); if (bytes.byteLength > MAX_BODY_BYTES) throw new ApiError(413, "Request body too large.");
  try { return bodyObject(JSON.parse(new TextDecoder().decode(bytes))); } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(400, "Invalid JSON."); }
}
function sameOrigin(request: Request): void { const origin = request.headers.get("origin"); if (origin !== null && origin !== new URL(request.url).origin) throw new ApiError(403, "Cross-origin advisor requests are not allowed."); }
function cookieValue(request: Request): string | null { for (const part of (request.headers.get("cookie") ?? "").split(";")) { const [k, ...v] = part.trim().split("="); if (k === COOKIE) return v.join("=") || null; } return null; }
function email(value: unknown): string { if (typeof value !== "string") throw new ApiError(400, "A valid email address is required."); const x = value.trim().toLowerCase(); if (x.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) throw new ApiError(400, "A valid email address is required."); return x; }
function password(value: unknown): string { if (typeof value !== "string" || value.length < 12 || value.length > 200) throw new ApiError(400, "Password must be between 12 and 200 characters."); return value; }
function displayName(value: unknown): string { if (typeof value !== "string") throw new ApiError(400, "Display name is required."); const x = value.trim(); if (!x || x.length > 120) throw new ApiError(400, "Display name must be between 1 and 120 characters."); return x; }
function optionalText(value: unknown, name: string, max: number): string | undefined { if (value === undefined || value === null || value === "") return undefined; if (typeof value !== "string") throw new ApiError(400, `${name} must be text.`); const x = value.trim(); if (x.length > max) throw new ApiError(400, `${name} is too long.`); return x || undefined; }
function accountView(a: AccountRow) { return { advisorId: a.advisor_id, email: a.email_normalized, displayName: a.display_name, status: a.status }; }
async function audit(database: D1DatabaseBinding, advisorId: string, action: string, clientId?: string): Promise<void> { await database.prepare("INSERT INTO advisor_audit_events (event_id, advisor_id, client_id, action, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, '{}')").bind(crypto.randomUUID(), advisorId, clientId ?? null, action, new Date().toISOString()).run(); }

async function createSession(database: D1DatabaseBinding, advisorId: string) {
  const sessionToken = token(), csrfToken = token(), now = new Date(), expiresAt = new Date(now.getTime() + TTL_SECONDS * 1000).toISOString();
  await database.prepare("INSERT INTO advisor_sessions (session_hash, csrf_token_hash, advisor_id, created_at, expires_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)").bind(await sha(sessionToken), await sha(csrfToken), advisorId, now.toISOString(), expiresAt, now.toISOString()).run();
  return { sessionToken, csrfToken, expiresAt };
}
async function authenticate(request: Request, database: D1DatabaseBinding, csrf: boolean): Promise<Auth> {
  const t = cookieValue(request); if (!t) throw new ApiError(401, "Authentication required.");
  const h = await sha(t), now = new Date().toISOString();
  const row = await database.prepare(`SELECT s.session_hash, s.csrf_token_hash, s.created_at AS session_created_at, s.expires_at, s.last_seen_at, s.revoked_at,
    a.advisor_id, a.email_normalized, a.display_name, a.password_salt, a.password_hash, a.password_iterations, a.status, a.created_at, a.updated_at
    FROM advisor_sessions s JOIN advisor_accounts a ON a.advisor_id=s.advisor_id WHERE s.session_hash=?`).bind(h).first<SessionRow>();
  if (!row || row.revoked_at || row.expires_at <= now || row.status !== "active") throw new ApiError(401, "Authentication required.");
  if (csrf) { const c = request.headers.get("x-csrf-token"); if (!c || !equal(await sha(c), row.csrf_token_hash)) throw new ApiError(403, "CSRF validation failed."); }
  await database.prepare("UPDATE advisor_sessions SET last_seen_at=? WHERE session_hash=?").bind(now, h).run();
  return { principal: { advisorId: row.advisor_id, status: row.status }, account: row, session: row };
}
async function blocked(database: D1DatabaseBinding, e: string): Promise<boolean> { const k = await sha(e), r = await database.prepare("SELECT window_started_at,failure_count FROM advisor_auth_failures WHERE identifier_hash=?").bind(k).first<{window_started_at:string;failure_count:number}>(); return !!r && Date.now() - Date.parse(r.window_started_at) <= LOGIN_WINDOW_MS && r.failure_count >= LOGIN_FAILURE_LIMIT; }
async function failLogin(database: D1DatabaseBinding, e: string): Promise<void> { const k=await sha(e), now=new Date().toISOString(), r=await database.prepare("SELECT window_started_at,failure_count FROM advisor_auth_failures WHERE identifier_hash=?").bind(k).first<{window_started_at:string;failure_count:number}>(); if (!r || Date.now()-Date.parse(r.window_started_at)>LOGIN_WINDOW_MS) await database.prepare("INSERT INTO advisor_auth_failures(identifier_hash,window_started_at,failure_count) VALUES(?,?,1) ON CONFLICT(identifier_hash) DO UPDATE SET window_started_at=excluded.window_started_at,failure_count=1").bind(k,now).run(); else await database.prepare("UPDATE advisor_auth_failures SET failure_count=failure_count+1 WHERE identifier_hash=?").bind(k).run(); }
async function clearFailures(database: D1DatabaseBinding, e: string): Promise<void> { await database.prepare("DELETE FROM advisor_auth_failures WHERE identifier_hash=?").bind(await sha(e)).run(); }

function parseClient(row: ClientRow): AdvisorClientRecordV1 { let r: unknown; try { r=JSON.parse(row.record_json); } catch { throw new ApiError(500,"Stored client record is invalid."); } const x=r as AdvisorClientRecordV1; if (!x || x.schemaVersion!==1 || x.clientId!==row.client_id || x.ownerAdvisorId!==row.owner_advisor_id) throw new ApiError(500,"Stored client record failed integrity checks."); return x; }
function summary(row: ClientRow): AdvisorClientDashboardSummary { return { clientId: row.client_id, displayName: row.display_name, lifecycleState: row.lifecycle_state, readinessState: row.readiness_state, updatedAt: row.updated_at }; }

const DAY_MS = 24 * 60 * 60 * 1000;
function fsaDateMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const parsed = match ? Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])) : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function fsaIso(value: number): string { return new Date(value).toISOString().slice(0, 10); }
function statusCategory(code?: string, description?: string): StudentAidStatusIntervalIntelligence["category"] {
  const c = String(code ?? "").trim().toUpperCase();
  const d = String(description ?? "").trim().toUpperCase();
  if (c === "FB" || d.includes("FORBEAR")) return "forbearance";
  if (c === "DF" || (d.includes("DEFAULT") && !d.includes("NON-DEFAULT"))) return "default";
  if (c === "RP" || d.includes("REPAY")) return "repayment";
  return "other";
}
function coverageState(count: number, total: number): "complete" | "partial" | "none" {
  if (count <= 0) return "none";
  return total > 0 && count >= total ? "complete" : "partial";
}
function portfolioAsOf(client: AdvisorClientRecordV1, loans: StudentAidNormalizedLoanFact[]): number | undefined {
  const requestDate = fsaDateMs(client.studentAidImport?.fileRequestDate);
  if (requestDate !== undefined) return requestDate;
  const candidates: number[] = [];
  for (const loan of loans) {
    for (const value of [loan.updateDate, loan.outstandingPrincipalAsOfDate, loan.outstandingInterestAsOfDate]) {
      const parsed = fsaDateMs(value); if (parsed !== undefined) candidates.push(parsed);
    }
    for (const fact of loan.statuses ?? []) { const parsed = fsaDateMs(fact.effectiveDate); if (parsed !== undefined) candidates.push(parsed); }
    for (const delinquency of loan.delinquencies ?? []) {
      for (const value of [delinquency.date, delinquency.endDate]) { const parsed = fsaDateMs(value); if (parsed !== undefined) candidates.push(parsed); }
    }
  }
  return candidates.length ? Math.max(...candidates) : undefined;
}
function deriveLoanIntelligence(loan: StudentAidNormalizedLoanFact, asOf: number | undefined) {
  const datedStatuses = (loan.statuses ?? []).flatMap((fact, sourceIndex) => {
    const start = fsaDateMs(fact.effectiveDate);
    return start === undefined ? [] : [{ fact, sourceIndex, start }];
  }).sort((a, b) => a.start - b.start || a.sourceIndex - b.sourceIndex);
  const statusIntervals: StudentAidStatusIntervalIntelligence[] = datedStatuses.map((item, index) => {
    const next = datedStatuses[index + 1]?.start;
    const end = next ?? (asOf !== undefined && asOf >= item.start ? asOf : undefined);
    return {
      startDate: fsaIso(item.start),
      ...(end !== undefined ? { endDate: fsaIso(end), calendarDays: Math.max(0, Math.floor((end - item.start) / DAY_MS)) } : {}),
      open: index === datedStatuses.length - 1,
      ...(item.fact.code ? { code: item.fact.code } : {}),
      ...(item.fact.description ? { description: item.fact.description } : {}),
      category: statusCategory(item.fact.code, item.fact.description)
    };
  });
  const forbearanceIntervals = statusIntervals.filter((interval) => interval.category === "forbearance");
  const explicitCurrentCategory = statusCategory(loan.currentLoanStatusCode, loan.currentLoanStatusDescription);
  const latestCategory = statusIntervals.length ? statusIntervals[statusIntervals.length - 1]!.category : "other";
  const hasExplicitCurrent = Boolean(loan.currentLoanStatusCode || loan.currentLoanStatusDescription);
  const currentlyInForbearance = (hasExplicitCurrent ? explicitCurrentCategory : latestCategory) === "forbearance";
  const currentForbearance = currentlyInForbearance && latestCategory === "forbearance" ? forbearanceIntervals[forbearanceIntervals.length - 1] : undefined;
  const delinquencyPeriods = (loan.delinquencies ?? []).flatMap((fact) => {
    const start = fsaDateMs(fact.date), suppliedEnd = fsaDateMs(fact.endDate);
    if (start === undefined) return [];
    const open = suppliedEnd === undefined;
    const end = suppliedEnd ?? (asOf !== undefined && asOf >= start ? asOf : undefined);
    return [{ startDate: fsaIso(start), ...(end !== undefined ? { endDate: fsaIso(end), calendarDays: Math.max(0, Math.floor((end - start) / DAY_MS)) } : {}), open }];
  });
  const preferredServicerContact = [...(loan.contacts ?? [])].filter((contact) => Boolean(contact.name || contact.phoneNumber || contact.emailAddress || contact.websiteAddress)).sort((a, b) => Number(Boolean(b.mostRelevant)) - Number(Boolean(a.mostRelevant)) || Number(String(b.type ?? "").toUpperCase().includes("SERVICER")) - Number(String(a.type ?? "").toUpperCase().includes("SERVICER")))[0];
  return {
    loanIndex: loan.loanIndex,
    active: typeof loan.outstandingPrincipal === "number" && loan.outstandingPrincipal > 0,
    statusIntervals,
    forbearance: {
      intervals: forbearanceIntervals,
      boundedCalendarDays: forbearanceIntervals.reduce((sum, interval) => sum + (interval.calendarDays ?? 0), 0),
      complete: Boolean(asOf !== undefined && (loan.statuses ?? []).length > 0 && datedStatuses.length === (loan.statuses ?? []).length),
      currentlyInForbearance,
      ...(currentForbearance ? { currentStartDate: currentForbearance.startDate, ...(currentForbearance.calendarDays !== undefined ? { currentCalendarDays: currentForbearance.calendarDays } : {}) } : {})
    },
    delinquency: {
      periods: delinquencyPeriods,
      boundedCalendarDays: delinquencyPeriods.reduce((sum, period) => sum + (period.calendarDays ?? 0), 0),
      complete: Boolean(asOf !== undefined && delinquencyPeriods.length === (loan.delinquencies ?? []).length),
      currentlyDelinquent: delinquencyPeriods.some((period) => period.open)
    },
    ...((loan.repaymentPlanTypeCode || loan.repaymentPlanDescription || loan.repaymentPlanBeginDate || typeof loan.repaymentPlanScheduledAmount === "number" || loan.repaymentPlanIdrAnniversaryDate || loan.nextPaymentDueDate) ? { repaymentPlan: {
      ...(loan.repaymentPlanTypeCode ? { code: loan.repaymentPlanTypeCode } : {}),
      ...(loan.repaymentPlanDescription ? { description: loan.repaymentPlanDescription } : {}),
      ...(loan.repaymentPlanBeginDate ? { beginDate: loan.repaymentPlanBeginDate } : {}),
      ...(typeof loan.repaymentPlanScheduledAmount === "number" ? { scheduledAmount: loan.repaymentPlanScheduledAmount } : {}),
      ...(loan.repaymentPlanIdrAnniversaryDate ? { idrAnniversaryDate: loan.repaymentPlanIdrAnniversaryDate } : {}),
      ...(loan.nextPaymentDueDate ? { nextPaymentDueDate: loan.nextPaymentDueDate } : {})
    } } : {}),
    interest: {
      ...(typeof loan.outstandingInterest === "number" ? { outstandingInterest: loan.outstandingInterest } : {}),
      ...(typeof loan.capitalizedInterest === "number" ? { capitalizedInterest: loan.capitalizedInterest } : {})
    },
    ...(preferredServicerContact ? { preferredServicerContact } : {})
  };
}
function mergeForbearanceIntervals(loans: ReturnType<typeof deriveLoanIntelligence>[]) {
  const ranges = loans.flatMap((loan) => loan.forbearance.intervals.flatMap((interval) => {
    const start = fsaDateMs(interval.startDate), end = fsaDateMs(interval.endDate);
    return start !== undefined && end !== undefined && end >= start ? [{ start, end, open: interval.open }] : [];
  })).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number; open: boolean }> = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) { previous.end = Math.max(previous.end, range.end); previous.open = previous.open || range.open; }
    else merged.push({ ...range });
  }
  return merged.map((range) => ({ startDate: fsaIso(range.start), endDate: fsaIso(range.end), calendarDays: Math.max(0, Math.floor((range.end - range.start) / DAY_MS)), open: range.open }));
}
export function deriveStudentAidPortfolioIntelligence(client: AdvisorClientRecordV1): StudentAidPortfolioIntelligence {
  const loans = client.normalizedLoanPortfolio?.loans ?? [];
  const asOf = portfolioAsOf(client, loans);
  const loanIntelligence = loans.map((loan) => deriveLoanIntelligence(loan, asOf));
  const activeLoans = loans.filter((loan) => typeof loan.outstandingPrincipal === "number" && loan.outstandingPrincipal > 0);
  const activeIntelligence = loanIntelligence.filter((loan) => loan.active);
  const portfolioForbearance = mergeForbearanceIntervals(loanIntelligence);
  const scheduledReported = activeLoans.filter((loan) => typeof loan.repaymentPlanScheduledAmount === "number");
  const planGroups = new Map<string, { key: string; code?: string; description?: string; loanCount: number; outstandingPrincipal: number }>();
  for (const loan of activeLoans) {
    const key = loan.repaymentPlanTypeCode || loan.repaymentPlanDescription || "unreported";
    const current = planGroups.get(key) ?? { key, ...(loan.repaymentPlanTypeCode ? { code: loan.repaymentPlanTypeCode } : {}), ...(loan.repaymentPlanDescription ? { description: loan.repaymentPlanDescription } : {}), loanCount: 0, outstandingPrincipal: 0 };
    current.loanCount += 1; current.outstandingPrincipal = roundCents(current.outstandingPrincipal + (loan.outstandingPrincipal ?? 0)); planGroups.set(key, current);
  }
  const contacts = activeLoans.flatMap((loan) => (loan.contacts ?? []).map((contact) => ({ loanIndex: loan.loanIndex, contact }))).filter((candidate): candidate is { loanIndex: number; contact: StudentAidLoanContactFact } => Boolean(candidate.contact.name || candidate.contact.phoneNumber || candidate.contact.emailAddress || candidate.contact.websiteAddress));
  contacts.sort((a, b) => Number(Boolean(b.contact.mostRelevant)) - Number(Boolean(a.contact.mostRelevant)) || Number(String(b.contact.type ?? "").toUpperCase().includes("SERVICER")) - Number(String(a.contact.type ?? "").toUpperCase().includes("SERVICER")));
  const outstandingInterestCount = activeLoans.filter((loan) => typeof loan.outstandingInterest === "number").length;
  const capitalizedInterestCount = activeLoans.filter((loan) => typeof loan.capitalizedInterest === "number").length;
  const parsedPrincipalSum = roundCents(activeLoans.reduce((sum, loan) => sum + (loan.outstandingPrincipal ?? 0), 0));
  const aggregateLoans = activeLoans.filter((loan) => typeof loan.calculatedCombinedAggregateOpb === "number");
  const aggregateContributionSum = aggregateLoans.length ? roundCents(aggregateLoans.reduce((sum, loan) => sum + (loan.calculatedCombinedAggregateOpb ?? 0), 0)) : undefined;
  const principalStatus = aggregateLoans.length === 0 ? "unavailable" : aggregateLoans.length < activeLoans.length ? "warning" : Math.abs((aggregateContributionSum ?? 0) - parsedPrincipalSum) <= 0.01 ? "pass" : "warning";
  const warnings: string[] = [];
  if (asOf === undefined) warnings.push("No reliable portfolio as-of date was available; open chronology durations remain unbounded.");
  if (activeLoans.length && scheduledReported.length < activeLoans.length) warnings.push("Reported scheduled-payment coverage is incomplete across active loans; the sum is not a complete portfolio bill.");
  if (loanIntelligence.some((loan, index) => (loans[index]?.statuses ?? []).length && !loan.forbearance.complete)) warnings.push("One or more status-history rows are missing usable dates; interval totals are bounded to dated source facts only.");
  if (aggregateLoans.length && aggregateLoans.length < activeLoans.length) warnings.push("Calculated Combined Aggregate OPB coverage is partial; aggregate contribution totals are not treated as a complete portfolio balance.");
  if (aggregateLoans.length === activeLoans.length && activeLoans.length && principalStatus === "warning") warnings.push("Calculated Combined Aggregate OPB contributions do not reconcile to the parsed active-loan principal sum; review consolidation and aggregate fields before relying on the difference.");
  return {
    schema: "student-aid-portfolio-intelligence-v1",
    ...(asOf !== undefined ? { asOfDate: fsaIso(asOf) } : {}),
    activeLoanCount: activeLoans.length,
    loans: loanIntelligence,
    forbearance: {
      portfolioCalendarIntervals: portfolioForbearance,
      boundedCalendarDays: portfolioForbearance.reduce((sum, interval) => sum + (interval.calendarDays ?? 0), 0),
      complete: loanIntelligence.length > 0 && loanIntelligence.every((loan) => loan.forbearance.complete),
      currentLoanCount: activeIntelligence.filter((loan) => loan.forbearance.currentlyInForbearance).length
    },
    scheduledPayment: {
      coverage: coverageState(scheduledReported.length, activeLoans.length),
      activeLoanCount: activeLoans.length,
      reportedLoanCount: scheduledReported.length,
      missingLoanCount: Math.max(0, activeLoans.length - scheduledReported.length),
      ...(scheduledReported.length ? { reportedAmountSum: roundCents(scheduledReported.reduce((sum, loan) => sum + (loan.repaymentPlanScheduledAmount ?? 0), 0)) } : {})
    },
    planDistribution: [...planGroups.values()].sort((a, b) => a.key.localeCompare(b.key)),
    interest: {
      outstandingInterestSum: roundCents(activeLoans.reduce((sum, loan) => sum + (loan.outstandingInterest ?? 0), 0)),
      outstandingInterestCoverage: coverageState(outstandingInterestCount, activeLoans.length),
      capitalizedInterestSum: roundCents(activeLoans.reduce((sum, loan) => sum + (loan.capitalizedInterest ?? 0), 0)),
      capitalizedInterestCoverage: coverageState(capitalizedInterestCount, activeLoans.length)
    },
    servicerRouting: { ...(contacts[0] ? { preferred: contacts[0] } : {}), candidateCount: contacts.length },
    reconciliation: {
      principal: {
        status: principalStatus,
        parsedPrincipalSum,
        ...(aggregateContributionSum !== undefined ? { aggregateContributionSum } : {}),
        coveredActiveLoanCount: aggregateLoans.length,
        activeLoanCount: activeLoans.length,
        ...(aggregateLoans.length === activeLoans.length && activeLoans.length ? { delta: roundCents((aggregateContributionSum ?? 0) - parsedPrincipalSum) } : {}),
        note: aggregateLoans.length === 0 ? "No Calculated Combined Aggregate OPB source facts were available." : aggregateLoans.length < activeLoans.length ? "Aggregate contribution coverage is partial; compare only after reviewing missing loan rows." : principalStatus === "pass" ? "Aggregate contribution sum reconciles to parsed active-loan principal within one cent." : "Aggregate contribution sum differs from parsed active-loan principal; review consolidation and aggregate source facts."
      },
      interest: { status: "unavailable", parsedInterestSum: roundCents(activeLoans.reduce((sum, loan) => sum + (loan.outstandingInterest ?? 0), 0)), note: "No separate portfolio aggregate-interest counterpart is stored in the current normalized FSA mapping, so interest is reported with coverage but not force-reconciled." }
    },
    warnings
  };
}

type ComparisonPoint = { month: number; remainingBalance: number; cumulativeBorrowerPaid: number; cumulativeInterestWaived: number; cumulativePrincipalMatch: number };
type ComparisonProjection = {
  plan: RepaymentPlan;
  eligibilityStatus: string;
  currentMonthlyPayment: number;
  projectionKind: "forgiveness_horizon" | "sunset_only" | "horizon_unknown" | "unavailable";
  horizonMonths: number | null;
  horizonLabel: string;
  projectedBorrowerPaid: number | null;
  projectedRemainingBalance: number | null;
  projectedForgiveness: number | null;
  projectedInterestWaived: number | null;
  projectedPrincipalMatch: number | null;
  payoffMonth: number | null;
  series: ComparisonPoint[];
  warnings: string[];
};

function roundCents(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function allocatePrincipalReduction(loans: RepaymentLoanInput[], amount: number): RepaymentLoanInput[] {
  const total = loans.reduce((sum, loan) => sum + loan.principal, 0);
  if (amount <= 0 || total <= 0) return loans;
  const reduction = Math.min(amount, total);
  let remaining = reduction;
  return loans.map((loan, index) => {
    const share = index === loans.length - 1 ? remaining : Math.min(loan.principal, reduction * (loan.principal / total));
    remaining -= share;
    return { ...loan, principal: Math.max(0, loan.principal - share) };
  });
}
function comparisonRequest(client: AdvisorClientRecordV1): CalculatorRequest {
  const facts = client.confirmedFacts;
  const portfolio = client.normalizedLoanPortfolio;
  const familySize = facts?.familySize;
  if (!facts?.income?.length) throw new ApiError(422, "Save at least one normalized income input before comparing repayment programs.");
  if (!facts.region || typeof familySize !== "number" || !Number.isInteger(familySize) || familySize < 1) throw new ApiError(422, "Save region and family size before comparing repayment programs.");
  if (!portfolio?.repaymentLoans?.length) throw new ApiError(422, "Save a normalized loan portfolio with balance and interest-rate facts before comparing repayment programs.");
  return {
    income: facts.income,
    region: facts.region,
    familySize,
    ...(typeof facts.dependentsClaimedOnFederalTaxReturn === "number" ? { dependentsClaimedOnFederalTaxReturn: facts.dependentsClaimedOnFederalTaxReturn } : {}),
    ...(facts.taxFilingStatus ? { taxFilingStatus: facts.taxFilingStatus } : {}),
    loan: {
      repaymentLoans: portfolio.repaymentLoans,
      ...(portfolio.eligibilityLoans?.length ? { eligibilityLoans: portfolio.eligibilityLoans } : {}),
      ...(typeof facts.newBorrowerOnOrAfterJuly1_2014 === "boolean" ? { newBorrowerOnOrAfterJuly1_2014: facts.newBorrowerOnOrAfterJuly1_2014 } : {})
    },
    plans: ["RAP", "IBR", "PAYE", "ICR"]
  };
}
function projectionHorizon(plan: RepaymentPlan, client: AdvisorClientRecordV1): { kind: ComparisonProjection["projectionKind"]; months: number | null; label: string } {
  if (plan === "RAP") return { kind: "forgiveness_horizon", months: 360, label: "30-year RAP discharge horizon (360 modeled monthly payments)" };
  if (plan === "IBR") {
    const newer = client.confirmedFacts?.newBorrowerOnOrAfterJuly1_2014;
    if (newer === true) return { kind: "forgiveness_horizon", months: 240, label: "20-year IBR forgiveness horizon for a saved post-July-1-2014 new-borrower fact" };
    if (newer === false) return { kind: "forgiveness_horizon", months: 300, label: "25-year IBR forgiveness horizon for a saved earlier-borrower fact" };
    return { kind: "horizon_unknown", months: null, label: "IBR horizon withheld until the 20-vs-25-year borrower-timing fact is saved" };
  }
  return { kind: "sunset_only", months: 22, label: `${plan} modeled only through the July 1, 2028 plan sunset; long-term forgiveness is not projected as if the plan continues` };
}
function simulateProjection(plan: RepaymentPlan, monthlyPayment: number, loansInput: RepaymentLoanInput[], horizon: ReturnType<typeof projectionHorizon>, eligibilityStatus: string): ComparisonProjection {
  const warnings = [
    "Projection holds the saved income, family/dependent facts, payment formula, and current interest rates constant; real annual recertification can change payments.",
    "Projection starts from the currently saved outstanding principal and does not credit prior qualifying payment counts, PSLF credit, deferment/forbearance history, defaults, extra payments, capitalization events, or tax consequences."
  ];
  if (eligibilityStatus !== "eligible") warnings.push(`Current plan eligibility is ${eligibilityStatus}; this modeled scenario is not an eligibility determination.`);
  if (horizon.kind === "horizon_unknown") return { plan, eligibilityStatus, currentMonthlyPayment: monthlyPayment, projectionKind: horizon.kind, horizonMonths: null, horizonLabel: horizon.label, projectedBorrowerPaid: null, projectedRemainingBalance: null, projectedForgiveness: null, projectedInterestWaived: null, projectedPrincipalMatch: null, payoffMonth: null, series: [], warnings };
  if (eligibilityStatus === "ineligible") return { plan, eligibilityStatus, currentMonthlyPayment: monthlyPayment, projectionKind: "unavailable", horizonMonths: horizon.months, horizonLabel: "Projection withheld because the saved loan facts are currently ineligible for this plan.", projectedBorrowerPaid: null, projectedRemainingBalance: null, projectedForgiveness: null, projectedInterestWaived: null, projectedPrincipalMatch: null, payoffMonth: null, series: [], warnings };
  const months = horizon.months ?? 0;
  let loans = loansInput.map((loan) => ({ ...loan }));
  let accruedUnpaidInterest = 0;
  let cumulativeBorrowerPaid = 0;
  let cumulativeInterestWaived = 0;
  let cumulativePrincipalMatch = 0;
  let payoffMonth: number | null = null;
  const totalBalance = () => loans.reduce((sum, loan) => sum + loan.principal, 0) + accruedUnpaidInterest;
  const point = (month: number): ComparisonPoint => ({ month, remainingBalance: roundCents(totalBalance()), cumulativeBorrowerPaid: roundCents(cumulativeBorrowerPaid), cumulativeInterestWaived: roundCents(cumulativeInterestWaived), cumulativePrincipalMatch: roundCents(cumulativePrincipalMatch) });
  const series: ComparisonPoint[] = [point(0)];
  for (let month = 1; month <= months; month += 1) {
    const principalBefore = loans.reduce((sum, loan) => sum + loan.principal, 0);
    if (principalBefore <= 0 && accruedUnpaidInterest <= 0) { payoffMonth = payoffMonth ?? month - 1; break; }
    const currentInterest = loans.reduce((sum, loan) => sum + loan.principal * loan.annualInterestRatePercent / 1200, 0);
    const amountDueForModel = principalBefore + accruedUnpaidInterest + currentInterest;
    const borrowerPayment = Math.min(monthlyPayment, amountDueForModel);
    cumulativeBorrowerPaid += borrowerPayment;
    let borrowerPrincipalReduction = 0;
    if (plan === "RAP") {
      const interestPaid = Math.min(borrowerPayment, currentInterest);
      const waived = Math.max(0, currentInterest - interestPaid);
      cumulativeInterestWaived += waived;
      borrowerPrincipalReduction = Math.min(principalBefore, Math.max(0, borrowerPayment - interestPaid));
      const match = Math.min(principalBefore - borrowerPrincipalReduction, Math.max(0, Math.min(50, borrowerPayment) - borrowerPrincipalReduction));
      cumulativePrincipalMatch += match;
      loans = allocatePrincipalReduction(loans, borrowerPrincipalReduction + match);
      accruedUnpaidInterest = 0;
    } else {
      const totalInterestDue = accruedUnpaidInterest + currentInterest;
      const interestPaid = Math.min(borrowerPayment, totalInterestDue);
      accruedUnpaidInterest = totalInterestDue - interestPaid;
      borrowerPrincipalReduction = Math.min(principalBefore, Math.max(0, borrowerPayment - interestPaid));
      loans = allocatePrincipalReduction(loans, borrowerPrincipalReduction);
    }
    if (totalBalance() <= 0.005) { payoffMonth = month; accruedUnpaidInterest = 0; loans = loans.map((loan) => ({ ...loan, principal: 0 })); }
    if (month % 12 === 0 || month === months || payoffMonth === month) series.push(point(month));
    if (payoffMonth === month) break;
  }
  const remaining = roundCents(totalBalance());
  if (plan === "IBR") warnings.push("IBR projection does not model loan-specific temporary interest subsidies because the saved repayment rows do not encode enough subsidy detail; unpaid interest is tracked without assumed capitalization.");
  if (horizon.kind === "sunset_only") warnings.push("PAYE and ICR end no later than July 1, 2028 under the current policy snapshot, so the comparison intentionally stops there and does not report a standalone long-term forgiveness amount.");
  return {
    plan,
    eligibilityStatus,
    currentMonthlyPayment: monthlyPayment,
    projectionKind: horizon.kind,
    horizonMonths: months,
    horizonLabel: horizon.label,
    projectedBorrowerPaid: roundCents(cumulativeBorrowerPaid),
    projectedRemainingBalance: remaining,
    projectedForgiveness: horizon.kind === "forgiveness_horizon" ? remaining : null,
    projectedInterestWaived: plan === "RAP" ? roundCents(cumulativeInterestWaived) : null,
    projectedPrincipalMatch: plan === "RAP" ? roundCents(cumulativePrincipalMatch) : null,
    payoffMonth,
    series,
    warnings
  };
}
function compareClientPrograms(client: AdvisorClientRecordV1) {
  const request = comparisonRequest(client);
  const calculation = calculateRepayment(request);
  const loans = request.loan!.repaymentLoans!;
  const projections = calculation.planEstimates.map((estimate) => simulateProjection(estimate.plan, estimate.monthlyPaymentEstimate, loans, projectionHorizon(estimate.plan, client), estimate.eligibility.status));
  return {
    schema: "student-loan-idr-advisor-comparison-v1",
    policySnapshot: calculation.policySnapshot,
    generatedAt: new Date().toISOString(),
    clientId: client.clientId,
    assumptions: [
      "All future-looking figures are modeled estimates, not guaranteed forgiveness, eligibility, approval, or servicer outcomes.",
      "RAP modeling applies the current unpaid-interest waiver and monthly principal-match mechanics to the saved loan balances; IBR uses the saved 20/25-year borrower timing only when explicitly confirmed.",
      "PAYE and ICR are modeled only through their July 1, 2028 sunset under the current policy snapshot."
    ],
    projections
  };
}
function parseStoredJson<T>(value: string, label: string): T { try { return JSON.parse(value) as T; } catch { throw new ApiError(500, `Stored ${label} is invalid.`); } }
function retainedName(value: unknown, label: string): string { if (typeof value !== "string") throw new ApiError(400, `${label} name is required.`); const x=value.trim(); if (!x || x.length>120) throw new ApiError(400, `${label} name must be between 1 and 120 characters.`); return x; }
function retainedTemplateRequest(value: unknown): TemplateRequest {
  const cleaned=safeJson(value), b=bodyObject(cleaned);
  const allowed=new Set(["templateType","outputFormat","documentDate","borrowerName","servicerName","incomeSources","incomeSourceName","incomeSourceAddress","paymentFrequency","grossAmount","notes"]);
  for (const k of Object.keys(b)) if (!allowed.has(k)) throw new ApiError(400, `Unexpected retained document field: ${k}.`);
  if (!["current_income_statement","income_change_explanation","unemployment_income_statement","no_current_taxable_income_statement"].includes(String(b.templateType))) throw new ApiError(400,"Invalid retained document template type.");
  return b as unknown as TemplateRequest;
}
function artifactSummary(row: ArtifactRow) { return { artifactId:row.artifact_id, artifactKind:row.artifact_kind, name:row.name, engineVersion:row.engine_version, createdAt:row.created_at }; }
function artifactView(row: ArtifactRow) { return { ...artifactSummary(row), templateRequest:parseStoredJson<TemplateRequest>(row.template_request_json,"artifact template request"), documentText:row.document_text, documentHtml:row.document_html }; }
const SELECT_SIGN_WINDOW_MS = 15 * 60 * 1000;
const BOOKING_WINDOW_MS = 36 * 60 * 60 * 1000;

function computeFlrsPlan(comparison: { projections: Array<{ plan: string; eligibilityStatus: string; currentMonthlyPayment: number | null }> }): string | null {
  const candidates = comparison.projections.filter((p) => p.eligibilityStatus !== "ineligible" && typeof p.currentMonthlyPayment === "number");
  if (!candidates.length) return null;
  const min = Math.min(...candidates.map((p) => p.currentMonthlyPayment as number));
  const winners = candidates.filter((p) => p.currentMonthlyPayment === min);
  return winners.length === 1 ? winners[0]!.plan : null;
}

async function planSelectionRowByToken(database: D1DatabaseBinding, shareToken: string): Promise<PlanSelectionRow> {
  const hash = await sha(shareToken);
  const row = await database.prepare(
    "SELECT selection_id,owner_advisor_id,client_id,share_token_hash,status,comparison_snapshot_json,selected_plan,selected_at,sign_initials,signed_at,booking_url,booked_at,link_opened_at,select_sign_deadline_at,booking_deadline_at,revoked_at,created_at,updated_at FROM advisor_client_plan_selections WHERE share_token_hash=?"
  ).bind(hash).first<PlanSelectionRow>();
  if (!row) throw new ApiError(404, "Share link not found.");
  return row;
}

function shareView(row: PlanSelectionRow) {
  const comparison = parseStoredJson<{ projections: Array<{ plan: string; eligibilityStatus: string; currentMonthlyPayment: number | null }>; [key: string]: unknown }>(row.comparison_snapshot_json, "comparison snapshot");
  return {
    status: row.status,
    comparison,
    flrsPlan: computeFlrsPlan(comparison),
    selectedPlan: row.selected_plan,
    selectedAt: row.selected_at,
    signedAt: row.signed_at,
    bookingUrl: row.booking_url,
    bookedAt: row.booked_at,
    linkOpenedAt: row.link_opened_at,
    selectSignDeadlineAt: row.select_sign_deadline_at,
    bookingDeadlineAt: row.booking_deadline_at
  };
}

async function issueShareLink(request: Request, database: D1DatabaseBinding, a: Auth, id: string) {
  sameOrigin(request);
  const row = await owned(database, a.account.advisor_id, id);
  const client = parseClient(row);
  const comparison = compareClientPrograms(client);
  const shareToken = token();
  const selectionId = `selection_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await database.prepare(
    "INSERT INTO advisor_client_plan_selections(selection_id,owner_advisor_id,client_id,share_token_hash,status,comparison_snapshot_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)"
  ).bind(selectionId, a.account.advisor_id, id, await sha(shareToken), "issued", JSON.stringify(comparison), now, now).run();
  await audit(database, a.account.advisor_id, "client.plan_selection.issue", id);
  return json({ ok: true, selection: { selectionId, shareToken, status: "issued", createdAt: now, flrsPlan: computeFlrsPlan(comparison) } }, 201);
}

async function listShareLinks(database: D1DatabaseBinding, a: Auth, id: string) {
  await owned(database, a.account.advisor_id, id);
  const rows = await database.prepare(
    "SELECT selection_id,owner_advisor_id,client_id,share_token_hash,status,comparison_snapshot_json,selected_plan,selected_at,sign_initials,signed_at,booking_url,booked_at,link_opened_at,select_sign_deadline_at,booking_deadline_at,revoked_at,created_at,updated_at FROM advisor_client_plan_selections WHERE owner_advisor_id=? AND client_id=? ORDER BY created_at DESC LIMIT 50"
  ).bind(a.account.advisor_id, id).all<PlanSelectionRow>();
  return json({ ok: true, selections: rows.results.map((r) => ({ selectionId: r.selection_id, status: r.status, selectedPlan: r.selected_plan, signedAt: r.signed_at, bookedAt: r.booked_at, createdAt: r.created_at, updatedAt: r.updated_at })) });
}

async function revokeShareLink(request: Request, database: D1DatabaseBinding, a: Auth, id: string, selectionId: string) {
  sameOrigin(request);
  await owned(database, a.account.advisor_id, id);
  const now = new Date().toISOString();
  const r = await database.prepare(
    "UPDATE advisor_client_plan_selections SET status='revoked', revoked_at=?, updated_at=? WHERE owner_advisor_id=? AND client_id=? AND selection_id=? AND status NOT IN ('revoked','booked')"
  ).bind(now, now, a.account.advisor_id, id, selectionId).run();
  if ((r.meta?.changes ?? 0) !== 1) throw new ApiError(409, "Share link could not be revoked (already booked, revoked, or not found).");
  await audit(database, a.account.advisor_id, "client.plan_selection.revoke", id);
  return json({ ok: true, revokedSelectionId: selectionId });
}

function expireIfPastDeadline(row: PlanSelectionRow, nowIso: string): PlanSelectionRow["status"] | null {
  const now = Date.parse(nowIso);
  if ((row.status === "opened" || row.status === "selected") && row.select_sign_deadline_at && now > Date.parse(row.select_sign_deadline_at)) return "expired";
  if (row.status === "signed" && row.booking_deadline_at && now > Date.parse(row.booking_deadline_at)) return "expired";
  return null;
}

async function viewShare(database: D1DatabaseBinding, shareToken: string) {
  let row = await planSelectionRowByToken(database, shareToken);
  if (row.status === "revoked") return json({ ok: true, ...shareView(row) });
  const now = new Date().toISOString();
  const expired = expireIfPastDeadline(row, now);
  if (expired) {
    await database.prepare("UPDATE advisor_client_plan_selections SET status=?, updated_at=? WHERE selection_id=?").bind(expired, now, row.selection_id).run();
    row = { ...row, status: expired, updated_at: now };
    return json({ ok: true, ...shareView(row) });
  }
  if (row.status === "issued") {
    const deadline = new Date(Date.parse(now) + SELECT_SIGN_WINDOW_MS).toISOString();
    await database.prepare("UPDATE advisor_client_plan_selections SET status='opened', link_opened_at=?, select_sign_deadline_at=?, updated_at=? WHERE selection_id=?").bind(now, deadline, now, row.selection_id).run();
    row = { ...row, status: "opened", link_opened_at: now, select_sign_deadline_at: deadline, updated_at: now };
  }
  return json({ ok: true, ...shareView(row) });
}

async function selectSharePlan(request: Request, database: D1DatabaseBinding, shareToken: string) {
  sameOrigin(request);
  const row = await planSelectionRowByToken(database, shareToken);
  const now = new Date().toISOString();
  const expired = expireIfPastDeadline(row, now);
  if (expired) { await database.prepare("UPDATE advisor_client_plan_selections SET status=?, updated_at=? WHERE selection_id=?").bind(expired, now, row.selection_id).run(); throw new ApiError(410, "This link's 15-minute selection window has expired. Ask your advisor for a new link."); }
  if (row.status !== "opened" && row.status !== "selected") throw new ApiError(409, `A plan cannot be selected while the link status is '${row.status}'.`);
  const b = await body(request);
  const allowed = new Set(["plan"]);
  for (const k of Object.keys(b)) if (!allowed.has(k)) throw new ApiError(400, `Unexpected field: ${k}.`);
  const plan = String(b.plan ?? "").trim();
  const comparison = parseStoredJson<{ projections: Array<{ plan: string; eligibilityStatus: string }> }>(row.comparison_snapshot_json, "comparison snapshot");
  const candidate = comparison.projections.find((p) => p.plan === plan);
  if (!candidate) throw new ApiError(400, "That plan is not part of this comparison.");
  if (candidate.eligibilityStatus === "ineligible") throw new ApiError(400, "That plan is currently modeled as ineligible and cannot be selected.");
  await database.prepare("UPDATE advisor_client_plan_selections SET status='selected', selected_plan=?, selected_at=?, updated_at=? WHERE selection_id=?").bind(plan, now, now, row.selection_id).run();
  await audit(database, row.owner_advisor_id, "client.plan_selection.select", row.client_id);
  return json({ ok: true, status: "selected", selectedPlan: plan, selectedAt: now, selectSignDeadlineAt: row.select_sign_deadline_at });
}

async function sendNotificationEmail(apiKey: string | undefined, to: string, subject: string, text: string): Promise<void> {
  if (!apiKey || !to) return;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "Student Loan IDR <notifications@agentfeedoptimization.com>", to: [to], subject, text })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(`Resend notification to ${to} failed: ${response.status} ${detail.slice(0, 300)}`);
    }
  } catch (error) { console.error(`Resend notification to ${to} threw: ${error instanceof Error ? error.message : "unknown error"}`); }
}

async function signSharePlan(request: Request, database: D1DatabaseBinding, shareToken: string, env: AdvisorWorkspaceEnv) {
  sameOrigin(request);
  const row = await planSelectionRowByToken(database, shareToken);
  const now = new Date().toISOString();
  const expired = expireIfPastDeadline(row, now);
  if (expired) { await database.prepare("UPDATE advisor_client_plan_selections SET status=?, updated_at=? WHERE selection_id=?").bind(expired, now, row.selection_id).run(); throw new ApiError(410, "This link's 15-minute selection window has expired. Ask your advisor for a new link."); }
  if (row.status !== "selected") throw new ApiError(409, "Select a plan before signing.");
  const b = await body(request);
  const allowed = new Set(["initials"]);
  for (const k of Object.keys(b)) if (!allowed.has(k)) throw new ApiError(400, `Unexpected field: ${k}.`);
  const initials = String(b.initials ?? "").trim().slice(0, 10);
  if (!initials) throw new ApiError(400, "Initials are required to confirm your plan choice.");
  const bookingDeadline = new Date(Date.parse(now) + BOOKING_WINDOW_MS).toISOString();
  await database.prepare("UPDATE advisor_client_plan_selections SET status='signed', sign_initials=?, signed_at=?, booking_deadline_at=?, updated_at=? WHERE selection_id=?").bind(initials, now, bookingDeadline, now, row.selection_id).run();
  await audit(database, row.owner_advisor_id, "client.plan_selection.sign", row.client_id);
  try {
    const clientRow = await owned(database, row.owner_advisor_id, row.client_id);
    const client = parseClient(clientRow);
    const account = await database.prepare("SELECT email_normalized, display_name FROM advisor_accounts WHERE advisor_id=?").bind(row.owner_advisor_id).first<{ email_normalized: string; display_name: string }>();
    if (account) {
      await sendNotificationEmail(env.RESEND_API_KEY, account.email_normalized, `${client.contact.displayName} confirmed a plan`, `${client.contact.displayName} confirmed the ${row.selected_plan} plan and is ready to schedule enrollment. Follow up to book a time.`);
    }
    if (client.contact.email) {
      await sendNotificationEmail(env.RESEND_API_KEY, client.contact.email, "You confirmed your repayment plan", `You confirmed the ${row.selected_plan} plan. Your advisor will follow up to schedule enrollment. This is not a binding signature or loan-program enrollment.`);
    }
  } catch { /* notification failures never block the borrower's confirmation */ }
  return json({ ok: true, status: "signed", signedAt: now, bookingDeadlineAt: bookingDeadline, note: "This confirms the plan you'd like to move forward with. It is not a binding electronic signature or loan-program enrollment." });
}

function toDocumentationIncomeSources(sources: AdvisorClientIncomeSource[] | undefined): DocumentationIncomeSource[] | undefined {
  if (!sources || !sources.length) return undefined;
  return sources.map((s) => ({ ...(s.sourceType?{sourceType:s.sourceType}:{}), ...(s.name?{name:s.name}:{}), ...(s.address?{address:s.address}:{}), ...(s.grossAmount!==undefined?{grossAmount:s.grossAmount}:{}), ...(s.paymentFrequency?{paymentFrequency:s.paymentFrequency}:{}), ...(s.notes?{notes:s.notes}:{}) }));
}

async function shareDocument(database: D1DatabaseBinding, shareToken: string) {
  const row = await planSelectionRowByToken(database, shareToken);
  if (row.status !== "signed" && row.status !== "booked") throw new ApiError(409, "A supporting document is available after you confirm a plan.");
  const clientRow = await owned(database, row.owner_advisor_id, row.client_id);
  const client = parseClient(clientRow);
  const incomeSources = toDocumentationIncomeSources(client.confirmedFacts?.incomeSources);
  let documentText: string, documentHtml: string;
  try {
    const templateRequest: Omit<TemplateRequest, "outputFormat"> = { templateType: "current_income_statement", borrowerName: client.contact.displayName, documentDate: new Date().toISOString().slice(0, 10), ...(client.servicerName?{servicerName:client.servicerName}:{}), ...(incomeSources?{incomeSources}:{}) };
    documentText = getDocumentationTemplate({ ...templateRequest, outputFormat: "text" });
    documentHtml = getDocumentationTemplate({ ...templateRequest, outputFormat: "html" });
  } catch (e) { throw new ApiError(400, e instanceof Error ? e.message : "Document generation failed."); }
  return json({ ok: true, document: { documentText, documentHtml } });
}

export async function handleShareApi(request: Request, env: AdvisorWorkspaceEnv): Promise<Response> {
  const database = db(env);
  try {
    const u = new URL(request.url);
    const m = u.pathname.match(/^\/api\/share\/([A-Za-z0-9_-]{16,128})(\/select|\/sign|\/document)?$/);
    if (!m) return json({ ok: false, error: "Share endpoint not found." }, 404);
    const shareToken = m[1]!;
    if (request.method === "GET" && !m[2]) return await viewShare(database, shareToken);
    if (request.method === "POST" && m[2] === "/select") return await selectSharePlan(request, database, shareToken);
    if (request.method === "POST" && m[2] === "/sign") return await signSharePlan(request, database, shareToken, env);
    if (request.method === "GET" && m[2] === "/document") return await shareDocument(database, shareToken);
    return json({ ok: false, error: "Share endpoint not found." }, 404);
  } catch (error) { if (error instanceof ApiError) return json({ ok: false, error: error.message }, error.status); return json({ ok: false, error: "Share link request failed." }, 500); }
}

function snapshotSummary(row: SnapshotRow) { return { snapshotId:row.snapshot_id, snapshotKind:row.snapshot_kind, name:row.name, policySnapshot:row.policy_snapshot, engineVersion:row.engine_version, createdAt:row.created_at }; }
function snapshotView(row: SnapshotRow) { return { ...snapshotSummary(row), basis:parseStoredJson<JsonObject>(row.basis_json,"snapshot basis"), result:parseStoredJson<unknown>(row.result_json,"snapshot result") }; }
function snapshotBasis(client: AdvisorClientRecordV1): JsonObject { return safeJson({ confirmedFacts:client.confirmedFacts ?? {}, normalizedLoanPortfolio:client.normalizedLoanPortfolio ?? {}, consideredPlans:client.consideredPlans ?? [] }) as JsonObject; }
function clientFromSnapshotBasis(row: SnapshotRow, basis: JsonObject): AdvisorClientRecordV1 {
  return { schemaVersion:1, clientId:row.client_id, ownerAdvisorId:row.owner_advisor_id, createdAt:row.created_at, updatedAt:row.created_at, lifecycleState:"active", readinessState:"needs_evidence", contact:{displayName:"Retained snapshot basis"}, ...(basis.confirmedFacts!==undefined?{confirmedFacts:basis.confirmedFacts as NonNullable<AdvisorClientRecordV1["confirmedFacts"]>}:{}), ...(basis.normalizedLoanPortfolio!==undefined?{normalizedLoanPortfolio:basis.normalizedLoanPortfolio as NonNullable<AdvisorClientRecordV1["normalizedLoanPortfolio"]>}:{}), ...(Array.isArray(basis.consideredPlans)?{consideredPlans:basis.consideredPlans as RepaymentPlan[]}:{}) };
}
function runSnapshot(kind: "calculation" | "comparison", client: AdvisorClientRecordV1) {
  if (kind === "comparison") return compareClientPrograms(client);
  const request=comparisonRequest(client);
  if (client.consideredPlans?.length) request.plans=client.consideredPlans;
  return calculateRepayment(request);
}
async function artifactRow(database:D1DatabaseBinding,advisorId:string,clientId:string,artifactId:string):Promise<ArtifactRow>{ await owned(database,advisorId,clientId); const row=await database.prepare("SELECT owner_advisor_id,client_id,artifact_id,artifact_kind,name,template_request_json,document_text,document_html,engine_version,created_at FROM advisor_client_artifacts WHERE owner_advisor_id=? AND client_id=? AND artifact_id=?").bind(advisorId,clientId,artifactId).first<ArtifactRow>(); if(!row) throw new ApiError(404,"Retained artifact not found or not accessible."); return row; }
async function snapshotRow(database:D1DatabaseBinding,advisorId:string,clientId:string,snapshotId:string):Promise<SnapshotRow>{ await owned(database,advisorId,clientId); const row=await database.prepare("SELECT owner_advisor_id,client_id,snapshot_id,snapshot_kind,name,basis_json,result_json,policy_snapshot,engine_version,created_at FROM advisor_client_calculation_snapshots WHERE owner_advisor_id=? AND client_id=? AND snapshot_id=?").bind(advisorId,clientId,snapshotId).first<SnapshotRow>(); if(!row) throw new ApiError(404,"Retained snapshot not found or not accessible."); return row; }
async function listArtifacts(database:D1DatabaseBinding,a:Auth,id:string){ await owned(database,a.account.advisor_id,id); const rows=await database.prepare("SELECT owner_advisor_id,client_id,artifact_id,artifact_kind,name,template_request_json,document_text,document_html,engine_version,created_at FROM advisor_client_artifacts WHERE owner_advisor_id=? AND client_id=? ORDER BY created_at DESC LIMIT 200").bind(a.account.advisor_id,id).all<ArtifactRow>(); return json({ok:true,artifacts:rows.results.map(artifactSummary)}); }
async function retainArtifact(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ sameOrigin(request); await owned(database,a.account.advisor_id,id); const b=await body(request), allowed=new Set(["name","templateRequest"]); for(const k of Object.keys(b)) if(!allowed.has(k)) throw new ApiError(400,`Unexpected retained artifact field: ${k}.`); const name=retainedName(b.name,"Artifact"), template=retainedTemplateRequest(b.templateRequest), createdAt=new Date().toISOString(), artifactId=`artifact_${crypto.randomUUID()}`; let documentText:string, documentHtml:string; try { documentText=getDocumentationTemplate({...template,outputFormat:"text"}); documentHtml=getDocumentationTemplate({...template,outputFormat:"html"}); } catch(e){ throw new ApiError(400,e instanceof Error?e.message:"Document generation failed."); } await database.prepare("INSERT INTO advisor_client_artifacts(owner_advisor_id,client_id,artifact_id,artifact_kind,name,template_request_json,document_text,document_html,engine_version,created_at) VALUES(?,?,?,'document_draft',?,?,?,?,?,?)").bind(a.account.advisor_id,id,artifactId,name,JSON.stringify(template),documentText,documentHtml,ENGINE_VERSION,createdAt).run(); await audit(database,a.account.advisor_id,"client.artifact.retain",id); return json({ok:true,artifact:{artifactId,artifactKind:"document_draft",name,templateRequest:template,documentText,documentHtml,engineVersion:ENGINE_VERSION,createdAt}},201); }
async function regenerateArtifact(request:Request,database:D1DatabaseBinding,a:Auth,id:string,artifactId:string){ sameOrigin(request); const row=await artifactRow(database,a.account.advisor_id,id,artifactId), template=parseStoredJson<TemplateRequest>(row.template_request_json,"artifact template request"); let documentText:string, documentHtml:string; try { documentText=getDocumentationTemplate({...template,outputFormat:"text"}); documentHtml=getDocumentationTemplate({...template,outputFormat:"html"}); } catch(e){ throw new ApiError(400,e instanceof Error?e.message:"Document regeneration failed."); } await audit(database,a.account.advisor_id,"client.artifact.regenerate",id); return json({ok:true,regenerated:{artifactId,name:row.name,templateRequest:template,documentText,documentHtml,engineVersion:ENGINE_VERSION,generatedAt:new Date().toISOString()}}); }
async function deleteArtifact(request:Request,database:D1DatabaseBinding,a:Auth,id:string,artifactId:string){ sameOrigin(request); await artifactRow(database,a.account.advisor_id,id,artifactId); const result=await database.prepare("DELETE FROM advisor_client_artifacts WHERE owner_advisor_id=? AND client_id=? AND artifact_id=?").bind(a.account.advisor_id,id,artifactId).run(); if((result.meta?.changes??0)!==1) throw new ApiError(404,"Retained artifact not found or not accessible."); await audit(database,a.account.advisor_id,"client.artifact.delete",id); return json({ok:true,deletedArtifactId:artifactId}); }
async function listSnapshots(database:D1DatabaseBinding,a:Auth,id:string){ await owned(database,a.account.advisor_id,id); const rows=await database.prepare("SELECT owner_advisor_id,client_id,snapshot_id,snapshot_kind,name,basis_json,result_json,policy_snapshot,engine_version,created_at FROM advisor_client_calculation_snapshots WHERE owner_advisor_id=? AND client_id=? ORDER BY created_at DESC LIMIT 200").bind(a.account.advisor_id,id).all<SnapshotRow>(); return json({ok:true,snapshots:rows.results.map(snapshotSummary)}); }
async function retainSnapshot(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ sameOrigin(request); const client=parseClient(await owned(database,a.account.advisor_id,id)), b=await body(request), allowed=new Set(["name","snapshotKind"]); for(const k of Object.keys(b)) if(!allowed.has(k)) throw new ApiError(400,`Unexpected retained snapshot field: ${k}.`); const name=retainedName(b.name,"Snapshot"), kind=String(b.snapshotKind); if(kind!=="calculation"&&kind!=="comparison") throw new ApiError(400,"Snapshot kind must be calculation or comparison."); const typedKind=kind as "calculation"|"comparison", basis=snapshotBasis(client), result=runSnapshot(typedKind,client), policySnapshot=String((result as {policySnapshot?:unknown}).policySnapshot??""); if(!policySnapshot) throw new ApiError(500,"Snapshot result is missing its policy snapshot."); const snapshotId=`snapshot_${crypto.randomUUID()}`, createdAt=new Date().toISOString(); await database.prepare("INSERT INTO advisor_client_calculation_snapshots(owner_advisor_id,client_id,snapshot_id,snapshot_kind,name,basis_json,result_json,policy_snapshot,engine_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(a.account.advisor_id,id,snapshotId,typedKind,name,JSON.stringify(basis),JSON.stringify(result),policySnapshot,ENGINE_VERSION,createdAt).run(); await audit(database,a.account.advisor_id,"client.snapshot.retain",id); return json({ok:true,snapshot:{snapshotId,snapshotKind:typedKind,name,basis,result,policySnapshot,engineVersion:ENGINE_VERSION,createdAt}},201); }
async function rerunSnapshot(request:Request,database:D1DatabaseBinding,a:Auth,id:string,snapshotId:string){ sameOrigin(request); const row=await snapshotRow(database,a.account.advisor_id,id,snapshotId), basis=parseStoredJson<JsonObject>(row.basis_json,"snapshot basis"), client=clientFromSnapshotBasis(row,basis), result=runSnapshot(row.snapshot_kind,client); await audit(database,a.account.advisor_id,"client.snapshot.rerun",id); return json({ok:true,rerun:{snapshotId,name:row.name,snapshotKind:row.snapshot_kind,basis:"retained_snapshot_basis",result,engineVersion:ENGINE_VERSION,generatedAt:new Date().toISOString()}}); }
async function deleteSnapshot(request:Request,database:D1DatabaseBinding,a:Auth,id:string,snapshotId:string){ sameOrigin(request); await snapshotRow(database,a.account.advisor_id,id,snapshotId); const result=await database.prepare("DELETE FROM advisor_client_calculation_snapshots WHERE owner_advisor_id=? AND client_id=? AND snapshot_id=?").bind(a.account.advisor_id,id,snapshotId).run(); if((result.meta?.changes??0)!==1) throw new ApiError(404,"Retained snapshot not found or not accessible."); await audit(database,a.account.advisor_id,"client.snapshot.delete",id); return json({ok:true,deletedSnapshotId:snapshotId}); }
function lifecycle(value: unknown): AdvisorClientLifecycleState { if (["active","awaiting_borrower_review","completed","archived"].includes(String(value))) return value as AdvisorClientLifecycleState; throw new ApiError(400,"Invalid client lifecycle state."); }
function readiness(value: unknown): AdvisorClientReadinessState { if (["needs_evidence","document_ready","application_ready"].includes(String(value))) return value as AdvisorClientReadinessState; throw new ApiError(400,"Invalid client readiness state."); }
function safeJson(value: unknown): unknown {
  if (value === null || ["string","number","boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) { if (value.length > 500) throw new ApiError(400,"Client data array is too large."); return value.map(safeJson); }
  if (typeof value !== "object") throw new ApiError(400,"Unsupported client data value.");
  const forbidden = new Set(["owneradvisorid","clientid","schemaversion","createdat","updatedat","rawfile","rawstudentaid","rawevidence","rawtext","rawcontent","filecontent","filetext","studentaidrawtext","ssn","socialsecuritynumber","fsaid","password","sessiontoken"]);
  const out: JsonObject = {};
  for (const [k,v] of Object.entries(value as JsonObject)) {
    if (forbidden.has(k.toLowerCase())) throw new ApiError(400,`Forbidden persisted client field: ${k}.`);
    out[k]=safeJson(v);
  }
  return out;
}
function updateRecord(existing: AdvisorClientRecordV1, b: JsonObject): AdvisorClientRecordV1 {
  const allowed=new Set(["expectedUpdatedAt","contact","fieldProvenance","servicerName","lifecycleState","readinessState","normalizedLoanPortfolio","confirmedFacts","consideredPlans","retainedDraftIds","notes","studentAidImport"]); for (const k of Object.keys(b)) if (!allowed.has(k)) throw new ApiError(400,`Unexpected client field: ${k}.`);
  if (b.expectedUpdatedAt!==existing.updatedAt) throw new ApiError(409,"Client record has changed; reload before saving.");
  const next=structuredClone(existing) as AdvisorClientRecordV1;
  if (b.contact!==undefined) {
    const c=bodyObject(b.contact);
    const allowedContact=new Set(["displayName","email","phone","streetAddress1","streetAddress2","city","stateCode","countryCode","zipCode"]);
    for (const k of Object.keys(c)) if (!allowedContact.has(k)) throw new ApiError(400,`Unexpected contact field: ${k}.`);
    const em=optionalText(c.email,"Client email",254), ph=optionalText(c.phone,"Client phone",80), streetAddress1=optionalText(c.streetAddress1,"Client street address",200), streetAddress2=optionalText(c.streetAddress2,"Client street address 2",200), city=optionalText(c.city,"Client city",120), stateCode=optionalText(c.stateCode,"Client state code",40), countryCode=optionalText(c.countryCode,"Client country code",40), zipCode=optionalText(c.zipCode,"Client ZIP code",40);
    next.contact={displayName:displayName(c.displayName),...(em?{email:em}:{}),...(ph?{phone:ph}:{}),...(streetAddress1?{streetAddress1}:{}),...(streetAddress2?{streetAddress2}:{}),...(city?{city}:{}),...(stateCode?{stateCode}:{}),...(countryCode?{countryCode}:{}),...(zipCode?{zipCode}:{})};
  }
  if (b.fieldProvenance!==undefined) next.fieldProvenance=safeJson(b.fieldProvenance) as NonNullable<AdvisorClientRecordV1["fieldProvenance"]>;
  if (b.servicerName!==undefined) { const value=optionalText(b.servicerName,"Servicer name",200); if (value===undefined) delete next.servicerName; else next.servicerName=value; }
  if (b.lifecycleState!==undefined) next.lifecycleState=lifecycle(b.lifecycleState);
  if (b.readinessState!==undefined) next.readinessState=readiness(b.readinessState);
  for (const key of ["normalizedLoanPortfolio","confirmedFacts","consideredPlans","retainedDraftIds"] as const) if (b[key]!==undefined) (next as unknown as JsonObject)[key]=safeJson(b[key]);
  if (b.notes!==undefined) { const value=optionalText(b.notes,"Advisor notes",10_000); if (value===undefined) delete next.notes; else next.notes=value; }
  if (b.studentAidImport!==undefined) {
    const s=bodyObject(b.studentAidImport), allowedStudentAid=new Set(["source","importedAt","fileRequestDate","mappingVersion","rawFileRetained"]);
    for (const k of Object.keys(s)) if (!allowedStudentAid.has(k)) throw new ApiError(400,`Unexpected StudentAid import field: ${k}.`);
    if (s.source!=="studentaid_download" || s.rawFileRetained!==false) throw new ApiError(400,"Raw StudentAid files cannot be retained.");
    const importedAt=optionalText(s.importedAt,"StudentAid import date",80), fileRequestDate=optionalText(s.fileRequestDate,"StudentAid file request date",80), mappingVersion=optionalText(s.mappingVersion,"StudentAid mapping version",80);
    next.studentAidImport={source:"studentaid_download",...(importedAt?{importedAt}:{}),...(fileRequestDate?{fileRequestDate}:{}),...(mappingVersion?{mappingVersion}:{}),rawFileRetained:false};
  }
  next.updatedAt=new Date().toISOString(); return next;
}
async function owned(database:D1DatabaseBinding,advisorId:string,clientId:string):Promise<ClientRow>{ const r=await database.prepare("SELECT owner_advisor_id,client_id,display_name,lifecycle_state,readiness_state,record_json,created_at,updated_at FROM advisor_clients WHERE owner_advisor_id=? AND client_id=?").bind(advisorId,clientId).first<ClientRow>(); if(!r) throw new ApiError(404,"Client not found or not accessible."); return r; }
function clientRoute(path:string){ const p="/api/advisor/clients/"; if(!path.startsWith(p)) return null; const rest=path.slice(p.length), slash=rest.indexOf("/"), id=decodeURIComponent(slash<0?rest:rest.slice(0,slash)); if(!/^client_[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404,"Client not found or not accessible."); return {id,suffix:slash<0?"":rest.slice(slash)}; }

async function register(request:Request,database:D1DatabaseBinding){ sameOrigin(request); const b=await body(request), e=email(b.email), name=displayName(b.displayName), pw=password(b.password); if(await database.prepare("SELECT advisor_id FROM advisor_accounts WHERE email_normalized=?").bind(e).first()) throw new ApiError(409,"Unable to create account with those credentials."); const advisorId=`adv_${crypto.randomUUID()}`, now=new Date().toISOString(), salt=randomHex(); let hash:string; try { hash=await passwordHash(pw,salt,PASSWORD_WORK_FACTOR); } catch { throw new ApiError(500,"Advisor credential hashing unavailable."); } try { await database.prepare("INSERT INTO advisor_accounts(advisor_id,email_normalized,display_name,password_salt,password_hash,password_iterations,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',?,?)").bind(advisorId,e,name,salt,hash,PASSWORD_WORK_FACTOR,now,now).run(); } catch { throw new ApiError(500,"Advisor account persistence unavailable."); } const s=await createSession(database,advisorId); await audit(database,advisorId,"advisor.register"); return json({ok:true,advisor:{advisorId,email:e,displayName:name,status:"active"},csrfToken:s.csrfToken,expiresAt:s.expiresAt},201,{"set-cookie":cookie(s.sessionToken)}); }
async function login(request:Request,database:D1DatabaseBinding){ sameOrigin(request); const b=await body(request), e=email(b.email), pw=password(b.password); if(await blocked(database,e)) throw new ApiError(429,"Too many login attempts. Try again later."); const a=await database.prepare("SELECT * FROM advisor_accounts WHERE email_normalized=?").bind(e).first<AccountRow>(); const candidate=a?await passwordHash(pw,a.password_salt,a.password_iterations):await passwordHash(pw,randomHex(),PASSWORD_WORK_FACTOR); if(!a||!equal(candidate,a.password_hash)||a.status!=="active"){await failLogin(database,e);throw new ApiError(401,"Invalid email or password.");} await clearFailures(database,e); await database.prepare("UPDATE advisor_sessions SET revoked_at=? WHERE advisor_id=? AND revoked_at IS NULL").bind(new Date().toISOString(),a.advisor_id).run(); const s=await createSession(database,a.advisor_id); await audit(database,a.advisor_id,"advisor.login"); return json({ok:true,advisor:accountView(a),csrfToken:s.csrfToken,expiresAt:s.expiresAt},200,{"set-cookie":cookie(s.sessionToken)}); }
async function listClients(request:Request,database:D1DatabaseBinding,a:Auth){ const u=new URL(request.url), q=(u.searchParams.get("search")??"").trim().toLowerCase().replace(/[%_]/g,"").slice(0,120), lim=Math.min(Math.max(Number(u.searchParams.get("limit")??50)||50,1),100), life=u.searchParams.get("lifecycle"); if(life!==null) lifecycle(life); const r=await database.prepare("SELECT client_id,display_name,lifecycle_state,readiness_state,updated_at FROM advisor_clients WHERE owner_advisor_id=? AND (?='' OR lower(display_name) LIKE ?) AND (? IS NULL OR lifecycle_state=?) ORDER BY updated_at DESC LIMIT ?").bind(a.account.advisor_id,q,`%${q}%`,life,life,lim).all<ClientRow>(); return json({ok:true,clients:r.results.map(summary)}); }
function normalizeMatchText(value: string | undefined): string | undefined { const t = (value ?? "").trim().toLowerCase(); return t || undefined; }
function normalizeMatchPhone(value: string | undefined): string | undefined { const t = (value ?? "").replace(/[^0-9]/g, ""); return t.length >= 7 ? t : undefined; }
async function matchClients(request:Request,database:D1DatabaseBinding,a:Auth){ sameOrigin(request); const b=await body(request), allowed=new Set(["displayName","email","phone"]); for(const k of Object.keys(b)) if(!allowed.has(k)) throw new ApiError(400,`Unexpected match field: ${k}.`); const name=optionalText(b.displayName,"Client name",120), em=optionalText(b.email,"Client email",254), ph=optionalText(b.phone,"Client phone",80); if(!name&&!em&&!ph) throw new ApiError(400,"At least one of displayName, email, or phone is required to check for matches."); const normName=normalizeMatchText(name), normEmail=normalizeMatchText(em), normPhone=normalizeMatchPhone(ph); const rows=await database.prepare("SELECT client_id,display_name,lifecycle_state,readiness_state,record_json,updated_at FROM advisor_clients WHERE owner_advisor_id=? ORDER BY updated_at DESC LIMIT 500").bind(a.account.advisor_id).all<ClientRow>(); const matches:Array<{clientId:string;displayName:string;lifecycleState:AdvisorClientLifecycleState;readinessState:AdvisorClientReadinessState;matchStrength:"strong"|"name_only";matchedOn:string[]}>=[]; for (const row of rows.results) { const client=parseClient(row); const matchedOn:string[]=[]; let strong=false; const rowEmail=normalizeMatchText(client.contact.email), rowPhone=normalizeMatchPhone(client.contact.phone), rowName=normalizeMatchText(client.contact.displayName); if(normEmail&&rowEmail&&normEmail===rowEmail){strong=true;matchedOn.push("email");} if(normPhone&&rowPhone&&normPhone===rowPhone){strong=true;matchedOn.push("phone");} if(normName&&rowName&&normName===rowName)matchedOn.push("displayName"); if(matchedOn.length===0)continue; matches.push({clientId:row.client_id,displayName:row.display_name,lifecycleState:row.lifecycle_state,readinessState:row.readiness_state,matchStrength:strong?"strong":"name_only",matchedOn}); } matches.sort((x,y)=>x.matchStrength===y.matchStrength?0:x.matchStrength==="strong"?-1:1); return json({ok:true,matches:matches.slice(0,10)}); }
async function createClient(request:Request,database:D1DatabaseBinding,a:Auth){ sameOrigin(request); const b=await body(request), allowed=new Set(["displayName","email","phone","contact","servicerName","normalizedLoanPortfolio","studentAidImport","fieldProvenance"]); for(const k of Object.keys(b)) if(!allowed.has(k)) throw new ApiError(400,`Unexpected client field: ${k}.`); if(b.contact!==undefined&&(b.displayName!==undefined||b.email!==undefined||b.phone!==undefined)) throw new ApiError(400,"Use either contact or displayName/email/phone, not both."); let contact:AdvisorClientRecordV1["contact"]; if(b.contact!==undefined){ const c=bodyObject(b.contact), allowedContact=new Set(["displayName","email","phone","streetAddress1","streetAddress2","city","stateCode","countryCode","zipCode"]); for(const k of Object.keys(c)) if(!allowedContact.has(k)) throw new ApiError(400,`Unexpected contact field: ${k}.`); const em=optionalText(c.email,"Client email",254), ph=optionalText(c.phone,"Client phone",80), streetAddress1=optionalText(c.streetAddress1,"Client street address",200), streetAddress2=optionalText(c.streetAddress2,"Client street address 2",200), city=optionalText(c.city,"Client city",120), stateCode=optionalText(c.stateCode,"Client state code",40), countryCode=optionalText(c.countryCode,"Client country code",40), zipCode=optionalText(c.zipCode,"Client ZIP code",40); contact={displayName:displayName(c.displayName),...(em?{email:em}:{}),...(ph?{phone:ph}:{}),...(streetAddress1?{streetAddress1}:{}),...(streetAddress2?{streetAddress2}:{}),...(city?{city}:{}),...(stateCode?{stateCode}:{}),...(countryCode?{countryCode}:{}),...(zipCode?{zipCode}:{})}; } else { const em=optionalText(b.email,"Client email",254), ph=optionalText(b.phone,"Client phone",80); contact={displayName:displayName(b.displayName),...(em?{email:em}:{}),...(ph?{phone:ph}:{})}; } const now=new Date().toISOString(), id=`client_${crypto.randomUUID()}`; const record:AdvisorClientRecordV1={schemaVersion:1,clientId:id,ownerAdvisorId:a.account.advisor_id,createdAt:now,updatedAt:now,lifecycleState:"active",readinessState:"needs_evidence",contact}; if(b.fieldProvenance!==undefined) record.fieldProvenance=safeJson(b.fieldProvenance) as NonNullable<AdvisorClientRecordV1["fieldProvenance"]>; if(b.servicerName!==undefined){ const value=optionalText(b.servicerName,"Servicer name",200); if(value!==undefined) record.servicerName=value; } if(b.normalizedLoanPortfolio!==undefined) record.normalizedLoanPortfolio=safeJson(b.normalizedLoanPortfolio) as NonNullable<AdvisorClientRecordV1["normalizedLoanPortfolio"]>; if(b.studentAidImport!==undefined){ const s=bodyObject(b.studentAidImport), allowedStudentAid=new Set(["source","importedAt","fileRequestDate","mappingVersion","rawFileRetained"]); for(const k of Object.keys(s)) if(!allowedStudentAid.has(k)) throw new ApiError(400,`Unexpected StudentAid import field: ${k}.`); if(s.source!=="studentaid_download"||s.rawFileRetained!==false) throw new ApiError(400,"Raw StudentAid files cannot be retained."); const importedAt=optionalText(s.importedAt,"StudentAid import date",80), fileRequestDate=optionalText(s.fileRequestDate,"StudentAid file request date",80), mappingVersion=optionalText(s.mappingVersion,"StudentAid mapping version",80); record.studentAidImport={source:"studentaid_download",...(importedAt?{importedAt}:{}),...(fileRequestDate?{fileRequestDate}:{}),...(mappingVersion?{mappingVersion}:{}),rawFileRetained:false}; } await database.prepare("INSERT INTO advisor_clients(owner_advisor_id,client_id,display_name,lifecycle_state,readiness_state,record_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(a.account.advisor_id,id,contact.displayName,record.lifecycleState,record.readinessState,JSON.stringify(record),now,now).run(); await audit(database,a.account.advisor_id,"client.create",id); return json({ok:true,client:record},201); }
async function updateClient(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ sameOrigin(request); const b=await body(request), row=await owned(database,a.account.advisor_id,id), current=parseClient(row), next=updateRecord(current,b); const r=await database.prepare("UPDATE advisor_clients SET display_name=?,lifecycle_state=?,readiness_state=?,record_json=?,updated_at=? WHERE owner_advisor_id=? AND client_id=? AND updated_at=?").bind(next.contact.displayName,next.lifecycleState,next.readinessState,JSON.stringify(next),next.updatedAt,a.account.advisor_id,id,current.updatedAt).run(); if((r.meta?.changes??0)!==1) throw new ApiError(409,"Client record has changed; reload before saving."); await audit(database,a.account.advisor_id,"client.update",id); return json({ok:true,client:next}); }
async function archiveClient(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ sameOrigin(request); const b=await body(request), row=await owned(database,a.account.advisor_id,id), current=parseClient(row); if(b.expectedUpdatedAt!==current.updatedAt) throw new ApiError(409,"Client record has changed; reload before saving."); const next={...current,lifecycleState:"archived" as const,updatedAt:new Date().toISOString()}; const r=await database.prepare("UPDATE advisor_clients SET lifecycle_state='archived',record_json=?,updated_at=? WHERE owner_advisor_id=? AND client_id=? AND updated_at=?").bind(JSON.stringify(next),next.updatedAt,a.account.advisor_id,id,current.updatedAt).run(); if((r.meta?.changes??0)!==1) throw new ApiError(409,"Client record has changed; reload before saving."); await audit(database,a.account.advisor_id,"client.archive",id); return json({ok:true,client:next}); }
async function deleteClient(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ sameOrigin(request); const b=await body(request), row=await owned(database,a.account.advisor_id,id), current=parseClient(row); if(b.confirm!=="delete"||b.expectedUpdatedAt!==current.updatedAt) throw new ApiError(400,"Permanent deletion requires confirm='delete' and the current updatedAt value."); const r=await database.prepare("DELETE FROM advisor_clients WHERE owner_advisor_id=? AND client_id=? AND updated_at=?").bind(a.account.advisor_id,id,current.updatedAt).run(); if((r.meta?.changes??0)<1) throw new ApiError(409,"Client record has changed; reload before deleting."); await audit(database,a.account.advisor_id,"client.delete",id); return json({ok:true,deletedClientId:id}); }

export async function handleAdvisorApi(request: Request, env: AdvisorWorkspaceEnv): Promise<Response> {
  const database=db(env), u=new URL(request.url);
  try {
    if(request.method==="POST"&&u.pathname==="/api/advisor/register") return await register(request,database);
    if(request.method==="POST"&&u.pathname==="/api/advisor/login") return await login(request,database);
    if(request.method==="GET"&&u.pathname==="/api/advisor/session"){const a=await authenticate(request,database,false),csrfToken=token(),now=new Date().toISOString();await database.prepare("UPDATE advisor_sessions SET csrf_token_hash=?,last_seen_at=? WHERE session_hash=?").bind(await sha(csrfToken),now,a.session.session_hash).run();return json({ok:true,advisor:accountView(a.account),csrfToken,expiresAt:a.session.expires_at});}
    if(request.method==="POST"&&u.pathname==="/api/advisor/logout"){sameOrigin(request);const a=await authenticate(request,database,true);await database.prepare("UPDATE advisor_sessions SET revoked_at=? WHERE session_hash=?").bind(new Date().toISOString(),a.session.session_hash).run();await audit(database,a.account.advisor_id,"advisor.logout");return json({ok:true},200,{"set-cookie":clearCookie()});}
    if(request.method==="DELETE"&&u.pathname==="/api/advisor/account"){sameOrigin(request);const a=await authenticate(request,database,true),b=await body(request),pw=password(b.password),candidate=await passwordHash(pw,a.account.password_salt,a.account.password_iterations);if(!equal(candidate,a.account.password_hash))throw new ApiError(401,"Invalid password.");await database.prepare("DELETE FROM advisor_audit_events WHERE advisor_id=?").bind(a.account.advisor_id).run();await database.prepare("DELETE FROM advisor_accounts WHERE advisor_id=?").bind(a.account.advisor_id).run();await clearFailures(database,a.account.email_normalized);return json({ok:true,deletedAdvisorId:a.account.advisor_id},200,{"set-cookie":clearCookie()});}
    const a=await authenticate(request,database,["POST","PUT","PATCH","DELETE"].includes(request.method));
    if(request.method==="GET"&&u.pathname==="/api/advisor/clients") return await listClients(request,database,a);
    if(request.method==="POST"&&u.pathname==="/api/advisor/clients") return await createClient(request,database,a);
    if(request.method==="POST"&&u.pathname==="/api/advisor/clients/match") return await matchClients(request,database,a);
    const r=clientRoute(u.pathname); if(r){
      if(request.method==="GET"&&r.suffix===""){const row=await owned(database,a.account.advisor_id,r.id);return json({ok:true,client:parseClient(row)});}
      if(request.method==="PUT"&&r.suffix==="") return await updateClient(request,database,a,r.id);
      if(request.method==="POST"&&r.suffix==="/archive") return await archiveClient(request,database,a,r.id);
      if(request.method==="GET"&&r.suffix==="/comparison"){const row=await owned(database,a.account.advisor_id,r.id),client=parseClient(row),comparison=compareClientPrograms(client);await audit(database,a.account.advisor_id,"client.compare",r.id);return json({ok:true,comparison});}
      if(request.method==="GET"&&r.suffix==="/intelligence"){const row=await owned(database,a.account.advisor_id,r.id),client=parseClient(row);if(!client.normalizedLoanPortfolio?.loans?.length) throw new ApiError(422,"Save normalized per-loan StudentAid facts before generating portfolio intelligence.");return json({ok:true,intelligence:deriveStudentAidPortfolioIntelligence(client)});}
      if(request.method==="GET"&&r.suffix==="/artifacts") return await listArtifacts(database,a,r.id);
      if(request.method==="POST"&&r.suffix==="/artifacts") return await retainArtifact(request,database,a,r.id);
      const artifactMatch=r.suffix.match(/^\/artifacts\/(artifact_[0-9a-f-]{36})(\/regenerate)?$/i);
      if(artifactMatch){ if(request.method==="GET"&&!artifactMatch[2]) return json({ok:true,artifact:artifactView(await artifactRow(database,a.account.advisor_id,r.id,artifactMatch[1]!))}); if(request.method==="POST"&&artifactMatch[2]==="/regenerate") return await regenerateArtifact(request,database,a,r.id,artifactMatch[1]!); if(request.method==="DELETE"&&!artifactMatch[2]) return await deleteArtifact(request,database,a,r.id,artifactMatch[1]!); }
      if(request.method==="GET"&&r.suffix==="/plan-selections") return await listShareLinks(database,a,r.id);
      if(request.method==="POST"&&r.suffix==="/plan-selections") return await issueShareLink(request,database,a,r.id);
      const planSelectionMatch=r.suffix.match(/^\/plan-selections\/(selection_[0-9a-f-]{36})\/revoke$/i);
      if(planSelectionMatch&&request.method==="POST") return await revokeShareLink(request,database,a,r.id,planSelectionMatch[1]!);
      if(request.method==="GET"&&r.suffix==="/snapshots") return await listSnapshots(database,a,r.id);
      if(request.method==="POST"&&r.suffix==="/snapshots") return await retainSnapshot(request,database,a,r.id);
      const snapshotMatch=r.suffix.match(/^\/snapshots\/(snapshot_[0-9a-f-]{36})(\/rerun)?$/i);
      if(snapshotMatch){ if(request.method==="GET"&&!snapshotMatch[2]) return json({ok:true,snapshot:snapshotView(await snapshotRow(database,a.account.advisor_id,r.id,snapshotMatch[1]!))}); if(request.method==="POST"&&snapshotMatch[2]==="/rerun") return await rerunSnapshot(request,database,a,r.id,snapshotMatch[1]!); if(request.method==="DELETE"&&!snapshotMatch[2]) return await deleteSnapshot(request,database,a,r.id,snapshotMatch[1]!); }
      if(request.method==="DELETE"&&r.suffix==="") return await deleteClient(request,database,a,r.id);
      if(request.method==="GET"&&r.suffix==="/export"){const row=await owned(database,a.account.advisor_id,r.id), artifacts=await database.prepare("SELECT owner_advisor_id,client_id,artifact_id,artifact_kind,name,template_request_json,document_text,document_html,engine_version,created_at FROM advisor_client_artifacts WHERE owner_advisor_id=? AND client_id=? ORDER BY created_at DESC").bind(a.account.advisor_id,r.id).all<ArtifactRow>(), snapshots=await database.prepare("SELECT owner_advisor_id,client_id,snapshot_id,snapshot_kind,name,basis_json,result_json,policy_snapshot,engine_version,created_at FROM advisor_client_calculation_snapshots WHERE owner_advisor_id=? AND client_id=? ORDER BY created_at DESC").bind(a.account.advisor_id,r.id).all<SnapshotRow>();await audit(database,a.account.advisor_id,"client.export",r.id);return json({ok:true,schema:"student-loan-idr-advisor-client-export-v2",exportedAt:new Date().toISOString(),client:parseClient(row),retainedArtifacts:artifacts.results.map(artifactView),calculationSnapshots:snapshots.results.map(snapshotView)});}
    }
    return json({ok:false,error:"Advisor endpoint not found."},404);
  } catch(error){ if(error instanceof ApiError) return json({ok:false,error:error.message},error.status,error.status===401?{"set-cookie":clearCookie()}:{}); return json({ok:false,error:"Advisor workspace request failed."},500); }
}
