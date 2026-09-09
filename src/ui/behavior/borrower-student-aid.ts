export const BORROWER_STUDENT_AID = String.raw`  function numericValue(value) {
    if (!value) return undefined;
    const normalized = value.replace(/[$,%]/g, "").replace(/,/g, "").trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function studentAidYesLocal(value) {
    const normalized = String(value || "").trim().toUpperCase();
    if (["Y", "YES", "TRUE", "1"].includes(normalized)) return true;
    if (["N", "NO", "FALSE", "0"].includes(normalized)) return false;
    return undefined;
  }

  function maskStudentAidIdentifierLocal(value) {
    const normalized = String(value || "").trim();
    return normalized ? "••••" + normalized.slice(-4) : null;
  }

  function mapLoanType(code, description, parentPlusIndicator) {
    const c = String(code || "").trim().toUpperCase();
    const value = String(description || "").toUpperCase();
    const hasParentPlus = studentAidYesLocal(parentPlusIndicator);
    if (["D0", "D1"].includes(c)) return "direct_subsidized";
    if (["D2", "D8"].includes(c)) return "direct_unsubsidized";
    if (c === "D3") return "direct_grad_plus";
    if (c === "D4") return "direct_parent_plus";
    if (["D5", "D6", "D9"].includes(c)) return hasParentPlus === true ? "direct_consolidation_with_parent_plus" : hasParentPlus === false ? "direct_consolidation_no_parent_plus" : null;
    if (c === "GB") return "ffel_grad_plus";
    if (c === "PL") return "ffel_parent_plus";
    if (c === "SF") return "ffel_subsidized_stafford";
    if (["SU", "SN"].includes(c)) return "ffel_unsubsidized_stafford";
    if (c === "CL") return hasParentPlus === true ? "ffel_consolidation_with_parent_plus" : hasParentPlus === false ? "ffel_consolidation_no_parent_plus" : null;
    if (["PU", "DU", "NU"].includes(c) || value.includes("PERKINS")) return "perkins";
    if (!value || value.includes("CONSOLIDAT")) return null;
    const isDirect = value.includes("DIRECT");
    const isFfel = value.includes("FFEL") || value.includes("FEDERAL STAFFORD");
    if (isDirect) {
      if (value.includes("PARENT") && value.includes("PLUS")) return "direct_parent_plus";
      if ((value.includes("GRAD") || value.includes("PROFESSIONAL")) && value.includes("PLUS")) return "direct_grad_plus";
      if (value.includes("UNSUBSID")) return "direct_unsubsidized";
      if (value.includes("SUBSID")) return "direct_subsidized";
    }
    if (isFfel) {
      if (value.includes("PARENT") && value.includes("PLUS")) return "ffel_parent_plus";
      if ((value.includes("GRAD") || value.includes("PROFESSIONAL")) && value.includes("PLUS")) return "ffel_grad_plus";
      if (value.includes("UNSUBSID") || value.includes("NON-SUBSID")) return "ffel_unsubsidized_stafford";
      if (value.includes("SUBSID")) return "ffel_subsidized_stafford";
    }
    return null;
  }

  function disbursementPeriod(value) {
    const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const timestamp = match ? Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])) : Date.parse(value || "");
    if (!Number.isFinite(timestamp)) return null;
    return timestamp >= Date.UTC(2026, 6, 1) ? "on_or_after_2026_07_01" : "before_2026_07_01";
  }

  function parseStudentAidData(text) {
    const student = {};
    const records = [];
    const rawLines = text.split(/\r?\n/);
    const tokens = rawLines.flatMap((rawLine, lineIndex) => {
      const separator = rawLine.indexOf(":");
      if (separator < 0) return [];
      return [{ lineNumber: lineIndex + 1, key: rawLine.slice(0, separator).trim(), value: rawLine.slice(separator + 1).trim() }];
    });
    const hasAwardAnchors = tokens.some((token) => token.key === "Loan Award ID");
    const firstAwardIndex = tokens.findIndex((token) => token.key === "Loan Award ID");
    const firstTypeIndex = tokens.findIndex((token) => token.key === "Loan Type Code" || token.key === "Loan Type");
    const awardFirstLayout = hasAwardAnchors && (firstTypeIndex < 0 || firstAwardIndex < firstTypeIndex);
    const recognizedLabels = new Set();
    const unmappedLabels = new Set();
    const structuralWarnings = [];
    const validationIssues = [];
    let fileRequestDate = null;
    let current = null;
    let currentStatus = null;
    let currentDisbursement = null;
    let currentDelinquency = null;
    let currentContact = null;
    const newLoan = () => ({ statuses: [], disbursements: [], delinquencies: [], contacts: [], provenance: {} });
    const ensureCurrent = () => { if (!current) current = newLoan(); return current; };
    const pushCurrent = () => { if (current) records.push(current); current = null; currentStatus = null; currentDisbursement = null; currentDelinquency = null; currentContact = null; };
    const dateTimestamp = (value) => {
      if (!value) return undefined;
      const match = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const timestamp = match ? Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])) : Date.parse(value);
      return Number.isFinite(timestamp) ? timestamp : undefined;
    };
    const latestStatus = (statuses) => {
      let latest = undefined;
      let latestTimestamp = Number.NEGATIVE_INFINITY;
      (statuses || []).forEach((statusFact) => {
        const timestamp = dateTimestamp(statusFact.effectiveDate);
        if (timestamp !== undefined && timestamp > latestTimestamp) { latest = statusFact; latestTimestamp = timestamp; }
      });
      return latest || (statuses || [])[0];
    };
    const textFields = {
      "Loan Attending School Name":"attendingSchoolName", "Loan Attending School OPEID":"attendingSchoolOpeid", "Loan Date":"loanDate", "Loan Repayment Begin Date":"repaymentBeginDate", "Loan Period Begin Date":"periodBeginDate", "Loan Period End Date":"periodEndDate", "Loan Canceled Date":"canceledDate", "Loan Outstanding Principal Balance as of Date":"outstandingPrincipalAsOfDate", "Loan Outstanding Interest Balance as of Date":"outstandingInterestAsOfDate", "Loan Interest Rate Type Code":"interestRateTypeCode", "Loan Interest Rate Type Description":"interestRateTypeDescription", "Loan Repayment Plan Type Code":"repaymentPlanTypeCode", "Loan Repayment Plan Type Code Description":"repaymentPlanDescription", "Loan Repayment Plan Begin Date":"repaymentPlanBeginDate", "Loan Repayment Plan IDR Plan Anniversary Date":"repaymentPlanIdrAnniversaryDate", "Loan Confirmed Subsidy Status":"confirmedSubsidyStatus", "Loan Reaffirmation Date":"reaffirmationDate", "Loan Most Recent Payment Effective Date":"mostRecentPaymentEffectiveDate", "Loan Next Payment Due Date":"nextPaymentDueDate", "Academic Level":"academicLevel", "Award Year":"awardYear", "Reaffirmation flag":"reaffirmationFlag", "UpdtDt":"updateDate", "Loan Updated Date":"updateDate", "Additional Unsubsidized Loan Flag":"additionalUnsubsidizedLoanFlag", "Joint Consolidation Loan Indicator":"jointConsolidationLoanIndicator", "Joint Consolidation Loan Separation Indicator":"jointConsolidationLoanSeparationIndicator", "Loan Special Contact Reason":"loanSpecialContactReason", "Loan Special Contact":"loanSpecialContact", "Current Loan Status":"currentLoanStatusCode", "Current Loan Status Description":"currentLoanStatusDescription", "Parent Plus First Level Consolidation Indicator":"parentPlusFirstLevelConsolidationIndicator", "Consolidation Loan With Any Parent Plus Indicator":"consolidationLoanWithAnyParentPlusIndicator"
    };
    const numericFields = {
      "Loan Amount":"originalAmount", "Loan Disbursed Amount":"disbursedAmount", "Loan Canceled Amount":"canceledAmount", "Loan Outstanding Principal Balance":"outstandingPrincipal", "Loan Outstanding Interest Balance":"outstandingInterest", "Loan Interest Rate":"interestRatePercent", "Loan Actual Interest Rate":"actualInterestRatePercent", "Loan Statutory Interest Rate":"statutoryInterestRatePercent", "Loan Repayment Plan Scheduled Amount":"repaymentPlanScheduledAmount", "Loan Subsidized Usage in Years":"subsidizedUsageYears", "Loan Cumulative Payment Amount":"cumulativePaymentAmount", "Loan PSLF Cumulative Matched Months":"pslfCumulativeMatchedMonths", "Capitalized Interest":"capitalizedInterest", "Net Loan Amount":"netLoanAmount", "Calculated Subsidized Aggregate OPB":"calculatedSubsidizedAggregateOpb", "Calculated Unsubsidized Aggregate OPB":"calculatedUnsubsidizedAggregateOpb", "Calculated Combined Aggregate OPB":"calculatedCombinedAggregateOpb", "Highest Historical Outstanding Principal Balance (OPB)":"highestHistoricalOutstandingPrincipalBalance", "Current Standard-Standard Schedule Payment Amount":"currentStandardSchedulePaymentAmount", "Permanent Standard-Standard Schedule Payment Amount":"permanentStandardSchedulePaymentAmount"
    };
    for (const token of tokens) {
      const { key, value, lineNumber } = token;
      if (!key) continue;
      if (key === "File Request Date") { recognizedLabels.add(key); fileRequestDate = value || null; continue; }
      if (key.startsWith("Student ") || key.startsWith("Grant ")) { recognizedLabels.add(key); if (key.startsWith("Student ")) student[key] = value; continue; }
      if (key === "Loan Award ID") {
        recognizedLabels.add(key);
        if (!current) current = newLoan();
        else if (current.__hasAwardAnchor) { pushCurrent(); current = newLoan(); }
        current.__hasAwardAnchor = true;
        const masked = maskStudentAidIdentifierLocal(value);
        if (masked) { current.maskedAwardId = masked; current.provenance.maskedAwardId = "derived_studentaid"; }
        continue;
      }
      if ((!hasAwardAnchors || !awardFirstLayout) && (key === "Loan Type Code" || key === "Loan Type")) {
        recognizedLabels.add(key);
        pushCurrent();
        current = newLoan();
        current[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = value || null;
        if (value) current.provenance[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = "imported_studentaid";
        continue;
      }
      if (key === "Loan Type Code" || key === "Loan Type") { recognizedLabels.add(key); const loan = ensureCurrent(); loan[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = value || null; if (value) loan.provenance[key === "Loan Type Code" ? "loanTypeCode" : "loanTypeDescription"] = "imported_studentaid"; continue; }
      if (key === "Loan Type Description") { recognizedLabels.add(key); const loan = ensureCurrent(); loan.loanTypeDescription = value || null; if (value) loan.provenance.loanTypeDescription = "imported_studentaid"; continue; }
      if (textFields[key]) { recognizedLabels.add(key); const loan = ensureCurrent(); if (value) { loan[textFields[key]] = value; loan.provenance[textFields[key]] = "imported_studentaid"; } continue; }
      if (numericFields[key]) { recognizedLabels.add(key); const loan = ensureCurrent(); const number = numericValue(value); if (number !== undefined) { loan[numericFields[key]] = number; loan.provenance[numericFields[key]] = "imported_studentaid"; } continue; }
      if (key === "Loan Delinquency Date" || key === "DelinqDate") { recognizedLabels.add(key); const loan = ensureCurrent(); currentDelinquency = { date: value || undefined }; loan.delinquencies.push(currentDelinquency); loan.delinquencyDate = value || undefined; if (value) loan.provenance.delinquencyDate = "imported_studentaid"; continue; }
      if (key === "Loan Delinquency End Date") { recognizedLabels.add(key); const loan = ensureCurrent(); loan.delinquencyEndDate = value || undefined; if (value) loan.provenance.delinquencyEndDate = "imported_studentaid"; if (currentDelinquency) currentDelinquency.endDate = value || undefined; else structuralWarnings.push("Line " + lineNumber + ": Loan Delinquency End Date appeared without a preceding delinquency start date."); continue; }
      if (key === "Loan Status") { recognizedLabels.add(key); const loan = ensureCurrent(); currentStatus = { code: value || undefined }; loan.statuses.push(currentStatus); continue; }
      if (key === "Loan Status Description") { recognizedLabels.add(key); if (currentStatus) currentStatus.description = value || undefined; else structuralWarnings.push("Line " + lineNumber + ": Loan Status Description appeared without a preceding Loan Status."); continue; }
      if (key === "Loan Status Effective Date") { recognizedLabels.add(key); if (currentStatus) currentStatus.effectiveDate = value || undefined; else structuralWarnings.push("Line " + lineNumber + ": Loan Status Effective Date appeared without a preceding Loan Status."); continue; }
      if (key === "Loan Disbursement Date") { recognizedLabels.add(key); const loan = ensureCurrent(); currentDisbursement = { date: value || undefined }; loan.disbursements.push(currentDisbursement); continue; }
      if (key === "Loan Disbursement Amount") { recognizedLabels.add(key); if (currentDisbursement) currentDisbursement.amount = numericValue(value); else structuralWarnings.push("Line " + lineNumber + ": Loan Disbursement Amount appeared without a preceding disbursement date."); continue; }
      if (key === "Loan Contact Type") { recognizedLabels.add(key); const loan = ensureCurrent(); currentContact = { type: value || undefined }; loan.contacts.push(currentContact); continue; }
      if (key.startsWith("Loan Contact ")) {
        const contactFields = { "Loan Contact Code":"code", "Loan Contact Name":"name", "Loan Contact Street Address 1":"streetAddress1", "Loan Contact Street Address 2":"streetAddress2", "Loan Contact City":"city", "Loan Contact State Code":"stateCode", "Loan Contact Zip Code":"zipCode", "Loan Contact Phone Number":"phoneNumber", "Loan Contact Phone Extension":"phoneExtension", "Loan Contact Email Address":"emailAddress", "Loan Contact Web Site Address":"websiteAddress" };
        if (contactFields[key]) { recognizedLabels.add(key); if (currentContact && value) currentContact[contactFields[key]] = value; else if (!currentContact) structuralWarnings.push("Line " + lineNumber + ": " + key + " appeared without a preceding Loan Contact Type."); }
        else unmappedLabels.add(key);
        continue;
      }
      if (key === "Most Relevant") { recognizedLabels.add(key); if (currentContact) currentContact.mostRelevant = studentAidYesLocal(value) === true; else structuralWarnings.push("Line " + lineNumber + ": Most Relevant appeared without a preceding Loan Contact Type."); continue; }
      unmappedLabels.add(key);
    }
    pushCurrent();
    if (!hasAwardAnchors && records.length) structuralWarnings.push("Loan Award ID anchors were not present; parser used the conservative legacy loan-boundary fallback.");
    if (!records.length) validationIssues.push("No loan records were assembled from the StudentAid data.");
    const loans = records.map((loan, loanIndex) => {
      const dateForPeriod = loan.disbursements.find((item) => item.date)?.date || loan.loanDate;
      const mappedLoanType = mapLoanType(loan.loanTypeCode, loan.loanTypeDescription, loan.consolidationLoanWithAnyParentPlusIndicator);
      const period = disbursementPeriod(dateForPeriod);
      const newestStatus = latestStatus(loan.statuses || []);
      const explicitCode = String(loan.currentLoanStatusCode || "").trim().toUpperCase();
      const explicitDescription = String(loan.currentLoanStatusDescription || "").trim().toUpperCase();
      const newestCode = String(newestStatus?.code || "").trim().toUpperCase();
      const newestDescription = String(newestStatus?.description || "").trim().toUpperCase();
      if ((explicitCode && newestCode && explicitCode !== newestCode) || (explicitDescription && newestDescription && explicitDescription !== newestDescription)) structuralWarnings.push("Loan " + (loanIndex + 1) + ": explicit current status differs from the newest dated status timeline entry.");
      const status = explicitDescription || newestDescription;
      const inDefault = status.includes("DEFAULT") && !status.includes("NON-DEFAULT");
      const provenance = { ...loan.provenance };
      if (mappedLoanType) provenance.mappedLoanType = "derived_studentaid";
      if (period) provenance.disbursementPeriod = "derived_studentaid";
      provenance.inDefault = "derived_studentaid";
      const { __hasAwardAnchor, ...normalizedLoan } = loan;
      return { ...normalizedLoan, loanIndex, mappedLoanType, disbursementPeriod: period, inDefault, provenance };
    });
    const active = loans.filter((loan) => typeof loan.outstandingPrincipal === "number" && loan.outstandingPrincipal > 0);
    const repaymentLoans = active.filter((loan) => typeof loan.interestRatePercent === "number").map((loan) => ({ principal: loan.outstandingPrincipal, annualInterestRatePercent: loan.interestRatePercent }));
    const fullyMappedForEligibility = active.length > 0 && active.every((loan) => loan.mappedLoanType && loan.disbursementPeriod);
    const eligibilityLoans = fullyMappedForEligibility ? active.map((loan) => ({ loanType: loan.mappedLoanType, disbursementPeriod: loan.disbursementPeriod, ...(loan.inDefault ? { inDefault: true } : {}) })) : undefined;
    const totalPrincipal = active.reduce((sum, loan) => sum + loan.outstandingPrincipal, 0);
    const totalInterest = active.reduce((sum, loan) => sum + (loan.outstandingInterest || 0), 0);
    const ambiguousCount = active.filter((loan) => !loan.mappedLoanType || !loan.disbursementPeriod).length;
    const name = [student["Student First Name"], student["Student Middle Initial"], student["Student Last Name"]].filter(Boolean).join(" ").trim();
    const preferredPhoneKeys = [["Student Cell Phone Number","Student Cell Phone Country Code","Student Cell Phone Preferred"],["Student Home Phone Number","Student Home Phone Country Code","Student Home Phone Preferred"],["Student Work Phone Number","Student Work Phone Country Code","Student Work Phone Preferred"]];
    const phoneChoice = preferredPhoneKeys.find(([numberKey,,preferredKey]) => student[numberKey] && studentAidYesLocal(student[preferredKey]) === true) || preferredPhoneKeys.find(([numberKey]) => student[numberKey]);
    const phone = phoneChoice ? [student[phoneChoice[1]] ? "+" + String(student[phoneChoice[1]]).replace(/^\+/,"") : "", student[phoneChoice[0]]].filter(Boolean).join(" ") : "";
    const borrower = { provenance: {} };
    [["displayName",name],["email",student["Student Email Address"]],["phone",phone],["streetAddress1",student["Student Street Address 1"]],["streetAddress2",student["Student Street Address 2"]],["city",student["Student City"]],["stateCode",student["Student State Code"]],["countryCode",student["Student Country Code"]],["zipCode",student["Student Zip Code"]]].forEach(([field,value]) => { if (value) { borrower[field] = String(value).trim(); borrower.provenance[field] = "imported_studentaid"; } });
    const relevantContact = active.flatMap((loan) => loan.contacts || []).find((contact) => contact.mostRelevant && contact.name) || active.flatMap((loan) => loan.contacts || []).find((contact) => contact.name);
    const summary = { loanCount: loans.length, activeLoanCount: active.length, totalOutstandingPrincipal: totalPrincipal, totalOutstandingInterest: totalInterest, repaymentLoanCount: repaymentLoans.length, eligibilityMappedLoanCount: active.length - ambiguousCount, ambiguousEligibilityLoanCount: ambiguousCount, hasLoanDisbursedOnOrAfterJuly1_2026: active.some((loan) => loan.disbursementPeriod === "on_or_after_2026_07_01") };
    const diagnostics = { mappingVersion: "2026-09-05-v2", rawLineCount: rawLines.length, parsedLineCount: tokens.length, recognizedLabelCount: recognizedLabels.size, unmappedLabels: Array.from(unmappedLabels).filter(Boolean).sort(), structuralWarnings, validationIssues };
    return { fileRequestDate, borrower, loans, repaymentLoans, eligibilityLoans, totalPrincipal, totalInterest, ambiguousCount, summary, servicerName: relevantContact?.name || null, diagnostics };
  }

`;
