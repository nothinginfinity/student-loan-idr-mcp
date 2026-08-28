# V0.8 Advisor/Client Authority and Persistence Contract

Status: V0.8.1 foundation. This freezes the first advisor-workspace authority/data boundary. It does not claim authentication, D1 persistence, account recovery, or production client storage is enabled.

## Authority invariants

- The authenticated advisor account is the authority root. A borrower client record is not an authentication principal.
- The first V0.8 model is single-advisor ownership: `client.ownerAdvisorId === principal.advisorId`.
- Every client read/write/archive/delete/export/draft/calculation/audit operation must be scoped by authenticated advisor ID plus client ID.
- Only an `active` advisor may access an owned client. Suspended or closed accounts fail closed.
- Ownership denial must use a generic not-found/not-accessible result so another advisor's client is not enumerated.
- Future team/organization roles require an explicit accepted assignment/role model; they must not weaken single-advisor isolation.

## Normalized client record

`AdvisorClientRecordV1` may hold only workflow-needed normalized data: client/owner IDs and timestamps; display/contact information; lifecycle/readiness state; normalized loan balance/rate/type/date facts; confirmed application and income-source facts with evidence readiness; family-size/tax facts when supplied; servicer; plans considered; explicitly retained draft IDs; advisor notes; and later separately accepted calculation/comparison snapshots.

Dashboard/list projections are intentionally smaller: `clientId`, `displayName`, `lifecycleState`, `readinessState`, and `updatedAt`. Email, phone, loan/income details, notes, evidence detail, and draft IDs stay inside the authorized client workspace.

## StudentAid boundary

- The raw StudentAid.gov **Download My Aid Data** file remains browser-local by default.
- The browser may parse it and persist only normalized loan facts the advisor explicitly retains.
- V0.8.1 fixes `studentAidImport.rawFileRetained` to literal `false`.
- Raw-file retention would require a later accepted design for consent, encryption, retention, deletion/export, and access logging.

## Not persisted by default

Do not persist SSNs; FSA IDs/passwords/recovery codes; unnecessary loan account numbers; raw StudentAid contents; unreviewed raw evidence files; session/authentication secrets; plaintext recovery tokens; fabricated employer/signature/pay-stub/tax evidence; or hidden model memory containing borrower facts outside the accepted client record.

## Consent, provenance, and estimates

Creating/importing a client does not itself prove borrower consent or advisor legal authority. Production persistence must make the applicable authorization/consent boundary explicit. Saved facts should retain provenance where the workflow distinguishes stated, imported, documented/identified, derived, and needs-review facts. Repayment or forgiveness projections are modeled estimates, never guarantees.

## Requirements before server persistence

Before V0.8 becomes a system of record, implementation must provide:

1. authentication resolving each request to one advisor principal;
2. secure session expiry/rotation/logout/recovery boundaries;
3. server-side ownership checks on every client operation, never trusting a browser-supplied advisor ID;
4. owner-keyed/indexed parameterized persistence so cross-advisor reads fail closed;
5. client/advisor-scoped retained artifacts and calculation snapshots;
6. scoped deletion/export and explicit archive-vs-delete semantics;
7. logs that exclude borrower payloads and secrets;
8. a minimal audit trail that records operational metadata without copying sensitive contents;
9. an accepted retention policy;
10. production migration and recovery/rollback behavior.

A later D1 slice may use advisor-account, session, client, income-source, normalized-loan, retained-draft, calculation-snapshot, and audit-event tables. V0.8.1 creates none of them.

## V0.8.1 executable acceptance

The foundation regression must prove: active owner access succeeds; another advisor fails; a suspended owner fails; denial is generic; dashboard projection excludes private details; and StudentAid metadata cannot claim raw-file retention.

These are authority-contract tests, not a substitute for database-isolation tests once persistence exists.

## V0.8.1 non-goals

No D1 client database, login/session endpoint, recovery flow, team delegation, raw StudentAid/evidence-file storage, public advisor CRUD API, comparison charts, or x402 integration is introduced by this slice.

The next safe slice is authenticated advisor identity/session plus an owner-keyed D1 client store and scoped client CRUD under this contract.
