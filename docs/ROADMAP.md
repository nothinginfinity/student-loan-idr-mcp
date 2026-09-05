# Student Loan IDR MCP — Roadmap

## Product intent

Give an AI client a deterministic, inspectable way to normalize irregular taxable income, estimate current federal student-loan repayment options, and produce truthful supporting-statement templates without pretending to be a tax-return generator or official eligibility engine.

## V0.1 — Deterministic MVP — COMPLETE

- Cloudflare Worker + MCP JSON-RPC route.
- Strict TypeScript core.
- Variable-income normalization for hourly, weekly, biweekly, semimonthly, monthly, annual, and seasonal-lump income.
- 2026 HHS poverty-guideline table for contiguous U.S./D.C., Alaska, Hawaii, including household sizes above eight.
- RAP estimate including AGI bands, dependent reduction, and $10 monthly floor.
- IBR and PAYE discretionary-income estimates with optional modeled 10-year Standard cap.
- ICR income arm plus optional 12-year/factor arm when caller supplies the applicable official income-percentage factor.
- Supporting-statement templates for current taxable income, significant income change, unemployment compensation income, and no current taxable income.
- Tests, README, and Cloudflare deployment manifest.

## V0.2 — Policy correctness hardening — COMPLETE

1. Added the version-controlled 2026 ICR income-percentage-factor table, including deterministic linear interpolation, so callers do not have to supply the factor.
2. Added explicit loan-type/disbursement eligibility objects with `eligible`, `ineligible`, `conditional`, `mixed`, and `unknown` outcomes instead of relying only on warnings.
3. Added source-backed policy fixtures, including published 2026 ICR examples and a table-driven current Federal Student Aid loan-eligibility matrix.
4. Added the `policy_status` MCP tool reporting snapshot date, supported plans, known sunset dates, the ICR factor-table effective period, and source links.
5. Added scheduled/manual policy refresh that fingerprints four official policy sources and opens a review PR rather than silently changing constants. The initial fingerprint baseline was reviewed and merged through PR #1.
6. Hardened CI to require strict TypeScript, all deterministic tests, and a real `wrangler deploy --dry-run` bundle check.

Acceptance evidence:

- 21 deterministic policy/formula regression tests passing.
- Push CI + Wrangler acceptance run `33098442626` succeeded on commit `9a2c7de9c9e9e5d39428702107d9bf50e3417bd8`.
- Manual policy-refresh + full test/Wrangler run `33098620922` succeeded on the same commit.
- Policy source fingerprint baseline merged as commit `71dfd775d99b76d1857bd43e712a318ef3cb0cbd`.

## V0.3 — Document workflow — COMPLETE

1. Added structured `incomeSources` arrays while preserving the legacy single-source fields for compatibility.
2. Added Markdown (default), plain-text, and privacy-safe printable HTML output formats.
3. Added HTML escaping, a restrictive no-network Content Security Policy, and no scripts or external resources in generated HTML.
4. Added a commonly requested supporting-evidence checklist that explicitly states a servicer may request different/additional evidence and that no single item guarantees acceptance.
5. Added contradiction protection so a no-current-taxable-income statement rejects supplied current-income sources rather than producing an inconsistent document.
6. Preserved explicit placeholders for every unsupplied descriptive fact instead of inventing borrower, servicer, source, amount, date, frequency, or explanation data.

Acceptance evidence:

- Implementation commit `5b04e3f4c37042ca80da887eaa47eba4d657ddc3` passed strict TypeScript, all 26 deterministic tests, and `wrangler deploy --dry-run` in CI run `33104204004`.
- Regression coverage includes multi-source generation, Markdown-to-text behavior, HTML escaping/no-network behavior, explicit placeholder completeness, legacy compatibility, evidence-checklist truthfulness, and contradictory no-income-source rejection.
- Generated documents remain user-editable supporting statements only; they do not submit applications, fabricate evidence, or guarantee servicer acceptance.

## V0.4 — Production MCP hardening — COMPLETE

1. Added protocol-conformance coverage for the server's declared MCP `2025-03-26` Streamable HTTP revision, including initialization negotiation, notification-only `202` responses, JSON-RPC batch reception, request-ID rules, media-type enforcement, and explicit handling for unsupported SSE listening.
2. Added a 64 KiB streamed request-body ceiling plus recursive runtime validation against each tool's declared input schema. Unknown fields and mistyped values are rejected without echoing rejected payload values.
3. Added exact browser-origin allowlisting through `MCP_ALLOWED_ORIGINS`; server-to-server calls without an `Origin` header remain supported.
4. Added optional bearer authentication through the `MCP_BEARER_TOKEN` Cloudflare secret. Authentication is fail-closed when configured and remains disabled when no secret is configured.
5. Added optional native Cloudflare Rate Limiting binding support through `MCP_RATE_LIMITER`, returning `429` on a denied request and failing closed with `503` if a configured binding errors. The account-specific rate-limit namespace is deliberately not invented or committed; activation remains a deployment decision.
6. Added structured request observability that logs only service/version, JSON-RPC method, tool name, HTTP status, request byte count, and duration. Borrower/document fields, tool arguments, authorization secrets, origins, and IP addresses are not logged by application code.

Acceptance evidence:

- V0.4 implementation commit `3e0ec5e4b45a9e279e32bd2ef5cef8c330698a38` passed strict TypeScript, all 38 deterministic regressions, and `wrangler deploy --dry-run` in CI run `33105610355`.
- The 12 new V0.4 regressions cover initialization/version negotiation, notification semantics, batches, malformed IDs/params, runtime schema rejection, HTTP media types, the 64 KiB body cap, optional bearer authentication, origin allowlisting, optional native rate limiting, sensitive-log redaction, and explicit `GET /mcp` behavior.
- Wrangler 4.127.0 produced the V0.4 bundle successfully. No rate-limit binding or bearer secret is claimed as live-configured, and no Cloudflare live deployment acceptance is claimed from dry-run evidence.

Core roadmap V0.1 through V0.4 is now complete. The next decision gate is live deployment/operational acceptance and selection of any later optional productization work.

