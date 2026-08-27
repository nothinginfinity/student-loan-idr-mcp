# Policy Notes — Snapshot 2026-08-27

This file documents the assumptions behind the deterministic calculator. It is not a substitute for current Federal Student Aid guidance.

## Current-income documentation

The current Federal Student Aid IDR request form allows borrowers in specified circumstances to provide current-income documentation instead of relying on a federal tax return or transcript. The form says taxable income must be documented, documentation generally should be recent, pay stubs or employer letters are common examples, and a signed statement may be attached when documentation is unavailable or the borrower wants to explain income.

The template tool therefore produces supporting statements, not fake tax documents.

## 2026 HHS poverty guidelines

The 2026 tables used in `src/constants.ts` are:

| Household size | Contiguous U.S./D.C. | Alaska | Hawaii |
|---:|---:|---:|---:|
| 1 | 15,960 | 19,950 | 18,360 |
| 2 | 21,640 | 27,050 | 24,890 |
| 3 | 27,320 | 34,150 | 31,420 |
| 4 | 33,000 | 41,250 | 37,950 |
| 5 | 38,680 | 48,350 | 44,480 |
| 6 | 44,360 | 55,450 | 51,010 |
| 7 | 50,040 | 62,550 | 57,540 |
| 8 | 55,720 | 69,650 | 64,070 |

Additional person: +5,680 contiguous U.S./D.C.; +7,100 Alaska; +6,530 Hawaii.

## RAP

RAP is available beginning July 1, 2026 for eligible Direct Loans. The base annual payment uses AGI bands: $120 at AGI up to $10,000, then 1% through 9% in $10,000 AGI bands, and 10% above $100,000. The monthly amount is the annual base divided by 12, reduced by $50 per dependent claimed on the federal tax return, with a $10 monthly floor.

Current Federal Student Aid guidance excludes Parent PLUS loans and Direct Consolidation Loans that paid off Parent PLUS debt from RAP.

## IBR / PAYE

The calculator uses 150% of the applicable poverty guideline for discretionary income. PAYE uses 10%. IBR uses 10% for the modeled post-July-1-2014 new-borrower case and 15% otherwise. When principal and interest rate are supplied, the calculator also models the 10-year Standard payment cap.

V0.2 adds explicit loan-type/disbursement eligibility assessments. PAYE also accepts the published Oct. 1, 2007 new-borrower and Oct. 1, 2011 Direct Loan disbursement conditions. Missing borrower-specific facts are surfaced as `conditional` or `unknown` rather than guessed.

## ICR

ICR is the lesser of the 20%-of-discretionary-income arm and a 12-year fixed payment adjusted by an official income-percentage factor.

The Department of Education's 2026 ICR notice (Federal Register document 2026-11540) applies from July 1, 2026 through June 30, 2027. V0.2 embeds both published factor columns:

- Single
- Married/Head of Household

If AGI falls between published rows, the factor is calculated by linear interpolation and rounded to the nearest hundredth of a percentage point, matching the notice's worked interpolation method. Callers therefore do not need to supply the factor. They provide `taxFilingStatus` or `loan.icrIncomeFactorCategory`; an explicit `loan.icrIncomePercentageFactor` is retained only as an override.

Regression fixtures include the notice's Kesha example ($15,000 at 6%, single AGI $35,104 → $105.23/month) and Santiago example ($60,000 at 6%, single AGI $41,769 → $430.15/month), plus the $50,000 AGI interpolation example (86.83%).

## Eligibility changes after July 1, 2026

Loan type and disbursement date matter. V0.2 represents these facts as `loan.eligibilityLoans[]` and returns a structured `eligibility` object on every plan estimate.

The current Federal Student Aid matrix distinguishes Direct, FFEL, Parent PLUS-related consolidation, and Perkins categories and states that defaulted loans are not eligible for IDR until the default is resolved through an eligible path. Mixed portfolios can produce a `mixed` result rather than a single blanket answer.

PAYE and ICR are scheduled to end no later than July 1, 2028.

## Policy refresh

The GitHub Actions workflow includes scheduled and manual policy-refresh runs. It fingerprints the official source URLs into `docs/POLICY_SOURCE_SNAPSHOT.json` and opens a review pull request when the fingerprints change. It never rewrites `src/constants.ts` or eligibility logic automatically.

Official policy sources used by this snapshot:

- https://studentaid.gov/articles/faqs-idr-plan/
- https://studentaid.gov/sites/default/files/IncomeDrivenRepayment-en-us.pdf
- https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines
- https://www.govinfo.gov/content/pkg/FR-2026-06-09/pdf/2026-11540.pdf
