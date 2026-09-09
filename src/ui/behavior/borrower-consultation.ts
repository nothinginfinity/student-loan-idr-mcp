export const BORROWER_CONSULTATION = String.raw`  function appendBorrowerConsultationMessage(text, role) {
    borrowerConsultationTranscript.appendChild(addText("div", text, "message " + role));
    borrowerConsultationTranscript.scrollTop = borrowerConsultationTranscript.scrollHeight;
  }

  function renderBorrowerConsultation(consultation) {
    appendBorrowerConsultationMessage(consultation.answer, "guide");
    if ((consultation.knowledge || []).length) {
      const details = document.createElement("details");
      details.className = "readiness-card";
      details.appendChild(addText("summary", "Official federal evidence · policy " + consultation.policySnapshot));
      consultation.knowledge.forEach((source) => {
        const row = document.createElement("div");
        row.className = "consultation-source";
        row.append(addText("strong", source.title), addText("div", source.content, "muted"), addText("div", "Official federal · reviewed " + source.reviewedAt + " · " + source.id, "muted"));
        details.appendChild(row);
      });
      borrowerConsultationTranscript.appendChild(details);
    }
    borrowerConsultationStatus.textContent = "Private-session consultation · " + consultation.synthesisMode.replace(/_/g, " ") + " · policy " + consultation.policySnapshot + " · not persisted · no advisor case lookup.";
    borrowerConsultationTranscript.scrollTop = borrowerConsultationTranscript.scrollHeight;
  }

  async function askBorrowerConsultation(question) {
    const trimmed = String(question || "").trim();
    if (!trimmed) return;
    if (!lastBorrowerCalculatorPayload) {
      borrowerConsultationStatus.textContent = "Recalculate the estimate before asking. Changed calculator facts invalidate the previous consultation context.";
      return;
    }
    appendBorrowerConsultationMessage(trimmed, "user");
    borrowerConsultationQuestion.value = "";
    borrowerConsultationSubmit.disabled = true;
    borrowerConsultationStatus.textContent = "Recomputing the estimate and retrieving reviewed policy evidence…";
    try {
      const response = await fetch("/api/consultation", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ question:trimmed, policySnapshot:"2026-08-27", calculator:lastBorrowerCalculatorPayload, history:borrowerConsultationHistory.slice(-6) }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Consultation failed.");
      renderBorrowerConsultation(body.consultation);
      borrowerConsultationHistory.push({role:"user",content:trimmed},{role:"assistant",content:body.consultation.answer});
      borrowerConsultationHistory = borrowerConsultationHistory.slice(-6);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Consultation failed.";
      appendBorrowerConsultationMessage(message, "guide");
      borrowerConsultationStatus.textContent = message;
    } finally {
      borrowerConsultationSubmit.disabled = false;
    }
  }

  function invalidateBorrowerConsultation() {
    if (!lastBorrowerCalculatorPayload) return;
    lastBorrowerCalculatorPayload = null;
    borrowerConsultationHistory = [];
    borrowerConsultationStatus.textContent = "Calculator facts changed. Recalculate before asking another question about the estimate.";
  }

`;
