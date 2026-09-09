export const BORROWER_CHARTS = String.raw`  function svgNode(tag, attrs = {}, text = "") {
    const node = document.createElementNS(svgNs, tag);
    Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, String(value)));
    if (text) node.textContent = text;
    return node;
  }
  function emptyChart(svg, message) {
    svg.replaceChildren(svgNode("text", { x: 360, y: 130, "text-anchor": "middle" }, message));
  }
  function chartPlanStyle(index) {
    return [
      { dash: "", opacity: "1" },
      { dash: "11 5", opacity: ".9" },
      { dash: "3 5", opacity: ".82" },
      { dash: "15 5 3 5", opacity: ".75" }
    ][index % 4];
  }
  function renderLineChart(svg, projections, valueForPoint, paymentMode = false) {
    const usable = projections.filter((projection) => projection.series?.length);
    if (!usable.length) { emptyChart(svg, "No bounded projection available"); return; }
    const values = [];
    let maxMonth = 1;
    usable.forEach((projection) => projection.series.forEach((point) => {
      maxMonth = Math.max(maxMonth, point.month);
      values.push(paymentMode ? projection.currentMonthlyPayment : valueForPoint(point));
    }));
    const maxValue = Math.max(1, ...values);
    const left = 70, top = 22, width = 610, height = 190, bottom = top + height;
    const x = (month) => left + month / maxMonth * width;
    const y = (value) => bottom - value / maxValue * height;
    svg.replaceChildren(
      svgNode("line", { x1: left, y1: top, x2: left, y2: bottom, class: "axis" }),
      svgNode("line", { x1: left, y1: bottom, x2: left + width, y2: bottom, class: "axis" }),
      svgNode("text", { x: left, y: 238, "text-anchor": "middle" }, "Now"),
      svgNode("text", { x: left + width, y: 238, "text-anchor": "end" }, (maxMonth / 12).toFixed(maxMonth % 12 ? 1 : 0) + " yr"),
      svgNode("text", { x: 62, y: bottom + 4, "text-anchor": "end" }, "$0"),
      svgNode("text", { x: 62, y: top + 4, "text-anchor": "end" }, money.format(maxValue))
    );
    usable.forEach((projection, index) => {
      const style = chartPlanStyle(index);
      const points = projection.series.map((point) => ({ month: point.month, value: paymentMode ? projection.currentMonthlyPayment : valueForPoint(point) }));
      const d = points.map((point, pointIndex) => (pointIndex ? "L" : "M") + x(point.month).toFixed(1) + " " + y(point.value).toFixed(1)).join(" ");
      const path = svgNode("path", { d, class: "series", opacity: style.opacity, "stroke-dasharray": style.dash });
      const last = points[points.length - 1];
      const label = svgNode("text", { x: Math.min(690, x(last.month) + 5), y: Math.max(14, y(last.value) - 5 + index * 12), "text-anchor": "end" }, projection.plan);
      svg.append(path, label);
    });
  }
  function renderForgivenessChart(svg, projections) {
    const usable = projections.filter((projection) => typeof projection.projectedForgiveness === "number");
    if (!usable.length) { emptyChart(svg, "Forgiveness withheld for current saved facts"); return; }
    const maxValue = Math.max(1, ...usable.map((projection) => projection.projectedForgiveness));
    const left = 85, top = 22, width = 570, rowHeight = 50;
    svg.replaceChildren();
    usable.forEach((projection, index) => {
      const y = top + index * rowHeight;
      const barWidth = projection.projectedForgiveness / maxValue * width;
      svg.append(
        svgNode("text", { x: left - 10, y: y + 21, "text-anchor": "end" }, projection.plan),
        svgNode("rect", { x: left, y, width: Math.max(1, barWidth), height: 28, fill: "currentColor", opacity: String(.85 - index * .12), rx: 5 }),
        svgNode("text", { x: Math.min(700, left + barWidth + 7), y: y + 20 }, money.format(projection.projectedForgiveness))
      );
    });
  }
  function renderAdvisorComparison(comparison) {
    advisorComparisonWorkspace.hidden = false;
    advisorComparisonCards.replaceChildren();
    comparison.projections.forEach((projection) => {
      const card = document.createElement("article");
      card.className = "comparison-card";
      const title = document.createElement("div");
      title.className = "plan-head";
      const name = document.createElement("div");
      name.append(addText("h3", projection.plan), addText("span", projection.eligibilityStatus, "badge"));
      title.append(name, addText("span", money.format(projection.currentMonthlyPayment) + "/mo", "payment"));
      card.append(title, addText("p", projection.horizonLabel, "muted"));
      const metrics = document.createElement("div");
      metrics.className = "comparison-metrics";
      [
        ["Modeled borrower paid", projection.projectedBorrowerPaid],
        ["Modeled remaining balance", projection.projectedRemainingBalance],
        ["Estimated forgiveness", projection.projectedForgiveness],
        ["RAP principal match", projection.projectedPrincipalMatch]
      ].forEach(([label, value]) => {
        const box = document.createElement("div");
        box.append(addText("span", label, "muted"), addText("strong", typeof value === "number" ? money.format(value) : "Withheld"));
        metrics.appendChild(box);
      });
      card.appendChild(metrics);
      if (typeof projection.projectedInterestWaived === "number") card.appendChild(addText("p", "Modeled RAP interest waived: " + money.format(projection.projectedInterestWaived), "muted"));
      if (projection.payoffMonth) card.appendChild(addText("p", "Modeled payoff before horizon: month " + projection.payoffMonth + ".", "muted"));
      if (projection.warnings?.length) {
        const details = document.createElement("details");
        details.appendChild(addText("summary", "Projection caveats"));
        const list = document.createElement("ul");
        projection.warnings.forEach((warning) => list.appendChild(addText("li", warning)));
        details.appendChild(list);
        card.appendChild(details);
      }
      advisorComparisonCards.appendChild(card);
    });
    renderLineChart(advisorPaymentChart, comparison.projections, () => 0, true);
    renderLineChart(advisorPaidChart, comparison.projections, (point) => point.cumulativeBorrowerPaid);
    renderLineChart(advisorBalanceChart, comparison.projections, (point) => point.remainingBalance);
    renderForgivenessChart(advisorForgivenessChart, comparison.projections);
    advisorComparisonAssumptions.replaceChildren(addText("strong", "Model assumptions"));
    const assumptions = document.createElement("ul");
    comparison.assumptions.forEach((assumption) => assumptions.appendChild(addText("li", assumption)));
    advisorComparisonAssumptions.appendChild(assumptions);
    advisorComparisonStatus.textContent = "Comparison generated from the saved client record under policy snapshot " + comparison.policySnapshot + ".";
    advisorComparisonWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function comparisonArtifactUrl(snapshotId, format) {
    if (!advisorClient) return "";
    return "/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/snapshots/" + encodeURIComponent(snapshotId) + "/artifact?format=" + encodeURIComponent(format);
  }
  function syncComparisonArtifactActions() {
    const disabled = !advisorClient || !advisorLastComparisonSnapshotId;
    advisorPrintComparison.disabled = disabled;
    advisorDownloadComparisonSvg.disabled = disabled;
    advisorShareComparison.disabled = disabled;
  }
  function openComparisonPrint(snapshotId) {
    const url = comparisonArtifactUrl(snapshotId, "html");
    if (!url) return;
    const printWindow = window.open(url, "_blank", "noopener");
    if (!printWindow) advisorComparisonStatus.textContent = "Your browser blocked the comparison report window. Allow pop-ups and try again.";
  }
  function downloadComparisonSvg(snapshotId) {
    const url = comparisonArtifactUrl(snapshotId, "svg");
    if (!url) return;
    const link = document.createElement("a"); link.href = url; link.download = "repayment-comparison-" + snapshotId + ".svg"; link.click();
  }
  async function createSnapshotShareLink(snapshotId) {
    if (!advisorClient) return;
    advisorComparisonStatus.textContent = "Freezing this exact retained comparison into a secure borrower link…";
    try {
      const body = await advisorApi("/api/advisor/clients/" + encodeURIComponent(advisorClient.clientId) + "/plan-selections", { method:"POST", body:JSON.stringify({ snapshotId }) });
      const url = location.origin + "/share/" + body.selection.shareToken;
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch {}
      window.prompt(copied ? "Secure borrower link copied. You can also copy it here:" : "Copy this secure borrower link:", url);
      advisorComparisonStatus.textContent = "Secure link created from " + snapshotId + (copied ? " and copied to the clipboard." : ".") + " It uses the same frozen comparison; opening the borrower review starts the existing 15-minute review window.";
      await loadAdvisorHistory();
    } catch (error) { advisorComparisonStatus.textContent = error instanceof Error ? error.message : "Unable to create the secure borrower link."; }
  }
`;
