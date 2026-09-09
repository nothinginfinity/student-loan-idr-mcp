export const BORROWER_DOCUMENTS_GUIDE = String.raw`  function refreshDocumentScopeOptions() {
    const previous = documentScope.value;
    documentScope.replaceChildren();
    const combined = document.createElement("option");
    combined.value = "combined";
    combined.textContent = "Combined confirmed income sources";
    documentScope.appendChild(combined);
    guidedIncomeSources.forEach((source, index) => {
      const option = document.createElement("option");
      option.value = "source:" + index;
      option.textContent = "Source " + (index + 1) + " — " + sourceTypeLabel(source.sourceType) + (source.name ? " — " + source.name : "");
      documentScope.appendChild(option);
    });
    const values = Array.from(documentScope.options).map((option) => option.value);
    documentScope.value = values.includes(previous) ? previous : "combined";
  }

  function renderIncomeReadiness() {
    incomeSourceReadiness.replaceChildren();
    if (!guidedIncomeSources.length) {
      readinessSummary.textContent = guideIncomeSituation === "none"
        ? "No current taxable income was stated. A no-current-taxable-income draft can be prepared, but the borrower should still review current servicer instructions before submission."
        : "No current income sources confirmed yet.";
      refreshDocumentScopeOptions();
      return;
    }

    let documentReadyCount = 0;
    let applicationReadyCount = 0;
    guidedIncomeSources.forEach((source, index) => {
      const documentReady = sourceDocumentReady(source);
      const applicationReady = sourceApplicationReady(source);
      if (documentReady) documentReadyCount += 1;
      if (applicationReady) applicationReadyCount += 1;

      const card = document.createElement("div");
      card.className = "readiness-card";
      const head = document.createElement("div");
      head.className = "readiness-head";
      const title = addText("strong", "Source " + (index + 1) + " — " + sourceTypeLabel(source.sourceType));
      const state = addText("span", applicationReady ? "Application-ready" : documentReady ? "Document-ready" : "Needs review", "badge");
      head.append(title, state);
      card.appendChild(head);
      card.appendChild(addText("p", (source.name || "[payer / source name still missing]") + " · " + money.format(source.grossAmount) + " · " + source.paymentFrequency, "muted"));

      const checklist = document.createElement("ul");
      const checks = [
        [Boolean(source.sourceType), "Income source type confirmed"],
        [typeof source.grossAmount === "number" && Boolean(source.paymentFrequency), "Gross taxable amount and payment frequency confirmed"],
        [Boolean(source.name), "Payer / source name confirmed"],
        [["documented", "identified"].includes(source.evidenceStatus), evidenceStatusLabel(source.evidenceStatus)]
      ];
      checks.forEach(([ok, label]) => checklist.appendChild(addText("li", (ok ? "✓ " : "□ ") + label)));
      card.appendChild(checklist);
      card.appendChild(addText("p", "Typical evidence for this source: " + sourceEvidenceGuidance(source.sourceType), "muted"));
      incomeSourceReadiness.appendChild(card);
    });

    if (applicationReadyCount === guidedIncomeSources.length) {
      readinessSummary.textContent = "Application-ready: every confirmed source has core facts, a payer/source name, and evidence that the borrower says is in hand or identified. Final servicer review is still required.";
    } else if (documentReadyCount === guidedIncomeSources.length) {
      readinessSummary.textContent = "Document-ready: every confirmed source has enough core facts for a draft, but one or more sources still need a payer/source name, evidence, or review before this session should be treated as application-ready.";
    } else {
      readinessSummary.textContent = "Needs review: one or more income sources are missing core amount/frequency facts needed for a source-specific draft.";
    }
    refreshDocumentScopeOptions();
  }

  function documentIncomeSources() {
    const sources = guidedIncomeSources.map((source) => ({
      sourceType: source.sourceType,
      ...(source.name ? { name: source.name } : {}),
      ...(source.address ? { address: source.address } : {}),
      ...(typeof source.grossAmount === "number" ? { grossAmount: source.grossAmount } : {}),
      ...(source.paymentFrequency ? { paymentFrequency: source.paymentFrequency } : {})
    }));

    const sourceNameControl = documentForm.elements.namedItem("sourceName");
    const sourceAddressControl = documentForm.elements.namedItem("sourceAddress");
    const grossAmountControl = documentForm.elements.namedItem("grossAmount");
    const paymentFrequencyControl = documentForm.elements.namedItem("paymentFrequency");
    const sourceName = sourceNameControl && "value" in sourceNameControl ? String(sourceNameControl.value).trim() : "";
    const sourceAddress = sourceAddressControl && "value" in sourceAddressControl ? String(sourceAddressControl.value).trim() : "";
    const grossAmount = grossAmountControl && "value" in grossAmountControl ? numberOrUndefined(String(grossAmountControl.value)) : undefined;
    const paymentFrequency = paymentFrequencyControl && "value" in paymentFrequencyControl ? String(paymentFrequencyControl.value).trim() : "";

    if (sources.length) {
      if (sourceName) sources[0].name = sourceName;
      if (sourceAddress) sources[0].address = sourceAddress;
      if (grossAmount !== undefined) sources[0].grossAmount = grossAmount;
      if (paymentFrequency) sources[0].paymentFrequency = paymentFrequency;
      return sources;
    }

    const source = { sourceType: documentSourceType() };
    if (sourceName) source.name = sourceName;
    if (sourceAddress) source.address = sourceAddress;
    if (grossAmount !== undefined) source.grossAmount = grossAmount;
    if (paymentFrequency) source.paymentFrequency = paymentFrequency;
    return [source];
  }

  function documentRequest(outputFormat) {
    const allSources = documentIncomeSources();
    const scope = documentScope.value;
    const sourceIndex = scope.startsWith("source:") ? Number(scope.slice(7)) : -1;
    const selectedSources = sourceIndex >= 0 && allSources[sourceIndex] ? [allSources[sourceIndex]] : allSources;
    let templateType = guideDocumentGoal || "current_income_statement";
    if (templateType === "auto") templateType = "current_income_statement";
    if (templateType !== "no_current_taxable_income_statement") {
      templateType = selectedSources.length === 1 && selectedSources[0]?.sourceType === "unemployment"
        ? "unemployment_income_statement"
        : "current_income_statement";
    }
    const payload = { templateType, outputFormat };
    for (const name of ["documentDate", "borrowerName", "servicerName", "notes"]) {
      const control = documentForm.elements.namedItem(name);
      const value = control && "value" in control ? String(control.value).trim() : "";
      if (value) payload[name] = value;
    }
    if (templateType !== "no_current_taxable_income_statement") payload.incomeSources = selectedSources;
    return payload;
  }

  async function requestDocument(outputFormat) {
    const response = await fetch("/api/document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(documentRequest(outputFormat))
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Unable to generate document draft.");
    return body.document;
  }

  function syncDocumentActions() {
    const enabled = Boolean(documentDraft) && documentReviewed.checked;
    documentPrint.disabled = !enabled;
    documentDownload.disabled = !enabled;
    advisorRetainDocument.hidden = !advisorClient;
    advisorRetainDocument.disabled = !enabled || !advisorClient;
  }

  async function generateDocumentDraft() {
    documentGenerate.disabled = true;
    documentStatus.textContent = "Generating draft…";
    documentDraft = null;
    documentReviewed.checked = false;
    syncDocumentActions();
    try {
      let text, html;
      if (advisorClient) {
        const generated = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/documents/generate", { method:"POST", body:JSON.stringify({ templateRequest:documentRequest("text") }) });
        text = generated.document.documentText;
        html = generated.document.documentHtml;
        void loadAdvisorHistory();
      } else {
        [text, html] = await Promise.all([requestDocument("text"), requestDocument("html")]);
      }
      documentDraft = { text, html };
      documentPreview.textContent = text;
      documentDraftArea.hidden = false;
      documentStatus.textContent = "Draft ready. Review every fact before signing or sharing it.";
    } catch (error) {
      documentDraftArea.hidden = true;
      documentStatus.textContent = error instanceof Error ? error.message : "Unable to generate document draft.";
    } finally {
      documentGenerate.disabled = false;
      syncDocumentActions();
    }
  }

  function openGuidedDocumentWorkspace() {
    const primarySource = guidedIncomeSources[0];
    if (primarySource) {
      if (primarySource.name) setDocumentValue("sourceName", primarySource.name);
      if (primarySource.address) setDocumentValue("sourceAddress", primarySource.address);
      if (typeof primarySource.grossAmount === "number") setDocumentValue("grossAmount", primarySource.grossAmount);
      if (primarySource.paymentFrequency) setDocumentValue("paymentFrequency", primarySource.paymentFrequency);
    } else {
      if (guideIncomeAmount !== null && guideIncomeAmount !== undefined) setDocumentValue("grossAmount", guideIncomeAmount);
      if (guideIncomeCadence) setDocumentValue("paymentFrequency", guideIncomeCadence);
    }
    renderIncomeReadiness();
    documentWorkspace.hidden = false;
    documentWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
    void generateDocumentDraft();
  }

  function documentFilename() {
    if (guideDocumentGoal === "unemployment_income_statement") return "unemployment-compensation-income-statement.html";
    if (guideDocumentGoal === "no_current_taxable_income_statement") return "no-current-taxable-income-statement.html";
    return "current-taxable-income-supporting-statement.html";
  }

  const guidePrompts = {
    goal: {
      text: "What would you like help with first?",
      options: [["Could my IBR payment be $0?", "ibr_zero"], ["Estimate my payment", "estimate"], ["Prepare income documents", "documents"], ["Both", "both"]]
    },
    ibr_zero_region: {
      text: "Which poverty-guideline region applies to you? I’ll show the 2026 IBR $0-payment AGI line for family sizes 1–6.",
      options: [["48 states + D.C.", "contiguous_us"], ["Alaska", "alaska"], ["Hawaii", "hawaii"]]
    },
    ibr_zero_followup: {
      text: "Want help preparing the income documentation next?",
      options: [["Prepare stated income document", "current_income_doc"], ["Prepare unemployment statement", "unemployment_doc"], ["Continue to calculator", "calculator"]]
    },
    income_situation: {
      text: "Which best describes your current taxable income situation?",
      options: [["Employment", "employment"], ["Self-employed / contract", "self_employment"], ["Unemployment compensation", "unemployment"], ["Multiple taxable sources", "multiple"], ["No current taxable income", "none"]]
    },
    income_source_type: {
      text: "What type of taxable income source is this? I’ll keep each source separate instead of collapsing them together.",
      options: [["Employment", "employment"], ["Self-employment", "self_employment"], ["Contract / gig income", "contract"], ["Unemployment compensation", "unemployment"], ["Other taxable income", "other"]]
    },
    income_cadence: {
      text: "How often is the income amount for this source paid or received?",
      options: [["Annual", "annual"], ["Monthly", "monthly"], ["Twice monthly", "semimonthly"], ["Every two weeks", "biweekly"], ["Weekly", "weekly"], ["Hourly", "hourly"]]
    },
    income_amount: { text: "What is the gross taxable income amount for this source at that cadence? Type a number, without an SSN or account number.", options: [] },
    source_name: { text: "What payer, employer, agency, client, or source name belongs to this income source? You can leave it as a visible placeholder for the draft, but it will not be application-ready until the source is identified.", options: [["Leave as placeholder", "__skip__"]] },
    source_evidence: { text: "What is the evidence status for this source? This is only your statement about readiness; no evidence file is uploaded or verified here.", options: [["I have recent evidence in hand", "documented"], ["I know what evidence I’ll use", "identified"], ["I still need evidence / review", "missing"]] },
    another_source: { text: "Do you have another current taxable income source to add?", options: [["Yes — add another source", "yes"], ["No — continue", "no"]] },
    doc_borrower_name: { text: "What borrower name should appear on the statement? You can leave it as a visible placeholder and fill it in later.", options: [["Leave as placeholder", "__skip__"]] },
    doc_source_name: { text: "What payer, employer, or unemployment agency name should appear? You can leave it as a visible placeholder.", options: [["Leave as placeholder", "__skip__"]] },
    doc_servicer_name: { text: "What loan servicer name should appear? You can leave it as a visible placeholder and fill it in later.", options: [["Leave as placeholder", "__skip__"]] },
    family_size: { text: "What is your current legacy IDR family size under the support-based definition? You can tap 1–6 or type any valid whole number; there is no six-person cap.", options: [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]] },
    dependents: { text: "How many dependents do you claim on your federal tax return for the RAP dependent reduction? This is intentionally separate from legacy IDR family size.", options: [["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]] },
    region: { text: "Which poverty-guideline region applies to you?", options: [["48 states + D.C.", "contiguous_us"], ["Alaska", "alaska"], ["Hawaii", "hawaii"]] }
  };

  function showGuideStep() {
    guideAnswers.replaceChildren();
    const prompt = guidePrompts[guideStep];
    if (!prompt) return;
    guideSay(prompt.text);
    prompt.options.forEach(([label, value]) => {
      const button = addText("button", label);
      button.type = "button";
      button.addEventListener("click", () => handleGuideAnswer(value, label));
      guideAnswers.appendChild(button);
    });
    guideInput.placeholder = prompt.options.length ? "Or type one of these answers" : "Type your answer";
    guideInput.focus();
  }

  function normalizedChoice(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function resolveTypedChoice(step, rawValue) {
    const normalized = normalizedChoice(rawValue);
    const aliases = {
      goal: { ibr_zero: "ibr_zero", could_my_ibr_payment_be_0: "ibr_zero", zero_payment: "ibr_zero", estimate: "estimate", estimate_my_payment: "estimate", payment: "estimate", documents: "documents", prepare_income_documents: "documents", document: "documents", both: "both" },
      ibr_zero_region: { contiguous_us: "contiguous_us", us: "contiguous_us", mainland: "contiguous_us", _48_states_dc: "contiguous_us", alaska: "alaska", hawaii: "hawaii" },
      ibr_zero_followup: { current_income_doc: "current_income_doc", stated_income: "current_income_doc", prepare_stated_income_document: "current_income_doc", unemployment_doc: "unemployment_doc", unemployment_statement: "unemployment_doc", prepare_unemployment_statement: "unemployment_doc", calculator: "calculator", continue_to_calculator: "calculator" },
      income_situation: { employment: "employment", employed: "employment", job: "employment", self_employed: "self_employment", self_employment: "self_employment", contract: "self_employment", contractor: "self_employment", unemployment: "unemployment", unemployment_compensation: "unemployment", multiple: "multiple", multiple_taxable_sources: "multiple", none: "none", no_income: "none", no_current_taxable_income: "none" },
      income_source_type: { employment: "employment", employed: "employment", self_employment: "self_employment", self_employed: "self_employment", contract: "contract", contractor: "contract", gig: "contract", unemployment: "unemployment", unemployment_compensation: "unemployment", other: "other", other_taxable_income: "other" },
      source_evidence: { documented: "documented", evidence_in_hand: "documented", identified: "identified", evidence_identified: "identified", missing: "missing", need_evidence: "missing", needs_review: "missing" },
      another_source: { yes: "yes", add_another_source: "yes", no: "no", continue: "no" },
      income_cadence: { annual: "annual", annually: "annual", yearly: "annual", monthly: "monthly", semimonthly: "semimonthly", twice_monthly: "semimonthly", biweekly: "biweekly", every_two_weeks: "biweekly", weekly: "weekly", hourly: "hourly" },
      region: { contiguous_us: "contiguous_us", us: "contiguous_us", mainland: "contiguous_us", _48_states_dc: "contiguous_us", alaska: "alaska", hawaii: "hawaii" }
    };
    return aliases[step] ? aliases[step][normalized] : rawValue;
  }

  async function showIbrZeroInfo(region) {
    guideAnswers.replaceChildren();
    guideInput.disabled = true;
    try {
      const response = await fetch("/api/ibr-zero-payment?region=" + encodeURIComponent(region));
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Unable to load IBR quick info.");
      guideSay("For IBR, the estimated payment is $0 when the AGI used for the calculation is at or below 150% of the poverty guideline. Here are the 2026 cutoffs for " + body.regionLabel + ".");
      const table = document.createElement("table");
      table.className = "quick-info";
      const headerRow = document.createElement("tr");
      ["Family size", "$0 IBR AGI cutoff"].forEach((text) => headerRow.appendChild(addText("th", text)));
      const head = document.createElement("thead");
      head.appendChild(headerRow);
      table.appendChild(head);
      const tableBody = document.createElement("tbody");
      body.thresholds.forEach((row) => {
        const tr = document.createElement("tr");
        tr.append(addText("td", String(row.familySize)), addText("td", money.format(row.maxAgiForZeroPayment)));
        tableBody.appendChild(tr);
      });
      table.appendChild(tableBody);
      guideTranscript.appendChild(table);
      if (region === "contiguous_us") {
        const example = addText("div", "$60,000 example: with family size 6, $60,000 is below the 2026 $66,540 IBR $0-payment AGI cutoff, so the formula estimates a $0 monthly IBR payment if the borrower and loans are otherwise IBR-eligible.", "quick-callout");
        guideTranscript.appendChild(example);
      }
      guideSay("Important: these are AGI thresholds, not automatic eligibility guarantees. Loan type/date rules still matter, spouse income can matter depending on the borrower’s situation, annual recertification still applies, and interest may still accrue.");
      guideTranscript.scrollTop = guideTranscript.scrollHeight;
      guideStep = "ibr_zero_followup";
    } catch (error) {
      guideSay(error instanceof Error ? error.message : "Unable to load IBR quick info.");
      guideStep = "goal";
    } finally {
      guideInput.disabled = false;
      showGuideStep();
    }
  }

  function finalizePendingIncomeSource(evidenceStatus) {
    if (!pendingIncomeSource) return;
    pendingIncomeSource.evidenceStatus = evidenceStatus;
    const source = { ...pendingIncomeSource };
    guidedIncomeSources.push(source);
    const sourceNumber = guidedIncomeSources.length;
    const evidenceLabel = evidenceStatusLabel(evidenceStatus);
    recordGuidedFact(
      "income_source_" + sourceNumber,
      "Taxable income source " + sourceNumber,
      sourceTypeLabel(source.sourceType) + " · " + money.format(source.grossAmount) + " · " + source.paymentFrequency + " · " + evidenceLabel
    );
    if (sourceNumber === 1) {
      guideIncomeCadence = source.paymentFrequency;
      guideIncomeAmount = source.grossAmount;
      cadence.value = source.paymentFrequency;
      setCalculatorValue("incomeAmount", source.grossAmount);
      syncHourlyFields();
    }
    pendingIncomeSource = null;
    renderIncomeReadiness();
  }

  function handleGuideAnswer(rawValue, displayValue) {
    const value = resolveTypedChoice(guideStep, rawValue);
    const shown = displayValue || String(rawValue).trim();
    if (!shown) return;

    if (guideStep === "income_amount") {
      const amount = numericValue(shown);
      if (amount === undefined || amount < 0) {
        guideSay("Please enter a valid non-negative gross income amount.");
        return;
      }
      guideSay(shown, "user");
      if (!pendingIncomeSource) pendingIncomeSource = { sourceType: documentSourceType() };
      pendingIncomeSource.grossAmount = amount;
      pendingIncomeSource.paymentFrequency = guideIncomeCadence;
      guideStep = "source_name";
    } else if (guideStep === "source_name") {
      guideSay(shown, "user");
      if (!pendingIncomeSource) pendingIncomeSource = { sourceType: documentSourceType(), paymentFrequency: guideIncomeCadence, grossAmount: guideIncomeAmount };
      if (value !== "__skip__") pendingIncomeSource.name = shown;
      guideStep = "source_evidence";
    } else if (guideStep === "source_evidence") {
      if (!["documented", "identified", "missing"].includes(value)) {
        guideSay("Choose evidence in hand, evidence identified, or needs evidence / review.");
        return;
      }
      guideSay(shown, "user");
      finalizePendingIncomeSource(value);
      guideStep = collectMultipleSources ? "another_source" : guideDocumentGoal ? "doc_borrower_name" : "family_size";
    } else if (guideStep === "another_source") {
      if (!["yes", "no"].includes(value)) {
        guideSay("Choose whether to add another current taxable income source.");
        return;
      }
      guideSay(shown, "user");
      if (value === "yes") {
        pendingIncomeSource = null;
        guideStep = "income_source_type";
      } else {
        collectMultipleSources = false;
        guideStep = guideDocumentGoal ? "doc_borrower_name" : "family_size";
      }
    } else if (guideStep === "income_source_type") {
      if (!["employment", "self_employment", "contract", "unemployment", "other"].includes(value)) {
        guideSay("Choose employment, self-employment, contract/gig income, unemployment compensation, or other taxable income.");
        return;
      }
      guideSay(shown, "user");
      pendingIncomeSource = { sourceType: value };
      guideIncomeSituation = value;
      guideStep = "income_cadence";
    } else if (guideStep === "family_size" || guideStep === "dependents") {
      const count = Number(value);
      const minimum = guideStep === "family_size" ? 1 : 0;
      if (!Number.isInteger(count) || count < minimum) {
        guideSay("Please enter a valid whole number" + (minimum ? " of at least 1." : " of 0 or more."));
        return;
      }
      guideSay(shown, "user");
      if (guideStep === "family_size") {
        setCalculatorValue("familySize", count);
        recordGuidedFact("family_size", "Legacy IDR family size", String(count));
        guideStep = "dependents";
      } else {
        setCalculatorValue("dependents", count);
        recordGuidedFact("dependents", "Federal tax-return dependents for RAP", String(count));
        guideStep = "region";
      }
    } else if (guideStep === "goal") {
      if (!["ibr_zero", "estimate", "documents", "both"].includes(value)) {
        guideSay("Choose the IBR $0 quick check, estimate, documents, or both.");
        return;
      }
      guideSay(shown, "user");
      if (value === "ibr_zero") {
        recordGuidedFact("goal", "Requested help", "IBR $0-payment quick check");
        guideStep = "ibr_zero_region";
      } else {
        recordGuidedFact("goal", "Requested help", value === "both" ? "Payment estimate and income-document help" : value === "documents" ? "Income-document help" : "Payment estimate");
        guideDocumentGoal = value === "documents" || value === "both" ? "auto" : null;
        guideContinueToCalculator = value === "both";
        guideStep = "income_situation";
      }
    } else if (guideStep === "ibr_zero_region") {
      if (!["contiguous_us", "alaska", "hawaii"].includes(value)) {
        guideSay("Choose 48 states + D.C., Alaska, or Hawaii.");
        return;
      }
      guideSay(shown, "user");
      setCalculatorValue("region", value);
      recordGuidedFact("region", "Poverty-guideline region", shown);
      void showIbrZeroInfo(value);
      return;
    } else if (guideStep === "ibr_zero_followup") {
      if (!["current_income_doc", "unemployment_doc", "calculator"].includes(value)) {
        guideSay("Choose stated income document, unemployment statement, or continue to calculator.");
        return;
      }
      guideSay(shown, "user");
      if (value === "current_income_doc") {
        guideDocumentGoal = "current_income_statement";
        guideContinueToCalculator = false;
        recordGuidedFact("document_goal", "Requested document", "Current / stated income supporting statement");
        guideStep = "income_situation";
      } else if (value === "unemployment_doc") {
        guideDocumentGoal = "unemployment_income_statement";
        guideContinueToCalculator = false;
        guideIncomeSituation = "unemployment";
        recordGuidedFact("document_goal", "Requested document", "Unemployment compensation income statement");
        recordGuidedFact("income_situation", "Current income situation", "Unemployment compensation");
        guideStep = "income_cadence";
      } else {
        guideDocumentGoal = null;
        guideContinueToCalculator = false;
        guideStep = "income_situation";
      }
    } else if (guideStep === "doc_borrower_name" || guideStep === "doc_source_name" || guideStep === "doc_servicer_name") {
      guideSay(shown, "user");
      if (guideStep === "doc_borrower_name") {
        if (value !== "__skip__") {
          setDocumentValue("borrowerName", shown);
          recordGuidedFact("document_borrower_name", "Document borrower name", shown);
        }
        guideStep = "doc_servicer_name";
      } else if (guideStep === "doc_source_name") {
        if (value !== "__skip__") {
          setDocumentValue("sourceName", shown);
          recordGuidedFact("document_source_name", "Document payer / employer / agency", shown);
        }
        guideStep = "doc_servicer_name";
      } else {
        if (value !== "__skip__") {
          setDocumentValue("servicerName", shown);
          recordGuidedFact("document_servicer_name", "Document loan servicer", shown);
        }
        guideInput.value = "";
        guideAnswers.replaceChildren();
        guideSay("Your draft is ready for review below. Missing facts remain visible placeholders. Review or edit the fields, generate again if needed, then explicitly confirm your review before print/download controls are enabled.");
        openGuidedDocumentWorkspace();
        if (guideContinueToCalculator) {
          guideSay("You also asked for a payment estimate, so I’ll continue collecting the remaining calculator facts here.");
          guideStep = "family_size";
          showGuideStep();
        } else {
          guideStep = "document_ready";
        }
        return;
      }
    } else if (guideStep === "income_situation") {
      if (!["employment", "self_employment", "unemployment", "multiple", "none"].includes(value)) {
        guideSay("Choose employment, self-employed/contract, unemployment compensation, multiple taxable sources, or no current taxable income.");
        return;
      }
      guideSay(shown, "user");
      guideIncomeSituation = value;
      guidedIncomeSources = [];
      pendingIncomeSource = null;
      collectMultipleSources = value === "multiple";
      const labels = { employment: "Employment", self_employment: "Self-employment / contract", unemployment: "Unemployment compensation", multiple: "Multiple taxable sources", none: "No current taxable income" };
      recordGuidedFact("income_situation", "Current income situation", labels[value]);
      if (guideDocumentGoal === "auto") {
        guideDocumentGoal = value === "unemployment" ? "unemployment_income_statement" : value === "none" ? "no_current_taxable_income_statement" : "current_income_statement";
      } else if (guideDocumentGoal && value === "unemployment") {
        guideDocumentGoal = "unemployment_income_statement";
      } else if (guideDocumentGoal && value === "none") {
        guideDocumentGoal = "no_current_taxable_income_statement";
      }
      if (value === "none") {
        setCalculatorValue("cadence", "annual");
        setCalculatorValue("incomeAmount", 0);
        guideIncomeCadence = "annual";
        guideIncomeAmount = 0;
        recordGuidedFact("income_amount", "Current gross taxable income", money.format(0));
        cadence.value = "annual";
        syncHourlyFields();
        renderIncomeReadiness();
        guideStep = guideDocumentGoal ? "doc_borrower_name" : "family_size";
      } else if (value === "multiple") {
        guideStep = "income_source_type";
      } else {
        pendingIncomeSource = { sourceType: value === "self_employment" ? "self_employment" : value };
        guideStep = "income_cadence";
      }
    } else if (guideStep === "income_cadence") {
      if (!["annual", "monthly", "semimonthly", "biweekly", "weekly", "hourly"].includes(value)) {
        guideSay("Choose annual, monthly, twice monthly, every two weeks, weekly, or hourly.");
        return;
      }
      guideSay(shown, "user");
      cadence.value = value;
      guideIncomeCadence = value;
      if (!pendingIncomeSource) pendingIncomeSource = { sourceType: documentSourceType() };
      pendingIncomeSource.paymentFrequency = value;
      syncHourlyFields();
      guideStep = "income_amount";
    } else if (guideStep === "region") {
      if (!["contiguous_us", "alaska", "hawaii"].includes(value)) {
        guideSay("Choose 48 states + D.C., Alaska, or Hawaii.");
        return;
      }
      guideSay(shown, "user");
      setCalculatorValue("region", value);
      recordGuidedFact("region", "Poverty-guideline region", shown);
      guideStep = "done";
    }

    guideInput.value = "";
    if (guideStep === "done") {
      guideAnswers.replaceChildren();
      guideSay("Your confirmed facts are now prefilled in the calculator. Review them, add or import your loan facts, then calculate. Document drafts, when requested, use this same confirmed fact ledger and keep missing information as explicit placeholders.");
      return;
    }
    showGuideStep();
  }

  guideForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleGuideAnswer(guideInput.value);
  });

  documentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void generateDocumentDraft();
  });
  documentReviewed.addEventListener("change", syncDocumentActions);
  documentScope.addEventListener("change", () => {
    documentDraft = null;
    documentReviewed.checked = false;
    documentDraftArea.hidden = true;
    syncDocumentActions();
  });
  advisorSaveProgress.addEventListener("click", () => { void saveAdvisorClientProgress(); });
  advisorViewCaseFile.addEventListener("click", async () => {
    const saved = await saveAdvisorClientProgress();
    if (saved) await loadAdvisorCaseContext(true);
  });
  advisorOpenConsultation.addEventListener("click", async () => {
    const saved = await saveAdvisorClientProgress();
    if (!saved) return;
    advisorConsultationWorkspace.hidden = false;
    if (!advisorConsultationTranscript.childElementCount) appendConsultationMessage("Ask me about this saved client. I will use only normalized owner-scoped case facts, deterministic results, and reviewed policy evidence from the current snapshot.", "guide");
    advisorConsultationWorkspace.scrollIntoView({ behavior:"smooth", block:"start" });
    advisorConsultationQuestion.focus();
  });
  advisorConsultationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void askAdvisorConsultation(advisorConsultationQuestion.value);
  });
  document.querySelectorAll("[data-consult-question]").forEach((button) => button.addEventListener("click", () => { void askAdvisorConsultation(button.dataset.consultQuestion || ""); }));
  advisorViewIntelligence.addEventListener("click", async () => {
    const saved = await saveAdvisorClientProgress();
    if (saved) await loadAdvisorIntelligence(true);
  });
  advisorRetainDocument.addEventListener("click", () => { void retainCurrentDocument(); });
  advisorRetainCalculation.addEventListener("click", () => { void retainCurrentSnapshot("calculation"); });
  advisorRetainComparison.addEventListener("click", () => { void retainCurrentSnapshot("comparison"); });
  advisorPrintComparison.addEventListener("click", () => { if (advisorLastComparisonSnapshotId) openComparisonPrint(advisorLastComparisonSnapshotId); });
  advisorDownloadComparisonSvg.addEventListener("click", () => { if (advisorLastComparisonSnapshotId) downloadComparisonSvg(advisorLastComparisonSnapshotId); });
  advisorShareComparison.addEventListener("click", () => { if (advisorLastComparisonSnapshotId) void createSnapshotShareLink(advisorLastComparisonSnapshotId); });
  advisorOpenHistory.addEventListener("click", () => { void loadAdvisorHistory().then(() => advisorHistoryWorkspace.scrollIntoView({ behavior:"smooth", block:"start" })); });
  advisorRefreshHistory.addEventListener("click", () => { void loadAdvisorHistory(); });
  advisorComparePlans.addEventListener("click", async () => {
    const saved = await saveAdvisorClientProgress();
    if (saved) await runAdvisorComparison();
  });
  advisorRegenerateDocument.addEventListener("click", () => {
    if (!advisorClient) return;
    guideDocumentGoal = guideIncomeSituation === "none" ? "no_current_taxable_income_statement" : "auto";
    openGuidedDocumentWorkspace();
  });
  addIncomeSource.addEventListener("click", () => {
    collectMultipleSources = true;
    pendingIncomeSource = null;
    guideStep = "income_source_type";
    guideSay("Add another source here. I’ll keep its facts and evidence readiness separate from the sources already confirmed.");
    showGuideStep();
    documentWorkspace.hidden = true;
    document.getElementById("guided-assistant").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  documentDownload.addEventListener("click", () => {
    if (!documentDraft || !documentReviewed.checked) return;
    const blob = new Blob([documentDraft.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = documentFilename();
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  documentPrint.addEventListener("click", () => {
    if (!documentDraft || !documentReviewed.checked) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      documentStatus.textContent = "Your browser blocked the print window. Allow pop-ups for this page and try again.";
      return;
    }
    printWindow.document.open();
    printWindow.document.write(documentDraft.html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  });

  form.addEventListener("input", () => { if (advisorClient) advisorCalculatorDirty = true; else invalidateBorrowerConsultation(); });
  form.addEventListener("change", () => { if (advisorClient) advisorCalculatorDirty = true; else invalidateBorrowerConsultation(); });
  borrowerConsultationForm.addEventListener("submit", (event) => { event.preventDefault(); void askBorrowerConsultation(borrowerConsultationQuestion.value); });
  document.querySelectorAll("[data-borrower-consult-question]").forEach((button) => button.addEventListener("click", () => { void askBorrowerConsultation(button.dataset.borrowerConsultQuestion || ""); }));
  cadence.addEventListener("change", syncHourlyFields);
  syncHourlyFields();
  if (advisorClientId) void initializeAdvisorClientMode();
  else {
    guideSay("I can help turn your answers into clearly labeled application facts and a repayment estimate. You can use the bubbles or type.");
    showGuideStep();
  }

  loanFile.addEventListener("change", async () => {
    importedPortfolio = null;
    importedFieldProvenance = {};
    portfolioSummary.replaceChildren();
    studentAidReview.replaceChildren();
    const file = loanFile.files && loanFile.files[0];
    if (!file) {
      importStatus.textContent = "No loan file loaded. Manual loan fields remain available below.";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      importStatus.textContent = "That file is larger than the 2 MiB local-import limit.";
      loanFile.value = "";
      return;
    }
    try {
      const text = await file.text();
      const portfolio = parseStudentAidData(text);
      if (!portfolio.loans.length) throw new Error("No active loan records with an outstanding principal balance were found.");
      importedPortfolio = portfolio;
      importedFieldProvenance = { ...(portfolio.borrower?.provenance || {}) };
      renderPortfolio(portfolio);
      importStatus.textContent = advisorClientId
        ? "Client facts prefilled locally. Review them, then use Save progress to persist only normalized facts. The raw StudentAid.gov file has not been uploaded."
        : "Borrower facts and loan details prefilled locally for this private session. The raw StudentAid.gov file has not been uploaded or persisted.";
    } catch (error) {
      importStatus.textContent = error instanceof Error ? error.message : "Unable to read that loan-data file.";
      loanFile.value = "";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "Calculating…";
    results.replaceChildren();

    try {
      const data = new FormData(form);
      const selectedPlans = data.getAll("plans").map(String);
      if (!selectedPlans.length) throw new Error("Select at least one repayment plan.");

      if (advisorClient) {
        const saved = await saveAdvisorClientProgress();
        if (!saved) throw new Error("Save the current client facts before calculating.");
        const automatic = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/calculations", { method:"POST", body:JSON.stringify({ plans:selectedPlans }) });
        render(automatic.result);
        status.textContent = "Estimate ready and added to the client timeline.";
        await loadAdvisorHistory();
        return;
      }

      const cadenceValue = String(data.get("cadence"));
      const amount = Number(data.get("incomeAmount"));
      const guidedCalculatorIncome = guidedIncomeSources
        .filter((source) => typeof source.grossAmount === "number" && source.paymentFrequency)
        .map((source) => source.paymentFrequency === "hourly"
          ? { cadence: "hourly", hourlyRate: source.grossAmount, hoursPerWeek: Number(data.get("hoursPerWeek")), weeksPerYear: Number(data.get("weeksPerYear")) }
          : { cadence: source.paymentFrequency, amount: source.grossAmount });
      const income = guidedCalculatorIncome.length
        ? guidedCalculatorIncome
        : cadenceValue === "hourly"
          ? [{ cadence: cadenceValue, hourlyRate: amount, hoursPerWeek: Number(data.get("hoursPerWeek")), weeksPerYear: Number(data.get("weeksPerYear")) }]
          : [{ cadence: cadenceValue, amount }];

      const payload = {
        income,
        region: String(data.get("region")),
        familySize: Number(data.get("familySize")),
        dependentsClaimedOnFederalTaxReturn: Number(data.get("dependents")),
        plans: selectedPlans
      };

      const adjustments = numberOrUndefined(String(data.get("adjustments")));
      const agiOverride = numberOrUndefined(String(data.get("agiOverride")));
      const taxFilingStatus = String(data.get("taxFilingStatus"));
      if (adjustments !== undefined) payload.estimatedAboveTheLineAdjustments = adjustments;
      if (agiOverride !== undefined) payload.adjustedGrossIncomeOverride = agiOverride;
      if (taxFilingStatus) payload.taxFilingStatus = taxFilingStatus;

      const loan = {};
      const principal = numberOrUndefined(String(data.get("principal")));
      const interestRate = numberOrUndefined(String(data.get("interestRate")));
      const loanType = String(data.get("loanType"));
      const ibrNewBorrower = String(data.get("ibrNewBorrower"));
      if (importedPortfolio) {
        if (importedPortfolio.repaymentLoans.length) loan.repaymentLoans = importedPortfolio.repaymentLoans;
        if (importedPortfolio.eligibilityLoans) loan.eligibilityLoans = importedPortfolio.eligibilityLoans;
      } else {
        if (principal !== undefined) loan.principal = principal;
        if (interestRate !== undefined) loan.annualInterestRatePercent = interestRate;
        if (loanType) {
          loan.eligibilityLoans = [{
            loanType,
            disbursementPeriod: String(data.get("disbursementPeriod"))
          }];
        }
      }
      if (ibrNewBorrower) loan.newBorrowerOnOrAfterJuly1_2014 = ibrNewBorrower === "true";
      if (Object.keys(loan).length) payload.loan = loan;

      const response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Calculation failed.");
      render(body.result);
      lastBorrowerCalculatorPayload = payload;
      borrowerConsultationWorkspace.hidden = false;
      if (!borrowerConsultationTranscript.childElementCount) appendBorrowerConsultationMessage("Your latest estimate is ready. Ask about plan comparisons, eligibility screening, or the reviewed policy evidence. I will use only this private-session calculator context.", "guide");
      borrowerConsultationStatus.textContent = "Ready for questions about this estimate. Nothing from this consultation is saved.";
      status.textContent = "Estimate ready.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Calculation failed.";
    } finally {
      submit.disabled = false;
    }
  });
})();
`;