## Operational activation — COMPLETE

1. Added a manually gated CI path that builds a single Wrangler deploy artifact from an explicitly selected source commit, runs strict TypeScript and all deterministic tests against that exact source, and publishes the bundle plus a SHA-256/provenance manifest to the separate `deployment-artifacts` branch without changing accepted runtime source.
2. Built and published the V0.4 artifact from immutable source commit `4f88622253fe866bba27d9fbff702a5da0a74b15`. Artifact workflow run `33111497757` succeeded; the published `worker.js` is 55,031 bytes with SHA-256 `1144961add77f8f2c0faa71dd179fcb71f584b192bfc0edc6f63f0962aeb8e30`, exactly matching its manifest.
3. Added a separate fail-closed `deploy_live` workflow gate. Live deployment requires `source_ref` to be a full 40-hex commit SHA, re-verifies checked-out commit identity, reruns typecheck/tests, requires explicit `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` repository secrets, and only then invokes `wrangler deploy`.
4. GitHub Actions repository secrets were configured on 2026-08-27. The exact accepted V0.4 source commit was deployed successfully to `https://student-loan-idr-mcp.jaredtechfit.workers.dev`. Successful deployment run `33123037565` proved the immutable source guard, typecheck, all 38 deterministic regressions, credential gate, and Wrangler deployment path.
5. Hardened deployment observability so successful Wrangler runs publish the live Worker route and failures preserve the exact Cloudflare error. The accepted workflow then added a post-deploy production acceptance gate; workflow commit `2421826efb593c7c810d5527ead911cababc6c97` passed normal CI in run `33123355234`.
6. Final live deployment and production acceptance run `33123401382` succeeded. The `deploy-live` job checked out exact runtime source `4f88622253fe866bba27d9fbff702a5da0a74b15`, reran strict TypeScript and all tests, deployed with Wrangler, and passed all 12 live checks against the production URL.

Live acceptance evidence:

- `GET /health` returned the expected `student-loan-idr-mcp` identity, version `0.4.0`, MCP protocol `2025-03-26`, policy snapshot `2026-08-27`, three-tool inventory, 65,536-byte request ceiling, and sensitive-payload logging disabled.
- `GET /mcp` returned `405`, `Allow: POST, OPTIONS`, and the explicit stateless/SSE-not-implemented message.
- MCP `initialize` negotiated protocol `2025-03-26` and reported server version `0.4.0`.
- `tools/list` returned exactly `calculate_alt_income_student_loan`, `get_repayment_documentation_template`, and `policy_status`.
- `policy_status` returned the accepted `2026-08-27` policy snapshot and the expected 2026 ICR table effective date.
- A live RAP fixture returned the known `$116.67` monthly estimate, and a live documentation-template call preserved supplied borrower facts plus the supporting-evidence checklist.
- Notification-only MCP traffic returned `202` with an empty body.
- Live HTTP hardening returned `415` for invalid Content-Type, `406` for an invalid Streamable HTTP Accept header, `403` for an untrusted browser Origin, and `413` for a body over 64 KiB.
- The final GitHub check annotation recorded `Live MCP acceptance: 12 production checks passed` and the live route `https://student-loan-idr-mcp.jaredtechfit.workers.dev`.

Operational activation is closed. Optional bearer authentication and native Cloudflare rate limiting remain deployment choices and are not claimed as enabled by this acceptance.

## V0.5 — Borrower-facing calculator UI — COMPLETE

1. Added a responsive borrower-facing calculator at `GET /` on the same Cloudflare Worker. The page has no analytics, no external assets, and no browser storage, and it explicitly warns users not to enter SSNs, account numbers, or fabricated facts.
2. Added a thin same-origin `POST /api/calculate` route that reuses the exact deterministic `calculateRepayment()` engine and the calculator MCP tool's runtime input schema rather than duplicating repayment formulas in browser code.
3. Preserved the hardened `/mcp` contract and exact three-tool inventory. The borrower route is separate from MCP transport negotiation and does not weaken MCP authentication/origin/media-type behavior.
4. Applied `Cache-Control: no-store`, a restrictive no-network Content Security Policy, frame/referrer hardening, same-origin API enforcement, the existing 64 KiB request ceiling, and optional reuse of the native Cloudflare rate-limiter binding when configured.
5. Added deterministic regressions for the HTML/privacy shell, the known RAP `$116.67` fixture through `/api/calculate`, schema rejection without rejected-value echo, cross-origin rejection, and the request-size ceiling.
6. Extended the immutable live-deploy workflow to exercise the borrower page/API in production while retaining the original MCP acceptance suite.

Acceptance evidence:

- Exact V0.5 runtime/workflow source commit `be8cb125ca51b7c68fd71c42a232fe941a5f87d3` passed normal CI in run `33124927471`: strict TypeScript, all 42 deterministic regressions, and Wrangler deployment dry-run.
- Live deploy + production acceptance run `33125464977` succeeded from that exact immutable source. All 16 production checks passed, including the borrower HTML/CSP shell, same-origin RAP calculation, browser-origin rejection, 64 KiB ceiling, MCP initialize/tool inventory, policy status, document generation, notification semantics, and MCP media/origin guards.
- Live borrower calculator: `https://student-loan-idr-mcp.jaredtechfit.workers.dev/`.

## V0.6 — Borrower portfolio import + fact provenance — COMPLETE

