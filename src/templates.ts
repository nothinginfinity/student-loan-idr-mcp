import type { TemplateRequest } from "./types.ts";

const money = (value: number | undefined): string => value === undefined ? "[gross amount]" : `$${value.toFixed(2)}`;
const field = (value: string | undefined, fallback: string): string => value?.trim() || fallback;

const header = (request: TemplateRequest, title: string): string => `# ${title}\n\nDate: [date]\n\nBorrower: ${field(request.borrowerName, "[borrower full name]")}\n\nLoan servicer: ${field(request.servicerName, "[loan servicer]")}\n`;

const certification = `\n## Certification\n\nI certify that the information in this statement is true and complete to the best of my knowledge. I understand that intentionally false statements may carry legal penalties.\n\nSignature: ______________________________\n\nDate: ______________________________\n`;

export function getDocumentationTemplate(request: TemplateRequest): string {
  const source = field(request.incomeSourceName, "[income source / employer / client]");
  const address = field(request.incomeSourceAddress, "[income source address]");
  const frequency = field(request.paymentFrequency, "[payment frequency]");
  const notes = field(request.notes, "[optional explanation]");

  switch (request.templateType) {
    case "current_income_statement":
      return `${header(request, "Current Taxable Income Supporting Statement")}\nI am providing this signed statement to explain a current source of taxable income for an income-driven repayment request.\n\n- Income source: ${source}\n- Source address: ${address}\n- Gross amount received: ${money(request.grossAmount)}\n- Frequency: ${frequency}\n- Additional explanation: ${notes}\n\nI will attach available supporting documentation dated within the required period when available. This statement is not a substitute for documentation when my servicer requires additional evidence.${certification}`;
    case "income_change_explanation":
      return `${header(request, "Significant Income Change Explanation")}\nMy current taxable income is materially different from the income reflected on my most recent federal tax return or transcript.\n\nCurrent income source: ${source}\nSource address: ${address}\nCurrent gross amount: ${money(request.grossAmount)}\nFrequency: ${frequency}\n\nExplanation of the change:\n${notes}\n\nI am providing current-income documentation consistent with my servicer's instructions.${certification}`;
    case "unemployment_income_statement":
      return `${header(request, "Unemployment Compensation Income Statement")}\nI currently receive unemployment compensation, which I am reporting as current taxable income for repayment-plan documentation.\n\n- Paying agency/source: ${source}\n- Source address: ${address}\n- Gross unemployment amount: ${money(request.grossAmount)}\n- Frequency: ${frequency}\n- Notes: ${notes}\n\nI will attach an available benefits statement, payment record, or other supporting documentation when required.${certification}`;
    case "no_current_taxable_income_statement":
      return `${header(request, "No Current Taxable Income Statement")}\nI currently receive no taxable income. This statement should not be used if I receive taxable unemployment compensation, employment income, tips, interest, dividends, alimony, or another taxable income source.\n\nExplanation of current circumstances:\n${notes}${certification}`;
  }
}
