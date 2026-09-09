// V0.9.10B — share page shell. Presentation assembly only.
import { SHARE_CSS } from "../styles/share-css.ts";
import { SHARE_MARKUP } from "../markup/share-markup.ts";
import { SHARE_SCRIPT } from "../behavior/share-script.ts";

export const SHARE_UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Your repayment plan comparison</title>
  <style>
` + SHARE_CSS + String.raw`
  </style>
</head>
<body>
` + SHARE_MARKUP + String.raw`<script>
` + SHARE_SCRIPT + String.raw`</script>
</body>
</html>`;
