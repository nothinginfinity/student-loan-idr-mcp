export const SHARE_SCRIPT = String.raw`(() => {
  const statusLine = document.getElementById("status-line");
  const countdownLine = document.getElementById("countdown-line");
  let countdownTimer = null;
  const chartPanel = document.getElementById("chart-panel");
  const planRows = document.getElementById("plan-rows");
  const flrsNote = document.getElementById("flrs-note");
  const assumptionsNote = document.getElementById("assumptions-note");
  const selectPanel = document.getElementById("select-panel");
  const selectButtons = document.getElementById("select-buttons");
  const signPanel = document.getElementById("sign-panel");
  const selectedPlanLabel = document.getElementById("selected-plan-label");
  const signInitials = document.getElementById("sign-initials");
  const signConfirm = document.getElementById("sign-confirm");
  const signBack = document.getElementById("sign-back");
  const signedPanel = document.getElementById("signed-panel");
  const signedSummary = document.getElementById("signed-summary");
  const closedPanel = document.getElementById("closed-panel");
  const closedTitle = document.getElementById("closed-title");
  const closedBody = document.getElementById("closed-body");
  const downloadDocumentButton = document.getElementById("download-document");
  const downloadStatus = document.getElementById("download-status");
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

  const match = location.pathname.match(/\/share\/([A-Za-z0-9_-]{16,128})$/);
  const shareToken = match ? match[1] : "";

  async function api(path, init = {}) {
    const headers = new Headers(init.headers || {});
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(path, { ...init, headers });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { throw new Error("This link returned an unexpected response."); }
    if (!response.ok || !body?.ok) throw new Error(body?.error || "This link could not be used right now.");
    return body;
  }

  function hideAll() {
    chartPanel.hidden = true;
    selectPanel.hidden = true;
    signPanel.hidden = true;
    signedPanel.hidden = true;
    closedPanel.hidden = true;
  }

  function renderChart(state) {
    const projections = state.comparison.projections;
    const eligible = projections.filter((p) => p.eligibilityStatus !== "ineligible" && typeof p.currentMonthlyPayment === "number");
    const minValue = eligible.length ? Math.min(...eligible.map((p) => p.currentMonthlyPayment)) : null;
    const tiedPlans = minValue !== null ? eligible.filter((p) => p.currentMonthlyPayment === minValue).map((p) => p.plan) : [];
    const maxValue = Math.max(1, ...projections.map((p) => (typeof p.currentMonthlyPayment === "number" ? p.currentMonthlyPayment : 0)));
    planRows.replaceChildren();
    projections.forEach((p) => {
      const row = document.createElement("div");
      row.className = "plan-row";
      const name = document.createElement("div");
      name.className = "plan-name";
      name.textContent = p.plan;
      if (state.flrsPlan === p.plan) { const b = document.createElement("span"); b.className = "badge flrs"; b.textContent = "Lowest payment"; name.appendChild(b); }
      else if (!state.flrsPlan && tiedPlans.includes(p.plan) && tiedPlans.length > 1) { const b = document.createElement("span"); b.className = "badge"; b.textContent = "Tied for lowest"; name.appendChild(b); }
      const track = document.createElement("div");
      track.className = "plan-bar-track";
      const fill = document.createElement("div");
      const ineligible = p.eligibilityStatus === "ineligible";
      const value = typeof p.currentMonthlyPayment === "number" ? p.currentMonthlyPayment : 0;
      fill.className = "plan-bar-fill" + (ineligible ? " ineligible" : state.flrsPlan === p.plan ? " flrs" : "");
      fill.style.width = Math.max(2, (value / maxValue) * 100) + "%";
      track.appendChild(fill);
      const amount = document.createElement("div");
      amount.className = "plan-amount";
      amount.textContent = ineligible ? "N/A" : money.format(value) + "/mo";
      row.append(name, track, amount);
      planRows.appendChild(row);
    });
    if (!state.flrsPlan && tiedPlans.length > 1) { flrsNote.hidden = false; flrsNote.textContent = tiedPlans.join(" and ") + " are tied for the lowest modeled current payment."; }
    else flrsNote.hidden = true;
    assumptionsNote.textContent = (state.comparison.assumptions || []).slice(0, 2).join(" ");
    chartPanel.hidden = false;
  }

  function renderSelect(state) {
    const projections = state.comparison.projections;
    selectButtons.replaceChildren();
    projections.forEach((p) => {
      if (p.eligibilityStatus === "ineligible") return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.style.marginRight = "8px";
      button.style.marginBottom = "8px";
      button.textContent = "Choose " + p.plan;
      button.addEventListener("click", () => selectPlan(p.plan));
      selectButtons.appendChild(button);
    });
    selectPanel.hidden = false;
  }

  function formatDeadline(iso) {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }); } catch { return iso; }
  }

  function clearCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    countdownLine.textContent = "";
    countdownLine.classList.remove("countdown-urgent");
  }

  function formatCountdown(ms, coarse) {
    if (ms <= 0) return coarse ? "0m" : "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    if (coarse) {
      const totalMinutes = Math.floor(totalSeconds / 60);
      const days = Math.floor(totalMinutes / 1440);
      const hours = Math.floor((totalMinutes % 1440) / 60);
      const minutes = totalMinutes % 60;
      if (days > 0) return days + "d " + hours + "h";
      if (hours > 0) return hours + "h " + minutes + "m";
      return minutes + "m";
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + ":" + String(seconds).padStart(2, "0");
  }

  function startCountdown(deadlineIso, coarse, suffix) {
    clearCountdown();
    const urgentThreshold = coarse ? 2 * 60 * 60 * 1000 : 60 * 1000;
    const tick = () => {
      const remaining = Date.parse(deadlineIso) - Date.now();
      if (remaining <= 0) { clearCountdown(); load(); return; }
      countdownLine.textContent = "\u23f1 " + formatCountdown(remaining, coarse) + " left" + suffix;
      countdownLine.classList.toggle("countdown-urgent", remaining <= urgentThreshold);
    };
    tick();
    countdownTimer = setInterval(tick, coarse ? 30000 : 1000);
  }

  function render(state) {
    clearCountdown();
    hideAll();
    if (state.status === "revoked") {
      statusLine.textContent = "";
      closedTitle.textContent = "This link is no longer active.";
      closedBody.textContent = "Your advisor has turned off this link. Ask them for a new one.";
      closedPanel.hidden = false;
      return;
    }
    if (state.status === "expired") {
      statusLine.textContent = "";
      closedTitle.textContent = "This link has expired.";
      closedBody.textContent = "Ask your advisor to send you a new comparison link.";
      closedPanel.hidden = false;
      return;
    }
    renderChart(state);
    if (state.status === "opened") {
      statusLine.textContent = state.selectSignDeadlineAt ? ("Pick a plan by " + formatDeadline(state.selectSignDeadlineAt) + ".") : "";
      if (state.selectSignDeadlineAt) startCountdown(state.selectSignDeadlineAt, false, " to pick a plan");
      renderSelect(state);
    } else if (state.status === "selected") {
      statusLine.textContent = state.selectSignDeadlineAt ? ("Confirm by " + formatDeadline(state.selectSignDeadlineAt) + ".") : "";
      if (state.selectSignDeadlineAt) startCountdown(state.selectSignDeadlineAt, false, " to confirm");
      selectedPlanLabel.textContent = state.selectedPlan;
      signInitials.value = "";
      signPanel.hidden = false;
    } else if (state.status === "signed" || state.status === "booked") {
      statusLine.textContent = "";
      if (state.status === "signed" && state.bookingDeadlineAt) startCountdown(state.bookingDeadlineAt, true, " to book");
      signedSummary.textContent = "You confirmed " + state.selectedPlan + " on " + formatDeadline(state.signedAt) + ".";
      signedPanel.hidden = false;
    } else {
      statusLine.textContent = "";
    }
  }

  let currentState = null;

  async function load() {
    if (!shareToken) { statusLine.textContent = "This link is missing its access code."; return; }
    try {
      const body = await api("/api/share/" + encodeURIComponent(shareToken));
      currentState = body;
      render(currentState);
    } catch (error) {
      statusLine.textContent = "";
      closedTitle.textContent = "This link isn't available.";
      closedBody.textContent = error instanceof Error ? error.message : "Please ask your advisor for a new link.";
      closedPanel.hidden = false;
    }
  }

  async function selectPlan(plan) {
    try {
      const body = await api("/api/share/" + encodeURIComponent(shareToken) + "/select", { method: "POST", body: JSON.stringify({ plan }) });
      currentState = { ...currentState, status: body.status, selectedPlan: body.selectedPlan, selectedAt: body.selectedAt, selectSignDeadlineAt: body.selectSignDeadlineAt };
      render(currentState);
    } catch (error) { statusLine.textContent = error instanceof Error ? error.message : "Unable to select that plan."; }
  }

  signBack.addEventListener("click", () => { if (currentState) { currentState = { ...currentState, status: "opened" }; render(currentState); } });
  signConfirm.addEventListener("click", async () => {
    const initials = signInitials.value.trim();
    if (!initials) { statusLine.textContent = "Enter your initials to confirm."; return; }
    try {
      const body = await api("/api/share/" + encodeURIComponent(shareToken) + "/sign", { method: "POST", body: JSON.stringify({ initials }) });
      currentState = { ...currentState, status: body.status, signedAt: body.signedAt, bookingDeadlineAt: body.bookingDeadlineAt };
      render(currentState);
    } catch (error) { statusLine.textContent = error instanceof Error ? error.message : "Unable to confirm that plan."; }
  });

  downloadDocumentButton.addEventListener("click", async () => {
    downloadStatus.textContent = "Preparing your document\u2026";
    try {
      const body = await api("/api/share/" + encodeURIComponent(shareToken) + "/document");
      const blob = new Blob([body.document.documentText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "supporting-document.txt";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      downloadStatus.textContent = "Downloaded. Your advisor can help you fill in any missing details.";
    } catch (error) { downloadStatus.textContent = error instanceof Error ? error.message : "Unable to prepare that document."; }
  });

  load();
})();
`;