1. Added browser-local import for the StudentAid.gov **Download My Aid Data** text file. The raw file is read only in the borrower's browser; there is no `/api/import` route and the Worker does not receive or persist the raw file.
2. Extracted active loan facts needed for faster borrower-specific calculations, including outstanding principal, interest rate, loan description/type when safely mappable, disbursement date/period, status/default hints, and servicer/contact name. Ambiguous consolidation or Parent PLUS history is never guessed; unresolved records remain visibly ambiguous for eligibility screening.
3. Added `loan.repaymentLoans` so multiple balance/rate pairs can be modeled independently. The 10-year Standard cap and ICR fixed-payment arm now sum per-loan amortized payments instead of collapsing an imported portfolio into a blended-rate approximation.
4. Added explicit UI provenance labels: **Stated fact**, **Documented fact**, **Imported fact**, and **Derived estimate**. The borrower can see which answers come from their statements, supporting evidence, StudentAid data, or deterministic calculations.
5. Corrected the borrower-facing family-size guidance to follow the current IDR support-based definition rather than an arbitrary household cap. Borrower/spouse treatment, supported children, and other supported household members are explained separately from RAP tax-return dependents.
6. Added current-income evidence guidance around recent gross-pay documentation, pay frequency, one item per taxable income source, and signed source-by-source statements when normal documentation is unavailable or needs explanation. V0.6 explains these requirements but does not yet automate a complete application packet.
7. Hardened legacy FFEL import mapping, including the older `NON-SUBSIDIZED` naming, and retained conservative fail-closed eligibility behavior when a source record cannot be mapped confidently.

Acceptance evidence:

- Final regression-bearing V0.6 source commit `0f2d4cebafad279c676bb708588ff51ca7192fb3` passed strict TypeScript, all 44 deterministic regressions, and Wrangler dry-run in CI run `33131135145`.
- Live deploy + production acceptance run `33131163767` succeeded from that exact immutable source. All 18 live checks passed, including the borrower import/privacy shell, absence of a raw-file import endpoint, multi-loan portfolio calculation, original borrower calculation hardening, and the unchanged three-tool MCP contract.
- Live borrower calculator remains `https://student-loan-idr-mcp.jaredtechfit.workers.dev/`.

## V0.7 — Guided application facts + evidence/document packet — COMPLETE

1. Add a conversational borrower entry point that asks one focused question at a time and accepts either answer bubbles or typed responses. The deterministic browser-local fact ledger remains authoritative: the guide may prefill calculator fields only from answers the borrower actually confirms.
2. Keep Workers AI optional and subordinate to the fact ledger. A later language layer may interpret freer phrasing, explain why a question matters, or suggest the next question, but it must never silently invent or overwrite family size, income, employer/payer, loan, evidence, or signature facts.
3. Build a source-by-source current-income workflow for employment, self-employment/contract income, unemployment compensation, other taxable income, multiple taxable sources, and no-current-taxable-income situations.
4. For every application fact, show provenance and readiness: borrower-stated, imported from StudentAid data, supported by uploaded/identified evidence, derived by the calculator, or still missing/needs review. RAP tax-return dependents remain distinct from legacy IDR family size.
5. Generate fast, editable supporting statements and evidence checklists from only supplied facts. Support payer/employer-attestation drafts that an actual payer/employer can review and sign. A company logo may be uploaded as an optional browser-local branding asset for a draft, but a logo is never treated as proof of employment or payer verification and the system never invents signatures, employer records, amounts, dates, dependents, or evidence.
6. Make completed drafts easy to print/download and suitable for normal email or later e-sign workflows, while preserving a clear review-before-sign boundary and never auto-submitting to Federal Student Aid or a servicer.
7. Keep the guided workflow usable without a required account so a borrower can complete a private session before persistent identity/storage is introduced. V0.8 remains the boundary for advisor authentication, saved client records, retained drafts, and account-linked data.

### V0.7.1 — IBR $0-payment quick info — COMPLETE

- Add a guided-assistant bubble for borrowers who want to know whether IBR could produce a $0 required monthly payment.
- Derive the quick-info threshold from the same 2026 poverty-guideline constants used by the deterministic calculator: IBR discretionary income is AGI above 150% of the applicable poverty guideline.
- Show family-size 1–6 AGI cutoffs by region, with a plain-language 48-states-plus-D.C. example showing that $60,000 with family size 6 is below the 2026 $66,540 $0-payment line, subject to borrower/loan IBR eligibility and the income actually used for the application.
- Immediately offer the next workflow action: prepare a current/stated-income supporting statement, prepare an unemployment-compensation statement, or continue to the full calculator.
- Keep the quick-info explanation explicit that a $0 formula result is not automatic plan eligibility, annual recertification still matters, spouse income can matter in applicable situations, and interest may still accrue.

Acceptance evidence:

- Exact V0.7.1 runtime source commit `1fa309f0631d7d89918e0c61de76d524291ae291` passed strict TypeScript, the complete deterministic regression suite, and Wrangler dry-run in CI run `33133261659`.
- Live deploy + production acceptance run `33133417016` succeeded from that exact immutable source. The deployment passed the immutable-source guard, tests, Wrangler deployment, and live checks for the guided bubble, both document follow-ups, the quick-info endpoint, and the $23,940 / $66,540 boundary values.
- CairnStone canonical closure is `4337549bfac4cec26fac20c3f88009ea2039b0c16cd3891a2970677b97790a93`.

### V0.7.2 — Browser document review, print, and local download — COMPLETE

- Turn the stated-income and unemployment follow-up actions into an actual borrower document workflow without requiring an account.
- Reuse confirmed guided facts and ask only for the remaining borrower, payer/agency, and servicer names needed for the draft; every skipped item remains an explicit placeholder.
- Generate the draft through a same-origin `/api/document` route that validates against and calls the existing trusted documentation-template engine rather than duplicating statement wording in browser JavaScript.
- Keep the generated preview editable through its source fields and require an explicit review acknowledgement before enabling print / Save PDF or local HTML download.
- Keep raw borrower facts out of server persistence and application logs. Do not auto-submit, invent evidence, create employer records, or create a borrower/employer signature.
- Preserve the existing three-tool MCP contract; this is a borrower-facing workflow layered on the same template engine.

Acceptance evidence:

