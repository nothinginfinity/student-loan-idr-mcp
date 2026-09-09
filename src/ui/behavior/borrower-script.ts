// V0.9.10B — borrower browser-behavior fragments. Concatenation order is load-bearing.
import { BORROWER_BOOT } from "./borrower-boot.ts";
import { BORROWER_CONSULTATION } from "./borrower-consultation.ts";
import { BORROWER_STUDENT_AID } from "./borrower-student-aid.ts";
import { BORROWER_CALCULATOR } from "./borrower-calculator.ts";
import { BORROWER_GUIDE_FACTS } from "./borrower-guide-facts.ts";
import { BORROWER_ADVISOR_CLIENT } from "./borrower-advisor-client.ts";
import { BORROWER_CHARTS } from "./borrower-charts.ts";
import { BORROWER_HISTORY } from "./borrower-history.ts";
import { BORROWER_DOCUMENTS_GUIDE } from "./borrower-documents-guide.ts";
import { BORROWER_COMPLETION_SCRIPT } from "./borrower-completion-script.ts";

export const BORROWER_SCRIPT = BORROWER_BOOT + BORROWER_CONSULTATION + BORROWER_STUDENT_AID + BORROWER_CALCULATOR + BORROWER_GUIDE_FACTS + BORROWER_ADVISOR_CLIENT + BORROWER_CHARTS + BORROWER_HISTORY + BORROWER_DOCUMENTS_GUIDE;
export { BORROWER_COMPLETION_SCRIPT };
