# V0.8.2 Advisor Workspace Security and Retention Boundary

V0.8.2 introduces the first authenticated, server-persistent advisor workspace. It is a bounded backend foundation under the accepted `docs/V0_8_ADVISOR_CLIENT_CONTRACT.md`; it is not permission to retain arbitrary borrower documents or to treat the service as a finished production system of record.

## Authority model

- The authenticated advisor is the authority root. A client/borrower record is not an authentication principal.
- The initial model is single-advisor ownership. A client row is keyed by `(owner_advisor_id, client_id)` and every client read, update, archive, export, or delete operation requires that exact owning advisor.
- Cross-advisor access returns the same generic `Client not found or not accessible.` response used for a missing client so the API does not become a client-enumeration oracle.
- Only active advisor accounts can use a live session. Suspended or closed accounts fail authentication.
- Team roles, delegation, client sharing, and organization-wide access are not part of V0.8.2.

## Advisor authentication and sessions

V0.8.2 supports advisor registration and password login only.

- Passwords must be 12–200 characters.
- Password verifier data is stored as a random salt plus a Workers-native Node `crypto.scrypt` output. V0.8.2 uses `N=16384`, `r=8`, `p=1`, with a 32 MiB `maxmem` bound; the existing `password_iterations` persistence column records the scrypt `N` work factor for this bounded schema. Plaintext passwords are never stored. This remains an authentication foundation rather than the final production identity boundary; a later accepted production-auth slice should version the verifier schema and/or move to a reviewed external identity provider with recovery and MFA.
- Successful authentication creates a cryptographically random server session token. Only the SHA-256 hash of that token is stored in D1.
- The browser receives the session only as `sl_advisor_session` with `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, and a 12-hour maximum age.
- State-changing advisor requests require a separate random CSRF token. Only its SHA-256 hash is persisted. `GET /api/advisor/session` rotates and reissues the CSRF token for a valid resumed session.
- Mutations reject a mismatched browser `Origin` when one is supplied.
- Successful login revokes older non-revoked sessions for that advisor.
- Logout explicitly revokes the current session.
- Failed-login tracking is keyed by a SHA-256 digest of the normalized email, not a plaintext identifier, with an eight-failure limit inside a 15-minute window.
- Advisor request bodies retain the service-wide 64 KiB ceiling.

### Recovery boundary

Password reset/recovery is **not implemented in V0.8.2**. No plaintext recovery token or security answer is stored. Until a reviewed recovery flow and borrower/advisor consent UX are accepted, this advisor backend must be treated as an authenticated technical foundation rather than a final production system of record.

## Persisted advisor/client data

The D1 database stores only data needed for the accepted advisor workflow:

- advisor account identity and password verifier material;
- hashed session/CSRF state and session lifecycle timestamps;
- normalized client record JSON plus owner, client ID, display name, workflow/readiness state, and timestamps;
- hashed login-failure counters;
- minimized audit events containing only event ID, advisor ID, optional client ID, action name, timestamp, and an empty metadata object in V0.8.2.

A client update uses the previously observed `updatedAt` value as an optimistic-concurrency guard. A stale save/archive/delete fails instead of silently overwriting newer client state.

The advisor dashboard/list projection is deliberately smaller than the client record. It returns only client ID, display name, lifecycle state, readiness state, and update time; contact details, income, loan facts, notes, draft IDs, and evidence facts are not copied into the dashboard response.

## Data that V0.8.2 does not retain

The following remain outside the accepted persistent record by default:

- Social Security numbers;
- FSA IDs, passwords, recovery codes, or other Federal Student Aid credentials;
- authentication/session secrets in plaintext;
- plaintext recovery tokens;
- raw StudentAid.gov **Download My Aid Data** files;
- raw evidence uploads such as pay stubs, tax records, employer files, or unemployment records;
- unnecessary bank/account numbers or similar secrets;
- fabricated employer, payer, signature, pay-stub, tax, dependent, or evidence facts;
- hidden model memory that is not part of an explicitly accepted client record.

The browser-local StudentAid importer may populate normalized loan facts into a client record, but persisted import metadata is structurally constrained to `source: "studentaid_download"` with `rawFileRetained: false`. A request that attempts `rawFileRetained: true` is rejected.

## Client lifecycle, export, and deletion

- Client records remain until the owning advisor archives or permanently deletes them. Archive is a workflow state; it is not deletion.
- Permanent deletion requires the current `updatedAt` value plus explicit `confirm: "delete"` and is scoped by both advisor and client ID.
- Client export is owner-scoped and returns the accepted normalized client record in a versioned export envelope.
- Advisor account deletion requires a valid session, CSRF token, and current password. It deletes the advisor audit rows explicitly and deletes the account; D1 foreign-key cascades remove that advisor's sessions and client records.
- V0.8.2 does not claim a long-term archival retention schedule. A formal retention period, backup/recovery policy, and any legal hold requirements must be accepted before the service is treated as a mature system of record.

## Audit and logging boundary

V0.8.2 records only coarse actions such as advisor registration/login/logout and client create/update/archive/export/delete. Audit rows do not copy client payloads, income, loan balances, contact details, passwords, session values, CSRF values, or raw files.

The existing application logging boundary remains: borrower/document payloads and secrets are not intentionally logged by application code.

## Public borrower path

The privacy-first borrower workflow remains separate and account-free. V0.8.2 does not make advisor registration mandatory for the calculator, guided borrower flow, browser-local StudentAid import, or browser document review/download workflow.

## Production gate after V0.8.2

Before advisor persistence is presented as a finished production system of record, a later accepted slice must define and verify at least:

1. reviewed password/account recovery;
2. explicit advisor/borrower authorization and consent UX for retaining a client record;
3. a formal retention/deletion/back-up recovery policy appropriate to the deployment;
4. advisor dashboard/client-workspace UX that makes ownership, readiness, and retained-data boundaries visible;
5. any future team/delegation rules without weakening exact-owner isolation.

Repayment comparison charts and modeled forgiveness projections are also later V0.8 work. They must reuse the accepted deterministic calculation engine and label future-looking outputs as estimates, not guaranteed forgiveness, eligibility, or servicer outcomes.
