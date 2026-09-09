export const BORROWER_BOOT = String.raw`(() => {
  const activateStep = (name) => {
    document.querySelectorAll("[data-step-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-step-panel") !== name;
    });
    document.querySelectorAll(".step-tab").forEach((tab) => {
      if (tab.getAttribute("data-step") === name) tab.setAttribute("aria-current", "step");
      else tab.removeAttribute("aria-current");
    });
    const map = { portfolio: "loan-import", profile: "calculator-form", guide: "guided-assistant", analysis: "results" };
    const target = document.getElementById(map[name] || "");
    if (target) target.scrollIntoView({ block: "start" });
  };
  document.querySelector(".step-rail")?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-step]");
    if (tab) activateStep(tab.getAttribute("data-step"));
  });
  const hashStep = {
    "#loan-import": "portfolio",
    "#calculator-form": "profile",
    "#guided-assistant": "guide",
    "#document-workspace": "guide",
    "#results": "analysis",
    "#borrower-consultation-workspace": "analysis",
    "#advisor-comparison-workspace": "analysis"
  };
  const initial = hashStep[location.hash] || "portfolio";
  activateStep(initial);
  window.addEventListener("hashchange", () => activateStep(hashStep[location.hash] || "portfolio"));
  const form = document.getElementById("calculator-form");
  const cadence = document.getElementById("cadence");
  const hoursField = document.getElementById("hours-field");
  const weeksField = document.getElementById("weeks-field");
  const status = document.getElementById("status");
  const results = document.getElementById("results");
  const submit = document.getElementById("submit");
  const borrowerConsultationWorkspace = document.getElementById("borrower-consultation-workspace");
  const borrowerConsultationTranscript = document.getElementById("borrower-consultation-transcript");
  const borrowerConsultationForm = document.getElementById("borrower-consultation-form");
  const borrowerConsultationQuestion = document.getElementById("borrower-consultation-question");
  const borrowerConsultationSubmit = document.getElementById("borrower-consultation-submit");
  const borrowerConsultationStatus = document.getElementById("borrower-consultation-status");
  const loanFile = document.getElementById("loan-file");
  const importStatus = document.getElementById("import-status");
  const portfolioSummary = document.getElementById("portfolio-summary");
  const studentAidReview = document.getElementById("studentaid-review");
  const guideTranscript = document.getElementById("guide-transcript");
  const guideAnswers = document.getElementById("guide-answers");
  const guideForm = document.getElementById("guide-form");
  const guideInput = document.getElementById("guide-input");
  const guidedFactsList = document.getElementById("guided-facts");
  const documentWorkspace = document.getElementById("document-workspace");
  const documentForm = document.getElementById("document-form");
  const documentGenerate = document.getElementById("document-generate");
  const documentStatus = document.getElementById("document-status");
  const documentDraftArea = document.getElementById("document-draft-area");
  const documentPreview = document.getElementById("document-preview");
  const documentReviewed = document.getElementById("document-reviewed");
  const documentPrint = document.getElementById("document-print");
  const documentDownload = document.getElementById("document-download");
  const documentScope = document.getElementById("document-scope");
  const readinessSummary = document.getElementById("readiness-summary");
  const incomeSourceReadiness = document.getElementById("income-source-readiness");
  const addIncomeSource = document.getElementById("add-income-source");
  const advisorClientBar = document.getElementById("advisor-client-bar");
  const advisorClientName = document.getElementById("advisor-client-name");
  const advisorSaveProgress = document.getElementById("advisor-save-progress");
  const advisorRegenerateDocument = document.getElementById("advisor-regenerate-document");
  const advisorViewCaseFile = document.getElementById("advisor-view-case-file");
  const advisorOpenConsultation = document.getElementById("advisor-open-consultation");
  const advisorConsultationWorkspace = document.getElementById("advisor-consultation-workspace");
  const advisorConsultationTranscript = document.getElementById("advisor-consultation-transcript");
  const advisorConsultationForm = document.getElementById("advisor-consultation-form");
  const advisorConsultationQuestion = document.getElementById("advisor-consultation-question");
  const advisorConsultationSubmit = document.getElementById("advisor-consultation-submit");
  const advisorConsultationStatus = document.getElementById("advisor-consultation-status");
  const advisorViewIntelligence = document.getElementById("advisor-view-intelligence");
  const advisorComparePlans = document.getElementById("advisor-compare-plans");
  const advisorRetainCalculation = document.getElementById("advisor-retain-calculation");
  const advisorOpenHistory = document.getElementById("advisor-open-history");
  const advisorRetainComparison = document.getElementById("advisor-retain-comparison");
  const advisorPrintComparison = document.getElementById("advisor-print-comparison");
  const advisorDownloadComparisonSvg = document.getElementById("advisor-download-comparison-svg");
  const advisorShareComparison = document.getElementById("advisor-share-comparison");
  const advisorRetainDocument = document.getElementById("advisor-retain-document");
  const advisorHistoryWorkspace = document.getElementById("advisor-history-workspace");
  const advisorHistoryStatus = document.getElementById("advisor-history-status");
  const advisorTimelineHistory = document.getElementById("advisor-timeline-history");
  const advisorArtifactHistory = document.getElementById("advisor-artifact-history");
  const advisorSnapshotHistory = document.getElementById("advisor-snapshot-history");
  const advisorRefreshHistory = document.getElementById("advisor-refresh-history");
  const advisorSaveStatus = document.getElementById("advisor-save-status");
  const advisorCaseWorkspace = document.getElementById("advisor-case-workspace");
  const advisorCaseStatus = document.getElementById("advisor-case-status");
  const advisorCaseSummary = document.getElementById("advisor-case-summary");
  const advisorCaseDetails = document.getElementById("advisor-case-details");
  const advisorIntelligenceWorkspace = document.getElementById("advisor-intelligence-workspace");
  const advisorIntelligenceStatus = document.getElementById("advisor-intelligence-status");
  const advisorIntelligenceSummary = document.getElementById("advisor-intelligence-summary");
  const advisorIntelligenceDetails = document.getElementById("advisor-intelligence-details");
  const advisorComparisonWorkspace = document.getElementById("advisor-comparison-workspace");
  const advisorComparisonStatus = document.getElementById("advisor-comparison-status");
  const advisorComparisonCards = document.getElementById("advisor-comparison-cards");
  const advisorPaymentChart = document.getElementById("advisor-payment-chart");
  const advisorPaidChart = document.getElementById("advisor-paid-chart");
  const advisorBalanceChart = document.getElementById("advisor-balance-chart");
  const advisorForgivenessChart = document.getElementById("advisor-forgiveness-chart");
  const advisorComparisonAssumptions = document.getElementById("advisor-comparison-assumptions");
  const advisorClientId = new URLSearchParams(window.location.search).get("advisorClient");
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const numberOrUndefined = (value) => value === "" ? undefined : Number(value);
  let importedPortfolio = null;
  let documentDraft = null;
  let guideDocumentGoal = null;
  let guideContinueToCalculator = false;
  let guideIncomeCadence = null;
  let guideIncomeAmount = null;
  let guidedIncomeSources = [];
  let pendingIncomeSource = null;
  let collectMultipleSources = false;
  let advisorClient = null;
  let advisorCsrfToken = null;
  let advisorIdentity = null;
  let advisorSavedIncome = null;
  let importedFieldProvenance = {};
  let advisorCalculatorDirty = false;
  let advisorLastComparisonSnapshotId = null;
  let lastBorrowerCalculatorPayload = null;
  let borrowerConsultationHistory = [];
  let advisorConsultationHistory = [];

`;
