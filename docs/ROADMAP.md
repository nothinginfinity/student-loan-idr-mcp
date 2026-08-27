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

## V0.4 — Production MCP hardening — NEXT

- Add protocol conformance tests.
- Add request-size limits and stricter schema validation.
- Add rate limiting / abuse controls if exposed publicly.
- Add structured observability without logging sensitive document content.
- Optional authentication if the service is used with real borrower data.

## Later / optional

- Small borrower-facing calculator UI.
- x402 paid access for agent-to-agent use.
- Policy change monitor that proposes reviewed constants updates.
- Multi-year policy snapshots for historical calculations.

## Explicit non-goals

- No automated filing or submission to Federal Student Aid.
- No generation of false pay stubs, tax forms, tax returns, dependents, deductions, or employer records.
- No guarantee of plan eligibility or servicer acceptance.
- No storage of SSNs or other borrower secrets in the MVP.
