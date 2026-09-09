export const BORROWER_CALCULATOR = String.raw`  function provenanceLabel(value) {
    return ({ imported_studentaid:"Imported from StudentAid", derived_studentaid:"Derived from StudentAid", advisor_entered:"Advisor entered", borrower_confirmed:"Borrower confirmed", missing_review:"Missing / needs review" })[value] || "Missing / needs review";
  }

  function renderPortfolio(portfolio) {
    portfolioSummary.replaceChildren();
    studentAidReview.replaceChildren();
    if (!portfolio.loans.length) return;
    const summary = document.createElement("div");
    summary.className = "summary";
    [["Active loans found", String(portfolio.summary?.activeLoanCount ?? portfolio.loans.length)], ["Outstanding principal", money.format(portfolio.totalPrincipal)], ["Outstanding interest", money.format(portfolio.totalInterest || 0)], ["Balance + rate rows", String(portfolio.repaymentLoans.length)], ["Eligibility mapped", String(portfolio.summary?.eligibilityMappedLoanCount ?? 0)], ["Post-7/1/2026 loan", portfolio.summary?.hasLoanDisbursedOnOrAfterJuly1_2026 ? "Yes" : "No"]].forEach(([label, value]) => {
      const metric = document.createElement("div");
      metric.className = "metric";
      metric.append(addText("span", label, "muted"), addText("strong", value));
      summary.appendChild(metric);
    });
    portfolioSummary.appendChild(summary);
    if (portfolio.ambiguousCount) portfolioSummary.appendChild(addText("p", String(portfolio.ambiguousCount) + " active loan record(s) have an ambiguous type/date for eligibility screening. Their balances can still be modeled when an interest rate is present, but this calculator will not guess consolidation/Parent PLUS history.", "muted"));
    if (portfolio.diagnostics) {
      const diagnostics = document.createElement("details");
      diagnostics.className = "readiness-card";
      const summaryNode = document.createElement("summary");
      const issueCount = (portfolio.diagnostics.unmappedLabels || []).length + (portfolio.diagnostics.structuralWarnings || []).length + (portfolio.diagnostics.validationIssues || []).length;
      summaryNode.textContent = "Parser diagnostics · " + portfolio.diagnostics.mappingVersion + (issueCount ? " · " + issueCount + " item(s) need review" : " · no structural issues detected");
      diagnostics.appendChild(summaryNode);
      const list = document.createElement("ul");
      list.appendChild(addText("li", "Recognized FSA labels: " + portfolio.diagnostics.recognizedLabelCount + " · parsed label/value rows: " + portfolio.diagnostics.parsedLineCount));
      if ((portfolio.diagnostics.unmappedLabels || []).length) list.appendChild(addText("li", "Unmapped FSA labels: " + portfolio.diagnostics.unmappedLabels.join(", ")));
      (portfolio.diagnostics.structuralWarnings || []).forEach((warning) => list.appendChild(addText("li", "Structural review: " + warning)));
      (portfolio.diagnostics.validationIssues || []).forEach((issue) => list.appendChild(addText("li", "Validation review: " + issue)));
      diagnostics.appendChild(list);
      portfolioSummary.appendChild(diagnostics);
    }

    const heading = document.createElement("div"); heading.className = "guide-head";
    const headingText = document.createElement("div"); headingText.append(addText("h3", "Imported StudentAid facts"), addText("p", "Review the normalized fields below. In advisor mode, only these normalized facts can be saved; the raw .txt file never leaves this browser.", "muted"));
    heading.appendChild(headingText); studentAidReview.appendChild(heading);
    const borrowerGrid = document.createElement("div"); borrowerGrid.className = "grid";
    const contactFields = [["displayName","Borrower name"],["email","Email"],["phone","Phone"],["streetAddress1","Street address 1"],["streetAddress2","Street address 2"],["city","City"],["stateCode","State / region"],["countryCode","Country"],["zipCode","ZIP / postal code"]];
    importedFieldProvenance = { ...(portfolio.borrower?.provenance || {}), ...importedFieldProvenance };
    contactFields.forEach(([field,label]) => {
      const wrapper = document.createElement("label");
      const title = document.createElement("span"); title.append(addText("span", provenanceLabel(importedFieldProvenance[field] || (portfolio.borrower?.[field] ? "imported_studentaid" : "missing_review")), "basis"), document.createTextNode(label));
      const input = document.createElement("input"); input.value = portfolio.borrower?.[field] || ""; input.dataset.importField = field; input.placeholder = "Not supplied by StudentAid";
      input.addEventListener("input", () => {
        importedFieldProvenance[field] = advisorClientId ? "advisor_entered" : "borrower_confirmed";
        if (portfolio.borrower) portfolio.borrower[field] = input.value;
        if (field === "displayName") setDocumentValue("borrowerName", input.value);
        title.querySelector(".basis").textContent = provenanceLabel(importedFieldProvenance[field]);
      });
      wrapper.append(title, input); borrowerGrid.appendChild(wrapper);
    });
    studentAidReview.appendChild(borrowerGrid);

    const loansHeading = addText("h3", "Individual loan facts"); loansHeading.style.marginTop = "18px"; studentAidReview.appendChild(loansHeading);
    portfolio.loans.forEach((loan, index) => {
      const details = document.createElement("details"); details.className = "readiness-card"; if (index === 0) details.open = true;
      const label = loan.loanTypeDescription || loan.mappedLoanType || loan.loanTypeCode || "Loan " + (index + 1);
      const header = document.createElement("summary"); header.textContent = label + " · " + (typeof loan.outstandingPrincipal === "number" ? money.format(loan.outstandingPrincipal) : "no outstanding principal"); details.appendChild(header);
      const list = document.createElement("ul");
      const skip = new Set(["loanIndex","statuses","disbursements","delinquencies","contacts","provenance"]);
      Object.entries(loan).forEach(([key,value]) => { if (skip.has(key) || value === undefined || value === null || value === "") return; const source = loan.provenance?.[key] || (["mappedLoanType","disbursementPeriod","inDefault"].includes(key) ? "derived_studentaid" : "imported_studentaid"); list.appendChild(addText("li", provenanceLabel(source) + " · " + key.replace(/([A-Z])/g," $1").replace(/^./,(c)=>c.toUpperCase()) + ": " + String(value))); });
      (loan.statuses || []).forEach((statusFact) => list.appendChild(addText("li", "Imported from StudentAid · Status: " + [statusFact.code,statusFact.description,statusFact.effectiveDate].filter(Boolean).join(" · "))));
      (loan.disbursements || []).forEach((disbursement) => list.appendChild(addText("li", "Imported from StudentAid · Disbursement: " + [disbursement.date, typeof disbursement.amount === "number" ? money.format(disbursement.amount) : ""].filter(Boolean).join(" · "))));
      (loan.delinquencies || []).forEach((delinquency) => list.appendChild(addText("li", "Imported from StudentAid · Delinquency: " + [delinquency.date, delinquency.endDate ? "ended " + delinquency.endDate : "end date not supplied"].filter(Boolean).join(" · "))));
      (loan.contacts || []).forEach((contact) => list.appendChild(addText("li", "Imported from StudentAid · Contact: " + [contact.type,contact.name,contact.phoneNumber,contact.emailAddress,contact.websiteAddress].filter(Boolean).join(" · "))));
      details.appendChild(list); studentAidReview.appendChild(details);
    });

    if (portfolio.borrower?.displayName) setDocumentValue("borrowerName", portfolio.borrower.displayName);
    if (portfolio.servicerName) setDocumentValue("servicerName", portfolio.servicerName);
    setCalculatorValue("principal", portfolio.totalPrincipal);
    if (portfolio.repaymentLoans.length === 1) setCalculatorValue("interestRate", portfolio.repaymentLoans[0].annualInterestRatePercent); else setCalculatorValue("interestRate", "");
    if (portfolio.eligibilityLoans?.length === 1) { setCalculatorValue("loanType", portfolio.eligibilityLoans[0].loanType); setCalculatorValue("disbursementPeriod", portfolio.eligibilityLoans[0].disbursementPeriod); } else setCalculatorValue("loanType", "");
  }

  function syncHourlyFields() {
    const hourly = cadence.value === "hourly";
    hoursField.hidden = !hourly;
    weeksField.hidden = !hourly;
  }

  function addText(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function render(result) {
    results.replaceChildren();
    results.appendChild(addText("h2", "Estimate"));

    const summary = document.createElement("div");
    summary.className = "summary";
    [
      ["Annualized taxable gross", money.format(result.normalizedAnnualTaxableGrossIncome)],
      ["Estimated AGI", money.format(result.estimatedAdjustedGrossIncome)],
      ["2026 poverty guideline", money.format(result.povertyGuideline)]
    ].forEach(([label, value]) => {
      const metric = document.createElement("div");
      metric.className = "metric";
      metric.append(addText("span", label, "muted"), addText("strong", value));
      summary.appendChild(metric);
    });
    results.appendChild(summary);

    const plans = document.createElement("div");
    plans.className = "plans";
    result.planEstimates.forEach((plan) => {
      const card = document.createElement("article");
      card.className = "plan";
      const head = document.createElement("div");
      head.className = "plan-head";
      const title = document.createElement("div");
      title.append(addText("strong", plan.plan), document.createTextNode(" "), addText("span", plan.eligibility.status, "badge"));
      head.append(title, addText("span", money.format(plan.monthlyPaymentEstimate) + "/mo", "payment"));
      card.append(head);
      card.appendChild(addText("p", plan.formulaSummary));
      card.appendChild(addText("p", plan.eligibilityNote, "muted"));
      if (plan.warnings.length) {
        const list = document.createElement("ul");
        plan.warnings.forEach((warning) => list.appendChild(addText("li", warning)));
        card.appendChild(list);
      }
      plans.appendChild(card);
    });
    results.appendChild(plans);

    const caveats = document.createElement("details");
    const summaryNode = addText("summary", "Assumptions and warnings");
    caveats.appendChild(summaryNode);
    const list = document.createElement("ul");
    [...result.assumptions, ...result.warnings].forEach((item) => list.appendChild(addText("li", item)));
    caveats.appendChild(list);
    results.appendChild(caveats);
  }

  const guidedFacts = new Map();
  let guideStep = "goal";
  let guideIncomeSituation = null;

`;
