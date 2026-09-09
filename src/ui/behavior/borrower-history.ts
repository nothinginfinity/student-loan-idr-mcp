export const BORROWER_HISTORY = String.raw`  async function retainedNamePrompt(label) {
    const value = window.prompt(label + " name", label + " · " + new Date().toLocaleString());
    return value && value.trim() ? value.trim() : null;
  }
  async function retainCurrentDocument() {
    if (!advisorClient || !documentDraft || !documentReviewed.checked) return;
    const name = await retainedNamePrompt("Document draft"); if (!name) return;
    try {
      const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/artifacts", { method:"POST", body:JSON.stringify({ name, templateRequest:documentRequest("text") }) });
      advisorSaveStatus.textContent = "Retained document draft: " + body.artifact.name + ".";
      await loadAdvisorHistory();
    } catch (error) { advisorSaveStatus.textContent = error instanceof Error ? error.message : "Unable to retain document draft."; }
  }
  async function retainCurrentSnapshot(kind) {
    if (!advisorClient) return;
    const name = await retainedNamePrompt(kind === "comparison" ? "Comparison snapshot" : "Calculation snapshot"); if (!name) return;
    const saved = await saveAdvisorClientProgress(); if (!saved) return;
    try {
      const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/snapshots", { method:"POST", body:JSON.stringify({ name, snapshotKind:kind }) });
      advisorSaveStatus.textContent = "Retained " + body.snapshot.snapshotKind + " snapshot: " + body.snapshot.name + ".";
      await loadAdvisorHistory();
    } catch (error) { advisorSaveStatus.textContent = error instanceof Error ? error.message : "Unable to retain calculation snapshot."; }
  }
  async function deleteHistoryItem(kind, itemId, name) {
    if (!advisorClient || !window.confirm("Permanently delete retained history item “" + name + "”?")) return;
    try { await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/" + kind + "/" + encodeURIComponent(itemId), { method:"DELETE", body:"{}" }); await loadAdvisorHistory(); }
    catch (error) { advisorHistoryStatus.textContent = error instanceof Error ? error.message : "Unable to delete retained history."; }
  }
  function historyAction(label, handler) { const button=addText("button",label); button.type="button"; button.addEventListener("click",handler); return button; }
  async function editTimelineEvent(event) {
    if (!advisorClient) return;
    const name = window.prompt("Timeline item name", event.name);
    if (name === null) return;
    const annotation = window.prompt("Advisor annotation (optional)", event.annotation || "");
    if (annotation === null) return;
    await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/timeline/" + encodeURIComponent(event.eventId), { method:"PATCH", body:JSON.stringify({ name, annotation }) });
    await loadAdvisorHistory();
  }
  async function starTimelineEvent(event) {
    if (!advisorClient) return;
    await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/timeline/" + encodeURIComponent(event.eventId), { method:"PATCH", body:JSON.stringify({ starred:!event.starred }) });
    await loadAdvisorHistory();
  }
  async function deleteTimelineEvent(event) {
    if (!advisorClient || !window.confirm("Delete timeline item “" + event.name + "”? Underlying retained artifacts/snapshots are not deleted by this action.")) return;
    await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/timeline/" + encodeURIComponent(event.eventId), { method:"DELETE", body:"{}" });
    await loadAdvisorHistory();
  }
  async function exportTimelineEvent(event) {
    if (!advisorClient) return;
    const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/timeline/" + encodeURIComponent(event.eventId));
    downloadJson("case-timeline-" + event.eventId + ".json", body);
  }
  async function loadAdvisorHistory() {
    if (!advisorClient) return;
    advisorHistoryWorkspace.hidden = false; advisorHistoryStatus.textContent = "Loading retained history…";
    try {
      const [timelineBody,artifactBody,snapshotBody] = await Promise.all([
        advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/timeline"),
        advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/artifacts"),
        advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/snapshots")
      ]);
      advisorTimelineHistory.replaceChildren(); advisorArtifactHistory.replaceChildren(); advisorSnapshotHistory.replaceChildren();
      if (!timelineBody.events.length) advisorTimelineHistory.appendChild(addText("p","No material case events yet. Advisor-mode calculations, comparisons, document actions, and borrower plan decisions will appear here automatically.","muted"));
      timelineBody.events.forEach((event) => {
        const card=document.createElement("article"); card.className="history-item";
        const title=(event.starred ? "★ " : "") + event.name;
        card.append(addText("strong",title),addText("div",event.summary,"muted"),addText("div",event.eventKind.replace(/_/g," ")+" · "+new Date(event.occurredAt).toLocaleString()+(event.policySnapshot?" · policy "+event.policySnapshot:"")+" · engine "+event.engineVersion,"muted"));
        if(event.annotation) card.appendChild(addText("p",event.annotation,"muted"));
        const actions=document.createElement("div"); actions.className="actions";
        actions.append(historyAction(event.starred?"Unstar":"Star",()=>{void starTimelineEvent(event);}),historyAction("Rename / annotate",()=>{void editTimelineEvent(event);}),historyAction("Export JSON",()=>{void exportTimelineEvent(event);}),historyAction("Delete",()=>{void deleteTimelineEvent(event);}));
        card.appendChild(actions); advisorTimelineHistory.appendChild(card);
      });
      if (!artifactBody.artifacts.length) advisorArtifactHistory.appendChild(addText("p","No retained document drafts yet.","muted"));
      artifactBody.artifacts.forEach((artifact) => {
        const card=document.createElement("article"); card.className="history-item"; card.append(addText("strong",artifact.name),addText("div","Retained " + new Date(artifact.createdAt).toLocaleString() + " · engine " + artifact.engineVersion,"muted"));
        const actions=document.createElement("div"); actions.className="actions";
        actions.append(historyAction("Regenerate",async()=>{ const body=await advisorApi("/api/advisor/clients/"+encodeURIComponent(advisorClient.clientId)+"/artifacts/"+encodeURIComponent(artifact.artifactId)+"/regenerate",{method:"POST",body:"{}"}); documentDraft={text:body.regenerated.documentText,html:body.regenerated.documentHtml}; documentPreview.textContent=documentDraft.text; documentDraftArea.hidden=false; documentReviewed.checked=false; syncDocumentActions(); documentWorkspace.hidden=false; documentWorkspace.scrollIntoView({behavior:"smooth",block:"start"}); }),historyAction("Export JSON",async()=>{ const body=await advisorApi("/api/advisor/clients/"+encodeURIComponent(advisorClient.clientId)+"/artifacts/"+encodeURIComponent(artifact.artifactId)); downloadJson("retained-document-"+artifact.artifactId+".json",body); }),historyAction("Delete",()=>{void deleteHistoryItem("artifacts",artifact.artifactId,artifact.name);})); card.appendChild(actions); advisorArtifactHistory.appendChild(card);
      });
      if (!snapshotBody.snapshots.length) advisorSnapshotHistory.appendChild(addText("p","No retained calculation snapshots yet.","muted"));
      snapshotBody.snapshots.forEach((snapshot) => {
        const card=document.createElement("article"); card.className="history-item"; card.append(addText("strong",snapshot.name),addText("div",snapshot.snapshotKind+" · policy "+snapshot.policySnapshot+" · "+new Date(snapshot.createdAt).toLocaleString(),"muted"));
        const actions=document.createElement("div"); actions.className="actions";
        actions.append(historyAction("Rerun retained basis",async()=>{ const body=await advisorApi("/api/advisor/clients/"+encodeURIComponent(advisorClient.clientId)+"/snapshots/"+encodeURIComponent(snapshot.snapshotId)+"/rerun",{method:"POST",body:"{}"}); if(snapshot.snapshotKind==="comparison") renderAdvisorComparison(body.rerun.result); else { render(body.rerun.result); results.scrollIntoView({behavior:"smooth",block:"start"}); } }),historyAction("Export JSON",async()=>{ const body=await advisorApi("/api/advisor/clients/"+encodeURIComponent(advisorClient.clientId)+"/snapshots/"+encodeURIComponent(snapshot.snapshotId)); downloadJson("retained-snapshot-"+snapshot.snapshotId+".json",body); })); if(snapshot.snapshotKind==="comparison") actions.append(historyAction("Print / Save PDF",()=>{openComparisonPrint(snapshot.snapshotId);}),historyAction("Download SVG",()=>{downloadComparisonSvg(snapshot.snapshotId);}),historyAction("Secure borrower link",()=>{void createSnapshotShareLink(snapshot.snapshotId);})); actions.append(historyAction("Delete",()=>{void deleteHistoryItem("snapshots",snapshot.snapshotId,snapshot.name);})); card.appendChild(actions); advisorSnapshotHistory.appendChild(card);
      });
      advisorHistoryStatus.textContent = timelineBody.events.length + " timeline event(s), " + artifactBody.artifacts.length + " retained document draft(s), and " + snapshotBody.snapshots.length + " calculation snapshot(s).";
    } catch (error) { advisorHistoryStatus.textContent = error instanceof Error ? error.message : "Unable to load retained history."; }
  }
  function renderAdvisorIntelligence(intelligence) {
    advisorIntelligenceWorkspace.hidden = false;
    advisorIntelligenceSummary.replaceChildren();
    advisorIntelligenceDetails.replaceChildren();
    const paymentValue = typeof intelligence.scheduledPayment.reportedAmountSum === "number"
      ? money.format(intelligence.scheduledPayment.reportedAmountSum) + " · " + intelligence.scheduledPayment.coverage
      : "Not reported";
    [
      ["Active loans", String(intelligence.activeLoanCount)],
      ["Portfolio-calendar forbearance", String(intelligence.forbearance.boundedCalendarDays) + " days"],
      ["Currently in forbearance", String(intelligence.forbearance.currentLoanCount) + " loan(s)"],
      ["Reported scheduled payment", paymentValue]
    ].forEach(([label, value]) => {
      const metric = document.createElement("div");
      metric.className = "metric";
      metric.append(addText("span", label, "muted"), addText("strong", value));
      advisorIntelligenceSummary.appendChild(metric);
    });

    const reconciliation = document.createElement("article");
    reconciliation.className = "readiness-card";
    reconciliation.append(addText("strong", "Balance reconciliation · " + intelligence.reconciliation.principal.status));
    const reconciliationList = document.createElement("ul");
    reconciliationList.appendChild(addText("li", "Parsed active-loan principal: " + money.format(intelligence.reconciliation.principal.parsedPrincipalSum)));
    if (typeof intelligence.reconciliation.principal.aggregateContributionSum === "number") reconciliationList.appendChild(addText("li", "Calculated aggregate OPB contribution sum: " + money.format(intelligence.reconciliation.principal.aggregateContributionSum)));
    if (typeof intelligence.reconciliation.principal.delta === "number") reconciliationList.appendChild(addText("li", "Difference: " + money.format(intelligence.reconciliation.principal.delta)));
    reconciliationList.appendChild(addText("li", intelligence.reconciliation.principal.note));
    reconciliation.appendChild(reconciliationList);
    advisorIntelligenceDetails.appendChild(reconciliation);

    const routing = document.createElement("article");
    routing.className = "readiness-card";
    routing.append(addText("strong", "Servicer routing"));
    if (intelligence.servicerRouting.preferred) {
      const contact = intelligence.servicerRouting.preferred.contact;
      routing.appendChild(addText("p", [contact.name, contact.phoneNumber, contact.emailAddress, contact.websiteAddress].filter(Boolean).join(" · ") || "Most relevant contact found", "muted"));
    } else routing.appendChild(addText("p", "No usable servicer/contact route was reported in the saved loan facts.", "muted"));
    advisorIntelligenceDetails.appendChild(routing);

    const plans = document.createElement("article");
    plans.className = "readiness-card";
    plans.append(addText("strong", "Reported repayment-plan state"));
    const planList = document.createElement("ul");
    intelligence.planDistribution.forEach((plan) => planList.appendChild(addText("li", (plan.description || plan.code || "Unreported plan") + " · " + plan.loanCount + " loan(s) · " + money.format(plan.outstandingPrincipal))));
    if (!intelligence.planDistribution.length) planList.appendChild(addText("li", "No repayment-plan state was reported for active loans."));
    plans.appendChild(planList);
    advisorIntelligenceDetails.appendChild(plans);

    intelligence.loans.forEach((loan) => {
      const card = document.createElement("details");
      card.className = "readiness-card";
      const heading = document.createElement("summary");
      heading.textContent = "Loan " + (loan.loanIndex + 1) + " · " + (loan.active ? "active" : "inactive") + " · " + loan.forbearance.boundedCalendarDays + " bounded forbearance day(s)";
      card.appendChild(heading);
      const list = document.createElement("ul");
      loan.statusIntervals.forEach((interval) => list.appendChild(addText("li", "Status · " + interval.startDate + " → " + (interval.endDate || "open") + " · " + (interval.description || interval.code || interval.category) + (typeof interval.calendarDays === "number" ? " · " + interval.calendarDays + " day(s)" : ""))));
      loan.delinquency.periods.forEach((period) => list.appendChild(addText("li", "Delinquency · " + period.startDate + " → " + (period.endDate || "open") + (typeof period.calendarDays === "number" ? " · " + period.calendarDays + " day(s)" : ""))));
      if (loan.repaymentPlan) list.appendChild(addText("li", "Plan · " + (loan.repaymentPlan.description || loan.repaymentPlan.code || "reported") + (loan.repaymentPlan.beginDate ? " · began " + loan.repaymentPlan.beginDate : "") + (loan.repaymentPlan.idrAnniversaryDate ? " · IDR anniversary " + loan.repaymentPlan.idrAnniversaryDate : "") + (loan.repaymentPlan.nextPaymentDueDate ? " · next due " + loan.repaymentPlan.nextPaymentDueDate : "")));
      if (typeof loan.interest.outstandingInterest === "number") list.appendChild(addText("li", "Outstanding interest · " + money.format(loan.interest.outstandingInterest)));
      if (typeof loan.interest.capitalizedInterest === "number") list.appendChild(addText("li", "Capitalized interest reported · " + money.format(loan.interest.capitalizedInterest)));
      card.appendChild(list);
      advisorIntelligenceDetails.appendChild(card);
    });
    const warningText = (intelligence.warnings || []).length ? " · " + intelligence.warnings.join(" · ") : "";
    advisorIntelligenceStatus.textContent = "Derived from saved normalized StudentAid facts" + (intelligence.asOfDate ? " as of " + intelligence.asOfDate : "") + ". Portfolio-calendar intervals union overlapping loans instead of double-counting them." + warningText;
  }
  async function loadAdvisorIntelligence(scroll = false) {
    if (!advisorClient) return;
    advisorIntelligenceWorkspace.hidden = false;
    advisorIntelligenceStatus.textContent = "Deriving deterministic portfolio intelligence…";
    try {
      const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/intelligence");
      renderAdvisorIntelligence(body.intelligence);
      if (scroll) advisorIntelligenceWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      advisorIntelligenceSummary.replaceChildren();
      advisorIntelligenceDetails.replaceChildren();
      advisorIntelligenceStatus.textContent = error instanceof Error ? error.message : "Unable to derive portfolio intelligence.";
      if (scroll) advisorIntelligenceWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function runAdvisorComparison() {
    if (!advisorClient) return;
    advisorComparePlans.disabled = true;
    advisorLastComparisonSnapshotId = null;
    syncComparisonArtifactActions();
    advisorComparisonWorkspace.hidden = false;
    advisorComparisonStatus.textContent = "Calculating saved repayment paths…";
    try {
      const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/comparisons", { method:"POST", body:"{}" });
      advisorLastComparisonSnapshotId = body.snapshot?.snapshotId || null;
      syncComparisonArtifactActions();
      renderAdvisorComparison(body.comparison);
      if (advisorLastComparisonSnapshotId) advisorComparisonStatus.textContent += " Frozen artifact source: " + advisorLastComparisonSnapshotId + ".";
      await loadAdvisorHistory();
    } catch (error) {
      advisorLastComparisonSnapshotId = null;
      syncComparisonArtifactActions();
      advisorComparisonCards.replaceChildren();
      emptyChart(advisorPaymentChart, "Comparison unavailable");
      emptyChart(advisorPaidChart, "Comparison unavailable");
      emptyChart(advisorBalanceChart, "Comparison unavailable");
      emptyChart(advisorForgivenessChart, "Comparison unavailable");
      advisorComparisonStatus.textContent = error instanceof Error ? error.message : "Unable to compare repayment programs.";
    } finally {
      advisorComparePlans.disabled = false;
    }
  }

`;
