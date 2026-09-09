// V0.9.10B — advisor workspace page shell. Presentation assembly only.
import { ADVISOR_WORKSPACE_CSS } from "../styles/advisor-workspace-css.ts";
import { ADVISOR_WORKSPACE_MARKUP } from "../markup/advisor-workspace-markup.ts";
import { ADVISOR_WORKSPACE_SCRIPT } from "../behavior/advisor-workspace-script.ts";

export const ADVISOR_UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Advisor Workspace · Student Loan IDR</title>
  <style>
` + ADVISOR_WORKSPACE_CSS + String.raw`
  </style>
</head>
<body>
` + ADVISOR_WORKSPACE_MARKUP + String.raw`<script>
` + ADVISOR_WORKSPACE_SCRIPT + String.raw`</script>
</body>
</html>`;
