export const BORROWER_ADVISOR_CLIENT = String.raw`  async function advisorApi(path, init = {}) {
    const headers = new Headers(init.headers || {});
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (advisorCsrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method || "GET")) headers.set("x-csrf-token", advisorCsrfToken);
    const response = await fetch(path, { ...init, headers });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { throw new Error("Advisor workspace returned an invalid response."); }
    if (!response.ok || !body?.ok) {
      const error = new Error(body?.error || "Advisor workspace request failed.");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function guidedIncomeForPersistence() {
    if (guidedIncomeSources.length) {
      const data = new FormData(form);
      return guidedIncomeSources.map((source) => source.paymentFrequency === "hourly"
        ? { cadence: "hourly", hourlyRate: source.grossAmount, hoursPerWeek: Number(data.get("hoursPerWeek")), weeksPerYear: Number(data.get("weeksPerYear")) }
        : { cadence: source.paymentFrequency, amount: source.grossAmount });
    }
    if (guideIncomeSituation === "none") return [{ cadence: "annual", amount: 0 }];
    if (!advisorCalculatorDirty && Array.isArray(advisorSavedIncome) && advisorSavedIncome.length) return advisorSavedIncome;
    const data = new FormData(form);
    const cadenceValue = String(data.get("cadence") || "annual");
    const amount = Number(data.get("incomeAmount"));
    return cadenceValue === "hourly"
      ? [{ cadence: "hourly", hourlyRate: amount, hoursPerWeek: Number(data.get("hoursPerWeek")), weeksPerYear: Number(data.get("weeksPerYear")) }]
      : [{ cadence: cadenceValue, amount }];
  }

  function advisorReadinessForPersistence() {
    if (guideIncomeSituation === "none") return "document_ready";
    if (!guidedIncomeSources.length) return advisorClient?.readinessState || "needs_evidence";
    if (guidedIncomeSources.every(sourceApplicationReady)) return "application_ready";
    if (guidedIncomeSources.every(sourceDocumentReady)) return "document_ready";
    return "needs_evidence";
  }

  function hydrateAdvisorClient(client) {
    advisorClient = client;
    advisorClientBar.hidden = false;
    advisorClientName.textContent = client.contact.displayName + (advisorIdentity?.displayName ? " · advisor: " + advisorIdentity.displayName : "");
    advisorSaveStatus.textContent = "Saved client loaded. Continue the guided workflow and save when you want to persist confirmed normalized facts.";
    setDocumentValue("borrowerName", client.contact.displayName);
    if (client.servicerName) setDocumentValue("servicerName", client.servicerName);

    guidedFacts.clear();
    guidedFactsList.replaceChildren(addText("li", "No guided facts confirmed yet.", "muted"));
    const facts = client.confirmedFacts || {};
    advisorSavedIncome = Array.isArray(facts.income) ? facts.income : null;
    guidedIncomeSources = Array.isArray(facts.incomeSources) ? facts.incomeSources.map((source) => ({
      sourceType: source.sourceType || "other",
      ...(source.name ? { name: source.name } : {}),
      ...(source.address ? { address: source.address } : {}),
      ...(typeof source.grossAmount === "number" ? { grossAmount: source.grossAmount } : {}),
      ...(source.paymentFrequency ? { paymentFrequency: source.paymentFrequency } : {}),
      evidenceStatus: savedEvidenceToGuide(source.evidenceState)
    })).filter((source) => typeof source.grossAmount === "number" && source.paymentFrequency) : [];

    if (guidedIncomeSources.length) {
      guideIncomeSituation = guidedIncomeSources.length > 1 ? "multiple" : guidedIncomeSources[0].sourceType;
      guidedIncomeSources.forEach((source, index) => recordGuidedFact(
        "income_source_" + (index + 1),
        "Taxable income source " + (index + 1),
        sourceTypeLabel(source.sourceType) + " · " + money.format(source.grossAmount) + " · " + source.paymentFrequency + " · " + evidenceStatusLabel(source.evidenceStatus)
      ));
      const first = guidedIncomeSources[0];
      guideIncomeCadence = first.paymentFrequency;
      guideIncomeAmount = first.grossAmount;
      cadence.value = first.paymentFrequency;
      setCalculatorValue("incomeAmount", first.grossAmount);
      syncHourlyFields();
    } else if (advisorSavedIncome?.length) {
      const first = advisorSavedIncome[0];
      recordGuidedFact("saved_income", "Saved taxable income inputs", String(advisorSavedIncome.length) + " source(s)", "Stated fact");
      if (first.cadence) cadence.value = first.cadence;
      const firstAmount = typeof first.amount === "number" ? first.amount : first.hourlyRate;
      if (typeof firstAmount === "number") setCalculatorValue("incomeAmount", firstAmount);
      syncHourlyFields();
    }

    if (facts.region) {
      setCalculatorValue("region", facts.region);
      recordGuidedFact("region", "Poverty-guideline region", facts.region === "contiguous_us" ? "48 states + D.C." : facts.region === "alaska" ? "Alaska" : "Hawaii");
    }
    if (typeof facts.familySize === "number") {
      setCalculatorValue("familySize", facts.familySize);
      recordGuidedFact("family_size", "Legacy IDR family size", String(facts.familySize));
    }
    if (typeof facts.dependentsClaimedOnFederalTaxReturn === "number") {
      setCalculatorValue("dependents", facts.dependentsClaimedOnFederalTaxReturn);
      recordGuidedFact("dependents", "Federal tax-return dependents for RAP", String(facts.dependentsClaimedOnFederalTaxReturn));
    }
    if (facts.taxFilingStatus) setCalculatorValue("taxFilingStatus", facts.taxFilingStatus);
    if (typeof facts.newBorrowerOnOrAfterJuly1_2014 === "boolean") {
      setCalculatorValue("ibrNewBorrower", facts.newBorrowerOnOrAfterJuly1_2014);
      recordGuidedFact("ibr_borrower_timing", "IBR borrower timing", facts.newBorrowerOnOrAfterJuly1_2014 ? "New borrower on/after July 1, 2014" : "Earlier borrower");
    }
    advisorComparisonWorkspace.hidden = false;
    advisorComparisonStatus.textContent = "Saved facts loaded. Compare after saving any changes you make in this session.";
    void loadAdvisorCaseContext(false);

    if (client.normalizedLoanPortfolio?.repaymentLoans?.length || client.normalizedLoanPortfolio?.loans?.length) {
      const repaymentLoans = client.normalizedLoanPortfolio.repaymentLoans || [];
      const eligibilityLoans = client.normalizedLoanPortfolio.eligibilityLoans;
      const savedLoans = client.normalizedLoanPortfolio.loans?.length
        ? client.normalizedLoanPortfolio.loans
        : repaymentLoans.map((loan, loanIndex) => ({ loanIndex, outstandingPrincipal: loan.principal, interestRatePercent: loan.annualInterestRatePercent, provenance: { outstandingPrincipal: "imported_studentaid", interestRatePercent: "imported_studentaid" } }));
      const totalPrincipal = client.normalizedLoanPortfolio.summary?.totalOutstandingPrincipal ?? repaymentLoans.reduce((sum, loan) => sum + loan.principal, 0);
      const totalInterest = client.normalizedLoanPortfolio.summary?.totalOutstandingInterest ?? savedLoans.reduce((sum, loan) => sum + (loan.outstandingInterest || 0), 0);
      importedFieldProvenance = { ...(client.fieldProvenance || {}) };
      importedPortfolio = {
        loans: savedLoans,
        repaymentLoans,
        ...(eligibilityLoans ? { eligibilityLoans } : {}),
        summary: client.normalizedLoanPortfolio.summary || { loanCount: savedLoans.length, activeLoanCount: repaymentLoans.length, totalOutstandingPrincipal: totalPrincipal, totalOutstandingInterest: totalInterest, repaymentLoanCount: repaymentLoans.length, eligibilityMappedLoanCount: eligibilityLoans?.length || 0, ambiguousEligibilityLoanCount: eligibilityLoans ? 0 : repaymentLoans.length, hasLoanDisbursedOnOrAfterJuly1_2026: Boolean(eligibilityLoans?.some((loan) => loan.disbursementPeriod === "on_or_after_2026_07_01")) },
        totalPrincipal,
        totalInterest,
        ambiguousCount: client.normalizedLoanPortfolio.summary?.ambiguousEligibilityLoanCount ?? (eligibilityLoans ? 0 : repaymentLoans.length),
        borrower: { ...client.contact, provenance: { ...(client.fieldProvenance || {}) } },
        servicerName: client.servicerName || null,
        fileRequestDate: client.studentAidImport?.fileRequestDate || null
      };
      renderPortfolio(importedPortfolio);
      importStatus.textContent = "Saved normalized StudentAid facts loaded. The raw StudentAid.gov file was never stored on the server.";
      void loadAdvisorIntelligence(false);
    }

    renderIncomeReadiness();
    guideTranscript.replaceChildren();
    guideAnswers.replaceChildren();
    guideSay("Resumed " + client.contact.displayName + " from the advisor workspace. Only previously saved normalized facts were loaded; raw StudentAid files and evidence files are not stored here.");
    const hasIncome = guidedIncomeSources.length > 0 || Boolean(advisorSavedIncome?.length) || guideIncomeSituation === "none";
    guideStep = !hasIncome ? "income_situation"
      : typeof facts.familySize !== "number" ? "family_size"
      : typeof facts.dependentsClaimedOnFederalTaxReturn !== "number" ? "dependents"
      : !facts.region ? "region"
      : "done";
    if (guideStep === "done") guideSay("Saved application facts are loaded. Review them, update anything that changed, import a fresh StudentAid file locally if needed, calculate, regenerate documents, then save progress.");
    else showGuideStep();
  }

  async function initializeAdvisorClientMode() {
    advisorClientBar.hidden = false;
    advisorSaveStatus.textContent = "Loading authenticated advisor session and saved client facts…";
    try {
      const session = await fetch("/api/advisor/session", { headers: { accept: "application/json" } });
      if (session.status === 401) {
        window.location.replace("/advisor");
        return;
      }
      const sessionBody = await session.json();
      if (!session.ok || !sessionBody.ok) throw new Error(sessionBody.error || "Unable to resume advisor session.");
      advisorCsrfToken = sessionBody.csrfToken;
      advisorIdentity = sessionBody.advisor;
      const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClientId));
      hydrateAdvisorClient(body.client);
    } catch (error) {
      advisorSaveStatus.textContent = error instanceof Error ? error.message : "Unable to load the saved client.";
      guideTranscript.replaceChildren();
      guideAnswers.replaceChildren();
      guideSay("This saved client could not be loaded. Return to the advisor dashboard and reopen the client.");
    }
  }

  function caseCoverageLabel(value) {
    if (value === "complete") return "Complete";
    if (value === "partial") return "Partial";
    return "Missing";
  }

  function renderAdvisorCaseContext(context) {
    advisorCaseWorkspace.hidden = false;
    advisorCaseSummary.replaceChildren();
    advisorCaseDetails.replaceChildren();
    const summary = context.professionalSummary;
    [
      ["Active loans", String(summary.activeLoanCount)],
      ["Outstanding principal", money.format(summary.totalOutstandingPrincipal || 0)],
      ["Outstanding interest", money.format(summary.totalOutstandingInterest || 0)],
      ["Reported payment", typeof summary.reportedScheduledPaymentSum === "number" ? money.format(summary.reportedScheduledPaymentSum) + "/mo" : "Not fully reported"],
      ["Missing fact areas", String((context.missingInformation || []).length)],
      ["Comparison readiness", caseCoverageLabel(context.coverage?.comparisonReadiness)]
    ].forEach(([label, value]) => {
      const metric = document.createElement("div");
      metric.className = "metric";
      metric.append(addText("span", label, "muted"), addText("strong", value));
      advisorCaseSummary.appendChild(metric);
    });

    const identity = document.createElement("article");
    identity.className = "readiness-card";
    identity.appendChild(addText("h3", "Borrower & current portfolio"));
    const identityList = document.createElement("ul");
    identityList.appendChild(addText("li", "Borrower: " + summary.displayName));
    if (summary.email) identityList.appendChild(addText("li", "Email: " + summary.email));
    if (summary.phone) identityList.appendChild(addText("li", "Phone: " + summary.phone));
    if (summary.servicerName) identityList.appendChild(addText("li", "Servicer: " + summary.servicerName));
    identityList.appendChild(addText("li", "Current repayment plan(s): " + (summary.currentRepaymentPlans?.length ? summary.currentRepaymentPlans.join(", ") : "Not reported")));
    identityList.appendChild(addText("li", "Current forbearance loans: " + summary.currentForbearanceLoanCount + " · current delinquency loans: " + summary.currentDelinquencyLoanCount));
    identity.appendChild(identityList);
    advisorCaseDetails.appendChild(identity);

    const dates = document.createElement("article");
    dates.className = "readiness-card";
    dates.appendChild(addText("h3", "Dates & as-of context"));
    const dateList = document.createElement("ul");
    dateList.appendChild(addText("li", "Case updated: " + new Date(context.asOf.caseUpdatedAt).toLocaleString()));
    if (context.asOf.studentAidFileRequestDate) dateList.appendChild(addText("li", "StudentAid file request date: " + context.asOf.studentAidFileRequestDate));
    if (context.asOf.portfolioAsOfDate) dateList.appendChild(addText("li", "Portfolio intelligence as of: " + context.asOf.portfolioAsOfDate));
    if (summary.idrAnniversaryDates?.length) dateList.appendChild(addText("li", "IDR anniversary date(s): " + summary.idrAnniversaryDates.join(", ")));
    if (summary.nextPaymentDueDates?.length) dateList.appendChild(addText("li", "Next payment due date(s): " + summary.nextPaymentDueDates.join(", ")));
    dates.appendChild(dateList);
    advisorCaseDetails.appendChild(dates);

    const missing = document.createElement("article");
    missing.className = "readiness-card";
    missing.appendChild(addText("h3", "Missing information / next intake facts"));
    if (context.missingInformation?.length) {
      const list = document.createElement("ul");
      context.missingInformation.forEach((item) => list.appendChild(addText("li", (item.blocking ? "Blocking · " : "Review · ") + item.label + " · needed for " + item.requiredFor.join(", ").replace(/_/g, " "))));
      missing.appendChild(list);
    } else missing.appendChild(addText("p", "No modeled case-context fact gaps are currently flagged.", "muted"));
    advisorCaseDetails.appendChild(missing);

    const coverage = document.createElement("article");
    coverage.className = "readiness-card";
    coverage.appendChild(addText("h3", "Coverage & provenance"));
    const coverageList = document.createElement("ul");
    Object.entries(context.coverage || {}).forEach(([key, value]) => coverageList.appendChild(addText("li", key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()) + ": " + caseCoverageLabel(value))));
    const provenanceValues = Object.values(context.provenance?.fields || {});
    const importedCount = provenanceValues.filter((value) => value === "imported_studentaid" || value === "derived_studentaid").length;
    const confirmedCount = provenanceValues.filter((value) => value === "advisor_entered" || value === "borrower_confirmed").length;
    coverageList.appendChild(addText("li", "Field provenance tracked: " + provenanceValues.length + " · StudentAid/derived: " + importedCount + " · advisor/borrower confirmed: " + confirmedCount));
    coverage.appendChild(coverageList);
    advisorCaseDetails.appendChild(coverage);

    if (context.warnings?.length) {
      const warnings = document.createElement("details");
      warnings.className = "readiness-card";
      warnings.appendChild(addText("summary", "Warnings & review notes · " + context.warnings.length));
      const list = document.createElement("ul");
      context.warnings.forEach((warning) => list.appendChild(addText("li", warning)));
      warnings.appendChild(list);
      advisorCaseDetails.appendChild(warnings);
    }
    advisorCaseStatus.textContent = "Saved case context · " + context.schema + " · updated " + new Date(context.clientUpdatedAt).toLocaleString() + ".";
  }

  async function loadAdvisorCaseContext(scrollIntoView = false) {
    if (!advisorClient) return;
    advisorCaseWorkspace.hidden = false;
    advisorCaseStatus.textContent = "Loading saved client case context…";
    try {
      const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/case-context");
      renderAdvisorCaseContext(body.caseContext);
      if (scrollIntoView) advisorCaseWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      advisorCaseStatus.textContent = error instanceof Error ? error.message : "Unable to load the client case file.";
    }
  }

  function appendConsultationMessage(text, role) {
    const node = addText("div", text, "message " + role);
    advisorConsultationTranscript.appendChild(node);
    advisorConsultationTranscript.scrollTop = advisorConsultationTranscript.scrollHeight;
  }

  function renderAdvisorConsultation(consultation) {
    appendConsultationMessage(consultation.answer, "guide");
    const evidence = consultation.evidence;
    if ((evidence.knowledge || []).length || (evidence.missingInformation || []).length || (evidence.warnings || []).length) {
      const details = document.createElement("details");
      details.className = "readiness-card";
      details.appendChild(addText("summary", "Evidence packet · " + evidence.intent.replace(/_/g, " ") + " · policy " + evidence.policySnapshot));
      if ((evidence.knowledge || []).length) {
        details.appendChild(addText("strong", "Reviewed knowledge"));
        evidence.knowledge.forEach((source) => {
          const row = document.createElement("div");
          row.className = "consultation-source";
          const tier = source.authorityTier === "official_federal" ? "Official federal" : "Accepted specialty/advisor";
          row.append(addText("strong", source.title), addText("div", source.content, "muted"), addText("div", tier + " · reviewed " + source.reviewedAt + " · " + source.id, "muted"));
          details.appendChild(row);
        });
      }
      const blocking = (evidence.missingInformation || []).filter((item) => item.blocking);
      if (blocking.length) details.appendChild(addText("p", "Blocking saved fact gaps: " + blocking.map((item) => item.label).join(", ") + ".", "muted"));
      (evidence.warnings || []).forEach((warning) => details.appendChild(addText("p", "Review: " + warning, "muted")));
      advisorConsultationTranscript.appendChild(details);
    }
    if ((consultation.proposedActions || []).length) {
      const actions = document.createElement("div");
      actions.className = "actions";
      consultation.proposedActions.forEach((action) => {
        const link = document.createElement("a");
        link.className = "link-button";
        link.href = action.href;
        link.textContent = action.label;
        actions.appendChild(link);
      });
      advisorConsultationTranscript.appendChild(actions);
    }
    advisorConsultationStatus.textContent = "Read-only consultation · " + consultation.synthesisMode.replace(/_/g, " ") + " · policy snapshot " + evidence.policySnapshot + ". No client mutation applied.";
    advisorConsultationTranscript.scrollTop = advisorConsultationTranscript.scrollHeight;
  }

  async function askAdvisorConsultation(question) {
    if (!advisorClient || !question.trim()) return;
    advisorConsultationWorkspace.hidden = false;
    appendConsultationMessage(question.trim(), "user");
    advisorConsultationQuestion.value = "";
    advisorConsultationSubmit.disabled = true;
    advisorConsultationStatus.textContent = "Assembling owner-scoped case facts and reviewed policy evidence…";
    try {
      const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/consultation", { method:"POST", body:JSON.stringify({ question:question.trim(), policySnapshot:"2026-08-27", history:advisorConsultationHistory.slice(-6) }) });
      renderAdvisorConsultation(body.consultation);
      advisorConsultationHistory.push({role:"user",content:question.trim()},{role:"assistant",content:body.consultation.answer});
      advisorConsultationHistory = advisorConsultationHistory.slice(-6);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to consult the saved case.";
      appendConsultationMessage(message, "guide");
      advisorConsultationStatus.textContent = message;
    } finally {
      advisorConsultationSubmit.disabled = false;
    }
  }

  function reviewedStudentAidContact() {
    const values = { ...(advisorClient?.contact || {}) };
    studentAidReview.querySelectorAll("[data-import-field]").forEach((input) => {
      const field = input.dataset.importField;
      if (!field) return;
      const value = String(input.value || "").trim();
      if (value) values[field] = value; else delete values[field];
    });
    if (!values.displayName) values.displayName = advisorClient?.contact?.displayName || "Client";
    return values;
  }

  async function saveAdvisorClientProgress() {
    if (!advisorClient || !advisorCsrfToken) return false;
    advisorSaveProgress.disabled = true;
    advisorSaveStatus.textContent = "Saving normalized client facts…";
    try {
      const facts = { ...(advisorClient.confirmedFacts || {}) };
      const income = guidedIncomeForPersistence();
      if (income.length) facts.income = income;
      if (guidedIncomeSources.length) facts.incomeSources = guidedIncomeSources.map((source) => ({
        sourceType: source.sourceType,
        ...(source.name ? { name: source.name } : {}),
        ...(source.address ? { address: source.address } : {}),
        grossAmount: source.grossAmount,
        paymentFrequency: source.paymentFrequency,
        evidenceState: guideEvidenceToSaved(source.evidenceStatus)
      }));
      const formData = new FormData(form);
      facts.region = String(formData.get("region"));
      facts.familySize = Number(formData.get("familySize"));
      facts.dependentsClaimedOnFederalTaxReturn = Number(formData.get("dependents"));
      const adjustments = numberOrUndefined(String(formData.get("adjustments") || ""));
      const agiOverride = numberOrUndefined(String(formData.get("agiOverride") || ""));
      if (adjustments !== undefined) facts.estimatedAboveTheLineAdjustments = adjustments; else delete facts.estimatedAboveTheLineAdjustments;
      if (agiOverride !== undefined) facts.adjustedGrossIncomeOverride = agiOverride; else delete facts.adjustedGrossIncomeOverride;
      const taxFilingStatus = String(formData.get("taxFilingStatus") || "");
      if (taxFilingStatus) facts.taxFilingStatus = taxFilingStatus;
      const ibrNewBorrower = String(formData.get("ibrNewBorrower") || "");
      if (ibrNewBorrower) facts.newBorrowerOnOrAfterJuly1_2014 = ibrNewBorrower === "true";

      const selectedPlans = formData.getAll("plans").map(String);
      const body = {
        expectedUpdatedAt: advisorClient.updatedAt,
        confirmedFacts: facts,
        readinessState: advisorReadinessForPersistence(),
        consideredPlans: selectedPlans
      };
      if (studentAidReview.querySelector("[data-import-field]")) {
        body.contact = reviewedStudentAidContact();
        body.fieldProvenance = { ...importedFieldProvenance };
      }
      const servicerControl = documentForm.elements.namedItem("servicerName");
      if (servicerControl && "value" in servicerControl) body.servicerName = String(servicerControl.value).trim();
      if (importedPortfolio?.repaymentLoans?.length || importedPortfolio?.loans?.length) {
        body.normalizedLoanPortfolio = {
          repaymentLoans: importedPortfolio.repaymentLoans || [],
          ...(importedPortfolio.eligibilityLoans ? { eligibilityLoans: importedPortfolio.eligibilityLoans } : {}),
          ...(importedPortfolio.loans ? { loans: importedPortfolio.loans } : {}),
          ...(importedPortfolio.summary ? { summary: importedPortfolio.summary } : {})
        };
      }
      if ((loanFile.files && loanFile.files[0]) || advisorClient.studentAidImport || importedPortfolio?.loans?.length) {
        body.studentAidImport = {
          source: "studentaid_download",
          importedAt: loanFile.files && loanFile.files[0] ? new Date().toISOString() : advisorClient.studentAidImport?.importedAt,
          ...(importedPortfolio?.fileRequestDate ? { fileRequestDate: importedPortfolio.fileRequestDate } : advisorClient.studentAidImport?.fileRequestDate ? { fileRequestDate: advisorClient.studentAidImport.fileRequestDate } : {}),
          mappingVersion: "2026-09-05-v2",
          rawFileRetained: false
        };
      }
      const saved = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId), { method: "PUT", body: JSON.stringify(body) });
      advisorClient = saved.client;
      advisorSavedIncome = Array.isArray(saved.client.confirmedFacts?.income) ? saved.client.confirmedFacts.income : null;
      advisorCalculatorDirty = false;
      advisorSaveStatus.textContent = "Saved " + new Date(saved.client.updatedAt).toLocaleString() + ". Raw StudentAid data and evidence files were not retained.";
      void loadAdvisorCaseContext(false);
      if (saved.client.normalizedLoanPortfolio?.loans?.length) void loadAdvisorIntelligence(false);
      return true;
    } catch (error) {
      advisorSaveStatus.textContent = error instanceof Error ? error.message : "Unable to save client progress.";
      return false;
    } finally {
      advisorSaveProgress.disabled = false;
    }
  }

  const svgNs = "http://www.w3.org/2000/svg";
`;
