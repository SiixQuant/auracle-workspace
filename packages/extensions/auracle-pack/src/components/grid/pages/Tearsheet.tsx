/**
 * Tearsheet — the shared strategy-tearsheet body (WS-E, PRD DF5).
 *
 * The one implementation behind two surfaces: the `strategy` ROOM
 * ({@link StrategyPage} wraps this in a {@link RoomPage} frame) and the panel's
 * resting HOME hero ({@link GridHome} renders it as the default thing seen). It
 * holds everything that used to live inside StrategyPage — the Overview/Trades
 * and Backtest/Live segmented controls, the Overview (chart + metrics table),
 * the plain-English summary, the AuraPoint dossier card, the per-trade view, and
 * all the load/state logic keyed off the Spine's {@link focusStore}.
 *
 * ## Two segmented controls, not tabs
 * RoomPage forbids a tab STRIP for plan navigation, but this slice adds two
 * SCOPED, in-body segmented controls the PRD calls for:
 *   - Overview / Trades — which view.
 *   - Backtest / Live — which source (FR-E3). Backtest is wired to the `/result`
 *     tearsheet; Live shows an honest "no live deployment yet" rest.
 *
 * ## A recent-runs picker
 * The header carries a compact selector of the engine's recent chartable
 * backtests ({@link tearsheetRuns}). Selecting one PUBLISHES it to the focus
 * store, which every surface — this body included — follows, so switching the
 * strategy on show is one control, not a hunt through rooms.
 *
 * ## Numbers come from the engine, formatted once
 * Every figure is the engine's — `/result` for the curves and the QuantStats
 * stats, `/factors` for alpha — put through {@link tearsheetMetricRows}, the one
 * place the house honesty rules live (missing ⇒ em dash, never a fabricated
 * number). `onLoaded` lifts those rows to a host (the room's vitals) so the
 * headline and the table can never be two different runs.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PanelHost } from '@nimbalyst/extension-sdk';
import {
  buildDossier,
  openReport,
  tearsheetFactors,
  tearsheetResult,
  tearsheetRuns,
  tearsheetSummary,
  tearsheetTrades,
  type BacktestResultBody,
  type DossierReport,
  type RecentRun,
  type StrategySummaryBody,
  type TradeRecord,
} from '../../../engine/client';
import { focusStore } from '../../../engine/focusStore';
import { EM_DASH, statPercent, tearsheetMetricRows, type TearsheetMetricRow } from '../../../engine/houseStats';
import { prettifyPath } from '../../../engine/humanize';
import { composeThesis } from '../../../engine/signalThesis';
import { handOffToAgent, type AgentNote } from '../../aiPanel';
import { Button, CenterState, InlineNote, SkeletonRows, tint, tone } from '../../panelkit';
import { TearsheetChart } from '../../charts/TearsheetChart';
import { GRID_ACCENT } from '../gridTheme';

type TearsheetView = 'overview' | 'trades';
type TearsheetMode = 'backtest' | 'live';
type LoadPhase = 'idle' | 'loading' | 'loaded' | 'error';

interface LoadState {
  phase: LoadPhase;
  result: BacktestResultBody | null;
  alphaAnnual: number | null;
  benchmarkReturnPct: number | null;
}

const IDLE: LoadState = { phase: 'idle', result: null, alphaAnnual: null, benchmarkReturnPct: null };

/** The per-trade list's own load, carried separately from the Overview's so the
 *  Trades view fetches lazily (only when it is first shown for a run) without
 *  disturbing the tearsheet. `forRun` pins a load to the run it belongs to, so a
 *  toggle back to a run already loaded shows instantly and a stale fetch from a
 *  superseded run can never overwrite the current one. */
interface TradesLoad {
  phase: LoadPhase;
  trades: TradeRecord[];
  forRun: number | null;
}

const TRADES_IDLE: TradesLoad = { phase: 'idle', trades: [], forRun: null };

/**
 * The dossier card's decorative doc-spine letterhead hint, matched to the
 * reference mockup's gold band. This is ONLY the card's cue — the generated PDF
 * itself carries the real AuraPoint navy/blue letterhead (engine, FR-C5), a
 * swappable asset the panel never renders.
 */
const DOSSIER_GOLD = '#c8a25a';

const STYLE_ID = 'auracle-tearsheet-styles';

/** Injected once. Widths are `@container auracle-grid`, never `@media` — the
 *  Grid is sized by its host pane, not the window (the pack's hard rule). */
