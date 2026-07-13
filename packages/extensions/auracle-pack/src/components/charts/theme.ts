/**
 * shadcn chart theme, adapted for the auracle-pack extension.
 *
 * The extension bundle has no Tailwind (the host's is purged), so instead of
 * grafting the Tailwind toolchain we realise the exact shadcn Card + chart
 * utility classes as one scoped stylesheet, injected once the panelkit way
 * (`ensureShadChartStyles`). Every colour maps onto the Auracle IDE theme
 * variables so the cards track light/dark and the accent like every other
 * panel — no shadcn `globals.css` needed.
 */

const STYLE_ID = 'auracle-shadchart-styles';

/**
 * The shadcn token surface, scoped under `.auracle-shad`, mapped onto Auracle's
 * theme vars. `--chart-1` is the equity green, `--chart-2` the drawdown red;
 * both fall back to fixed hexes so the cards render even before the host
 * injects its variables (the same contrast trap that bit the QC stats).
 */
const SHEET = `
.auracle-shad {
  --sc-card: var(--bg-secondary, #16191e);
  --sc-fg: var(--text-primary, #d7dae0);
  --sc-muted: var(--text-tertiary, #8a8f98);
  --sc-border: var(--border-primary, rgba(146,152,166,0.20));
  --sc-radius: 12px;
  --chart-1: #3fb950;
  --chart-2: #e5534b;
  --sc-accent: var(--accent-primary, #60a5fa);
}
.auracle-shad.sc-card {
  display: flex;
  flex-direction: column;
  background: var(--sc-card);
  border: 1px solid var(--sc-border);
  border-radius: var(--sc-radius);
  color: var(--sc-fg);
  overflow: hidden;
}
.sc-header { display: flex; flex-direction: column; gap: 3px; padding: 14px 18px 6px; }
.sc-title { font-size: 15px; font-weight: 600; letter-spacing: -0.1px; color: var(--sc-fg); }
.sc-desc { font-size: 12.5px; color: var(--sc-muted); }
.sc-content { padding: 6px 8px 2px; }
.sc-footer { display: flex; flex-direction: column; gap: 2px; padding: 8px 18px 15px; }
.sc-trend { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--sc-fg); }
.sc-trend svg { width: 15px; height: 15px; }
.sc-sub { font-size: 12px; color: var(--sc-muted); }
.sc-tooltip {
  background: var(--sc-card);
  border: 1px solid var(--sc-border);
  border-radius: 8px;
  padding: 6px 9px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.38);
  font-variant-numeric: tabular-nums;
}
.sc-tt-label { font-size: 11px; color: var(--sc-muted); margin-bottom: 2px; }
.sc-tt-row { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--sc-fg); }
.sc-tt-dot { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.sc-tt-val { font-weight: 600; margin-left: 2px; }
.auracle-shad .recharts-cartesian-grid line { stroke: var(--sc-border); }
.auracle-shad .recharts-surface:focus { outline: none; }
`;

/** Inject the shadcn chart stylesheet once (idempotent), like panelkit. */
export function ensureShadChartStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** Minimal `cn` — the extension provides its own utility classes, so shadcn's
 *  tailwind-merge conflict resolution isn't needed; a filtered join is enough. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
