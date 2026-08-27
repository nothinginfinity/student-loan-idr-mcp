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

## Operational activation — IN PROGRESS

1. Added a manually gated CI path that can build a single Wrangler deploy artifact from an explicitly selected source commit, run strict TypeScript and all deterministic tests against that exact source, and publish the bundle plus a SHA-256/provenance manifest to the separate `deployment-artifacts` branch without changing accepted runtime source.
2. Built and published the V0.4 artifact from immutable source commit `4f88622253fe866bba27d9fbff702a5da0a74b15`. Artifact workflow run `33111497757` succeeded; the published `worker.js` is 55,031 bytes with SHA-256 `1144961add77f8f2c0faa71dd179fcb71f584b192bfc0edc6f63f0962aeb8e30`, exactly matching its manifest.
3. Added a separate `deploy_live` workflow gate. Live deployment requires `source_ref` to be a full 40-hex commit SHA, re-verifies the checked-out commit identity, reruns typecheck/tests, requires explicit `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` repository secrets, and only then invokes `wrangler deploy`.
4. The live-deploy workflow change is commit `16ed99cb04371685d162fd5024738ee8a9e2e9d0`; CI run `33112498767` succeeded. GitHub currently reports zero Actions repository secrets, so no live Cloudflare deployment or live acceptance is claimed yet.

Next activation action: configure the two Cloudflare GitHub Actions secrets, then manually dispatch `ci.yml` with `deploy_live=true` and `source_ref=4f88622253fe866bba27d9fbff702a5da0a74b15`. After deployment, verify `/health`, MCP initialization, `tools/list`, representative tool calls, request-size enforcement, origin behavior, and unsupported `GET /mcp` behavior before closing operational acceptance.

## Later / optional — NEXT DECISION

- Small borrower-facing calculator UI.
- x402 paid access for agent-to-agent use.
- Policy change monitor that proposes reviewed constants updates.
- Multi-year policy snapshots for historical calculations.

## Explicit non-goals

- No automated filing or submission to Federal Student Aid.
- No generation of false pay stubs, tax forms, tax returns, dependents, deductions, or employer records.
- No guarantee of plan eligibility or servicer acceptance.
- No storage of SSNs or other borrower secrets in the MVP.