const SHEET = `
.auracle-tearsheet { display: flex; flex-direction: column; gap: 14px; }
.auracle-tearsheet__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.auracle-tearsheet__seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 9px; border: 1px solid ${tone.border}; background: ${tone.surface}; }
.auracle-tearsheet__segbtn { appearance: none; font: inherit; font-size: 12px; font-weight: 600; line-height: 1; padding: 6px 12px; border: 0; border-radius: 6px; background: transparent; color: ${tone.text3}; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: color 150ms ease-out, background-color 150ms ease-out; }
.auracle-tearsheet__segbtn:hover { color: ${tone.text}; }
.auracle-tearsheet__segbtn[data-active="true"] { color: ${tone.text}; background: color-mix(in srgb, ${GRID_ACCENT} 16%, transparent); }
.auracle-tearsheet__segcount { font-size: 11px; color: ${tone.text3}; font-variant-numeric: tabular-nums; }
.auracle-tearsheet__picker { position: relative; display: inline-flex; align-items: center; margin-left: auto; }
.auracle-tearsheet__picker::after { content: '▾'; position: absolute; right: 9px; pointer-events: none; font-size: 9px; color: ${GRID_ACCENT}; }
.auracle-tearsheet__pickersel { appearance: none; -webkit-appearance: none; font: inherit; font-size: 11.5px; font-weight: 600; color: ${tone.text2}; background: ${tone.surface}; border: 1px solid ${tint(GRID_ACCENT, 34)}; border-radius: 7px; padding: 5px 26px 5px 10px; max-width: 260px; text-overflow: ellipsis; cursor: pointer; transition: border-color 150ms ease-out, color 150ms ease-out; }
.auracle-tearsheet__pickersel:hover { border-color: ${GRID_ACCENT}; color: ${tone.text}; }
.auracle-tearsheet__pickersel:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.auracle-tearsheet__dash { display: grid; grid-template-columns: 1.7fr 1fr; gap: 14px; }
@container auracle-grid (max-width: 760px) { .auracle-tearsheet__dash { grid-template-columns: 1fr; } }
.auracle-tearsheet__card { background: ${tone.surface}; border: 1px solid ${tone.border}; border-radius: 10px; display: flex; flex-direction: column; overflow: hidden; }
.auracle-tearsheet__cardhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 15px 10px; }
.auracle-tearsheet__cardtitle { margin: 0; font-size: 14px; font-weight: 600; color: ${tone.text}; }
.auracle-tearsheet__metrics { display: flex; flex-direction: column; flex: 1; padding: 2px 0 6px; }
.auracle-tearsheet__mrow { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 15px; min-height: 33px; }
.auracle-tearsheet__mrow + .auracle-tearsheet__mrow { border-top: 1px solid ${tone.border}; }
.auracle-tearsheet__mk { color: ${tone.text2}; font-size: 12.5px; }
.auracle-tearsheet__mv { color: ${tone.text}; font-size: 12.5px; font-variant-numeric: tabular-nums; letter-spacing: 0.005em; }
.auracle-tearsheet__chartwrap { padding: 0 6px 6px; }
.auracle-tearsheet__provenance { margin: 2px 2px 0; font-size: 11.5px; line-height: 1.5; color: ${tone.text3}; font-variant-numeric: tabular-nums; }
.auracle-tearsheet__tv { display: flex; flex-direction: column; }
.auracle-tearsheet__tstat { display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 0 12px; }
.auracle-tearsheet__chip { font-size: 11.5px; color: ${tone.text2}; background: ${tone.surface}; border: 1px solid ${tone.border}; border-radius: 20px; padding: 5px 11px; white-space: nowrap; }
.auracle-tearsheet__chip b { color: ${tone.text}; font-weight: 600; font-variant-numeric: tabular-nums; }
.auracle-tearsheet__thead { display: grid; grid-template-columns: 1.5fr .8fr 1fr .7fr; gap: 8px; padding: 8px 14px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.11em; text-transform: uppercase; color: ${tone.text3}; }
.auracle-tearsheet__thead .auracle-tearsheet__r { text-align: right; }
.auracle-tearsheet__trow { border-top: 1px solid ${tone.border}; }
.auracle-tearsheet__tsum { display: grid; grid-template-columns: 1.5fr .8fr 1fr .7fr; gap: 8px; align-items: center; width: 100%; padding: 11px 14px; text-align: left; font: inherit; color: inherit; background: transparent; border: 0; cursor: pointer; transition: background-color 120ms ease-out; }
.auracle-tearsheet__tsum:hover { background: color-mix(in srgb, ${tone.text} 3%, transparent); }
.auracle-tearsheet__tsum:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: -2px; }
.auracle-tearsheet__sym { display: flex; align-items: center; gap: 9px; min-width: 0; }
.auracle-tearsheet__car { color: ${tone.text3}; font-size: 10px; flex: none; transition: transform 150ms ease-out; }
.auracle-tearsheet__trow[data-open="true"] .auracle-tearsheet__car { transform: rotate(90deg); }
.auracle-tearsheet__nm { font-weight: 600; font-size: 12.5px; color: ${tone.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.auracle-tearsheet__dir { font-size: 10px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; flex: none; }
.auracle-tearsheet__tcell { font-size: 12px; color: ${tone.text2}; font-variant-numeric: tabular-nums; }
.auracle-tearsheet__tcell.auracle-tearsheet__r { text-align: right; }
.auracle-tearsheet__contrib { text-align: right; font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.auracle-tearsheet__thesis { padding: 0 14px 14px 37px; }
.auracle-tearsheet__thlab { font-size: 9.5px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: ${tone.text3}; margin: 2px 0 6px; }
.auracle-tearsheet__clause { color: ${tone.text2}; font-size: 12.5px; line-height: 1.55; }
.auracle-tearsheet__clause + .auracle-tearsheet__clause { margin-top: 3px; }
.auracle-tearsheet__nosignal { color: ${tone.text3}; font-size: 12.5px; font-style: italic; }
.auracle-tearsheet__tfoot { font-size: 11px; line-height: 1.5; color: ${tone.text3}; padding: 11px 2px 0; }
@container auracle-grid (max-width: 640px) {
  .auracle-tearsheet__thead, .auracle-tearsheet__tsum { grid-template-columns: 1fr auto; }
  .auracle-tearsheet__hide { display: none; }
}
.auracle-tearsheet__summary { background: ${tone.surface}; border: 1px solid ${tone.border}; border-radius: 10px; padding: 14px 16px; }
.auracle-tearsheet__seclabel { font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: ${tone.text3}; }
.auracle-tearsheet__summarytext { margin: 8px 0 0; color: ${tone.text2}; font-size: 12.9px; line-height: 1.62; max-width: 92ch; }
.auracle-tearsheet__summarynote { margin-top: 8px; font-size: 11.5px; line-height: 1.5; color: ${tone.text3}; }
.auracle-tearsheet__summaryactions { margin-top: 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.auracle-tearsheet__report { display: flex; align-items: center; gap: 14px; background: ${tone.surface}; border: 1px solid ${tone.border}; border-radius: 10px; padding: 14px 16px; }
@container auracle-grid (max-width: 560px) { .auracle-tearsheet__report { flex-wrap: wrap; } }
.auracle-tearsheet__doc { width: 44px; height: 56px; border-radius: 5px; flex: none; position: relative; overflow: hidden; background: linear-gradient(160deg, #1a1c22, #0f1014); border: 1px solid ${tone.borderStrong}; }
.auracle-tearsheet__docband { position: absolute; top: 0; left: 0; right: 0; height: 14px; background: linear-gradient(90deg, ${DOSSIER_GOLD}, #a9823d); }
.auracle-tearsheet__docmark { position: absolute; top: 3px; left: 5px; font-size: 6.5px; font-weight: 700; letter-spacing: 0.06em; color: #161109; }
.auracle-tearsheet__reportmeta { flex: 1; min-width: 0; }
.auracle-tearsheet__rtitle { font-weight: 600; font-size: 13px; color: ${tone.text}; }
.auracle-tearsheet__firm { color: ${DOSSIER_GOLD}; }
.auracle-tearsheet__rsub { color: ${tone.text3}; font-size: 11.5px; margin-top: 3px; line-height: 1.5; }
.auracle-tearsheet__savedpath { font-size: 10.5px; color: ${tone.text3}; margin-top: 6px; font-variant-numeric: tabular-nums; }
.auracle-tearsheet__savedpath b { color: ${tone.text2}; font-weight: 500; }
`;

function ensureTearsheetStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** kebab-case DOM marker from a metric label ("Days Since ATH" → "days-since-ath"). */
function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Convert a growth-of-$1 curve to cumulative-return percent — (v − 1) × 100.
 * The engine's `/result` serves the equity and benchmark curves as growth (first
 * point 1.0; a value of 74.0475 means +7304.75%), but {@link TearsheetChart}'s
 * documented contract is percent, so the Overview converts here — at the one
 * seam where it assembles the chart data. Pure and robust to an empty/short
 * array.
 */
export function growthToPercent(points: number[]): number[] {
  if (!Array.isArray(points)) return [];
  return points.map((v) => (v - 1) * 100);
}

/**
 * The benchmark overlay's last point, converted from the engine's growth-of-$1
 * to cumulative-return percent — (last − 1) × 100 — or null when the run has no
 * benchmark. A SPY curve ending 8.924 reads as +792.4%.
 */
export function benchmarkTail(result: BacktestResultBody): number | null {
  const points = result.benchmark?.points;
  if (!points || points.length === 0) return null;
  const last = points[points.length - 1];
  return typeof last === 'number' && Number.isFinite(last) ? (last - 1) * 100 : null;
}

/** Group a non-negative integer with thousands separators ("4158" → "4,158"),
 *  locale-independent so the caption reads the same everywhere. */
