# Student Loan IDR MCP

A small Cloudflare Workers MCP server for people whose income is irregular, seasonal, hourly, freelance, contract-based, or otherwise difficult to express as a single annual number.

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

## MCP

Endpoint: `POST /mcp`

Supported JSON-RPC methods:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`

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
