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

## IBR / PAYE

The calculator uses 150% of the applicable poverty guideline for discretionary income. PAYE uses 10%. IBR uses 10% for the modeled post-July-1-2014 new-borrower case and 15% otherwise. When principal and interest rate are supplied, the calculator also models the 10-year Standard payment cap.

## ICR

ICR is the lesser of the 20%-of-discretionary-income arm and a 12-year fixed payment adjusted by an official income-percentage factor. Because the factor is table-driven and time-sensitive, V0.1 requires the caller to supply it before claiming a fuller ICR estimate. Without it, the calculator labels ICR as partial.

## Eligibility changes after July 1, 2026

Loan type and disbursement date matter. RAP is the relevant IDR plan for new post-July-1-2026 Direct Loan borrowing, while legacy IBR/PAYE/ICR eligibility is tied to older eligible loans. PAYE and ICR are scheduled to end no later than July 1, 2028.
