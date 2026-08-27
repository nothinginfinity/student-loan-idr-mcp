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

## V0.2 — Policy correctness hardening — NEXT

1. Add a version-controlled annual ICR income-percentage-factor table and tests so callers do not have to supply the factor.
2. Add explicit loan-type/disbursement eligibility objects instead of only warnings.
3. Add policy fixtures derived from current Federal Student Aid examples.
4. Add a `policy_status` tool that reports snapshot date, supported plans, known sunset dates, and source links.
5. Add a scheduled/manual policy-refresh workflow that opens a review PR rather than silently changing constants.

Acceptance: every repayment formula and eligibility branch has a source-backed fixture and deterministic regression test.

## V0.3 — Document workflow

- Add structured source-of-income arrays to template generation.
- Add Markdown + plain-text outputs.
- Add a privacy-safe printable HTML renderer.
- Add a checklist of commonly requested supporting evidence without asserting that any single item guarantees acceptance.

Acceptance: generated documents never invent facts and contain explicit placeholders for anything not supplied by the caller.

## V0.4 — Production MCP hardening

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