function groupThousands(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The data-provenance caption — the real-data fact the owner wants visible,
 * built ONLY from fields the run already carries: the bar count (`n_bars`) and
 * the chart's first and last date. No data-source name is invented — bar count
 * and date range only. Returns null when the run carries neither, so it never
 * prints an empty caption.
 */
function provenanceLine(result: BacktestResultBody): string | null {
  const nBars =
    typeof result.n_bars === 'number' && Number.isFinite(result.n_bars) && result.n_bars > 0
      ? result.n_bars
      : null;
  const labels = result.chart?.labels;
  const first = labels && labels.length > 0 ? labels[0] : null;
  const last = labels && labels.length > 0 ? labels[labels.length - 1] : null;
  const parts: string[] = [];
  if (nBars !== null) parts.push(`Backtested on ${groupThousands(nBars)} daily bars`);
  if (first && last && first !== last) parts.push(`${first} → ${last}`);
  else if (first) parts.push(first);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function Segmented({
  options,
  value,
  onChange,
  testidPrefix,
}: {
  options: Array<{ id: string; label: string; count?: number }>;
  value: string;
  onChange: (id: string) => void;
  testidPrefix: string;
}): JSX.Element {
  return (
    <div className="auracle-tearsheet__seg" role="tablist">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          data-active={value === option.id}
          data-testid={`${testidPrefix}-${option.id}`}
          className="auracle-tearsheet__segbtn"
          onClick={() => onChange(option.id)}
        >
          {option.label}
          {typeof option.count === 'number' ? (
            <span className="auracle-tearsheet__segcount">{option.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A run's finished-at stamp as a short date — "Aug 5", or "Aug 5 ’24" when the
 *  year is not the current one. Unparseable in ⇒ empty, so the row drops it. */
function shortFinished(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!match) return '';
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return '';
  const year = Number(match[1]);
  const suffix = typeof document !== 'undefined' && year === new Date().getFullYear() ? '' : ` ’${String(year).slice(-2)}`;
  return `${month} ${Number(match[3])}${suffix}`;
}

/**
 * The recent-runs picker (WS-E). Lists the engine's recent chartable backtests
 * and, on select, PUBLISHES the chosen run to the focus store — the one control
 * that switches the strategy on show. Renders nothing until there is at least
 * one run to offer, so a fresh box never shows an empty dropdown. Reads the
 * feed once on mount; a failed read simply leaves it hidden.
 */
function RunPicker({ focusedJob }: { focusedJob: number | null }): JSX.Element | null {
  const [runs, setRuns] = useState<RecentRun[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await tearsheetRuns();
        if (!cancelled) setRuns(rows);
      } catch {
        if (!cancelled) setRuns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (runs.length === 0) return null;

  const value = focusedJob !== null && runs.some((run) => run.jobId === focusedJob) ? String(focusedJob) : '';

  const select = (raw: string): void => {
    const jobId = Number(raw);
    const run = runs.find((candidate) => candidate.jobId === jobId);
    if (!run) return;
    focusStore.publish({
      strategy: { filePath: run.strategyPath, dottedPath: run.strategyPath },
      run: { kind: 'backtest', id: String(run.jobId) },
    });
  };

  const optionLabel = (run: RecentRun): string => {
    const name = prettifyPath(run.strategyPath) ?? run.strategyPath;
    const when = shortFinished(run.finishedAt);
    const ret = run.totalReturn === null ? EM_DASH : statPercent(run.totalReturn);
    return [name, when, ret].filter(Boolean).join(' · ');
  };

  return (
    <span className="auracle-tearsheet__picker">
      <select
        className="auracle-tearsheet__pickersel"
        data-testid="tearsheet-run-picker"
        aria-label="Recent backtests"
        value={value}
        onChange={(event) => select(event.target.value)}
      >
        <option value="" disabled>
          Recent backtests…
        </option>
        {runs.map((run) => (
          <option key={run.jobId} value={run.jobId}>
            {optionLabel(run)}
          </option>
        ))}
      </select>
    </span>
  );
}

/** The 14-row Risk / Return table, values white and formatted to the reference. */
function MetricsTable({
  result,
  alphaAnnual,
  benchmarkReturnPct,
}: {
  result: BacktestResultBody;
  alphaAnnual: number | null;
  benchmarkReturnPct: number | null;
}): JSX.Element {
  const rows = tearsheetMetricRows(result.stats ?? {}, { alphaAnnual, benchmarkReturnPct });
  return (
    <div className="auracle-tearsheet__metrics" data-testid="tearsheet-metrics">
      {rows.map((row) => (
        <div key={row.label} className="auracle-tearsheet__mrow" data-testid={`tearsheet-metric-${slug(row.label)}`}>
          <span className="auracle-tearsheet__mk">{row.label}</span>
          <span className="auracle-tearsheet__mv" data-testid={`tearsheet-metric-value-${slug(row.label)}`}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Overview({ state }: { state: LoadState }): JSX.Element {
  const { phase, result, alphaAnnual, benchmarkReturnPct } = state;

  if (phase === 'idle') {
    return (
      <CenterState
        title="No run focused yet"
        detail="Open a strategy and run a backtest, or pick a saved run — its tearsheet renders here."
      />
    );
  }
  if (phase === 'loading') {
    return <SkeletonRows rows={6} />;
  }
  if (phase === 'error' || !result) {
    return (
      <CenterState
        tone="danger"
        title="This run could not be loaded"
        detail="The tearsheet reads from your local Auracle engine. Make sure the stack is running, then reopen the run."
      />
    );
  }

  const chartable = Boolean(result.chartable && result.chart && result.drawdown);
  const provenance = provenanceLine(result);

  return (
    <>
      <div className="auracle-tearsheet__dash" data-testid="tearsheet-dash">
        <section className="auracle-tearsheet__card">
          <header className="auracle-tearsheet__cardhead">
            <h3 className="auracle-tearsheet__cardtitle">Performance Chart</h3>
          </header>
          <div className="auracle-tearsheet__chartwrap">
            {chartable ? (
              // The engine serves the equity + benchmark curves as growth-of-$1
              // (first point 1.0); TearsheetChart's contract is percent, so
              // convert both here before they reach it. Drawdown is already
              // percent and passes through untouched.
              <TearsheetChart
                data={{
                  chart: { ...result.chart!, points: growthToPercent(result.chart!.points) },
                  drawdown: result.drawdown!,
                  benchmark: result.benchmark
                    ? { ...result.benchmark, points: growthToPercent(result.benchmark.points) }
                    : null,
                }}
              />
            ) : (
              <CenterState
                title="No chartable curve"
                detail="This run recorded metrics but no plottable equity series — the numbers still stand to the right."
              />
            )}
          </div>
        </section>
        <section className="auracle-tearsheet__card">
          <header className="auracle-tearsheet__cardhead">
            <h3 className="auracle-tearsheet__cardtitle">Risk / Return Metrics</h3>
          </header>
          <MetricsTable result={result} alphaAnnual={alphaAnnual} benchmarkReturnPct={benchmarkReturnPct} />
        </section>
      </div>
      {provenance ? (
        <p className="auracle-tearsheet__provenance" data-testid="tearsheet-provenance">
          {provenance}
        </p>
      ) : null}
    </>
  );
}

/* ── Summary + dossier (WS-F / FR-F1, FR-F2, FR-F3) ──────────────────────── */

function DownloadGlyph(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
    </svg>
  );
}

interface SummaryState {
  phase: 'loading' | 'loaded';
  body: StrategySummaryBody | null;
}

/** The prompt handed to the agent to author + persist a real summary. It cites
 *  the run's engine-computed metrics only (INV-1) and PUTs the result back to
 *  the engine's summary store (FR-D3). */
function summaryHandoffPrompt(strategyPath: string, jobId: number | null): string {
  const run = jobId !== null ? `backtest run ${jobId}` : 'its latest backtest run';
  return (
    `Write a concise, plain-English summary of the strategy \`${strategyPath}\` for its tearsheet. ` +
    `Read the strategy source and the engine-computed metrics from ${run} — cite only numbers the ` +
    `engine computed, never invent one. In three to five sentences, say what the strategy does and ` +
    `why it should work, then persist it by PUTting ` +
    `{ "summary_text": "…", "source_run_id": ${jobId ?? 'null'} } ` +
    `to /ui/api/strategy/summary?strategy_path=${strategyPath}.`
  );
}

/**
 * The plain-English summary strip (FR-F1). Reads the engine's stored summary by
 * strategy_path and renders it in plain type below the metrics. A docstring
 * fallback and a stale summary are each flagged quietly; an absent one rests
 * empty. When no real agent summary exists yet and the host exposes the AI
 * seam, a small "Have the agent write a summary" action prefills an agent
 * session (best-effort — hidden on hosts without `launchAgentSession`).
 */
function StrategySummary({
  strategyPath,
  jobId,
  host,
}: {
  strategyPath: string | null;
  jobId: number | null;
  host: PanelHost;
}): JSX.Element | null {
  const [state, setState] = useState<SummaryState>({ phase: 'loading', body: null });
  const [note, setNote] = useState<AgentNote>(null);
  const [handingOff, setHandingOff] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!strategyPath) return;
    const gen = (generation.current += 1);
    setState({ phase: 'loading', body: null });
    void (async () => {
      const body = await tearsheetSummary(strategyPath);
      if (gen !== generation.current) return;
      setState({ phase: 'loaded', body });
    })();
  }, [strategyPath]);

  if (!strategyPath) return null;

  if (state.phase === 'loading') {
    return (
      <div className="auracle-tearsheet__summary" data-testid="tearsheet-summary">
        <SkeletonRows rows={2} />
      </div>
    );
  }

  const body = state.body;
  const text = body?.summary_text?.trim() ?? '';
  const hasText = text.length > 0;
  const needsSummary = !hasText || body?.is_fallback === true;

  const runHandOff = async () => {
    setHandingOff(true);
    const result = await handOffToAgent(
      host,
      summaryHandoffPrompt(strategyPath, jobId),
      'Write strategy summary'
    );
    setHandingOff(false);
    setNote(result);
  };

  return (
    <div className="auracle-tearsheet__summary" data-testid="tearsheet-summary">
      <div className="auracle-tearsheet__seclabel">What this strategy does · in plain English</div>
      {hasText ? (
        <p className="auracle-tearsheet__summarytext" data-testid="tearsheet-summary-text">
          {text}
        </p>
      ) : (
        <p className="auracle-tearsheet__summarynote" data-testid="tearsheet-summary-empty">
          No plain-English summary yet — the engine has neither an agent summary nor a docstring to
          show for this strategy.
        </p>
      )}
      {body?.is_fallback ? (
        <div className="auracle-tearsheet__summarynote" data-testid="tearsheet-summary-fallback">
          This is the strategy&rsquo;s docstring — no agent summary has been written yet.
        </div>
      ) : null}
      {body?.stale ? (
        <div className="auracle-tearsheet__summarynote" data-testid="tearsheet-summary-stale">
          This may be out of date — the strategy or its run has changed since it was written.
        </div>
      ) : null}
      {needsSummary && host.launchAgentSession ? (
        <div className="auracle-tearsheet__summaryactions">
          <Button
            variant="ghost"
            testId="tearsheet-summary-handoff"
            busy={handingOff}
            onClick={() => void runHandOff()}
          >
            Have the agent write a summary
          </Button>
          {note ? (
            <InlineNote kind={note.kind} testId="tearsheet-summary-note">
              {note.text}
            </InlineNote>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface DossierState {
  phase: 'idle' | 'building' | 'ready' | 'error';
  report: DossierReport | null;
  message: string | null;
}

const DOSSIER_IDLE: DossierState = { phase: 'idle', report: null, message: null };

/** Honest copy per failure, so the card never hides why a build didn't happen:
 *  a 503 = the engine build lacks the PDF generator (WeasyPrint), a 400/404 =
 *  the run can't be built, status 0 = unreachable. */
function dossierError(status: number, error?: string): string {
  if (status === 503) return 'The dossier generator is not available on this engine build.';
  if (status === 400 || status === 404) return 'This run can’t be built into a dossier yet.';
  if (status === 0) return 'Couldn’t reach the engine — make sure your local stack is running.';
  return error && error.trim() ? error : 'The dossier could not be generated.';
}

/**
 * The AuraPoint research-dossier card (FR-F2/F3), matched to the reference
 * mockup. Download builds (or returns the cached) PDF for the focused
 * Strategy+Run, opens it through the host once the engine resolves the report,
 * and shows where it saved. States are honest: idle → building → ready / error.
 */
function DossierCard({
  strategyPath,
  jobId,
}: {
  strategyPath: string | null;
  jobId: number | null;
}): JSX.Element {
  const [state, setState] = useState<DossierState>(DOSSIER_IDLE);
  const canBuild = Boolean(strategyPath) && jobId !== null;

  const build = async () => {
    if (!strategyPath || jobId === null) return;
    setState({ phase: 'building', report: null, message: null });
    const res = await buildDossier(strategyPath, jobId);
    if (!res.ok) {
      setState({ phase: 'error', report: null, message: dossierError(res.status, res.error) });
      return;
    }
    setState({ phase: 'ready', report: res.report, message: null });
    void openReport(res.report.id);
  };

  const isReady = state.phase === 'ready' && state.report !== null;

  return (
    <div className="auracle-tearsheet__report" data-testid="tearsheet-dossier">
      <div className="auracle-tearsheet__doc" aria-hidden>
        <div className="auracle-tearsheet__docband" />
        <div className="auracle-tearsheet__docmark">AURAPOINT</div>
      </div>
      <div className="auracle-tearsheet__reportmeta">
        <div className="auracle-tearsheet__rtitle">
          <span className="auracle-tearsheet__firm">AuraPoint Capital</span> — Research Dossier
        </div>
        <div className="auracle-tearsheet__rsub">
          The thesis and the market intuition, the full math, the out-of-sample proof, and every
          test — factor regression, t / p-stats, drawdown and robustness.
        </div>
        {state.phase === 'ready' && state.report ? (
          <div className="auracle-tearsheet__savedpath" data-testid="tearsheet-dossier-saved">
            {state.report.cached ? 'Ready at ' : 'Saved to '}
            <b>reports/{state.report.filename}</b>
          </div>
        ) : null}
        {state.phase === 'error' && state.message ? (
          <div style={{ marginTop: 6 }}>
            <InlineNote kind="err" testId="tearsheet-dossier-error">
              {state.message}
            </InlineNote>
          </div>
        ) : null}
      </div>
      <Button
        variant="ghost"
        testId="tearsheet-dossier-download"
        busy={state.phase === 'building'}
        disabled={!canBuild}
        title={canBuild ? undefined : 'Focus a backtest run to build its dossier'}
        onClick={() => {
          if (state.phase === 'ready' && state.report) void openReport(state.report.id);
          else void build();
        }}
      >
        <DownloadGlyph />
        {isReady ? 'Open PDF' : 'Download PDF'}
      </Button>
    </div>
  );
}

/* ── Trades view (WS-G / FR-G1, FR-G2, AC-6) ────────────────────────────── */

/**
 * Position side is an ATTRIBUTE, not a health state, so its chip borrows neither
 * the semantic ok/danger ramp nor the white brand accent: long takes the Grid's
 * structural orange, short the tearsheet's steel (the same cool tone the
 * underwater curve draws in). Both are already in this sheet's palette; neither
 * can be misread as a status.
 */
const SIDE_TONE: Record<'long' | 'short', string> = { long: GRID_ACCENT, short: '#86a0bd' };

function parseIsoDate(raw: string | undefined): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? '');
  if (!match) return null;
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y: Number(match[1]), m, d };
}

/** "Feb 3 → Mar 21 ’24"; both years shown only when they differ. An
 *  unparseable date falls through to the raw strings rather than guessing. */
function formatDateRange(entry: string, exit: string): string {
  const e = parseIsoDate(entry);
  const x = parseIsoDate(exit);
  if (!e || !x) return [entry, exit].filter(Boolean).join(' → ') || EM_DASH;
  const day = (p: { m: number; d: number }) => `${MONTHS[p.m - 1]} ${p.d}`;
  const yy = (y: number) => `’${String(y).slice(-2)}`;
  return e.y === x.y
    ? `${day(e)} → ${day(x)} ${yy(x.y)}`
    : `${day(e)} ${yy(e.y)} → ${day(x)} ${yy(x.y)}`;
}

/** Whole-day hold: "47 days", "1 day". */
function formatHold(days: number): string {
  if (typeof days !== 'number' || !Number.isFinite(days)) return EM_DASH;
  const n = Math.round(days);
  return `${n} day${n === 1 ? '' : 's'}`;
}

/**
 * `contribution_pct` is the position's share of the PORTFOLIO's return, already
 * in percent units — signed, two decimals, no dollar figure and never called a
 * return or P&L (recon Q3 / house honesty wall).
 */
function formatContribution(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return EM_DASH;
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

/** Green when the position ADDED to portfolio return, red when it detracted —
 *  the sign of the contribution, not a claim about trade profit. */
function contribColor(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return tone.text2;
  return v > 0 ? tone.ok : tone.danger;
}

function TradeRow({ trade, index }: { trade: TradeRecord; index: number }): JSX.Element {
  const [open, setOpen] = useState(false);
  const clauses = composeThesis(trade.signals);
  const sideColor = SIDE_TONE[trade.side] ?? tone.text2;
  return (
    <div className="auracle-tearsheet__trow" data-open={open} data-testid={`tearsheet-trade-row-${index}`}>
      <button
        type="button"
        className="auracle-tearsheet__tsum"
        aria-expanded={open}
        data-testid={`tearsheet-trade-${index}`}
        data-side={trade.side}
        data-symbol={trade.symbol}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="auracle-tearsheet__sym">
          <span aria-hidden className="auracle-tearsheet__car">
            ▸
          </span>
          <span className="auracle-tearsheet__nm" data-testid={`tearsheet-trade-symbol-${index}`}>
            {trade.symbol}
          </span>
          <span
            className="auracle-tearsheet__dir"
            data-testid={`tearsheet-trade-side-${index}`}
            style={{ color: sideColor, background: tint(sideColor, 16) }}
          >
            {trade.side}
          </span>
        </span>
        <span className="auracle-tearsheet__tcell auracle-tearsheet__hide" data-testid={`tearsheet-trade-hold-${index}`}>
          {formatHold(trade.hold_days)}
        </span>
        <span
          className="auracle-tearsheet__tcell auracle-tearsheet__r auracle-tearsheet__hide"
          data-testid={`tearsheet-trade-range-${index}`}
        >
          {formatDateRange(trade.entry_date, trade.exit_date)}
        </span>
        <span
          className="auracle-tearsheet__contrib"
          data-testid={`tearsheet-trade-contribution-${index}`}
          style={{ color: contribColor(trade.contribution_pct) }}
        >
          {formatContribution(trade.contribution_pct)}
        </span>
      </button>
      {open ? (
        <div className="auracle-tearsheet__thesis" data-testid={`tearsheet-trade-thesis-${index}`}>
          <div className="auracle-tearsheet__thlab">Signals logged at entry</div>
          {clauses ? (
            clauses.map((clause, j) => (
              <div
                key={j}
                className="auracle-tearsheet__clause"
                data-testid={`tearsheet-trade-clause-${index}-${j}`}
              >
                {clause}
              </div>
            ))
          ) : (
            <div className="auracle-tearsheet__nosignal" data-testid={`tearsheet-trade-nosignal-${index}`}>
              No logged signal for this entry.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Summary chips computed only from the returned fields — count, long/short
 *  split, average hold, and the share of positions that contributed positively.
 *  No "win rate" or profit factor: those need a per-trade P&L the record does
 *  not carry. */
function tradeSummaryChips(trades: TradeRecord[]): JSX.Element {
  const n = trades.length;
  const longs = trades.filter((t) => t.side === 'long').length;
  const shorts = trades.filter((t) => t.side === 'short').length;
  const positive = trades.filter(
    (t) => typeof t.contribution_pct === 'number' && t.contribution_pct > 0
  ).length;
  const holds = trades
    .map((t) => t.hold_days)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const avgHold = holds.length ? Math.round(holds.reduce((s, v) => s + v, 0) / holds.length) : null;
  const asPct = (part: number) => `${Math.round((part / n) * 100)}%`;
  return (
    <div className="auracle-tearsheet__tstat" data-testid="tearsheet-trades-summary">
      <span className="auracle-tearsheet__chip">
        <b>{n}</b> trade{n === 1 ? '' : 's'}
      </span>
      {longs > 0 ? (
        <span className="auracle-tearsheet__chip">
          <b>{asPct(longs)}</b> long
        </span>
      ) : null}
      {shorts > 0 ? (
        <span className="auracle-tearsheet__chip">
          <b>{asPct(shorts)}</b> short
        </span>
      ) : null}
      {avgHold !== null ? (
        <span className="auracle-tearsheet__chip">
          avg hold <b>{avgHold}d</b>
        </span>
      ) : null}
      <span
        className="auracle-tearsheet__chip"
        title="Share of positions with a positive contribution to portfolio return"
      >
        <b>{asPct(positive)}</b> positive
      </span>
    </div>
  );
}

function Trades({ state }: { state: TradesLoad }): JSX.Element {
  if (state.phase === 'idle' || state.phase === 'loading') {
    return (
      <div className="auracle-tearsheet__tv" data-testid="tearsheet-trades">
        <SkeletonRows rows={5} />
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div className="auracle-tearsheet__tv" data-testid="tearsheet-trades">
        <CenterState
          tone="danger"
          title="Trades could not be loaded"
          detail="The per-trade record reads from your local Auracle engine. Make sure the stack is running, then reopen the run."
        />
      </div>
    );
  }
  if (state.trades.length === 0) {
    return (
      <div className="auracle-tearsheet__tv" data-testid="tearsheet-trades">
        <div data-testid="tearsheet-trades-empty">
          <CenterState
            title="No trades in this run"
            detail="This backtest closed no positions, so there is nothing to attribute yet."
          />
        </div>
      </div>
    );
  }
  return (
    <div className="auracle-tearsheet__tv" data-testid="tearsheet-trades">
      {tradeSummaryChips(state.trades)}
      <div className="auracle-tearsheet__thead" aria-hidden>
        <span>Position</span>
        <span className="auracle-tearsheet__hide">Held</span>
        <span className="auracle-tearsheet__r auracle-tearsheet__hide">Entry → Exit</span>
        <span className="auracle-tearsheet__r">Contribution</span>
      </div>
      {state.trades.map((trade, i) => (
        <TradeRow key={i} trade={trade} index={i} />
      ))}
      <p className="auracle-tearsheet__tfoot">
        Contribution is each position&rsquo;s share of the portfolio&rsquo;s total return, not a standalone
        trade P&amp;L or return.
      </p>
    </div>
  );
}

/**
 * The shared tearsheet body. Reads the Spine's {@link focusStore} for the
 * focused backtest run and renders its Overview / Trades against Backtest / Live,
 * exactly as the room did. `onLoaded` lifts the loaded metric rows to a host so
 * a frame (the room's vitals) can mirror them; the home hero passes none.
 */
export function Tearsheet({
  host,
  onLoaded,
}: {
  host: PanelHost;
  onLoaded?: (rows: TearsheetMetricRow[]) => void;
}): JSX.Element {
  ensureTearsheetStyles();
  const focus = useSyncExternalStore(focusStore.subscribe, focusStore.getSnapshot);
  const [view, setView] = useState<TearsheetView>('overview');
  const [mode, setMode] = useState<TearsheetMode>('backtest');
  const [state, setState] = useState<LoadState>(IDLE);
  const [tradesState, setTradesState] = useState<TradesLoad>(TRADES_IDLE);
  // Bumped on every run/mode change so a slow fetch from a superseded run can
  // never write its result over the one the user is now looking at.
  const generation = useRef(0);
  const tradesGeneration = useRef(0);

  const job = focus.run?.kind === 'backtest' ? Number(focus.run.id) : null;
  const runId = job !== null && Number.isFinite(job) ? job : null;

  // The Overview load, and the one place the loaded rows are lifted to the host
  // (`onLoaded`) so a room frame's vitals mirror the very rows on the table.
  // `onLoaded` is a stable setter, so it is deliberately out of the dep list.
  useEffect(() => {
    if (mode !== 'backtest') {
      onLoaded?.([]);
      return;
    }
    if (runId === null) {
      setState(IDLE);
      onLoaded?.([]);
      return;
    }
    const gen = (generation.current += 1);
    setState({ phase: 'loading', result: null, alphaAnnual: null, benchmarkReturnPct: null });
    void (async () => {
      const [result, factors] = await Promise.all([tearsheetResult(runId), tearsheetFactors(runId)]);
      if (gen !== generation.current) return;
      if (!result) {
        setState({ phase: 'error', result: null, alphaAnnual: null, benchmarkReturnPct: null });
        onLoaded?.([]);
        return;
      }
      const alphaAnnual =
        typeof factors?.regression?.alpha_annual === 'number' ? factors.regression.alpha_annual : null;
      const benchmarkReturnPct = benchmarkTail(result);
      setState({ phase: 'loaded', result, alphaAnnual, benchmarkReturnPct });
      onLoaded?.(tearsheetMetricRows(result.stats ?? {}, { alphaAnnual, benchmarkReturnPct }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, mode]);

  // The per-trade list loads lazily — only when the Trades view is shown for a
  // backtest run, and only once per run: a run already loaded (or in flight, or
  // already errored) is not re-fetched, so toggling Overview↔Trades is instant
  // and a persistent error does not spin. A separate generation guard drops a
  // stale run's late response.
  useEffect(() => {
    if (mode !== 'backtest' || view !== 'trades' || runId === null) return;
    if (tradesState.forRun === runId && tradesState.phase !== 'idle') return;
    const gen = (tradesGeneration.current += 1);
    setTradesState({ phase: 'loading', trades: [], forRun: runId });
    void (async () => {
      const body = await tearsheetTrades(runId);
      if (gen !== tradesGeneration.current) return;
      if (!body || body.status !== 'succeeded' || !Array.isArray(body.trades)) {
        setTradesState({ phase: 'error', trades: [], forRun: runId });
        return;
      }
      setTradesState({ phase: 'loaded', trades: body.trades, forRun: runId });
    })();
  }, [runId, mode, view, tradesState.forRun, tradesState.phase]);

  const tradeCount =
    typeof state.result?.trades === 'number' && state.result.trades > 0 ? state.result.trades : undefined;

  return (
    <div className="auracle-tearsheet" data-testid="tearsheet-room">
      <div className="auracle-tearsheet__head">
        <Segmented
          testidPrefix="tearsheet-tab"
          value={view}
          onChange={(id) => setView(id as TearsheetView)}
          options={[
            { id: 'overview', label: 'Overview' },
            { id: 'trades', label: 'Trades', count: tradeCount },
          ]}
        />
        <Segmented
          testidPrefix="tearsheet-mode"
          value={mode}
          onChange={(id) => setMode(id as TearsheetMode)}
          options={[
            { id: 'backtest', label: 'Backtest' },
            { id: 'live', label: 'Live' },
          ]}
        />
        <RunPicker focusedJob={runId} />
      </div>

      {mode === 'live' ? (
        <div data-testid="tearsheet-live-empty">
          <CenterState
            title="No live deployment yet"
            detail="Deploy this strategy to paper or live and its realized equity, fills and metrics will render here."
          />
        </div>
      ) : view === 'trades' ? (
        runId === null ? (
          <div data-testid="tearsheet-trades-norun">
            <CenterState
              title="No run focused yet"
              detail="Open a strategy and run a backtest, or pick a saved run — its trades and their thesis render here."
            />
          </div>
        ) : (
          <Trades state={tradesState} />
        )
      ) : (
        <>
          <Overview state={state} />
          {state.phase === 'loaded' && state.result ? (
            <>
              <StrategySummary
                strategyPath={state.result.strategy_path ?? null}
                jobId={runId}
                host={host}
              />
              <DossierCard strategyPath={state.result.strategy_path ?? null} jobId={runId} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