- Core V0.7.2 implementation was pre-merge accepted in PR #2 by CI run `33137440831`, then merged as source commit `29b12f3231ee205aef4746043845f84d2fbb648e`; post-merge CI run `33137466470` passed strict TypeScript, the complete deterministic regression suite, and Wrangler dry-run.
- The live deployment workflow exposed a short Cloudflare propagation race after the first successful Wrangler publish. CI was hardened to emit exact live-assertion failures and to wait for `/health` to report the expected deployed version before production assertions. Those workflow hardenings are included in final runtime source commit `6a5df45d901cfb3d411878a42df1e77f8f5063a0`.
- Normal CI run `33137744700` passed on that final exact source commit. Exact-SHA deployment run `33137753929` then passed the immutable-source guard, strict TypeScript, the complete deterministic suite, Cloudflare credential gate, Wrangler deployment, and all 36 live production acceptance checks.
- Live acceptance covers the document-review UI, review-before-sign acknowledgement, print / Save PDF and local HTML download controls, same-origin `/api/document`, trusted-template rendering, caller-markup escaping, `Cache-Control: no-store`, cross-origin rejection, and the unchanged three-tool MCP contract.

### V0.7.3 — Source-by-source evidence and application readiness — COMPLETE

- Extend the guided fact ledger from one current-income path to multiple taxable income sources without collapsing employer, self-employment, unemployment, and other taxable income into one ambiguous fact.
- Track provenance and evidence readiness per source: borrower-stated, documented/identified evidence, imported fact where applicable, derived estimate, or still missing/needs review.
- Build a source-specific evidence checklist and distinguish `document-ready` from `application-ready` so the borrower can immediately see what is complete and what still needs evidence or review.
- Reuse the existing multi-source documentation engine to create combined or source-specific drafts from confirmed facts only; never invent payer names, amounts, dates, evidence, attestations, or signatures.
- Keep the workflow account-free and browser-local where possible. V0.8 remains the boundary where an authenticated advisor can save multiple borrower clients, their normalized facts, evidence/readiness state, and retained drafts.

Acceptance evidence:

- Final V0.7.3 runtime source commit `86be2218533a39c9e1764ef7fbcd39a2ffa7f4d8` passed strict TypeScript, the complete deterministic regression suite, and Wrangler dry-run in normal CI run `33173349529`.
- Exact-SHA live deployment run `33173463078` succeeded from that immutable source. The `deploy-live` job passed the immutable-source guard, strict TypeScript, the complete deterministic suite, Cloudflare credential gate, Wrangler deployment, and the full 42-check live production acceptance step.
- Live acceptance covers the browser-local source-by-source income ledger, borrower-stated evidence-readiness boundary, source-specific evidence guidance, separate `Document-ready` / `Application-ready` / `Needs review` states, combined and source-specific drafts through the trusted multi-source documentation engine, preservation of two distinct income sources, and reuse of all confirmed guided sources by the deterministic calculator.
- The raw StudentAid.gov file remains browser-local; evidence files are not uploaded or verified by this slice; no borrower account or server persistence was introduced; and the existing three-tool MCP contract remains unchanged.

## V0.8 — Advisor/manager accounts + multi-client workspace — IN PROGRESS

### V0.8.1 — Advisor/client authority + persistence contract — COMPLETE

- Added a versioned `AdvisorClientRecordV1` model for owner-scoped client contact data, normalized loan facts, confirmed application/income facts, evidence readiness, workflow state, retained draft IDs, notes, and considered plans without enabling server persistence yet.
- Added fail-closed authority helpers: only an active advisor whose `advisorId` exactly matches `client.ownerAdvisorId` may access the client; cross-advisor and suspended-account access use the same generic denial.
- Added a minimized dashboard projection that exposes only client ID, display name, lifecycle/readiness state, and update time rather than copying private contact, loan, income, note, evidence, or draft details into the client list.
- Structurally fixed StudentAid import metadata to `rawFileRetained: false`, preserving the browser-local raw-file boundary from V0.6/V0.7.
- Added `docs/V0_8_ADVISOR_CLIENT_CONTRACT.md` to freeze ownership, consent/provenance, persistence, deletion/export, session/recovery, audit, and sensitive-data boundaries before D1/authentication work.
- Added deterministic regression coverage proving owner access, cross-advisor denial, suspended-owner denial, generic errors, dashboard minimization, and the no-raw-file-retention invariant.

Acceptance evidence:

- Clean authority/data-model candidate `3e2232d8f6fac19dc528232e8061fa79998b990e` passed strict TypeScript, the complete deterministic regression suite, and Wrangler dry-run in CI run `33175744194`.
- The contract was committed as `e6bd0061215062116a1e8a9a18ead563918aa9cb`.
- V0.8.1 intentionally does **not** create a D1 client store, login/session endpoint, recovery flow, public advisor CRUD API, raw StudentAid/evidence-file storage, comparison charts, or x402 integration.

### V0.8.2 — Authenticated advisor sessions + owner-keyed D1 client CRUD — COMPLETE

- Added advisor registration/login/logout/session endpoints with 12-hour server-issued `HttpOnly; Secure; SameSite=Strict` cookies, CSRF rotation/validation, login throttling, and password verification using the Workers-native Node crypto `scrypt` implementation. Passwords and raw session/CSRF tokens are never persisted.
- Added the dedicated Cloudflare D1 database `student-loan-idr-mcp-db` and migration-backed tables for advisor accounts, sessions, owner-keyed clients, authentication-failure throttling, and payload-minimized audit events.
- Added owner-scoped client list/create/read/update/archive/export/delete APIs. Every client read/write query keys on the authenticated advisor ID plus client ID, with generic cross-owner denial and optimistic `updatedAt` concurrency guards.
- Preserved the V0.8.1 privacy boundary: raw StudentAid downloads remain browser-local, raw evidence/SSNs/FSA credentials are rejected from normalized client persistence, and aggregate client lists expose only minimized dashboard summaries.
- Added account deletion, client export/deletion, same-origin enforcement, 64 KiB request ceilings, and privacy-safe audit events. The accepted security/retention boundaries are documented in `docs/V0_8_2_SECURITY_AND_RETENTION.md`.
- Preserved the account-free borrower calculator/guided workflow and the existing three-tool MCP contract unchanged.

Acceptance evidence:

