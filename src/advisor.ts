import { scryptSync } from "node:crypto";
import { calculateRepayment } from "./formulas.ts";
import { FSA_DATA_DICTIONARY, FSA_DATA_DICTIONARY_VERSION, POLICY_EVIDENCE_CORPUS, POLICY_RULE_REGISTRY, POLICY_SNAPSHOT } from "./constants.ts";
import { getDocumentationTemplate } from "./templates.ts";
import type { AdvisorAccountStatus, AdvisorActionDashboardV1, AdvisorActionState, AdvisorClientActionSignalV1, AdvisorClientActionSummaryV1, AdvisorClientCaseContextV1, AdvisorClientDashboardSummary, AdvisorClientIncomeSource, AdvisorClientLifecycleState, AdvisorClientReadinessState, AdvisorClientRecordV1, AdvisorConsultationIntent, AdvisorConsultationResponseV1, AdvisorEvidencePacketV1, AdvisorPrincipal, AdvisorRetrievalFactV1, CalculatorRequest, DocumentationIncomeSource, RepaymentPlan, RepaymentLoanInput, StudentAidLoanContactFact, StudentAidNormalizedLoanFact, StudentAidPortfolioIntelligence, StudentAidStatusIntervalIntelligence, TemplateRequest } from "./types.ts";

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
const MAX_CLIENT_BODY_BYTES = 512 * 1024;
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
type TimelineEventKind = "calculation" | "comparison" | "document_generated" | "document_retained" | "document_regenerated" | "plan_selected" | "plan_confirmed";
type TimelineRow = {
  owner_advisor_id: string; client_id: string; event_id: string; event_kind: TimelineEventKind; name: string; summary: string;
  source_type: string | null; source_id: string | null; basis_json: string | null; result_json: string | null; policy_snapshot: string | null;
  engine_version: string; starred: number; annotation: string | null; occurred_at: string; updated_at: string;
};
type PlanSelectionRow = {
  selection_id: string; owner_advisor_id: string; client_id: string; share_token_hash: string;
  status: "issued" | "opened" | "selected" | "signed" | "booked" | "expired" | "revoked";
  comparison_snapshot_json: string; selected_plan: string | null; selected_at: string | null;
  sign_initials: string | null; signed_at: string | null; booking_url: string | null; booked_at: string | null;
  link_opened_at: string | null; select_sign_deadline_at: string | null; booking_deadline_at: string | null;
  revoked_at: string | null; created_at: string; updated_at: string;
};
type ActionPlanSelectionRow = Pick<PlanSelectionRow, "selection_id" | "client_id" | "status" | "selected_at" | "signed_at" | "booked_at" | "link_opened_at" | "select_sign_deadline_at" | "booking_deadline_at" | "created_at" | "updated_at">;
type ActionTimelineRow = Pick<TimelineRow, "client_id" | "event_kind" | "occurred_at">;

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
async function body(request: Request, maxBytes = MAX_BODY_BYTES): Promise<JsonObject> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) throw new ApiError(415, "Content-Type must be application/json.");
  const declared = Number(request.headers.get("content-length")); if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError(413, "Request body too large.");
  const bytes = new Uint8Array(await request.arrayBuffer()); if (bytes.byteLength > maxBytes) throw new ApiError(413, "Request body too large.");
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

export function deriveAdvisorClientCaseContext(client: AdvisorClientRecordV1): AdvisorClientCaseContextV1 {
  const portfolio = client.normalizedLoanPortfolio;
  const loans = portfolio?.loans ?? [];
  const repaymentLoans = portfolio?.repaymentLoans ?? [];
  const summary = portfolio?.summary;
  const intelligence = loans.length ? deriveStudentAidPortfolioIntelligence(client) : undefined;
  const activeLoanCount = summary?.activeLoanCount ?? intelligence?.activeLoanCount ?? repaymentLoans.length;
  const totalOutstandingPrincipal = roundCents(summary?.totalOutstandingPrincipal ?? intelligence?.reconciliation.principal.parsedPrincipalSum ?? repaymentLoans.reduce((sum, loan) => sum + loan.principal, 0));
  const totalOutstandingInterest = roundCents(summary?.totalOutstandingInterest ?? intelligence?.interest.outstandingInterestSum ?? loans.reduce((sum, loan) => sum + (loan.outstandingInterest ?? 0), 0));
  const fields = { ...(client.fieldProvenance ?? {}) };
  const markMissingProvenance = (path: string, present: boolean) => { if (present && !fields[path]) fields[path] = "missing_review"; };
  for (const key of ["displayName", "email", "phone", "streetAddress1", "streetAddress2", "city", "stateCode", "countryCode", "zipCode"] as const) markMissingProvenance(key, Boolean(client.contact[key]));
  markMissingProvenance("servicerName", Boolean(client.servicerName));
  const facts = client.confirmedFacts;
  markMissingProvenance("confirmedFacts.income", Boolean(facts?.income?.length));
  markMissingProvenance("confirmedFacts.incomeSources", Boolean(facts?.incomeSources?.length));
  markMissingProvenance("confirmedFacts.region", Boolean(facts?.region));
  markMissingProvenance("confirmedFacts.familySize", typeof facts?.familySize === "number");
  markMissingProvenance("confirmedFacts.dependentsClaimedOnFederalTaxReturn", typeof facts?.dependentsClaimedOnFederalTaxReturn === "number");
  markMissingProvenance("confirmedFacts.taxFilingStatus", Boolean(facts?.taxFilingStatus));
  markMissingProvenance("confirmedFacts.newBorrowerOnOrAfterJuly1_2014", typeof facts?.newBorrowerOnOrAfterJuly1_2014 === "boolean");

  const missingInformation: AdvisorClientCaseContextV1["missingInformation"] = [];
  const missing = (key: string, label: string, requiredFor: AdvisorClientCaseContextV1["missingInformation"][number]["requiredFor"], blocking: boolean) => missingInformation.push({ key, label, requiredFor, blocking });
  if (!facts?.income?.length) missing("current_income", "Current normalized taxable income", ["comparison", "advisor_review"], true);
  if (!facts?.region) missing("region", "Poverty-guideline region", ["comparison"], true);
  if (typeof facts?.familySize !== "number") missing("family_size", "Legacy IDR family size", ["comparison"], true);
  if (typeof facts?.dependentsClaimedOnFederalTaxReturn !== "number") missing("dependents", "Federal tax-return dependents", ["comparison"], true);
  if (!repaymentLoans.length) missing("repayment_loan_facts", "Loan balances and interest rates", ["comparison", "advisor_review"], true);
  const mappedEligibilityCount = summary?.eligibilityMappedLoanCount ?? portfolio?.eligibilityLoans?.length ?? 0;
  if (activeLoanCount > mappedEligibilityCount) missing("eligibility_mapping", "Loan type/disbursement eligibility mapping", ["eligibility_review"], false);
  if (!facts?.taxFilingStatus) missing("tax_filing_status", "Tax filing status", ["eligibility_review"], false);
  if (typeof facts?.newBorrowerOnOrAfterJuly1_2014 !== "boolean") missing("ibr_borrower_timing", "IBR borrower timing", ["forgiveness_projection"], false);
  if (!loans.length) missing("per_loan_fsa_facts", "Normalized per-loan StudentAid facts", ["advisor_review"], false);
  if (!client.contact.email && !client.contact.phone) missing("contact_channel", "Borrower email or phone", ["advisor_review"], false);

  const currentRepaymentPlans = (intelligence?.planDistribution ?? [])
    .filter((item) => item.key !== "unreported")
    .map((item) => item.description || item.code || item.key);
  const preferredServicerName = client.servicerName ?? intelligence?.servicerRouting.preferred?.contact.name;
  const idrAnniversaryDates = [...new Set(loans.map((loan) => loan.repaymentPlanIdrAnniversaryDate).filter((value): value is string => Boolean(value)))].sort();
  const nextPaymentDueDates = [...new Set(loans.map((loan) => loan.nextPaymentDueDate).filter((value): value is string => Boolean(value)))].sort();
  const coverageTotal = Math.max(activeLoanCount, repaymentLoans.length);
  const comparisonPresent = Number(Boolean(facts?.income?.length)) + Number(Boolean(facts?.region)) + Number(typeof facts?.familySize === "number") + Number(typeof facts?.dependentsClaimedOnFederalTaxReturn === "number") + Number(Boolean(repaymentLoans.length));
  const warnings = [...(intelligence?.warnings ?? [])];
  if ((summary?.ambiguousEligibilityLoanCount ?? 0) > 0) warnings.push(`${summary!.ambiguousEligibilityLoanCount} active loan record(s) have ambiguous eligibility mapping and require advisor review.`);
  const blockingCount = missingInformation.filter((item) => item.blocking).length;
  if (blockingCount) warnings.push(`${blockingCount} case fact area(s) are still blocking a complete repayment comparison.`);

  return {
    schema: "student-loan-idr-client-case-context-v1",
    schemaVersion: 1,
    clientId: client.clientId,
    clientUpdatedAt: client.updatedAt,
    lifecycleState: client.lifecycleState,
    readinessState: client.readinessState,
    asOf: {
      caseUpdatedAt: client.updatedAt,
      ...(client.studentAidImport?.importedAt ? { studentAidImportedAt: client.studentAidImport.importedAt } : {}),
      ...(client.studentAidImport?.fileRequestDate ? { studentAidFileRequestDate: client.studentAidImport.fileRequestDate } : {}),
      ...(intelligence?.asOfDate ? { portfolioAsOfDate: intelligence.asOfDate } : {})
    },
    professionalSummary: {
      displayName: client.contact.displayName,
      ...(client.contact.email ? { email: client.contact.email } : {}),
      ...(client.contact.phone ? { phone: client.contact.phone } : {}),
      ...(preferredServicerName ? { servicerName: preferredServicerName } : {}),
      activeLoanCount,
      totalOutstandingPrincipal,
      totalOutstandingInterest,
      currentRepaymentPlans,
      ...(intelligence?.scheduledPayment.reportedAmountSum !== undefined ? { reportedScheduledPaymentSum: intelligence.scheduledPayment.reportedAmountSum } : {}),
      currentForbearanceLoanCount: intelligence?.forbearance.currentLoanCount ?? 0,
      currentDelinquencyLoanCount: intelligence?.loans.filter((loan) => loan.active && loan.delinquency.currentlyDelinquent).length ?? 0,
      idrAnniversaryDates,
      nextPaymentDueDates
    },
    normalizedFacts: {
      contact: client.contact,
      ...(client.servicerName ? { servicerName: client.servicerName } : {}),
      ...(facts ? { confirmedFacts: facts } : {}),
      ...(portfolio ? { loanPortfolio: portfolio } : {}),
      ...(client.consideredPlans?.length ? { consideredPlans: client.consideredPlans } : {})
    },
    provenance: {
      fields,
      loans: loans.map((loan) => ({ loanIndex: loan.loanIndex, fields: { ...(loan.provenance ?? {}) } }))
    },
    ...(intelligence ? { deterministicIntelligence: intelligence } : {}),
    missingInformation,
    coverage: {
      contact: client.contact.displayName && (client.contact.email || client.contact.phone) ? "complete" : client.contact.displayName ? "partial" : "none",
      loanPortfolio: coverageState(repaymentLoans.length, coverageTotal),
      eligibilityMapping: coverageState(mappedEligibilityCount, activeLoanCount),
      currentIncome: facts?.income?.length ? "complete" : "none",
      familySize: typeof facts?.familySize === "number" ? "complete" : "none",
      dependents: typeof facts?.dependentsClaimedOnFederalTaxReturn === "number" ? "complete" : "none",
      region: facts?.region ? "complete" : "none",
      comparisonReadiness: coverageState(comparisonPresent, 5),
      scheduledPayment: intelligence?.scheduledPayment.coverage ?? "none",
      outstandingInterest: intelligence?.interest.outstandingInterestCoverage ?? "none"
    },
    warnings
  };
}

