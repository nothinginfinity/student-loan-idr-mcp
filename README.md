# Student Loan IDR MCP

A small Cloudflare Workers service with both an MCP interface and a borrower-facing calculator for people whose income is irregular, seasonal, hourly, freelance, contract-based, or otherwise difficult to express as a single annual number.

The service exposes three MCP tools:

1. `calculate_alt_income_student_loan` — normalizes variable taxable income into an annual estimate and computes repayment-plan estimates for RAP, IBR, PAYE, and ICR.
2. `get_repayment_documentation_template` — generates truthful supporting-statement documents from structured income-source arrays in Markdown, plain text, or privacy-safe printable HTML.
3. `policy_status` — reports the immutable policy snapshot, supported plans, known sunset dates, the effective period of the built-in ICR factor table, and official source links.

## Why this exists

Federal Student Aid permits current-income documentation in situations where tax-return information does not reflect a borrower's current income. The current IDR request form says documentation usually includes a pay stub or employer letter, and when documentation is unavailable or the borrower wants to explain income, a signed statement can be attached that identifies each income source and its address.

This project does **not** fabricate tax documents, deductions, or eligibility. It produces estimates, deterministic eligibility-screening objects, and user-editable supporting documents that leave explicit placeholders for facts the caller did not supply.

## Policy snapshot

The deterministic constants are explicitly versioned to `2026-08-27`.

- 2026 HHS poverty guidelines are embedded for the contiguous U.S./D.C., Alaska, and Hawaii.
- RAP is included because it became available July 1, 2026.
- IBR, PAYE, and ICR are modeled for applicable legacy loans with explicit loan-type/disbursement eligibility objects when `loan.eligibilityLoans` is supplied.
- The official 2026 ICR income-percentage-factor table is embedded for July 1, 2026 through June 30, 2027, including linear interpolation between published AGI rows.
- PAYE and ICR are currently scheduled to end no later than July 1, 2028.
- SAVE is intentionally not modeled in this snapshot.

Official references:

- https://studentaid.gov/articles/faqs-idr-plan/
- https://studentaid.gov/sites/default/files/IncomeDrivenRepayment-en-us.pdf
- https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines
- https://www.govinfo.gov/content/pkg/FR-2026-06-09/pdf/2026-11540.pdf

## Income normalization

Supported cadences:

- hourly (`hourlyRate × hoursPerWeek × weeksPerYear`)
- weekly (`amount × 52`)
- biweekly (`amount × 26`)
- semimonthly (`amount × 24`)
- monthly (`amount × 12`)
- annual
- seasonal lump sums (sum of supplied payments)

The service does **not** apply a fake “standard deduction” to gross income. IDR calculations are based on AGI or current-income documentation. The caller can either supply an `adjustedGrossIncomeOverride` or supply estimated above-the-line adjustments. Otherwise annualized taxable gross income is used as the conservative AGI estimate.

## V0.2 eligibility inputs

`loan.eligibilityLoans` accepts explicit loan records with a `loanType` and a coarse disbursement period (`before_2026_07_01` or `on_or_after_2026_07_01`). The calculator returns a plan-level `eligibility` object with per-loan assessments and one of `eligible`, `ineligible`, `conditional`, `mixed`, or `unknown`.

The eligibility object is a deterministic screening aid, not an official determination. Borrower-specific facts that are not supplied remain conditional or unknown instead of being invented.

For PAYE, optional borrower/date flags model the published Oct. 1, 2007 and Oct. 1, 2011 conditions. For ICR, callers can provide `taxFilingStatus` or `loan.icrIncomeFactorCategory`; the calculator then selects and interpolates the official 2026 factor automatically. `loan.icrIncomePercentageFactor` remains available only as an explicit override.

## V0.3 document workflow

`get_repayment_documentation_template` accepts an optional `incomeSources` array. Each source can carry a source type, payer/name, address, gross amount, payment frequency, and notes. If a required descriptive fact is not supplied, the generated document keeps a visible placeholder instead of inventing a value.

Set `outputFormat` to `markdown` (default), `text`, or `html`. The HTML renderer escapes caller-supplied content, includes no scripts or external resources, and ships with a restrictive Content Security Policy suitable for a privacy-safe printable document.

Every generated statement includes a checklist of common supporting-evidence categories. The checklist is guidance only: it explicitly says a servicer may request different or additional evidence and that no single item guarantees acceptance.

The legacy single-source fields (`incomeSourceName`, `incomeSourceAddress`, `paymentFrequency`, and `grossAmount`) remain supported for compatibility. A `no_current_taxable_income_statement` rejects contradictory current-income source data rather than silently producing an inconsistent statement.

## V0.4 production MCP hardening

The HTTP transport now enforces a 64 KiB request-body ceiling, `application/json` content type, the Streamable HTTP `Accept` media types, JSON-RPC request/notification ID rules, batch reception, initialization version negotiation, and runtime validation against each tool's declared input schema. Unknown tool-argument fields are rejected rather than silently ignored.

Browser-origin requests to `/mcp` are denied unless their exact origin is present in the comma-separated `MCP_ALLOWED_ORIGINS` environment variable. Server-to-server requests without an `Origin` header continue to work normally.