- Final V0.8.2 runtime source commit `8f993b88aedbcd453a1132a6d013d487c91d235e` passed strict TypeScript, the complete deterministic suite including real in-memory SQLite owner-isolation coverage, and Wrangler dry-run in CI run `33180881887`.
- Exact-SHA deployment run `33180935616` passed the immutable-source guard, repeated typecheck/tests, remote D1 migration, Wrangler deployment, and all **61 production checks**.
- Live acceptance created two independent advisor accounts, proved authenticated session/CSRF behavior and exact cross-advisor client isolation, exercised client persistence lifecycle operations, and cleaned up the live acceptance accounts afterward.
- During live acceptance, the original PBKDF2 verifier hit a Cloudflare Workers runtime work-factor ceiling. The accepted runtime switched to Workers-native `scrypt`, retained salted one-way password storage, added explicit TypeScript declarations, and then passed the full live gate.

### V0.8.3 — Advisor workspace UI + saved guided client workflow — COMPLETE

- Added an authenticated browser workspace at `GET /advisor` with advisor registration/sign-in, client creation/search, minimized client dashboard cards, client export/archive controls, and explicit navigation back to the account-free borrower calculator.
- Added saved-client mode to the existing V0.7 guided workflow through `/?advisorClient=<clientId>`. The authenticated advisor can open one client, hydrate that client's confirmed normalized facts and loan portfolio, continue the guided fact workflow, save progress, and return later without mixing client records.
- Connected saved current-income sources, region, legacy IDR family size, RAP tax-return dependents, servicer name, readiness state, and normalized repayment/eligibility loan facts to the existing deterministic calculator/document workflow rather than creating parallel formulas or template logic.
- Added advisor controls to save normalized progress and regenerate the existing reviewable supporting-document drafts from confirmed facts. The direct borrower workflow remains usable without an account.
- Preserved the privacy boundary: raw StudentAid.gov files and evidence files are not retained by the advisor workspace, dashboard summaries remain minimized, browser storage is not introduced, and saved StudentAid metadata requires `rawFileRetained: false`.
- Extended deterministic and live acceptance coverage for the advisor HTML/CSP/auth shell, normalized save/resume workflow, cross-advisor isolation, document regeneration controls, and the unchanged three-tool MCP surface.

Acceptance evidence:

- Exact V0.8.3 runtime source commit `8dea095439957b83f0fc1945dd9697b085e92ade` passed strict TypeScript, the complete deterministic regression suite, and Wrangler dry-run in normal CI run `33183133895`.
- Exact-SHA live deployment + production acceptance run `33183228204` succeeded from that immutable source. The deployment passed the immutable-source guard, D1 migrations, repeated typecheck/tests, Wrangler deployment, and all **72 production checks**.
- Live acceptance exercised authenticated advisor creation/session behavior, client creation and exact owner isolation, normalized application/income/loan persistence and resume, the `/advisor` dashboard/privacy shell, saved guided-client controls, the borrower calculator/document workflow, and the existing MCP protocol/tool contract.
- The raw StudentAid.gov file remains browser-local by default; evidence files, SSNs, FSA credentials, raw session tokens, and raw CSRF tokens are not introduced as retained advisor-client payloads by this slice.

### V0.8.4 — Repayment-program comparison + forgiveness visualizations — COMPLETE

- Added an authenticated, exact-owner-scoped `GET /api/advisor/clients/:clientId/comparison` endpoint that reads the saved client record and reuses the accepted `calculateRepayment()` engine for current plan payment/eligibility results instead of duplicating repayment formulas.
- Added side-by-side RAP, IBR, PAYE, and ICR projections from the client's saved normalized loan balances, interest rates, income, family/dependent facts, tax status, and borrower timing. The comparison is read-only and records only a minimized `client.compare` audit event.
- Added a persisted IBR borrower-timing fact so the system can deterministically select a 20-year or 25-year IBR horizon. If that fact is absent, the current IBR payment can still be shown but long-term forgiveness is explicitly withheld rather than guessed.
- Added bounded balance-path modeling for RAP and IBR. RAP models the current 30-year discharge horizon, unpaid-interest waiver, and monthly principal-match mechanics; IBR projections explicitly disclose that loan-specific temporary interest subsidies are not modeled from the current normalized repayment rows.
- PAYE and ICR are modeled only through the current July 1, 2028 sunset boundary. V0.8.4 intentionally does not fabricate a standalone 20/25-year forgiveness result as though those plans continue unchanged after sunset.
- Added the saved-client **Repayment & forgiveness comparison** workspace with native same-origin SVG views for current monthly payment path, cumulative borrower paid, remaining balance, and estimated forgiveness. No external chart library, analytics, browser storage, or cross-client aggregate sensitive data was introduced.
- Every future-looking output is labeled as a modeled estimate rather than guaranteed forgiveness, eligibility, approval, tax treatment, or servicer outcome. Projection assumptions also state that saved facts are held constant and do not credit prior qualifying payments, PSLF history, deferment/forbearance, defaults, extra payments, capitalization events, or tax consequences.
- Preserved the account-free borrower workflow, owner-scoped advisor isolation, raw StudentAid browser-local boundary, existing document workflow, and unchanged three-tool MCP contract.

Acceptance evidence:

- Final V0.8.4 runtime/workflow source commit `ef32ee123772d0d4a189d6f33fcafbcd9a506ae2` passed strict TypeScript, the complete deterministic regression suite, and Wrangler dry-run in normal CI run `33186280862`.
- The first V0.8.4 exact-SHA deployment successfully published the Worker but exposed one stale live-gate fixture that still expected MCP server version `0.8.3`; the runtime tests and V0.8.4 comparison regression were already green. The fixture and stale check-count report were corrected before canonical acceptance.
- Final exact-SHA deployment + production acceptance run `33186338271` succeeded from `ef32ee123772d0d4a189d6f33fcafbcd9a506ae2`, including immutable-source verification, repeated typecheck/tests, D1 migrations, Wrangler deployment, and all **91 production checks**.
- Live acceptance created independent advisor accounts, proved cross-advisor comparison denial, exercised the saved client comparison schema and four-plan inventory, verified RAP/IBR bounded forgiveness behavior, verified PAYE/ICR sunset-only behavior, checked all four chart surfaces/non-guarantee labeling, and cleaned up the acceptance accounts.

