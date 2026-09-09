export const BORROWER_CSS = String.raw`    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color-scheme: light dark; }
    * { box-sizing: border-box; }
    :root { --ink: CanvasText; --paper: Canvas; --accent: #0f6e56; --line: color-mix(in srgb, CanvasText 16%, transparent); --raise: color-mix(in srgb, CanvasText 4%, Canvas); }
    body { margin: 0; background:
      radial-gradient(1200px 420px at 8% -10%, color-mix(in srgb, #0f6e56 16%, transparent), transparent 60%),
      Canvas; color: CanvasText; line-height: 1.5; }
    main { width: min(1040px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0 64px; }
    h1 { font-size: clamp(2rem, 7vw, 4rem); line-height: 1; letter-spacing: -0.045em; margin: 0 0 16px; }
    h2 { margin-top: 0; }
    .lede { max-width: 780px; font-size: 1.05rem; color: color-mix(in srgb, CanvasText 72%, transparent); }
    .notice { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 16px; padding: 16px; margin: 24px 0; background: color-mix(in srgb, CanvasText 4%, Canvas); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .span-2 { grid-column: 1 / -1; }
    label, legend { font-weight: 650; }
    label { display: grid; gap: 7px; }
    input, select, textarea, button { font: inherit; }
    input, select, textarea { width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); background: Canvas; color: CanvasText; }
    textarea { min-height: 96px; resize: vertical; }
    fieldset { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 12px; padding: 14px; margin: 0; }
    .checks { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; }
    .checks label { display: flex; align-items: center; gap: 7px; font-weight: 500; }
    .checks input { width: auto; }
    .actions { display: flex; gap: 12px; align-items: center; margin-top: 22px; flex-wrap: wrap; }
    button { border: 0; border-radius: 999px; padding: 12px 18px; font-weight: 750; cursor: pointer; background: CanvasText; color: Canvas; }
    button:disabled { opacity: .55; cursor: wait; }
    #status { min-height: 1.5em; color: color-mix(in srgb, CanvasText 70%, transparent); }
    #results { margin-top: 32px; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0 20px; }
    .metric, .plan { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 14px; padding: 16px; }
    .metric strong { display: block; font-size: 1.35rem; }
    .plans { display: grid; gap: 12px; }
    .plan-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .plan-head strong { font-size: 1.15rem; }
    .payment { font-size: 1.35rem; font-weight: 800; }
    .badge { display: inline-flex; padding: 3px 9px; border: 1px solid currentColor; border-radius: 999px; font-size: .82rem; text-transform: capitalize; }
    .muted { color: color-mix(in srgb, CanvasText 66%, transparent); }
    .advisor-savebar { border: 2px solid color-mix(in srgb, CanvasText 28%, transparent); border-radius: 16px; padding: 16px; margin: 20px 0 24px; background: color-mix(in srgb, CanvasText 6%, Canvas); }
    .advisor-savebar[hidden] { display: none; }
    .advisor-savebar-head { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
    .advisor-savebar .actions { margin-top: 0; }
    .link-button { display: inline-flex; align-items: center; border: 1px solid currentColor; border-radius: 999px; padding: 10px 15px; text-decoration: none; font-weight: 750; }
    .workspace { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 16px; padding: 18px; margin: 24px 0; }
    .guide-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
    .guide-transcript { display: grid; gap: 10px; margin: 16px 0; max-height: 360px; overflow: auto; padding-right: 4px; }
    .message { max-width: min(720px, 92%); padding: 10px 13px; border-radius: 14px; border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    .message.guide { justify-self: start; background: color-mix(in srgb, CanvasText 4%, Canvas); }
    .message.user { justify-self: end; background: CanvasText; color: Canvas; }
    .answer-bubbles { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
    .answer-bubbles button { padding: 9px 13px; background: color-mix(in srgb, CanvasText 8%, Canvas); color: CanvasText; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); }
    .guide-entry { display: flex; gap: 8px; align-items: center; }
    .guide-entry input { flex: 1; }
    .fact-ledger { margin-top: 16px; padding-top: 14px; border-top: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    .fact-ledger ul { margin-bottom: 0; }
    .quick-info { width: 100%; border-collapse: collapse; margin: 10px 0; font-variant-numeric: tabular-nums; }
    .quick-info th, .quick-info td { padding: 8px 10px; text-align: left; border-bottom: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    .quick-info th:last-child, .quick-info td:last-child { text-align: right; }
    .quick-callout { border-left: 4px solid currentColor; padding: 10px 12px; margin: 10px 0; background: color-mix(in srgb, CanvasText 4%, Canvas); border-radius: 0 10px 10px 0; }
    .document-workspace[hidden], #document-draft-area[hidden] { display: none; }
    .document-preview { white-space: pre-wrap; overflow: auto; max-height: 520px; padding: 16px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 12px; background: color-mix(in srgb, CanvasText 3%, Canvas); font: 0.92rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .document-review { display: flex; align-items: flex-start; gap: 9px; font-weight: 600; margin-top: 14px; }
    .document-review input { width: auto; margin-top: 4px; }
    .basis { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 8px; font-size: .78rem; font-weight: 750; border: 1px solid currentColor; margin-right: 6px; }
    .fact-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .fact { border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius: 12px; padding: 12px; }
    .fact strong { display: block; margin-bottom: 4px; }
    .readiness-list { display: grid; gap: 10px; margin-top: 12px; }
    .readiness-card { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 12px; padding: 12px; }
    .readiness-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    .readiness-card ul { margin-bottom: 0; }
    .readiness-actions { margin-top: 12px; }
    #portfolio-summary { margin-top: 12px; }
    .case-workspace[hidden], .comparison-workspace[hidden], .intelligence-workspace[hidden], .consultation-workspace[hidden] { display: none; }
    .consultation-source { border-left: 3px solid color-mix(in srgb, CanvasText 35%, transparent); padding-left: 10px; margin: 8px 0; }
    .comparison-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 14px 0; }
    .comparison-card, .chart-panel { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 14px; padding: 14px; }
    .comparison-card h3, .chart-panel h3 { margin: 0 0 8px; }
    .comparison-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
    .comparison-metrics div { border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent); padding-top: 7px; }
    .comparison-metrics strong { display: block; }
    .chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
    .chart-panel svg { display: block; width: 100%; height: auto; min-height: 220px; overflow: visible; }
    .chart-panel .axis { stroke: color-mix(in srgb, CanvasText 28%, transparent); stroke-width: 1; }
    .chart-panel .series { fill: none; stroke: currentColor; stroke-width: 3; }
    .chart-panel text { fill: currentColor; font: 12px ui-sans-serif, system-ui, sans-serif; }
    .comparison-assumptions { margin-top: 14px; }
    .history-workspace[hidden] { display: none; }
    .history-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .history-list { display: grid; gap: 10px; }
    .history-item { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 12px; padding: 12px; }
    .history-item .actions { margin-top: 10px; }
    ul { padding-left: 22px; }
    a { color: inherit; }
    footer { margin-top: 36px; font-size: .9rem; color: color-mix(in srgb, CanvasText 65%, transparent); }
    .step-rail { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 18px 0 24px; position: sticky; top: 0; z-index: 30; padding: 10px 0 8px; background: color-mix(in srgb, Canvas 88%, transparent); backdrop-filter: blur(10px); }
    .step-tab { width: 100%; border-radius: 14px; padding: 10px 12px; background: var(--raise); color: CanvasText; border: 1px solid var(--line); font-weight: 750; min-height: 44px; }
    .step-tab[aria-current="step"] { background: #0f6e56; color: #f4fff9; border-color: #0f6e56; }
    .step-panel[hidden] { display: none !important; }
    .field-completion { margin: -8px 0 16px; font-size: .92rem; }
    @media (max-width: 700px) { .grid, .summary, .fact-grid, .comparison-cards, .chart-grid, .history-grid { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } main { width: min(100% - 24px, 1040px); padding-top: 28px; } .step-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); } #guided-assistant, #loan-import, #calculator-form, #results { scroll-margin-top: 96px; } }
    .field-color-toggle { display: flex; align-items: center; gap: 8px; font-weight: 600; margin: 4px 0 18px; }
    .field-color-toggle input { width: auto; }
    label[data-fill-state] { border-left: 4px solid transparent; border-radius: 6px; padding-left: 10px; margin-left: -14px; transition: border-color .15s ease, background-color .15s ease; }
    label[data-fill-state].fill-red { border-left-color: #dc2626; background: color-mix(in srgb, #dc2626 9%, transparent); }
    label[data-fill-state].fill-green { border-left-color: #16a34a; background: color-mix(in srgb, #16a34a 9%, transparent); }
    label[data-fill-state].fill-purple { border-left-color: #9333ea; background: color-mix(in srgb, #9333ea 9%, transparent); }
    .fill-status-text { font-size: .78rem; font-weight: 700; letter-spacing: .01em; }
    label[data-fill-state].fill-red .fill-status-text { color: #dc2626; }
    label[data-fill-state].fill-green .fill-status-text { color: #16a34a; }
    label[data-fill-state].fill-purple .fill-status-text { color: #9333ea; }
    body.field-colors-off .fill-status-text { color: inherit; }
    body.field-colors-off label[data-fill-state] { border-left-color: transparent; background: transparent; padding-left: 0; margin-left: 0; }`;
