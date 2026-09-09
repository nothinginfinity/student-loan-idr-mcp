export const SHARE_CSS = String.raw`    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: Canvas; color: CanvasText; line-height: 1.5; }
    main { width: min(760px, calc(100% - 28px)); margin: 0 auto; padding: 32px 0 60px; }
    h1 { font-size: clamp(1.6rem, 5vw, 2.4rem); line-height: 1.1; letter-spacing: -.03em; margin: 8px 0 14px; }
    h2, h3 { margin-top: 0; }
    .muted { color: color-mix(in srgb, CanvasText 66%, transparent); }
    .notice, .panel { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 16px; padding: 18px; background: color-mix(in srgb, CanvasText 3%, Canvas); }
    .notice { margin: 16px 0; }
    .panel { margin: 18px 0; }
    button { font: inherit; border: 0; border-radius: 999px; padding: 12px 18px; font-weight: 750; cursor: pointer; background: CanvasText; color: Canvas; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button.secondary { background: color-mix(in srgb, CanvasText 8%, Canvas); color: CanvasText; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); }
    input { font: inherit; width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, CanvasText 24%, transparent); background: Canvas; color: CanvasText; }
    .plan-row { display: flex; align-items: center; gap: 14px; padding: 12px 0; border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
    .plan-row:first-of-type { border-top: none; }
    .plan-name { min-width: 90px; font-weight: 750; }
    .plan-bar-track { flex: 1; height: 26px; border-radius: 8px; background: color-mix(in srgb, CanvasText 8%, Canvas); position: relative; overflow: hidden; }
    .plan-bar-fill { height: 100%; border-radius: 8px; background: color-mix(in srgb, CanvasText 70%, Canvas); }
    .plan-bar-fill.flrs { background: #1a8f5e; }
    .plan-bar-fill.ineligible { background: color-mix(in srgb, CanvasText 18%, transparent); }
    .plan-amount { min-width: 76px; text-align: right; font-weight: 750; font-variant-numeric: tabular-nums; }
    .plan-select { min-width: 84px; }
    .badge { display: inline-flex; border: 1px solid currentColor; border-radius: 999px; padding: 2px 9px; font-size: .76rem; margin-left: 8px; }
    .badge.flrs { color: #1a8f5e; border-color: #1a8f5e; }
    [hidden] { display: none !important; }
    #status-line { min-height: 1.4em; }
    #countdown-line { font-size: 1.05rem; font-weight: 750; margin: 4px 0 0; min-height: 1.3em; }
    #countdown-line.countdown-urgent { color: #b3261e; }
    @media (max-width: 480px) { .plan-name { min-width: 60px; font-size: .92rem; } .plan-amount { min-width: 60px; } }`;