### V0.8.5 — Retained client artifacts + calculation history — COMPLETE

- Added two dedicated owner-and-client-keyed D1 history stores: one for explicitly retained generated document drafts and one for named deterministic calculation/comparison snapshots. History is opt-in; ordinary generation/calculation/comparison does not silently create retained records.
- Retained document drafts store the validated trusted-template request plus generated text/printable HTML, engine version, and creation time. Retained calculation/comparison snapshots store a bounded normalized basis, deterministic result, policy snapshot, engine version, and creation time. Raw StudentAid downloads and raw evidence files remain outside server persistence.
- Added exact-owner-scoped history APIs to list minimized history summaries, retrieve/export full retained records, regenerate document drafts from their retained template request, rerun calculation/comparison snapshots from their retained basis, and permanently delete individual history items.
- Regeneration/rerun is deliberately non-mutating: the historical original is never overwritten. A fresh result becomes retained history only through another explicit retain action.
- Upgraded client export to `student-loan-idr-advisor-client-export-v2`, including the normalized client record plus all explicitly retained document artifacts and calculation/comparison snapshots.
- Added saved-client browser controls to retain the current document draft, calculation, or comparison; browse history; regenerate/rerun; export JSON; and delete retained items. The dashboard remains minimized, the direct borrower workflow remains account-free, and no browser storage was introduced.
- Preserved payload-minimized auditing: retain/regenerate/rerun/delete history events record action names and client IDs without copying document bodies, history names, loan/income facts, template payloads, snapshot bases, or results into audit metadata.
- Client deletion continues to delete dependent retained history. Live acceptance exposed a D1-specific detail: `meta.changes` on the parent delete can include cascading child deletions, so the guarded delete now treats any positive change count as success while zero remains the optimistic-concurrency failure signal.
- Added `docs/V0_8_5_RETENTION_AND_HISTORY.md` to freeze the accepted storage, isolation, regeneration/rerun, export, deletion, audit, and browser/privacy boundaries.
- Hardened the live acceptance harness to count assertions dynamically instead of maintaining a copied check-count constant, preventing the stale-count/stale-version class of acceptance fixture seen at the V0.8.4 boundary.

Acceptance evidence:

- Final V0.8.5 runtime/workflow source commit `112e24583028c01443d560252db1cc869be1cc4d` passed strict TypeScript, the complete deterministic regression suite including retained-basis/history isolation coverage, and Wrangler dry-run in normal CI run `33190299021`.
- Exact-SHA deployment + production acceptance run `33190347634` succeeded from that immutable source. The run passed the immutable-source guard, repeated typecheck/tests, remote D1 migrations, Wrangler deployment, and **166 dynamically counted production checks**.
- Production acceptance proved explicit artifact/snapshot retention, minimized history lists, exact cross-advisor denial, regeneration, retained-basis rerun, export v2, individual deletion, client cleanup/cascade behavior, saved-client history UI/privacy boundaries, all prior borrower/advisor comparison workflows, and the unchanged three-tool MCP contract.
- An earlier live gate correctly caught the D1 cascade-count behavior after successful deployment; the final accepted run above includes the bounded production fix rather than weakening the concurrency guard.

V0.8.5 is closed. V0.8 remains **IN PROGRESS**. The next bounded advisor-workspace slice is now selected below; x402 remains deferred behind its separate token/economic design gate.

### V0.8.6 — Dual-mode StudentAid import + advisor client prefill — COMPLETE

- Make StudentAid.gov **Download My Aid Data** import explicitly mode-aware. **Borrower/private mode** remains account-free and browser-local for a one-session calculation. **Advisor/client mode** runs inside an authenticated saved client record and uses the same local parser to prefill that client's workflow.
- In advisor/client mode, populate **every reliable fact available in the StudentAid file** into visible reviewable fields and normalized client facts rather than keeping most imported values only inside an internal portfolio object. This includes borrower/contact fields when actually present and safe to use, servicer/contact name, individual outstanding principal balances, individual interest rates, loan type/description when safely mappable, disbursement dates/periods, loan status/default facts, portfolio totals, and deterministic cutoff facts derivable from the imported loan records.
- Preserve the real per-loan portfolio. Do not collapse mixed loans into one fabricated loan type, one fake interest rate, or a blended approximation merely because a legacy manual form exposes a single field. Add/expand advisor review UI where needed so multiple loans and their distinct facts remain inspectable. Ambiguous consolidation or Parent PLUS history remains unresolved rather than guessed.
- Show fact provenance directly in the form/workflow using clear states such as **Imported from StudentAid**, **Derived from StudentAid**, **Advisor entered**, **Borrower confirmed**, and **Missing / needs review**. Imported values remain editable/reviewable where appropriate, but a manual edit must not continue to masquerade as an imported fact.
- On explicit advisor **Save progress**, persist the normalized imported/derived client facts under the existing exact-owner authorization boundary so the advisor can close the client, return later, and resume with the populated portfolio. The raw StudentAid download itself must remain browser-local, must not be uploaded to a raw-file endpoint, and must never be retained in D1/client history.
- Borrower/private mode should receive the same useful visible prefill for the current session but preserve the existing no-account/no-persistence privacy behavior.
- Do not infer facts that the StudentAid file does not establish. Current income, family size, RAP tax-return dependents, tax filing status, employer/payer facts, evidence readiness, signatures, and similar borrower-specific application facts remain advisor-entered or borrower-confirmed unless a trustworthy source explicitly supplies them.
- Build the parser field map against a representative current StudentAid **My Aid Data** sample, preferably sanitized while preserving exact field labels. Add deterministic fixtures for supported labels/variants, mixed portfolios, ambiguous records, and save/resume behavior so future StudentAid export changes fail visibly instead of silently dropping facts.
- Acceptance should prove both modes end to end: browser-local borrower import/prefill, authenticated advisor client import/prefill/save/resume, exact cross-advisor isolation, no raw-file server retention or import endpoint, correct mixed-loan calculations, visible provenance, and the unchanged three-tool MCP contract.

