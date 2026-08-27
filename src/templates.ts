import type { DocumentationIncomeSource, DocumentationOutputFormat, TemplateRequest } from "./types.ts";

const money = (value: number | undefined): string => value === undefined ? "[gross amount]" : `$${value.toFixed(2)}`;
const field = (value: string | undefined, fallback: string): string => value?.trim() || fallback;
const sourceType = (value: DocumentationIncomeSource["sourceType"]): string => value?.split("_").join(" ") || "[income source type]";

const header = (request: TemplateRequest, title: string): string => `# ${title}\n\nDate: ${field(request.documentDate, "[date]")}\n\nBorrower: ${field(request.borrowerName, "[borrower full name]")}\n\nLoan servicer: ${field(request.servicerName, "[loan servicer]")}\n`;

const certification = `\n## Certification\n\nI certify that the information in this statement is true and complete to the best of my knowledge. I understand that intentionally false statements may carry legal penalties.\n\nSignature: ______________________________\n\nDate: ______________________________\n`;

const evidenceChecklist = `## Supporting evidence checklist\n\n- [ ] Review the loan servicer's current instructions for the exact documentation it requests.\n- [ ] Recent pay stub(s) or an employer statement, if applicable.\n- [ ] Recent client, contract, or business payment records that show current taxable income, if applicable.\n- [ ] Unemployment benefits statement or payment history, if applicable.\n- [ ] Other current-income records requested by the servicer, if applicable.\n\nThese are common examples only. A servicer may request different or additional evidence, and no single item guarantees acceptance.\n`;

function hasLegacyIncomeSourceData(request: TemplateRequest): boolean {
  return [request.incomeSourceName, request.incomeSourceAddress, request.paymentFrequency].some((value) => Boolean(value?.trim())) || request.grossAmount !== undefined;
}

function normalizedIncomeSources(request: TemplateRequest): DocumentationIncomeSource[] {
  if (request.templateType === "no_current_taxable_income_statement") {
    if ((request.incomeSources?.length ?? 0) > 0 || hasLegacyIncomeSourceData(request)) {
      throw new Error("no_current_taxable_income_statement cannot include current income sources.");
    }
    return [];
  }

  if (request.incomeSources?.length) return request.incomeSources;

  return [{
    sourceType: request.templateType === "unemployment_income_statement" ? "unemployment" : undefined,
    name: request.incomeSourceName,
    address: request.incomeSourceAddress,
    grossAmount: request.grossAmount,
    paymentFrequency: request.paymentFrequency
  }];
}

function incomeSourcesMarkdown(request: TemplateRequest): string {
  return normalizedIncomeSources(request).map((source, index, all) => {
    const heading = all.length === 1 ? "### Income source" : `### Income source ${index + 1}`;
    return `${heading}\n\n- Type: ${sourceType(source.sourceType)}\n- Name / payer: ${field(source.name, "[income source / employer / client]")}\n- Address: ${field(source.address, "[income source address]")}\n- Gross amount received: ${money(source.grossAmount)}\n- Payment frequency: ${field(source.paymentFrequency, "[payment frequency]")}\n- Source notes: ${field(source.notes, "[source notes]")}`;
  }).join("\n\n");
}

function markdownDocument(request: TemplateRequest): string {
  const notes = field(request.notes, "[optional explanation]");
  const sources = incomeSourcesMarkdown(request);

  switch (request.templateType) {
    case "current_income_statement":
      return `${header(request, "Current Taxable Income Supporting Statement")}\nI am providing this signed statement to explain my current sources of taxable income for an income-driven repayment request.\n\n${sources}\n\nAdditional explanation:\n${notes}\n\n${evidenceChecklist}${certification}`;
    case "income_change_explanation":
      return `${header(request, "Significant Income Change Explanation")}\nMy current taxable income is materially different from the income reflected on my most recent federal tax return or transcript.\n\n${sources}\n\nExplanation of the change:\n${notes}\n\n${evidenceChecklist}${certification}`;
    case "unemployment_income_statement":
      return `${header(request, "Unemployment Compensation Income Statement")}\nI currently receive unemployment compensation, which I am reporting as current taxable income for repayment-plan documentation.\n\n${sources}\n\nAdditional explanation:\n${notes}\n\n${evidenceChecklist}${certification}`;
    case "no_current_taxable_income_statement":
      return `${header(request, "No Current Taxable Income Statement")}\nI currently receive no taxable income. This statement should not be used if I receive taxable unemployment compensation, employment income, tips, interest, dividends, alimony, or another taxable income source.\n\nExplanation of current circumstances:\n${notes}\n\n${evidenceChecklist}${certification}`;
  }
}

function markdownToPlainText(markdown: string): string {
  return markdown.split("\n").map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^- \[ \] /, "[ ] ")).join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markdownToPrintableHtml(markdown: string): string {
  const body: string[] = [];
  let listOpen = false;
  const closeList = (): void => {
    if (listOpen) {
      body.push("</ul>");
      listOpen = false;
    }
  };

  for (const line of markdown.split("\n")) {
    if (line.startsWith("- [ ] ") || line.startsWith("- ")) {
      if (!listOpen) {
        body.push("<ul>");
        listOpen = true;
      }
      const item = line.startsWith("- [ ] ") ? `[ ] ${line.slice(6)}` : line.slice(2);
      body.push(`<li>${escapeHtml(item)}</li>`);
      continue;
    }

    closeList();
    if (!line) continue;
    if (line.startsWith("### ")) body.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    else if (line.startsWith("## ")) body.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    else if (line.startsWith("# ")) body.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    else body.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();

  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="referrer" content="no-referrer">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Student Loan Repayment Supporting Statement</title>\n<style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:760px;margin:0 auto;padding:32px;color:#111;line-height:1.5}h1,h2,h3{line-height:1.2}ul{padding-left:24px}@media print{body{max-width:none;margin:0;padding:0}a{color:inherit}}</style>\n</head>\n<body>\n${body.join("\n")}\n</body>\n</html>`;
}

export function getDocumentationTemplate(request: TemplateRequest): string {
  const markdown = markdownDocument(request);
  const outputFormat: DocumentationOutputFormat = request.outputFormat ?? "markdown";
  if (outputFormat === "text") return markdownToPlainText(markdown);
  if (outputFormat === "html") return markdownToPrintableHtml(markdown);
  return markdown;
}
