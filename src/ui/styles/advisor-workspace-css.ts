export const ADVISOR_WORKSPACE_CSS = String.raw`    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: radial-gradient(1000px 380px at 90% -20%, color-mix(in srgb, #0f6e56 14%, transparent), transparent 55%), Canvas; color: CanvasText; line-height: 1.5; }
    main { width: min(1100px, calc(100% - 28px)); margin: 0 auto; padding: 32px 0 60px; }
    h1 { font-size: clamp(2rem, 6vw, 3.8rem); line-height: 1; letter-spacing: -.04em; margin: 8px 0 14px; }
    h2, h3 { margin-top: 0; }
    .muted { color: color-mix(in srgb, CanvasText 66%, transparent); }
    .notice, .panel, .client-card { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 16px; padding: 16px; background: color-mix(in srgb, CanvasText 3%, Canvas); }
    .notice { margin: 20px 0; }
    .panel { margin: 18px 0; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    label { display: grid; gap: 7px; font-weight: 650; }
    input, button { font: inherit; }
    input { width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, CanvasText 24%, transparent); background: Canvas; color: CanvasText; }
    button, .button-link { border: 0; border-radius: 999px; padding: 11px 16px; font-weight: 750; cursor: pointer; background: CanvasText; color: Canvas; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
    .secondary { background: color-mix(in srgb, CanvasText 8%, Canvas); color: CanvasText; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); }
    .actions { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; margin-top: 14px; }
    .topbar { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
    .client-list { display: grid; gap: 12px; margin-top: 14px; }
    .client-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    .badges { display: flex; gap: 7px; flex-wrap: wrap; }
    .badge { display: inline-flex; border: 1px solid currentColor; border-radius: 999px; padding: 2px 8px; font-size: .78rem; text-transform: capitalize; }
    .action-summary { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0 4px; }
    .action-summary strong { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 999px; padding: 5px 10px; }
    .action-reason { margin: 10px 0 0; }
    .attention { font-weight: 800; }
    [hidden] { display: none !important; }
    #status, #auth-status { min-height: 1.5em; }
    a { color: inherit; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } main { width: min(100% - 20px, 1100px); padding-top: 22px; } }`;