Acceptance evidence:

- Exact V0.8.6 production runtime source commit `db6196a0ad51a4594144248e29040b3d0c84a85b` passed strict TypeScript, the expanded deterministic regression suite, and Wrangler dry-run in normal CI run `33203821214`.
- Exact-SHA live deployment + production acceptance run `33203904245` succeeded from that immutable source. The deploy-live job reverified the requested commit, reran typecheck/tests, applied D1 migrations, deployed with Wrangler, and passed **189 dynamically counted production checks**.
- Production acceptance proves the dual-mode browser-local import surface, advisor normalized save/resume, exact cross-advisor denial, recursive rejection of raw StudentAid text/file-shaped persistence, per-loan mixed portfolio preservation, contact/address prefill, import/edit provenance, mapping metadata, mixed-plan eligibility behavior, and the unchanged three-tool MCP contract.
- StudentAid mapping version `2026-08-28-v1` preserves individual loan balance/rate/type/date/status/disbursement/contact facts and borrower contact fields when present. `Loan Award ID` is deliberately normalized to a masked row hint rather than retained as a raw identifier. Ambiguous consolidation/Parent PLUS history remains unresolved rather than guessed.
- Borrower/private mode remains account-free and non-persistent. Advisor/client mode persists only explicit normalized facts on **Save progress**; the raw StudentAid `.txt` is never uploaded, has no raw import endpoint, and is not retained in D1/history.
- A sanitized current My Aid Data sample remains useful as a future compatibility fixture for newly observed StudentAid label variants; it is not required to retain or upload a real borrower file to the service.

1. Make the persistent account an **advisor/manager account**, not a one-borrower account. One authenticated advisor can create, search, open, and manage many borrower **client records** from a single workspace.
2. Give each client a structured profile for contact information, normalized StudentAid loan portfolio, confirmed application facts, income sources, family-size facts, evidence/readiness state, servicer information, generated document drafts, selected/considered repayment programs, notes, and repeat calculations. Client records must remain logically isolated from one another and scoped to the owning/authorized advisor account.
3. Let the advisor walk a borrower through the same guided V0.7 workflow inside that client's workspace, save progress, resume later, regenerate documents from confirmed facts, and see what is document-ready or application-ready without re-entering the same information.
4. Persist only normalized facts and explicitly retained artifacts needed for the advisor workflow. The raw StudentAid.gov download remains browser-local by default; importing it should populate the client's normalized loan facts without automatically turning the service into a raw Federal Student Aid document store.
5. Add a client-level **repayment-program comparison** view that runs the accepted deterministic calculation engine across applicable scenarios and presents side-by-side estimates such as monthly payment, projected payment path where supported, estimated total paid, estimated repayment/forgiveness horizon, and estimated balance remaining for forgiveness where the policy model supports that projection.
6. Add clear visualizations for those comparisons — for example payment-over-time, cumulative-paid, remaining-balance, and estimated-forgiveness comparison charts — while labeling all future-looking outputs as modeled estimates rather than guaranteed forgiveness, eligibility, or servicer outcomes.
7. Support an advisor dashboard across clients with useful operational states such as recently updated, needs evidence, document-ready, application-ready, awaiting borrower review, and completed/archived. Do not expose one client's sensitive facts inside another client's workspace or aggregate view beyond the minimum summary needed for advisor workflow.
8. Define authentication, advisor/client authorization, consent, retention, deletion/export, encryption, session security, access/audit history, and account recovery boundaries before treating the service as a system of record. A future team/organization model can extend this with roles and client assignment without weakening single-advisor isolation.
9. Preserve the privacy-first direct borrower workflow as a separate no-account path where practical; V0.8 adds advisor-managed persistence rather than making an advisor account mandatory for every calculator user.

## V0.9 — Professional advisor delivery + FSA intelligence — IN PROGRESS

### V0.9.0 — Advisor StudentAid intake — COMPLETE

- Advisor dashboard intake can create a borrower client directly from a StudentAid.gov **Download My Aid Data** file while keeping the raw file browser-local and persisting only normalized facts.
- Duplicate/match review remains part of advisor intake so a real-file import does not casually create parallel records for the same borrower.

### V0.9.1 — Chart-first borrower review, confirmation, booking, and supporting-document handoff — COMPLETE

- Advisor-created borrower share links present the repayment comparison chart first, identify the unique lowest modeled monthly payment as FLRs, and show genuine ties as tied rather than assigning a false winner.
- Borrower plan selection/confirmation uses a bounded 15-minute review/signing window; confirmed borrowers receive a bounded 36-hour booking window, Cal.com booking surface, and supporting-document download flow.
- Advisor/borrower Resend notifications are part of the accepted V0.9.1 workflow. Confirmation is explicitly non-binding and does not represent enrollment or an official servicer decision.

### V0.9.2 — StudentAid Parser V2: real-export structural parsing + compatibility diagnostics — COMPLETE

Build the parser against the observed structure of real Federal Student Aid / NSLDS **My Aid Data** text exports used by professional advisors, not against a simplified synthetic ordering.

