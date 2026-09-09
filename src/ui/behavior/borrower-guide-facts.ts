export const BORROWER_GUIDE_FACTS = String.raw`  function guideSay(text, role = "guide") {
    const node = addText("div", text, "message " + role);
    guideTranscript.appendChild(node);
    guideTranscript.scrollTop = guideTranscript.scrollHeight;
  }

  function recordGuidedFact(key, label, value, basis = "Stated fact") {
    guidedFacts.set(key, { label, value, basis });
    guidedFactsList.replaceChildren();
    guidedFacts.forEach((fact) => {
      const item = document.createElement("li");
      const tag = addText("span", fact.basis, "basis");
      item.append(tag, document.createTextNode(fact.label + ": " + fact.value));
      guidedFactsList.appendChild(item);
    });
  }

  function setCalculatorValue(name, value) {
    const control = form.elements.namedItem(name);
    if (control && "value" in control) control.value = String(value);
  }

  function setDocumentValue(name, value) {
    const control = documentForm.elements.namedItem(name);
    if (control && "value" in control) control.value = String(value);
  }

  function documentSourceType() {
    if (guideIncomeSituation === "unemployment") return "unemployment";
    if (guideIncomeSituation === "self_employment") return "self_employment";
    if (guideIncomeSituation === "employment") return "employment";
    return "other";
  }

  function sourceTypeLabel(value) {
    const labels = {
      employment: "Employment",
      self_employment: "Self-employment",
      contract: "Contract / gig income",
      unemployment: "Unemployment compensation",
      other: "Other taxable income"
    };
    return labels[value] || "Other taxable income";
  }

  function evidenceStatusLabel(value) {
    if (value === "documented") return "Evidence in hand (borrower-stated)";
    if (value === "identified") return "Evidence identified (borrower-stated)";
    return "Needs evidence / review";
  }

  function sourceEvidenceGuidance(sourceType) {
    if (sourceType === "employment") return "Recent pay stub(s) or an employer statement showing gross pay and pay frequency.";
    if (sourceType === "self_employment" || sourceType === "contract") return "Recent client/business payment records, invoices paired with payment evidence, or a payer statement that reflects current taxable income.";
    if (sourceType === "unemployment") return "Recent unemployment-benefits statement or payment history.";
    return "A recent payer/source record showing the current taxable amount and payment frequency, or another item requested by the servicer.";
  }

  function sourceDocumentReady(source) {
    return Boolean(source && source.sourceType && typeof source.grossAmount === "number" && source.paymentFrequency);
  }

  function sourceApplicationReady(source) {
    return sourceDocumentReady(source) && Boolean(source.name) && ["documented", "identified"].includes(source.evidenceStatus);
  }

  function savedEvidenceToGuide(value) {
    if (value === "evidence_in_hand") return "documented";
    if (value === "evidence_identified") return "identified";
    return "missing";
  }

  function guideEvidenceToSaved(value) {
    if (value === "documented") return "evidence_in_hand";
    if (value === "identified") return "evidence_identified";
    return "needs_evidence_review";
  }

`;