Authentication is optional until the service is used with real borrower data. To enable bearer authentication, store the token as a Cloudflare secret rather than a plaintext Wrangler variable:

```bash
npx wrangler secret put MCP_BEARER_TOKEN
```

The Worker also supports the native Cloudflare Rate Limiting binding under the optional binding name `MCP_RATE_LIMITER`. When public exposure warrants rate limiting, add a `ratelimits` entry to `wrangler.jsonc` with a positive-integer namespace ID unique to the Cloudflare account and the desired 10- or 60-second limit window. The runtime fails closed with HTTP 503 if a configured binding errors and returns HTTP 429 when the binding denies a request. Cloudflare documents the binding as available in Wrangler 4.36.0 and later.

Structured request logs contain only service/version, JSON-RPC method, tool name, HTTP status, request byte count, and duration. Borrower names, document fields, tool arguments, authorization headers/tokens, origins, and IP addresses are not logged by application code.

## V0.5 borrower-facing calculator

The live Worker now serves a small borrower calculator at `GET /`. It uses the same deterministic `calculateRepayment()` engine as the MCP tool through a thin same-origin `POST /api/calculate` route; the hardened `/mcp` contract and three-tool inventory are unchanged.

The browser surface has no analytics, external assets, or browser storage. Responses use `Cache-Control: no-store`, a restrictive Content Security Policy, same-origin API enforcement, the existing 64 KiB request ceiling, and the same runtime input-schema validation used by MCP. Results remain estimates and show eligibility as `eligible`, `ineligible`, `conditional`, `mixed`, or `unknown` rather than presenting a servicer decision.

Live borrower calculator: `https://student-loan-idr-mcp.jaredtechfit.workers.dev/`

## V0.6 borrower portfolio import + fact provenance

The borrower page can now read the StudentAid.gov **Download My Aid Data** text file directly in the browser. The raw file never goes to the Worker, there is no raw-file import API, and nothing from the file is stored by the page. The local parser extracts only loan facts used to improve the current session: active outstanding principal, interest rate, loan description/type when confidently mappable, disbursement date/period, default/status hints, and servicer/contact name.

Imported portfolios can supply `loan.repaymentLoans`, an array of `{ principal, annualInterestRatePercent }` records. Standard-payment caps and ICR fixed-payment estimates sum the per-loan amortized payments instead of pretending that a multi-rate portfolio is one blended loan. If loan type or consolidation history is ambiguous, eligibility remains unresolved rather than being guessed.

The borrower UI also distinguishes **Stated fact**, **Documented fact**, **Imported fact**, and **Derived estimate**. Family-size guidance is intentionally separate from RAP tax-return dependents, and the page warns against an arbitrary six-person cap. Current-income guidance calls out recent gross-pay evidence, pay frequency, source-by-source documentation, and signed explanatory statements when standard documentation is unavailable or incomplete.

V0.7 is planned as a guided application/evidence workflow that turns those facts into fast, editable supporting statements and checklists. Borrower accounts and secure saved profiles are planned after that. x402 is deliberately deferred until an account-linked signup-minted token/asset contract, anti-abuse model, wallet binding, and economic/legal boundaries are explicitly designed and accepted.

## MCP

Endpoint: `POST /mcp`

Supported JSON-RPC methods:

- `initialize`
- `notifications/initialized`
- `ping`
- `tools/list`
- `tools/call`

For the declared `2025-03-26` Streamable HTTP revision, POST requests should send both `Content-Type: application/json` and `Accept: application/json, text/event-stream`. `GET /mcp` intentionally returns `405` because this stateless server does not provide an SSE listening stream.

### Example tool call

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "calculate_alt_income_student_loan",
    "arguments": {
      "income": [
        { "cadence": "hourly", "hourlyRate": 28, "hoursPerWeek": 25, "weeksPerYear": 48 },
        { "cadence": "seasonal_lump_sum", "seasonalPayments": [3500, 4200] }
      ],
      "region": "contiguous_us",
      "familySize": 2,
      "taxFilingStatus": "single",
      "dependentsClaimedOnFederalTaxReturn": 1,
      "loan": {
        "principal": 42000,
        "annualInterestRatePercent": 5.5,
        "newBorrowerOnOrAfterJuly1_2014": true,
        "eligibilityLoans": [
          { "loanType": "direct_unsubsidized", "disbursementPeriod": "before_2026_07_01" }
        ]
      }
    }
  }
}
```

## Policy refresh workflow

The repository CI workflow also supports a scheduled/manual `policy-refresh` job. It fingerprints current official policy sources and uses a pull request for any changed source snapshot. It does **not** automatically rewrite repayment constants or eligibility rules; a human review is required before policy changes are merged.

## Development

```bash
npm install
npm run typecheck
npm test
npm run dev
```

Deploy with Wrangler:

```bash
npm run deploy
```

## Safety / scope

This is an estimator and document-template generator, not legal, tax, financial, or filing advice. It does not submit an IDR application and does not determine official eligibility. Borrowers should verify results with StudentAid.gov and their loan servicer.