1. Replace the current `Loan Type Code`-as-record-boundary assumption with deterministic tokenization and record assembly. Treat `Loan Award ID` as a strong loan anchor when present, support fields that precede the type code, and preserve conservative fallback boundaries for records where an award ID is absent.
2. Maintain an explicit exact-label compatibility map for current and legacy field names. Initial real-export variants include `Loan Updated Date`, `Loan Delinquency Date`, `Loan Delinquency End Date`, `Additional Unsubsidized Loan Flag`, `Joint Consolidation Loan Indicator`, `Joint Consolidation Loan Separation Indicator`, `Loan Special Contact Reason`, and `Loan Special Contact`, while retaining accepted aliases such as `UpdtDt` and `DelinqDate`.
3. Preserve repeating child structures per loan instead of flattening them away: status events, disbursements, and servicer/contact blocks. Never merge parallel loans into one fabricated loan record.
4. Preserve source order but derive the newest status by date rather than array position. Compare any explicit current-status fields with the newest dated timeline entry and flag a mismatch instead of guessing which source is correct.
5. Add parser diagnostics that expose recognized/unmapped **labels only**, mapping version, structural warnings, and validation issues without echoing unknown-field values or raw borrower identifiers.
6. Keep raw award IDs out of retained advisor records. They may be used transiently to assemble records, but persisted normalized data retains only the existing masked row hint (or a future explicitly reviewed one-way fingerprint if needed for duplicate detection).
7. Keep the privacy boundary unchanged: borrower/private and advisor/client imports parse the raw `.txt` locally in the browser; there is no raw-file upload endpoint and no raw FSA file retention in D1/history.
8. Build deterministic sanitized regression fixtures that preserve the real FSA label/order/repetition grammar while replacing names, IDs, addresses, phones, emails, and other borrower PII.
9. Acceptance must cover both actual browser-local parser copies plus the server/test parser so advisor intake, saved-client import, and borrower-private import cannot drift onto different grammars.

V0.9.2 acceptance gates:

- A sanitized real-layout fixture with `Loan Award ID` and other loan fields before `Loan Type Code` parses into the correct number of complete loan records.
- Current and legacy label aliases map to the same normalized fields.
- Repeated status/disbursement/contact rows remain attached to the correct loan.
- Unknown labels fail visibly through diagnostics without retaining or logging their values.
- Ambiguous consolidation / Parent PLUS history remains unresolved rather than guessed.
- Strict TypeScript, the full deterministic regression suite, Wrangler dry-run, exact-SHA deployment, and production acceptance must pass before V0.9.2 is marked complete.

Acceptance evidence:

- Final V0.9.2 runtime source commit `10b23890a019c6fdaab9ee865fe73d7f479f1732` passed strict TypeScript, the full deterministic regression suite, and Wrangler dry-run in CI run `33990108243`.
- Exact-SHA live deployment + production acceptance run `33990147056` succeeded from that immutable source, including the immutable-source guard, repeated typecheck/tests, D1 migrations, Worker deployment, and the live production MCP acceptance step.
- Parser mapping version `2026-09-05-v2` tokenizes the actual flat FSA label/value grammar, uses `Loan Award ID` as a strong transient record anchor when the observed layout supports it, retains a conservative legacy fallback, and keeps raw award identifiers out of normalized/persisted records.
- Sanitized real-layout regressions prove fields may precede `Loan Type Code`, current/legacy label aliases map correctly, repeated status/disbursement/contact/delinquency rows remain attached to their loan, newest status is date-derived, ambiguous consolidation/Parent PLUS history is not guessed, and unknown label **values** are not retained in diagnostics.
- Both browser-local import implementations ship the V2 grammar. Borrower review now exposes mapping/structural diagnostics plus explicit delinquency rows, and advisor intake surfaces parser mapping, unmapped-label names, and structural/validation review counts before client creation. Raw StudentAid files remain browser-local and unretained.

### V0.9.3 — FSA Portfolio Intelligence for advisors — PLANNED

Layer deterministic advisory intelligence on top of Parser V2's normalized structure; do not ask an LLM to perform the underlying math or chronology.

1. Derive chronological status intervals from the parsed status timeline. Use the FSA **File Request Date** as the authoritative `as_of_date` when the newest state remains open so historical calculations are reproducible.
2. Compute per-loan and portfolio-calendar forbearance history, including current forbearance start/duration and cumulative observed forbearance. Do not multiply one calendar interval merely because several loans were simultaneously in forbearance.
3. Compute **reported scheduled plan payment** from active loans' `Loan Repayment Plan Scheduled Amount` values with explicit coverage counts. Missing scheduled amounts remain missing; they are never silently treated as `$0`. Current/permanent Standard schedule fields remain separate reference values.
4. Normalize delinquency periods, repayment-plan state, IDR anniversary/next-payment dates, capitalization/current-interest facts, plan distribution, and servicer routing. Prefer a `Most Relevant: Yes` current ED servicer/lender contact while preserving all per-loan contacts.
5. Reconcile sums of parsed individual balances against FSA portfolio aggregate fields where those aggregates are present, producing explicit pass/warning diagnostics rather than overwriting either source.
6. Add an advisor-facing portfolio intelligence panel showing useful operational facts, data quality/coverage, and per-loan drilldown without exposing one client's details in another client's dashboard.
7. Keep policy interpretation separate from borrower PII. A later RAG/LLM explanation layer may explain normalized/derived facts using reviewed federal policy sources, but deterministic parsing, dates, balances, payment sums, and interval math remain code-owned.

## Deferred economic layer — x402 + signup-minted token

x402 is intentionally **not** the next implementation slice. Future paid agent-to-agent access is gated on a separate accepted design for an account-linked crypto asset that is minted/allocated through the advisor/account signup flow.

Before any x402 integration, freeze and review at least these decisions:

- exact token/asset and chain/network accepted by x402;
- mint authority, supply/issuance rules, signup allocation, transferability, and whether the asset represents credits, access rights, or something else;
- account ↔ wallet binding and recovery model;
- anti-abuse/Sybil controls so repeated signups cannot mint unbounded value;
- custody/key model and what a borrower must understand or approve;
- pricing/burn/redeem/treasury behavior and whether tokens expire;
- legal/compliance/tax review appropriate to the final economic design;
- x402 quote/settlement behavior that rejects every other asset and cannot bypass account/token policy.

Only after that contract is accepted should x402 be wired around the service. Payment logic must remain outside the deterministic repayment formulas and must not weaken the free/privacy-preserving borrower workflow by accident.

## Later / optional

- Policy change monitor that proposes reviewed constants updates.
- Multi-year policy snapshots for historical calculations.

## Explicit non-goals

- No automated filing or submission to Federal Student Aid.
- No generation of false pay stubs, tax forms, tax returns, dependents, deductions, or employer records.
- No guarantee of plan eligibility or servicer acceptance.
- No storage of SSNs or other borrower secrets in the MVP.
