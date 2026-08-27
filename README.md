# Student Loan IDR MCP

A small Cloudflare Workers MCP server for people whose income is irregular, seasonal, hourly, freelance, contract-based, or otherwise difficult to express as a single annual number.

The service exposes two MCP tools:

1. `calculate_alt_income_student_loan` — normalizes variable taxable income into an annual estimate and computes repayment-plan estimates for RAP, IBR, PAYE, and ICR.
2. `get_repayment_documentation_template` — generates clean Markdown supporting-statement templates for current income and income changes.

## Why this exists

Federal Student Aid permits current-income documentation in situations where tax-return information does not reflect a borrower's current income. The current IDR request form says documentation usually includes a pay stub or employer letter, and when documentation is unavailable or the borrower wants to explain income, a signed statement can be attached that identifies each income source and its address.

This project does **not** fabricate tax documents, deductions, or eligibility. It produces estimates and user-editable supporting-document templates.

## Policy snapshot

The deterministic constants are explicitly versioned to `2026-08-27`.

- 2026 HHS poverty guidelines are embedded for the contiguous U.S./D.C., Alaska, and Hawaii.
- RAP is included because it became available July 1, 2026.
- IBR, PAYE, and ICR are included for eligible pre-July-1-2026 loans, with eligibility warnings.
- PAYE and ICR are currently scheduled to end no later than July 1, 2028.
- SAVE is intentionally not modeled in this snapshot.

Official references:

- https://studentaid.gov/articles/faqs-idr-plan/
- https://studentaid.gov/sites/default/files/IncomeDrivenRepayment-en-us.pdf
- https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines

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
      "dependentsClaimedOnFederalTaxReturn": 1,
      "loan": {
        "principal": 42000,
        "annualInterestRatePercent": 5.5,
        "newBorrowerOnOrAfterJuly1_2014": true,
        "hasLoanDisbursedOnOrAfterJuly1_2026": false
      }
    }
  }
}
```

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
