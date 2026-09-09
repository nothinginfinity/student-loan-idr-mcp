// V0.9.10B — borrower page shell. Presentation assembly only; no routing/CSP/API.
import { BORROWER_CSS } from "../styles/borrower-css.ts";
import { BORROWER_MARKUP } from "../markup/borrower-markup.ts";
import { BORROWER_SCRIPT, BORROWER_COMPLETION_SCRIPT } from "../behavior/borrower-script.ts";

export const BORROWER_UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Student Loan IDR Estimate</title>
  <style>
` + BORROWER_CSS + String.raw`
  </style>
</head>
<body>
` + BORROWER_MARKUP + String.raw`<script>
` + BORROWER_SCRIPT + String.raw`</script>
<script>
` + BORROWER_COMPLETION_SCRIPT + String.raw`</script>
</body>
</html>`;