function retrievalQuestion(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "Consultation question is required.");
  const question = value.trim();
  if (!question || question.length > 2000) throw new ApiError(400, "Consultation question must be between 1 and 2000 characters.");
  return question;
}
function retrievalText(value: string): string { return value.toLowerCase().replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim(); }
function retrievalTokens(value: string): string[] { return [...new Set(retrievalText(value).split(" ").filter((token) => token.length >= 2))]; }
function deriveConsultationIntent(question: string): AdvisorConsultationIntent {
  const q = retrievalText(question);
  if (/missing|still need|what do i need|before i can/.test(q)) return "missing_information";
  if (/what should i ask|ask the borrower|next best|next action|what should i do/.test(q)) return "next_best_action";
  if (/parent plus|ffel|perkins|consolidat|eligib|loan type|disbursement/.test(q)) return "eligibility_review";
  if (/lowest|monthly payment|compare|comparison|forgiveness|repayment path|modeled payment/.test(q)) return "plan_comparison";
  if (/forbear|delinquen|status histor|fsa histor|portfolio histor/.test(q)) return "portfolio_history";
  if (/document|evidence|income statement|supporting/.test(q)) return "documents_and_evidence";
  if (/policy|rule|save|repaye|paye|icr|ibr|rap/.test(q)) return "policy_explanation";
  return "case_summary";
}
function lexicalScore(question: string, keywords: readonly string[], extra = ""): number {
  const q = retrievalText(question), tokens = new Set(retrievalTokens(question));
  let score = 0;
  for (const keyword of keywords) {
    const normalized = retrievalText(keyword);
    if (normalized && q.includes(normalized)) score += normalized.includes(" ") ? 6 : 4;
    for (const token of retrievalTokens(keyword)) if (tokens.has(token)) score += 1;
  }
  for (const token of retrievalTokens(extra)) if (tokens.has(token)) score += 0.5;
  return score;
}
function policyEvidenceFor(question: string, intent: AdvisorConsultationIntent) {
  const intentKeywords: Record<AdvisorConsultationIntent, string[]> = {
    case_summary: [], missing_information: [], portfolio_history: ["status","forbearance","delinquency"], eligibility_review: ["eligibility","loan type","consolidation"],
    plan_comparison: ["repayment","payment","forgiveness"], documents_and_evidence: [], next_best_action: [], policy_explanation: ["policy","repayment plan"]
  };
  const ranked = POLICY_EVIDENCE_CORPUS
    .filter((entry) => entry.policySnapshot === POLICY_SNAPSHOT)
    .map((entry) => ({ entry, score: lexicalScore(question, [...entry.keywords, ...intentKeywords[intent]], entry.title) }))
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  const selected = ranked.filter((candidate) => candidate.score > 0).slice(0, 4).map((candidate) => candidate.entry);
  if (selected.length) return selected;
  if (["eligibility_review","plan_comparison","policy_explanation"].includes(intent)) return POLICY_EVIDENCE_CORPUS.filter((entry) => entry.policySnapshot === POLICY_SNAPSHOT).slice(0, 2);
  return [];
}
function policyRulesFor(question: string, evidenceIds: Set<string>, intent: AdvisorConsultationIntent) {
  return POLICY_RULE_REGISTRY
    .filter((rule) => rule.policySnapshot === POLICY_SNAPSHOT)
    .map((rule) => ({ rule, score: lexicalScore(question, rule.keywords, `${rule.title} ${rule.programs.join(" ")} ${rule.loanFamilies.join(" ")}`) + rule.evidenceChunkIds.filter((id) => evidenceIds.has(id)).length * 4 }))
    .filter((candidate) => candidate.score > 0 || ["eligibility_review","plan_comparison","policy_explanation"].includes(intent))
    .sort((a,b) => b.score-a.score || a.rule.id.localeCompare(b.rule.id)).slice(0, 4).map((candidate) => candidate.rule);
}
function dictionaryFor(question: string, intent: AdvisorConsultationIntent) {
  const categoryBoost = intent === "eligibility_review" ? new Set(["loan_identity","consolidation"]) : intent === "portfolio_history" ? new Set(["status","delinquency","repayment_plan"]) : intent === "plan_comparison" ? new Set(["balance","interest","repayment_plan","loan_identity"]) : new Set<string>();
  return FSA_DATA_DICTIONARY.map((entry) => ({ entry, score: lexicalScore(question, [entry.canonicalLabel, ...entry.aliases, entry.normalizedTarget], entry.category) + (categoryBoost.has(entry.category) ? 3 : 0) }))
    .filter((candidate) => candidate.score > 0).sort((a,b) => b.score-a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, 12).map((candidate) => candidate.entry);
}
function addRetrievalFact(facts: AdvisorRetrievalFactV1[], key: string, label: string, value: unknown, sourcePath: string, provenance?: AdvisorRetrievalFactV1["provenance"], asOf?: string): void {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return;
  facts.push({ key, label, value, sourcePath, ...(provenance ? { provenance } : {}), ...(asOf ? { asOf } : {}) });
}
function structuredFactsFor(context: AdvisorClientCaseContextV1, intent: AdvisorConsultationIntent): AdvisorRetrievalFactV1[] {
  const facts: AdvisorRetrievalFactV1[] = [], summary = context.professionalSummary;
  if (intent === "case_summary" || intent === "portfolio_history" || intent === "plan_comparison") {
    addRetrievalFact(facts,"active_loan_count","Active loan count",summary.activeLoanCount,"professionalSummary.activeLoanCount","deterministic_derived",context.asOf.portfolioAsOfDate);
    addRetrievalFact(facts,"outstanding_principal","Outstanding principal",summary.totalOutstandingPrincipal,"professionalSummary.totalOutstandingPrincipal","deterministic_derived",context.asOf.portfolioAsOfDate);
    addRetrievalFact(facts,"outstanding_interest","Outstanding interest",summary.totalOutstandingInterest,"professionalSummary.totalOutstandingInterest","deterministic_derived",context.asOf.portfolioAsOfDate);
    addRetrievalFact(facts,"current_repayment_plans","Current repayment plans",summary.currentRepaymentPlans,"professionalSummary.currentRepaymentPlans","deterministic_derived",context.asOf.portfolioAsOfDate);
    addRetrievalFact(facts,"scheduled_payment","Reported scheduled payment",summary.reportedScheduledPaymentSum,"professionalSummary.reportedScheduledPaymentSum","deterministic_derived",context.asOf.portfolioAsOfDate);
  }
  if (intent === "portfolio_history" || intent === "case_summary") {
    addRetrievalFact(facts,"current_forbearance_loans","Current forbearance loans",summary.currentForbearanceLoanCount,"professionalSummary.currentForbearanceLoanCount","deterministic_derived",context.asOf.portfolioAsOfDate);
    addRetrievalFact(facts,"current_delinquency_loans","Current delinquency loans",summary.currentDelinquencyLoanCount,"professionalSummary.currentDelinquencyLoanCount","deterministic_derived",context.asOf.portfolioAsOfDate);
    addRetrievalFact(facts,"idr_anniversary_dates","IDR anniversary dates",summary.idrAnniversaryDates,"professionalSummary.idrAnniversaryDates","deterministic_derived",context.asOf.portfolioAsOfDate);
    addRetrievalFact(facts,"next_payment_due_dates","Next payment due dates",summary.nextPaymentDueDates,"professionalSummary.nextPaymentDueDates","deterministic_derived",context.asOf.portfolioAsOfDate);
  }
  if (intent === "eligibility_review" || intent === "policy_explanation" || intent === "plan_comparison") {
    const eligibilityLoans = context.normalizedFacts.loanPortfolio?.eligibilityLoans ?? [];
    if (eligibilityLoans.length) addRetrievalFact(facts,"eligibility_loan_inputs","Deterministic eligibility loan inputs",eligibilityLoans,"normalizedFacts.loanPortfolio.eligibilityLoans","saved_case",context.asOf.caseUpdatedAt);
    for (const loan of context.normalizedFacts.loanPortfolio?.loans ?? []) {
      const minimal = {
        loanIndex: loan.loanIndex, mappedLoanType: loan.mappedLoanType, disbursementPeriod: loan.disbursementPeriod,
        parentPlusFirstLevelConsolidationIndicator: loan.parentPlusFirstLevelConsolidationIndicator,
        consolidationLoanWithAnyParentPlusIndicator: loan.consolidationLoanWithAnyParentPlusIndicator,
        currentLoanStatusDescription: loan.currentLoanStatusDescription
      };
      addRetrievalFact(facts,`loan_${loan.loanIndex}_eligibility`,`Loan ${loan.loanIndex + 1} eligibility facts`,minimal,`normalizedFacts.loanPortfolio.loans[${loan.loanIndex}]`,"deterministic_derived",context.asOf.portfolioAsOfDate);
    }
  }
  if (intent === "documents_and_evidence") {
    addRetrievalFact(facts,"readiness_state","Case readiness state",context.readinessState,"readinessState","saved_case",context.asOf.caseUpdatedAt);
    addRetrievalFact(facts,"income_source_evidence","Income-source evidence states",(context.normalizedFacts.confirmedFacts?.incomeSources ?? []).map((source) => ({ sourceType:source.sourceType, evidenceState:source.evidenceState })),"normalizedFacts.confirmedFacts.incomeSources","saved_case",context.asOf.caseUpdatedAt);
  }
  if (intent === "missing_information" || intent === "next_best_action") addRetrievalFact(facts,"comparison_readiness","Comparison readiness",context.coverage.comparisonReadiness,"coverage.comparisonReadiness","deterministic_derived",context.asOf.caseUpdatedAt);
  return facts;
}
async function evidencePacket(database: D1DatabaseBinding, advisorId: string, client: AdvisorClientRecordV1, question: string): Promise<AdvisorEvidencePacketV1> {
  const context = deriveAdvisorClientCaseContext(client), intent = deriveConsultationIntent(question), facts = structuredFactsFor(context,intent);
  const timelineRows = await database.prepare("SELECT owner_advisor_id,client_id,event_id,event_kind,name,summary,source_type,source_id,basis_json,result_json,policy_snapshot,engine_version,starred,annotation,occurred_at,updated_at FROM advisor_client_timeline_events WHERE owner_advisor_id=? AND client_id=? ORDER BY occurred_at DESC,event_id DESC LIMIT 12").bind(advisorId,client.clientId).all<TimelineRow>();
  const artifactRows = await database.prepare("SELECT owner_advisor_id,client_id,artifact_id,artifact_kind,name,template_request_json,document_text,document_html,engine_version,created_at FROM advisor_client_artifacts WHERE owner_advisor_id=? AND client_id=? ORDER BY created_at DESC LIMIT 8").bind(advisorId,client.clientId).all<ArtifactRow>();
  const snapshotRows = await database.prepare("SELECT owner_advisor_id,client_id,snapshot_id,snapshot_kind,name,basis_json,result_json,policy_snapshot,engine_version,created_at FROM advisor_client_calculation_snapshots WHERE owner_advisor_id=? AND client_id=? ORDER BY created_at DESC LIMIT 8").bind(advisorId,client.clientId).all<SnapshotRow>();
  const selectionRows = await database.prepare("SELECT selection_id,client_id,status,selected_at,signed_at,booked_at,link_opened_at,select_sign_deadline_at,booking_deadline_at,created_at,updated_at FROM advisor_client_plan_selections WHERE owner_advisor_id=? AND client_id=? ORDER BY updated_at DESC LIMIT 20").bind(advisorId,client.clientId).all<ActionPlanSelectionRow>();
  const activeSelection = selectionRows.results.find((row) => !["expired","revoked","booked"].includes(row.status));
  const action = deriveActionSummary(client,activeSelection,timelineRows.results.map((row) => ({client_id:row.client_id,event_kind:row.event_kind,occurred_at:row.occurred_at})),Date.now());
  const evidence = policyEvidenceFor(question,intent), evidenceIds = new Set(evidence.map((entry) => entry.id)), rules = policyRulesFor(question,evidenceIds,intent), dictionaryEntries = dictionaryFor(question,intent);
  const warnings = [...context.warnings];
  let comparison: unknown | undefined;
  if (intent === "plan_comparison") {
    try { comparison = compareClientPrograms(client); }
    catch (error) { if (error instanceof ApiError && error.status === 422) warnings.push(error.message); else throw error; }
  }
  if (evidence.some((entry) => entry.policySnapshot !== POLICY_SNAPSHOT) || rules.some((rule) => rule.policySnapshot !== POLICY_SNAPSHOT)) throw new ApiError(409,"Policy retrieval attempted to use evidence outside the current accepted policy snapshot.");
  return {
    schema:"student-loan-idr-advisor-evidence-packet-v1", schemaVersion:1, clientId:client.clientId, clientUpdatedAt:client.updatedAt,
    policySnapshot:POLICY_SNAPSHOT, dictionaryVersion:FSA_DATA_DICTIONARY_VERSION, question, intent, retrievalMode:"structured_client_exact_keyword_policy",
    facts, missingInformation:context.missingInformation,
    deterministic:{ caseContext:{asOf:context.asOf,coverage:context.coverage,warnings:context.warnings}, ...(context.deterministicIntelligence?{intelligence:context.deterministicIntelligence}:{}), ...(comparison!==undefined?{comparison}:{}), nextBestAction:action },
    history:{
      timeline:timelineRows.results.map((row) => ({eventId:row.event_id,eventKind:row.event_kind,name:row.name,summary:row.summary,...(row.policy_snapshot?{policySnapshot:row.policy_snapshot}:{}),occurredAt:row.occurred_at})),
      artifacts:artifactRows.results.map((row) => ({artifactId:row.artifact_id,name:row.name,createdAt:row.created_at})),
      snapshots:snapshotRows.results.map((row) => ({snapshotId:row.snapshot_id,snapshotKind:row.snapshot_kind,name:row.name,policySnapshot:row.policy_snapshot,createdAt:row.created_at}))
    },
    dictionaryEntries:[...dictionaryEntries], policyRules:[...rules], policyEvidence:[...evidence], warnings,
    privacy:{rawStudentAidIncluded:false,rawStudentAidEmbedded:false,sharedBorrowerPiiCorpus:false}
  };
}
function consultationAnswer(packet: AdvisorEvidencePacketV1): string {
  const citations = packet.policyEvidence.map((entry) => `[${entry.id}]`).join(" ");
  const suffix = citations ? ` Policy evidence: ${citations}.` : "";
  if (packet.intent === "missing_information") {
    const blocking = packet.missingInformation.filter((item) => item.blocking);
    return blocking.length ? `Before a complete comparison, the saved case is still missing: ${blocking.map((item) => item.label).join(", ")}.${suffix}` : `The saved case has no blocking comparison facts flagged by the current deterministic case-context contract.${suffix}`;
  }
  if (packet.intent === "next_best_action") {
    const action = packet.deterministic.nextBestAction;
    return action ? `${action.signals[0]?.reason ?? "Open the saved case to review the next step."} Next best action: ${action.nextBestAction.label}.${suffix}` : `Open the saved case to review the next deterministic workflow step.${suffix}`;
  }
  if (packet.intent === "plan_comparison" && packet.deterministic.comparison) {
    const comparison = packet.deterministic.comparison as {projections?:Array<{plan:string;eligibilityStatus:string;currentMonthlyPayment:number|null}>};
    const candidates=(comparison.projections??[]).filter((projection)=>projection.eligibilityStatus!=="ineligible"&&typeof projection.currentMonthlyPayment==="number");
    if(candidates.length){const lowest=[...candidates].sort((a,b)=>(a.currentMonthlyPayment??Infinity)-(b.currentMonthlyPayment??Infinity))[0]!;return `${lowest.plan} has the lowest modeled monthly payment among the currently modeled non-ineligible options at $${Number(lowest.currentMonthlyPayment).toFixed(2)} per month. The calculation remains deterministic and the policy evidence only explains the result.${suffix}`;}
  }
  if (packet.intent === "eligibility_review") {
    const loanFacts = packet.facts.filter((fact)=>fact.key.includes("eligibility"));
    return `I found ${loanFacts.length} structured loan eligibility fact set(s). Eligibility remains code-owned from the saved loan family, disbursement, and consolidation facts; the retrieved policy cards explain those branches but cannot override them.${suffix}`;
  }
  if (packet.intent === "portfolio_history") {
    const forbearance=packet.facts.find((fact)=>fact.key==="current_forbearance_loans")?.value??0, delinquency=packet.facts.find((fact)=>fact.key==="current_delinquency_loans")?.value??0;
    return `The saved deterministic portfolio history shows ${String(forbearance)} active loan(s) currently in forbearance and ${String(delinquency)} active loan(s) currently delinquent. Review the cited as-of dates and case warnings before acting.${suffix}`;
  }
  if (packet.intent === "documents_and_evidence") {
    const blocking=packet.missingInformation.filter((item)=>item.blocking);
    return blocking.length?`The case still has ${blocking.length} blocking fact area(s) before a complete comparison. Supporting-document work should use only saved confirmed facts and explicit evidence states; chat does not create or verify evidence.${suffix}`:`The current saved case has no blocking comparison fact gaps. Supporting-document actions still require explicit use of the validated document workflow.${suffix}`;
  }
  if (packet.intent === "policy_explanation") return `The explanation is pinned to policy snapshot ${packet.policySnapshot}. Deterministic code remains authoritative for eligibility and calculations; retrieved policy cards are explanatory only.${suffix}`;
  const summary = packet.facts.slice(0,5).map((fact)=>`${fact.label}: ${Array.isArray(fact.value)?fact.value.join(", "):String(fact.value)}`).join("; ");
  return `${summary || "The saved case context is available, but this question did not require additional client facts."}.${suffix}`;
}
async function parseRetrievalRequest(request: Request): Promise<string> {
  sameOrigin(request); const b=await body(request), allowed=new Set(["question","policySnapshot"]); for(const key of Object.keys(b)) if(!allowed.has(key)) throw new ApiError(400,`Unexpected consultation field: ${key}.`);
  if(b.policySnapshot!==undefined&&String(b.policySnapshot)!==POLICY_SNAPSHOT) throw new ApiError(409,`Requested policy snapshot ${String(b.policySnapshot)} is not the current accepted snapshot ${POLICY_SNAPSHOT}.`);
  return retrievalQuestion(b.question);
}
async function retrieveClientEvidence(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ const question=await parseRetrievalRequest(request),client=parseClient(await owned(database,a.account.advisor_id,id)); return json({ok:true,evidence:await evidencePacket(database,a.account.advisor_id,client,question)}); }
async function consultClient(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ const question=await parseRetrievalRequest(request),client=parseClient(await owned(database,a.account.advisor_id,id)),evidence=await evidencePacket(database,a.account.advisor_id,client,question),action=evidence.deterministic.nextBestAction?.nextBestAction; const response:AdvisorConsultationResponseV1={schema:"student-loan-idr-advisor-consultation-v1",schemaVersion:1,synthesisMode:"deterministic_evidence_summary",answer:consultationAnswer(evidence),evidence,proposedActions:action?[{kind:action.kind,label:action.label,href:action.href}]:[],mutationApplied:false}; return json({ok:true,consultation:response}); }
function retrievalMetadata(){ return json({ok:true,schema:"student-loan-idr-retrieval-metadata-v1",schemaVersion:1,policySnapshot:POLICY_SNAPSHOT,dictionaryVersion:FSA_DATA_DICTIONARY_VERSION,dictionary:[...FSA_DATA_DICTIONARY],policyRules:[...POLICY_RULE_REGISTRY],policyEvidence:POLICY_EVIDENCE_CORPUS.map((entry)=>({...entry})) ,privacy:{rawStudentAidEmbedded:false,sharedBorrowerPiiCorpus:false}}); }

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
    ...(typeof facts.estimatedAboveTheLineAdjustments === "number" ? { estimatedAboveTheLineAdjustments: facts.estimatedAboveTheLineAdjustments } : {}),
    ...(typeof facts.adjustedGrossIncomeOverride === "number" ? { adjustedGrossIncomeOverride: facts.adjustedGrossIncomeOverride } : {}),
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
  await recordTimelineEvent(database, a.account.advisor_id, id, { eventKind:"comparison", name:"Shared repayment comparison", summary:repaymentTimelineSummary(client,"comparison"), sourceType:"plan_selection", sourceId:selectionId, basis:snapshotBasis(client), result:comparison, policySnapshot:comparison.policySnapshot, occurredAt:now });
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
  await recordTimelineEvent(database, row.owner_advisor_id, row.client_id, { eventKind:"plan_selected", name:`Borrower selected ${plan}`, summary:`Borrower selected ${plan} for advisor follow-up.`, sourceType:"plan_selection", sourceId:row.selection_id, occurredAt:now });
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
  await recordTimelineEvent(database, row.owner_advisor_id, row.client_id, { eventKind:"plan_confirmed", name:`Borrower confirmed ${row.selected_plan ?? "repayment plan"}`, summary:`Borrower confirmed ${row.selected_plan ?? "the selected repayment plan"}; advisor enrollment follow-up is next.`, sourceType:"plan_selection", sourceId:row.selection_id, occurredAt:now });
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
function timelineSummary(row:TimelineRow){ return { schema:"student-loan-idr-client-timeline-event-v1", schemaVersion:1, eventId:row.event_id, clientId:row.client_id, eventKind:row.event_kind, name:row.name, summary:row.summary, ...(row.source_type?{sourceType:row.source_type}:{}), ...(row.source_id?{sourceId:row.source_id}:{}), ...(row.policy_snapshot?{policySnapshot:row.policy_snapshot}:{}), engineVersion:row.engine_version, starred:row.starred===1, ...(row.annotation?{annotation:row.annotation}:{}), occurredAt:row.occurred_at, updatedAt:row.updated_at }; }
function timelineView(row:TimelineRow){ return { ...timelineSummary(row), ...(row.basis_json?{basis:parseStoredJson<unknown>(row.basis_json,"timeline basis")}:{}) , ...(row.result_json?{result:parseStoredJson<unknown>(row.result_json,"timeline result")}:{}) }; }
function timelineAnnotation(value:unknown):string|null { if(value===undefined||value===null||value==="") return null; if(typeof value!=="string") throw new ApiError(400,"Timeline annotation must be text."); const x=value.trim(); if(x.length>2000) throw new ApiError(400,"Timeline annotation is too long."); return x||null; }
function repaymentTimelineSummary(client:AdvisorClientRecordV1,kind:"calculation"|"comparison"):string { const request=comparisonRequest(client); if(kind==="calculation"&&client.consideredPlans?.length) request.plans=client.consideredPlans; const calculation=calculateRepayment(request); const plans=calculation.planEstimates.map((estimate)=>estimate.plan).join("/"); return `${plans} ${kind} · income $${Math.round(calculation.normalizedAnnualTaxableGrossIncome).toLocaleString("en-US")} · family size ${request.familySize} · policy snapshot ${calculation.policySnapshot}`; }
async function recordTimelineEvent(database:D1DatabaseBinding,advisorId:string,clientId:string,input:{eventKind:TimelineEventKind;name:string;summary:string;sourceType?:string;sourceId?:string;basis?:unknown;result?:unknown;policySnapshot?:string;occurredAt?:string}) { const eventId=`event_${crypto.randomUUID()}`, occurredAt=input.occurredAt??new Date().toISOString(), row:TimelineRow={owner_advisor_id:advisorId,client_id:clientId,event_id:eventId,event_kind:input.eventKind,name:retainedName(input.name,"Timeline event"),summary:input.summary.trim().slice(0,500),source_type:input.sourceType??null,source_id:input.sourceId??null,basis_json:input.basis===undefined?null:JSON.stringify(safeJson(input.basis)),result_json:input.result===undefined?null:JSON.stringify(input.result),policy_snapshot:input.policySnapshot??null,engine_version:ENGINE_VERSION,starred:0,annotation:null,occurred_at:occurredAt,updated_at:occurredAt}; await database.prepare("INSERT INTO advisor_client_timeline_events(owner_advisor_id,client_id,event_id,event_kind,name,summary,source_type,source_id,basis_json,result_json,policy_snapshot,engine_version,starred,annotation,occurred_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,?,?)").bind(advisorId,clientId,eventId,row.event_kind,row.name,row.summary,row.source_type,row.source_id,row.basis_json,row.result_json,row.policy_snapshot,ENGINE_VERSION,occurredAt,occurredAt).run(); return timelineView(row); }
async function timelineRow(database:D1DatabaseBinding,advisorId:string,clientId:string,eventId:string):Promise<TimelineRow>{ await owned(database,advisorId,clientId); const row=await database.prepare("SELECT owner_advisor_id,client_id,event_id,event_kind,name,summary,source_type,source_id,basis_json,result_json,policy_snapshot,engine_version,starred,annotation,occurred_at,updated_at FROM advisor_client_timeline_events WHERE owner_advisor_id=? AND client_id=? AND event_id=?").bind(advisorId,clientId,eventId).first<TimelineRow>(); if(!row) throw new ApiError(404,"Timeline event not found or not accessible."); return row; }
async function listTimeline(database:D1DatabaseBinding,a:Auth,id:string){ await owned(database,a.account.advisor_id,id); const rows=await database.prepare("SELECT owner_advisor_id,client_id,event_id,event_kind,name,summary,source_type,source_id,basis_json,result_json,policy_snapshot,engine_version,starred,annotation,occurred_at,updated_at FROM advisor_client_timeline_events WHERE owner_advisor_id=? AND client_id=? ORDER BY occurred_at DESC,event_id DESC LIMIT 200").bind(a.account.advisor_id,id).all<TimelineRow>(); return json({ok:true,schema:"student-loan-idr-client-timeline-v1",events:rows.results.map(timelineSummary)}); }
async function updateTimelineEvent(request:Request,database:D1DatabaseBinding,a:Auth,id:string,eventId:string){ sameOrigin(request); const row=await timelineRow(database,a.account.advisor_id,id,eventId), b=await body(request), allowed=new Set(["name","starred","annotation"]); for(const k of Object.keys(b)) if(!allowed.has(k)) throw new ApiError(400,`Unexpected timeline field: ${k}.`); const name=b.name===undefined?row.name:retainedName(b.name,"Timeline event"), starred=b.starred===undefined?row.starred:(typeof b.starred==="boolean"?(b.starred?1:0):(()=>{throw new ApiError(400,"Timeline starred must be boolean.");})()), annotation=b.annotation===undefined?row.annotation:timelineAnnotation(b.annotation), updatedAt=new Date().toISOString(); await database.prepare("UPDATE advisor_client_timeline_events SET name=?,starred=?,annotation=?,updated_at=? WHERE owner_advisor_id=? AND client_id=? AND event_id=?").bind(name,starred,annotation,updatedAt,a.account.advisor_id,id,eventId).run(); await audit(database,a.account.advisor_id,"client.timeline.update",id); return json({ok:true,event:timelineView({...row,name,starred,annotation,updated_at:updatedAt})}); }
async function deleteTimelineEvent(request:Request,database:D1DatabaseBinding,a:Auth,id:string,eventId:string){ sameOrigin(request); await timelineRow(database,a.account.advisor_id,id,eventId); const result=await database.prepare("DELETE FROM advisor_client_timeline_events WHERE owner_advisor_id=? AND client_id=? AND event_id=?").bind(a.account.advisor_id,id,eventId).run(); if((result.meta?.changes??0)!==1) throw new ApiError(404,"Timeline event not found or not accessible."); await audit(database,a.account.advisor_id,"client.timeline.delete",id); return json({ok:true,deletedEventId:eventId}); }
async function artifactRow(database:D1DatabaseBinding,advisorId:string,clientId:string,artifactId:string):Promise<ArtifactRow>{ await owned(database,advisorId,clientId); const row=await database.prepare("SELECT owner_advisor_id,client_id,artifact_id,artifact_kind,name,template_request_json,document_text,document_html,engine_version,created_at FROM advisor_client_artifacts WHERE owner_advisor_id=? AND client_id=? AND artifact_id=?").bind(advisorId,clientId,artifactId).first<ArtifactRow>(); if(!row) throw new ApiError(404,"Retained artifact not found or not accessible."); return row; }
async function snapshotRow(database:D1DatabaseBinding,advisorId:string,clientId:string,snapshotId:string):Promise<SnapshotRow>{ await owned(database,advisorId,clientId); const row=await database.prepare("SELECT owner_advisor_id,client_id,snapshot_id,snapshot_kind,name,basis_json,result_json,policy_snapshot,engine_version,created_at FROM advisor_client_calculation_snapshots WHERE owner_advisor_id=? AND client_id=? AND snapshot_id=?").bind(advisorId,clientId,snapshotId).first<SnapshotRow>(); if(!row) throw new ApiError(404,"Retained snapshot not found or not accessible."); return row; }
async function persistSnapshot(database:D1DatabaseBinding,advisorId:string,client:AdvisorClientRecordV1,kind:"calculation"|"comparison",name:string,sourceType="snapshot"){ const basis=snapshotBasis(client),result=runSnapshot(kind,client),policySnapshot=String((result as {policySnapshot?:unknown}).policySnapshot??""); if(!policySnapshot) throw new ApiError(500,"Snapshot result is missing its policy snapshot."); const snapshotId=`snapshot_${crypto.randomUUID()}`,createdAt=new Date().toISOString(); await database.prepare("INSERT INTO advisor_client_calculation_snapshots(owner_advisor_id,client_id,snapshot_id,snapshot_kind,name,basis_json,result_json,policy_snapshot,engine_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(advisorId,client.clientId,snapshotId,kind,name,JSON.stringify(basis),JSON.stringify(result),policySnapshot,ENGINE_VERSION,createdAt).run(); const event=await recordTimelineEvent(database,advisorId,client.clientId,{eventKind:kind,name,summary:repaymentTimelineSummary(client,kind),sourceType,sourceId:snapshotId,basis,result,policySnapshot,occurredAt:createdAt}); return {snapshot:{snapshotId,snapshotKind:kind,name,basis,result,policySnapshot,engineVersion:ENGINE_VERSION,createdAt},event}; }
function requestedPlans(value:unknown):RepaymentPlan[]|undefined { if(value===undefined) return undefined; if(!Array.isArray(value)||value.length<1||value.length>4) throw new ApiError(400,"Plans must contain one to four repayment plans."); const allowed=new Set<RepaymentPlan>(["RAP","IBR","PAYE","ICR"]), out:RepaymentPlan[]=[]; for(const item of value){ const plan=String(item) as RepaymentPlan; if(!allowed.has(plan)) throw new ApiError(400,`Unsupported repayment plan: ${String(item)}.`); if(!out.includes(plan)) out.push(plan); } return out; }
async function runAutomaticCalculation(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ sameOrigin(request); const client=parseClient(await owned(database,a.account.advisor_id,id)),b=await body(request),allowed=new Set(["plans"]); for(const k of Object.keys(b)) if(!allowed.has(k)) throw new ApiError(400,`Unexpected calculation field: ${k}.`); const plans=requestedPlans(b.plans),working=structuredClone(client) as AdvisorClientRecordV1; if(plans) working.consideredPlans=plans; const saved=await persistSnapshot(database,a.account.advisor_id,working,"calculation","Automatic repayment calculation","advisor_calculation"); await audit(database,a.account.advisor_id,"client.calculation.run",id); return json({ok:true,result:saved.snapshot.result,snapshot:saved.snapshot,event:saved.event},201); }
async function runAutomaticComparison(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ sameOrigin(request); const client=parseClient(await owned(database,a.account.advisor_id,id)),b=await body(request); if(Object.keys(b).length) throw new ApiError(400,"Automatic comparison does not accept override fields; save client facts first."); const saved=await persistSnapshot(database,a.account.advisor_id,client,"comparison","Automatic repayment / forgiveness comparison","advisor_comparison"); await audit(database,a.account.advisor_id,"client.comparison.run",id); return json({ok:true,comparison:saved.snapshot.result,snapshot:saved.snapshot,event:saved.event},201); }
async function generateCaseDocument(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ sameOrigin(request); await owned(database,a.account.advisor_id,id); const b=await body(request),allowed=new Set(["templateRequest"]); for(const k of Object.keys(b)) if(!allowed.has(k)) throw new ApiError(400,`Unexpected document-generation field: ${k}.`); const template=retainedTemplateRequest(b.templateRequest); let documentText:string,documentHtml:string; try{documentText=getDocumentationTemplate({...template,outputFormat:"text"});documentHtml=getDocumentationTemplate({...template,outputFormat:"html"});}catch(e){throw new ApiError(400,e instanceof Error?e.message:"Document generation failed.");} const generatedAt=new Date().toISOString(); const event=await recordTimelineEvent(database,a.account.advisor_id,id,{eventKind:"document_generated",name:"Supporting document generated",summary:`Supporting document generated · ${String(template.templateType).replace(/_/g," ")}.`,sourceType:"workflow",basis:template,occurredAt:generatedAt}); await audit(database,a.account.advisor_id,"client.document.generate",id); return json({ok:true,document:{templateRequest:template,documentText,documentHtml,engineVersion:ENGINE_VERSION,generatedAt},event}); }
async function listArtifacts(database:D1DatabaseBinding,a:Auth,id:string){ await owned(database,a.account.advisor_id,id); const rows=await database.prepare("SELECT owner_advisor_id,client_id,artifact_id,artifact_kind,name,template_request_json,document_text,document_html,engine_version,created_at FROM advisor_client_artifacts WHERE owner_advisor_id=? AND client_id=? ORDER BY created_at DESC LIMIT 200").bind(a.account.advisor_id,id).all<ArtifactRow>(); return json({ok:true,artifacts:rows.results.map(artifactSummary)}); }
async function retainArtifact(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ sameOrigin(request); await owned(database,a.account.advisor_id,id); const b=await body(request), allowed=new Set(["name","templateRequest"]); for(const k of Object.keys(b)) if(!allowed.has(k)) throw new ApiError(400,`Unexpected retained artifact field: ${k}.`); const name=retainedName(b.name,"Artifact"), template=retainedTemplateRequest(b.templateRequest), createdAt=new Date().toISOString(), artifactId=`artifact_${crypto.randomUUID()}`; let documentText:string, documentHtml:string; try { documentText=getDocumentationTemplate({...template,outputFormat:"text"}); documentHtml=getDocumentationTemplate({...template,outputFormat:"html"}); } catch(e){ throw new ApiError(400,e instanceof Error?e.message:"Document generation failed."); } await database.prepare("INSERT INTO advisor_client_artifacts(owner_advisor_id,client_id,artifact_id,artifact_kind,name,template_request_json,document_text,document_html,engine_version,created_at) VALUES(?,?,?,'document_draft',?,?,?,?,?,?)").bind(a.account.advisor_id,id,artifactId,name,JSON.stringify(template),documentText,documentHtml,ENGINE_VERSION,createdAt).run(); const event=await recordTimelineEvent(database,a.account.advisor_id,id,{eventKind:"document_retained",name,summary:`Document retained · ${String(template.templateType).replace(/_/g," ")}.`,sourceType:"artifact",sourceId:artifactId,basis:template,occurredAt:createdAt}); await audit(database,a.account.advisor_id,"client.artifact.retain",id); return json({ok:true,artifact:{artifactId,artifactKind:"document_draft",name,templateRequest:template,documentText,documentHtml,engineVersion:ENGINE_VERSION,createdAt},event},201); }
async function regenerateArtifact(request:Request,database:D1DatabaseBinding,a:Auth,id:string,artifactId:string){ sameOrigin(request); const row=await artifactRow(database,a.account.advisor_id,id,artifactId), template=parseStoredJson<TemplateRequest>(row.template_request_json,"artifact template request"); let documentText:string, documentHtml:string; try { documentText=getDocumentationTemplate({...template,outputFormat:"text"}); documentHtml=getDocumentationTemplate({...template,outputFormat:"html"}); } catch(e){ throw new ApiError(400,e instanceof Error?e.message:"Document regeneration failed."); } const generatedAt=new Date().toISOString(); const event=await recordTimelineEvent(database,a.account.advisor_id,id,{eventKind:"document_regenerated",name:`${row.name} regenerated`,summary:`Document regenerated from retained normalized template facts · ${String(template.templateType).replace(/_/g," ")}.`,sourceType:"artifact",sourceId:artifactId,basis:template,occurredAt:generatedAt}); await audit(database,a.account.advisor_id,"client.artifact.regenerate",id); return json({ok:true,regenerated:{artifactId,name:row.name,templateRequest:template,documentText,documentHtml,engineVersion:ENGINE_VERSION,generatedAt},event}); }
async function deleteArtifact(request:Request,database:D1DatabaseBinding,a:Auth,id:string,artifactId:string){ sameOrigin(request); await artifactRow(database,a.account.advisor_id,id,artifactId); const result=await database.prepare("DELETE FROM advisor_client_artifacts WHERE owner_advisor_id=? AND client_id=? AND artifact_id=?").bind(a.account.advisor_id,id,artifactId).run(); if((result.meta?.changes??0)!==1) throw new ApiError(404,"Retained artifact not found or not accessible."); await audit(database,a.account.advisor_id,"client.artifact.delete",id); return json({ok:true,deletedArtifactId:artifactId}); }
async function listSnapshots(database:D1DatabaseBinding,a:Auth,id:string){ await owned(database,a.account.advisor_id,id); const rows=await database.prepare("SELECT owner_advisor_id,client_id,snapshot_id,snapshot_kind,name,basis_json,result_json,policy_snapshot,engine_version,created_at FROM advisor_client_calculation_snapshots WHERE owner_advisor_id=? AND client_id=? ORDER BY created_at DESC LIMIT 200").bind(a.account.advisor_id,id).all<SnapshotRow>(); return json({ok:true,snapshots:rows.results.map(snapshotSummary)}); }
async function retainSnapshot(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ sameOrigin(request); const client=parseClient(await owned(database,a.account.advisor_id,id)), b=await body(request), allowed=new Set(["name","snapshotKind"]); for(const k of Object.keys(b)) if(!allowed.has(k)) throw new ApiError(400,`Unexpected retained snapshot field: ${k}.`); const name=retainedName(b.name,"Snapshot"), kind=String(b.snapshotKind); if(kind!=="calculation"&&kind!=="comparison") throw new ApiError(400,"Snapshot kind must be calculation or comparison."); const saved=await persistSnapshot(database,a.account.advisor_id,client,kind as "calculation"|"comparison",name); await audit(database,a.account.advisor_id,"client.snapshot.retain",id); return json({ok:true,...saved},201); }
async function rerunSnapshot(request:Request,database:D1DatabaseBinding,a:Auth,id:string,snapshotId:string){ sameOrigin(request); const row=await snapshotRow(database,a.account.advisor_id,id,snapshotId),basis=parseStoredJson<JsonObject>(row.basis_json,"snapshot basis"),client=clientFromSnapshotBasis(row,basis),result=runSnapshot(row.snapshot_kind,client),policySnapshot=String((result as {policySnapshot?:unknown}).policySnapshot??row.policy_snapshot),newSnapshotId=`snapshot_${crypto.randomUUID()}`,createdAt=new Date().toISOString(),name=`${row.name} · rerun`.slice(0,120); await database.prepare("INSERT INTO advisor_client_calculation_snapshots(owner_advisor_id,client_id,snapshot_id,snapshot_kind,name,basis_json,result_json,policy_snapshot,engine_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(a.account.advisor_id,id,newSnapshotId,row.snapshot_kind,name,row.basis_json,JSON.stringify(result),policySnapshot,ENGINE_VERSION,createdAt).run(); const event=await recordTimelineEvent(database,a.account.advisor_id,id,{eventKind:row.snapshot_kind,name,summary:repaymentTimelineSummary(client,row.snapshot_kind),sourceType:"snapshot_rerun",sourceId:newSnapshotId,basis,result,policySnapshot,occurredAt:createdAt}); await audit(database,a.account.advisor_id,"client.snapshot.rerun",id); return json({ok:true,rerun:{snapshotId:newSnapshotId,sourceSnapshotId:snapshotId,name,snapshotKind:row.snapshot_kind,basis:"retained_snapshot_basis",result,policySnapshot,engineVersion:ENGINE_VERSION,generatedAt:createdAt},snapshot:{snapshotId:newSnapshotId,snapshotKind:row.snapshot_kind,name,basis,result,policySnapshot,engineVersion:ENGINE_VERSION,createdAt},event},201); }
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

function actionHref(clientId:string,hash:string):string { return `/?advisorClient=${encodeURIComponent(clientId)}${hash}`; }
function actionSignal(clientId:string,state:AdvisorActionState,label:string,reason:string,priority:number,attention:boolean,kind:AdvisorClientActionSignalV1["action"]["kind"],actionLabel:string,hash:string,dueDate?:string):AdvisorClientActionSignalV1 {
  return { state,label,reason,priority,attention,...(dueDate?{dueDate}:{}),action:{kind,label:actionLabel,href:actionHref(clientId,hash)} };
}
function futureDateWithin(values:string[],nowMs:number,days:number):string|undefined {
  const candidates=values.flatMap((value)=>{const parsed=fsaDateMs(value);return parsed!==undefined&&parsed>=nowMs&&parsed-nowMs<=days*DAY_MS?[{value,parsed}]:[];}).sort((a,b)=>a.parsed-b.parsed);
  return candidates[0]?.value;
}
function deriveActionSummary(client:AdvisorClientRecordV1,plan:ActionPlanSelectionRow|undefined,timeline:ActionTimelineRow[],nowMs:number):AdvisorClientActionSummaryV1 {
  const context=deriveAdvisorClientCaseContext(client), signals:AdvisorClientActionSignalV1[]=[];
  const add=(signal:AdvisorClientActionSignalV1)=>{if(!signals.some((existing)=>existing.state===signal.state))signals.push(signal);};
  if(client.lifecycleState==="archived") add(actionSignal(client.clientId,"archived","Archived","This client case is archived.",1000,false,"open_case","Open archived case","#advisor-case-workspace"));
  else if(client.lifecycleState==="completed") add(actionSignal(client.clientId,"completed","Completed","This client case is marked complete.",1000,false,"open_case","Open completed case","#advisor-case-workspace"));
  else {
    if(context.professionalSummary.currentDelinquencyLoanCount>0) add(actionSignal(client.clientId,"delinquency_attention","Delinquency attention","Saved StudentAid status shows a current delinquency that needs advisor review.",120,true,"review_delinquency","Review delinquency","#advisor-intelligence-workspace"));
    if(context.professionalSummary.currentForbearanceLoanCount>0) add(actionSignal(client.clientId,"in_forbearance","In forbearance","Saved StudentAid status shows one or more active loans currently in forbearance.",110,true,"review_forbearance","Review forbearance","#advisor-intelligence-workspace"));
    const anniversary=futureDateWithin(context.professionalSummary.idrAnniversaryDates,nowMs,60);
    if(anniversary) add(actionSignal(client.clientId,"idr_anniversary_approaching","IDR anniversary approaching","A saved IDR anniversary is within the next 60 days.",105,true,"review_recertification","Review recertification","#advisor-case-workspace",anniversary));
    if(plan?.status==="signed") add(actionSignal(client.clientId,"booking_pending","Booking pending","The borrower confirmed a repayment plan and enrollment follow-up has not been marked booked.",100,true,"book_enrollment","Book enrollment","#advisor-history-workspace",plan.booking_deadline_at??undefined));
    else if(plan?.status==="selected") add(actionSignal(client.clientId,"plan_selected","Plan selected","The borrower selected a repayment plan and still needs to confirm it.",95,true,"review_plan_selection","Review selected plan","#advisor-history-workspace",plan.select_sign_deadline_at??undefined));
    else if(plan?.status==="issued"||plan?.status==="opened"||client.lifecycleState==="awaiting_borrower_review") add(actionSignal(client.clientId,"borrower_review_pending","Borrower review pending",plan?.status==="opened"?"The borrower opened a repayment comparison and the review window is active.":plan?.status==="issued"?"A repayment comparison was issued and is awaiting borrower review.":"The client lifecycle is waiting on borrower review.",90,true,"share_borrower_review","Open borrower review","#advisor-comparison-workspace",plan?.select_sign_deadline_at??undefined));
    if(context.coverage.currentIncome==="none") add(actionSignal(client.clientId,"needs_income","Needs income","Current normalized income facts are still missing.",80,true,"collect_income","Collect income","#guided-assistant"));
    else if(context.coverage.familySize==="none") add(actionSignal(client.clientId,"needs_family_size","Needs family size","Legacy IDR family size is still missing.",78,true,"collect_family_size","Collect family size","#guided-assistant"));
    const evidenceNeedsReview=client.confirmedFacts?.incomeSources?.some((source)=>source.evidenceState==="needs_evidence_review")===true;
    if(client.readinessState==="needs_evidence"||evidenceNeedsReview) add(actionSignal(client.clientId,"needs_evidence","Needs evidence","The saved case is not yet evidence-ready for application work.",70,true,"review_evidence","Review evidence","#document-workspace"));
    const hasDocumentHistory=timeline.some((event)=>event.event_kind==="document_generated"||event.event_kind==="document_retained"||event.event_kind==="document_regenerated");
    if(client.readinessState==="document_ready") add(actionSignal(client.clientId,"document_ready","Document ready",hasDocumentHistory?"Saved document history and readiness state indicate the case is ready for document review.":"The saved readiness state indicates supporting-document review is ready.",55,false,"prepare_document","Review document","#document-workspace"));
    if(client.readinessState==="application_ready") add(actionSignal(client.clientId,"application_ready","Application ready","The saved readiness state indicates the case is ready for application review.",50,false,"review_application","Review application","#advisor-case-workspace"));
  }
  signals.sort((x,y)=>y.priority-x.priority||(x.dueDate&&y.dueDate?Date.parse(x.dueDate)-Date.parse(y.dueDate):0));
  const primary=signals[0]??actionSignal(client.clientId,"application_ready","Application ready","Open the saved case to review the next step.",1,false,"open_case","Open case","#advisor-case-workspace");
  return {clientId:client.clientId,displayName:client.contact.displayName,lifecycleState:client.lifecycleState,readinessState:client.readinessState,updatedAt:client.updatedAt,primaryState:primary.state,nextBestAction:primary.action,signals};
}
async function actionDashboard(request:Request,database:D1DatabaseBinding,a:Auth){
  const u=new URL(request.url), q=(u.searchParams.get("search")??"").trim().toLowerCase().replace(/[%_]/g,"").slice(0,120), lim=Math.min(Math.max(Number(u.searchParams.get("limit")??100)||100,1),100), now=Date.now();
  const clients=await database.prepare("SELECT owner_advisor_id,client_id,display_name,lifecycle_state,readiness_state,record_json,created_at,updated_at FROM advisor_clients WHERE owner_advisor_id=? AND (?='' OR lower(display_name) LIKE ?) ORDER BY updated_at DESC LIMIT ?").bind(a.account.advisor_id,q,`%${q}%`,lim).all<ClientRow>();
  const plans=await database.prepare("SELECT selection_id,client_id,status,selected_at,signed_at,booked_at,link_opened_at,select_sign_deadline_at,booking_deadline_at,created_at,updated_at FROM advisor_client_plan_selections WHERE owner_advisor_id=? ORDER BY updated_at DESC LIMIT 1000").bind(a.account.advisor_id).all<ActionPlanSelectionRow>();
  const events=await database.prepare("SELECT client_id,event_kind,occurred_at FROM advisor_client_timeline_events WHERE owner_advisor_id=? ORDER BY occurred_at DESC LIMIT 2000").bind(a.account.advisor_id).all<ActionTimelineRow>();
  const latestPlan=new Map<string,ActionPlanSelectionRow>(); for(const row of plans.results) if(!latestPlan.has(row.client_id)&&!["expired","revoked","booked"].includes(row.status)) latestPlan.set(row.client_id,row);
  const eventsByClient=new Map<string,ActionTimelineRow[]>(); for(const event of events.results){const list=eventsByClient.get(event.client_id)??[];list.push(event);eventsByClient.set(event.client_id,list);}
  const summaries=clients.results.map((row)=>deriveActionSummary(parseClient(row),latestPlan.get(row.client_id),eventsByClient.get(row.client_id)??[],now));
  summaries.sort((x,y)=>Number(y.signals.some((s)=>s.attention))-Number(x.signals.some((s)=>s.attention))||(y.signals[0]?.priority??0)-(x.signals[0]?.priority??0)||Date.parse(y.updatedAt)-Date.parse(x.updatedAt));
  const byState:Partial<Record<AdvisorActionState,number>>={}; for(const client of summaries) byState[client.primaryState]=(byState[client.primaryState]??0)+1;
  const dashboard:AdvisorActionDashboardV1={schema:"student-loan-idr-advisor-action-dashboard-v1",schemaVersion:1,generatedAt:new Date(now).toISOString(),clients:summaries,counts:{total:summaries.length,attention:summaries.filter((client)=>client.signals.some((s)=>s.attention)).length,byState}};
  return json({ok:true,dashboard});
}
function normalizeMatchText(value: string | undefined): string | undefined { const t = (value ?? "").trim().toLowerCase(); return t || undefined; }
function normalizeMatchPhone(value: string | undefined): string | undefined { const t = (value ?? "").replace(/[^0-9]/g, ""); return t.length >= 7 ? t : undefined; }
async function matchClients(request:Request,database:D1DatabaseBinding,a:Auth){ sameOrigin(request); const b=await body(request), allowed=new Set(["displayName","email","phone"]); for(const k of Object.keys(b)) if(!allowed.has(k)) throw new ApiError(400,`Unexpected match field: ${k}.`); const name=optionalText(b.displayName,"Client name",120), em=optionalText(b.email,"Client email",254), ph=optionalText(b.phone,"Client phone",80); if(!name&&!em&&!ph) throw new ApiError(400,"At least one of displayName, email, or phone is required to check for matches."); const normName=normalizeMatchText(name), normEmail=normalizeMatchText(em), normPhone=normalizeMatchPhone(ph); const rows=await database.prepare("SELECT client_id,display_name,lifecycle_state,readiness_state,record_json,updated_at FROM advisor_clients WHERE owner_advisor_id=? ORDER BY updated_at DESC LIMIT 500").bind(a.account.advisor_id).all<ClientRow>(); const matches:Array<{clientId:string;displayName:string;lifecycleState:AdvisorClientLifecycleState;readinessState:AdvisorClientReadinessState;matchStrength:"strong"|"name_only";matchedOn:string[]}>=[]; for (const row of rows.results) { const client=parseClient(row); const matchedOn:string[]=[]; let strong=false; const rowEmail=normalizeMatchText(client.contact.email), rowPhone=normalizeMatchPhone(client.contact.phone), rowName=normalizeMatchText(client.contact.displayName); if(normEmail&&rowEmail&&normEmail===rowEmail){strong=true;matchedOn.push("email");} if(normPhone&&rowPhone&&normPhone===rowPhone){strong=true;matchedOn.push("phone");} if(normName&&rowName&&normName===rowName)matchedOn.push("displayName"); if(matchedOn.length===0)continue; matches.push({clientId:row.client_id,displayName:row.display_name,lifecycleState:row.lifecycle_state,readinessState:row.readiness_state,matchStrength:strong?"strong":"name_only",matchedOn}); } matches.sort((x,y)=>x.matchStrength===y.matchStrength?0:x.matchStrength==="strong"?-1:1); return json({ok:true,matches:matches.slice(0,10)}); }
async function createClient(request:Request,database:D1DatabaseBinding,a:Auth){ sameOrigin(request); const b=await body(request,MAX_CLIENT_BODY_BYTES), allowed=new Set(["displayName","email","phone","contact","servicerName","normalizedLoanPortfolio","studentAidImport","fieldProvenance","confirmedFacts","consideredPlans"]); for(const k of Object.keys(b)) if(!allowed.has(k)) throw new ApiError(400,`Unexpected client field: ${k}.`); if(b.contact!==undefined&&(b.displayName!==undefined||b.email!==undefined||b.phone!==undefined)) throw new ApiError(400,"Use either contact or displayName/email/phone, not both."); let contact:AdvisorClientRecordV1["contact"]; if(b.contact!==undefined){ const c=bodyObject(b.contact), allowedContact=new Set(["displayName","email","phone","streetAddress1","streetAddress2","city","stateCode","countryCode","zipCode"]); for(const k of Object.keys(c)) if(!allowedContact.has(k)) throw new ApiError(400,`Unexpected contact field: ${k}.`); const em=optionalText(c.email,"Client email",254), ph=optionalText(c.phone,"Client phone",80), streetAddress1=optionalText(c.streetAddress1,"Client street address",200), streetAddress2=optionalText(c.streetAddress2,"Client street address 2",200), city=optionalText(c.city,"Client city",120), stateCode=optionalText(c.stateCode,"Client state code",40), countryCode=optionalText(c.countryCode,"Client country code",40), zipCode=optionalText(c.zipCode,"Client ZIP code",40); contact={displayName:displayName(c.displayName),...(em?{email:em}:{}),...(ph?{phone:ph}:{}),...(streetAddress1?{streetAddress1}:{}),...(streetAddress2?{streetAddress2}:{}),...(city?{city}:{}),...(stateCode?{stateCode}:{}),...(countryCode?{countryCode}:{}),...(zipCode?{zipCode}:{})}; } else { const em=optionalText(b.email,"Client email",254), ph=optionalText(b.phone,"Client phone",80); contact={displayName:displayName(b.displayName),...(em?{email:em}:{}),...(ph?{phone:ph}:{})}; } const now=new Date().toISOString(), id=`client_${crypto.randomUUID()}`; const record:AdvisorClientRecordV1={schemaVersion:1,clientId:id,ownerAdvisorId:a.account.advisor_id,createdAt:now,updatedAt:now,lifecycleState:"active",readinessState:"needs_evidence",contact}; if(b.fieldProvenance!==undefined) record.fieldProvenance=safeJson(b.fieldProvenance) as NonNullable<AdvisorClientRecordV1["fieldProvenance"]>; if(b.servicerName!==undefined){ const value=optionalText(b.servicerName,"Servicer name",200); if(value!==undefined) record.servicerName=value; } if(b.normalizedLoanPortfolio!==undefined) record.normalizedLoanPortfolio=safeJson(b.normalizedLoanPortfolio) as NonNullable<AdvisorClientRecordV1["normalizedLoanPortfolio"]>; if(b.confirmedFacts!==undefined) record.confirmedFacts=safeJson(b.confirmedFacts) as NonNullable<AdvisorClientRecordV1["confirmedFacts"]>; if(b.consideredPlans!==undefined) record.consideredPlans=safeJson(b.consideredPlans) as RepaymentPlan[]; if(b.studentAidImport!==undefined){ const s=bodyObject(b.studentAidImport), allowedStudentAid=new Set(["source","importedAt","fileRequestDate","mappingVersion","rawFileRetained"]); for(const k of Object.keys(s)) if(!allowedStudentAid.has(k)) throw new ApiError(400,`Unexpected StudentAid import field: ${k}.`); if(s.source!=="studentaid_download"||s.rawFileRetained!==false) throw new ApiError(400,"Raw StudentAid files cannot be retained."); const importedAt=optionalText(s.importedAt,"StudentAid import date",80), fileRequestDate=optionalText(s.fileRequestDate,"StudentAid file request date",80), mappingVersion=optionalText(s.mappingVersion,"StudentAid mapping version",80); record.studentAidImport={source:"studentaid_download",...(importedAt?{importedAt}:{}),...(fileRequestDate?{fileRequestDate}:{}),...(mappingVersion?{mappingVersion}:{}),rawFileRetained:false}; } await database.prepare("INSERT INTO advisor_clients(owner_advisor_id,client_id,display_name,lifecycle_state,readiness_state,record_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(a.account.advisor_id,id,contact.displayName,record.lifecycleState,record.readinessState,JSON.stringify(record),now,now).run(); await audit(database,a.account.advisor_id,"client.create",id); return json({ok:true,client:record},201); }
async function updateClient(request:Request,database:D1DatabaseBinding,a:Auth,id:string){ sameOrigin(request); const b=await body(request,MAX_CLIENT_BODY_BYTES), row=await owned(database,a.account.advisor_id,id), current=parseClient(row), next=updateRecord(current,b); const r=await database.prepare("UPDATE advisor_clients SET display_name=?,lifecycle_state=?,readiness_state=?,record_json=?,updated_at=? WHERE owner_advisor_id=? AND client_id=? AND updated_at=?").bind(next.contact.displayName,next.lifecycleState,next.readinessState,JSON.stringify(next),next.updatedAt,a.account.advisor_id,id,current.updatedAt).run(); if((r.meta?.changes??0)!==1) throw new ApiError(409,"Client record has changed; reload before saving."); await audit(database,a.account.advisor_id,"client.update",id); return json({ok:true,client:next}); }
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
    if(request.method==="GET"&&u.pathname==="/api/advisor/action-dashboard") return await actionDashboard(request,database,a);
    if(request.method==="GET"&&u.pathname==="/api/advisor/retrieval-metadata") return retrievalMetadata();
    if(request.method==="GET"&&u.pathname==="/api/advisor/clients") return await listClients(request,database,a);
    if(request.method==="POST"&&u.pathname==="/api/advisor/clients") return await createClient(request,database,a);
    if(request.method==="POST"&&u.pathname==="/api/advisor/clients/match") return await matchClients(request,database,a);
    const r=clientRoute(u.pathname); if(r){
      if(request.method==="GET"&&r.suffix===""){const row=await owned(database,a.account.advisor_id,r.id);return json({ok:true,client:parseClient(row)});}
      if(request.method==="PUT"&&r.suffix==="") return await updateClient(request,database,a,r.id);
      if(request.method==="POST"&&r.suffix==="/archive") return await archiveClient(request,database,a,r.id);
      if(request.method==="GET"&&r.suffix==="/comparison"){const row=await owned(database,a.account.advisor_id,r.id),client=parseClient(row),comparison=compareClientPrograms(client);await audit(database,a.account.advisor_id,"client.compare",r.id);return json({ok:true,comparison});}
      if(request.method==="GET"&&r.suffix==="/intelligence"){const row=await owned(database,a.account.advisor_id,r.id),client=parseClient(row);if(!client.normalizedLoanPortfolio?.loans?.length) throw new ApiError(422,"Save normalized per-loan StudentAid facts before generating portfolio intelligence.");return json({ok:true,intelligence:deriveStudentAidPortfolioIntelligence(client)});}
      if(request.method==="GET"&&r.suffix==="/case-context"){const row=await owned(database,a.account.advisor_id,r.id),client=parseClient(row);return json({ok:true,caseContext:deriveAdvisorClientCaseContext(client)});}
      if(request.method==="POST"&&r.suffix==="/retrieval") return await retrieveClientEvidence(request,database,a,r.id);
      if(request.method==="POST"&&r.suffix==="/consultation") return await consultClient(request,database,a,r.id);
      if(request.method==="POST"&&r.suffix==="/calculations") return await runAutomaticCalculation(request,database,a,r.id);
      if(request.method==="POST"&&r.suffix==="/comparisons") return await runAutomaticComparison(request,database,a,r.id);
      if(request.method==="POST"&&r.suffix==="/documents/generate") return await generateCaseDocument(request,database,a,r.id);
      if(request.method==="GET"&&r.suffix==="/timeline") return await listTimeline(database,a,r.id);
      const timelineMatch=r.suffix.match(/^\/timeline\/(event_[0-9a-f-]{36})$/i);
      if(timelineMatch){ if(request.method==="GET") return json({ok:true,event:timelineView(await timelineRow(database,a.account.advisor_id,r.id,timelineMatch[1]!))}); if(request.method==="PATCH") return await updateTimelineEvent(request,database,a,r.id,timelineMatch[1]!); if(request.method==="DELETE") return await deleteTimelineEvent(request,database,a,r.id,timelineMatch[1]!); }
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
      if(request.method==="GET"&&r.suffix==="/export"){const row=await owned(database,a.account.advisor_id,r.id), artifacts=await database.prepare("SELECT owner_advisor_id,client_id,artifact_id,artifact_kind,name,template_request_json,document_text,document_html,engine_version,created_at FROM advisor_client_artifacts WHERE owner_advisor_id=? AND client_id=? ORDER BY created_at DESC").bind(a.account.advisor_id,r.id).all<ArtifactRow>(), snapshots=await database.prepare("SELECT owner_advisor_id,client_id,snapshot_id,snapshot_kind,name,basis_json,result_json,policy_snapshot,engine_version,created_at FROM advisor_client_calculation_snapshots WHERE owner_advisor_id=? AND client_id=? ORDER BY created_at DESC").bind(a.account.advisor_id,r.id).all<SnapshotRow>(), timeline=await database.prepare("SELECT owner_advisor_id,client_id,event_id,event_kind,name,summary,source_type,source_id,basis_json,result_json,policy_snapshot,engine_version,starred,annotation,occurred_at,updated_at FROM advisor_client_timeline_events WHERE owner_advisor_id=? AND client_id=? ORDER BY occurred_at DESC,event_id DESC").bind(a.account.advisor_id,r.id).all<TimelineRow>();await audit(database,a.account.advisor_id,"client.export",r.id);const client=parseClient(row);return json({ok:true,schema:"student-loan-idr-advisor-client-export-v3",exportedAt:new Date().toISOString(),client,caseContext:deriveAdvisorClientCaseContext(client),timelineEvents:timeline.results.map(timelineView),retainedArtifacts:artifacts.results.map(artifactView),calculationSnapshots:snapshots.results.map(snapshotView)});}
    }
    return json({ok:false,error:"Advisor endpoint not found."},404);
  } catch(error){ if(error instanceof ApiError) return json({ok:false,error:error.message},error.status,error.status===401?{"set-cookie":clearCookie()}:{}); return json({ok:false,error:"Advisor workspace request failed."},500); }
}
