export const BORROWER_COMPLETION_SCRIPT = String.raw`(() => {
  var toggle = document.getElementById("field-color-toggle");
  var completion = document.getElementById("field-completion");
  var fields = Array.prototype.slice.call(document.querySelectorAll("[data-fill-state]"));
  function isFilled(input) {
    if (!input) return false;
    if (input.type === "checkbox" || input.type === "radio") return input.checked;
    return String(input.value == null ? "" : input.value).trim().length > 0;
  }
  function ensureStatusEl(label) {
    var el = label.querySelector(".fill-status-text");
    if (!el) {
      el = document.createElement("span");
      el.className = "fill-status-text";
      label.appendChild(el);
    }
    return el;
  }
  function updateField(label) {
    var input = label.querySelector("input, select, textarea");
    if (!input) return;
    var state = label.getAttribute("data-fill-state");
    var statusEl = ensureStatusEl(label);
    label.classList.remove("fill-red", "fill-green", "fill-purple");
    if (isFilled(input)) {
      label.classList.add("fill-green");
      statusEl.textContent = "✓ Filled";
    } else if (state === "required") {
      label.classList.add("fill-red");
      statusEl.textContent = "! Required";
    } else {
      label.classList.add("fill-purple");
      statusEl.textContent = "○ Optional";
    }
  }
  function updateCompletion() {
    if (!completion) return;
    var visible = fields.filter(function (label) { return !label.hidden; });
    var required = visible.filter(function (label) { return label.getAttribute("data-fill-state") === "required"; });
    var optional = visible.filter(function (label) { return label.getAttribute("data-fill-state") === "optional"; });
    var requiredFilled = required.filter(function (label) { return isFilled(label.querySelector("input, select, textarea")); }).length;
    var optionalFilled = optional.filter(function (label) { return isFilled(label.querySelector("input, select, textarea")); }).length;
    completion.textContent = "Required: " + requiredFilled + "/" + required.length + " filled · Optional: " + optionalFilled + "/" + optional.length + " filled";
  }
  var completionTimer = null;
  function scheduleCompletionUpdate() {
    if (completionTimer) window.clearTimeout(completionTimer);
    completionTimer = window.setTimeout(updateCompletion, 400);
  }
  function refreshAll() { fields.forEach(updateField); updateCompletion(); }
  fields.forEach(function (label) {
    var input = label.querySelector("input, select, textarea");
    if (!input) return;
    input.addEventListener("input", function () { updateField(label); scheduleCompletionUpdate(); });
    input.addEventListener("change", function () { updateField(label); scheduleCompletionUpdate(); });
  });
  var cadenceControl = document.getElementById("cadence");
  if (cadenceControl) cadenceControl.addEventListener("change", function () { window.setTimeout(refreshAll, 0); });
  refreshAll();
  if (toggle) {
    toggle.addEventListener("change", function () {
      document.body.classList.toggle("field-colors-off", !toggle.checked);
    });
  }
})();
`;
