/**
 * Strategy Tearsheet — the strategy-detail room (WS-E, PRD DF5).
 *
 * The reference's tearsheet made a first-class room: a Plotly performance chart
 * (strategy vs. benchmark) over an underwater drawdown subplot, beside the
 * 14-row Risk / Return table, keyed off whatever strategy/run the Spine's
 * {@link focusStore} is pointed at. Opening a run (or the `open-tearsheet`
 * command, routed here through the `tearsheet` alias) focuses it and this room
 * renders its latest backtest.
 *
 * ## Two segmented controls, not tabs
 * RoomPage forbids a tab STRIP for plan navigation, but this slice adds two
 * SCOPED, in-body segmented controls the PRD calls for:
 *   - Overview / Trades — which view. Overview is this slice; Trades is a stub
 *     the per-trade slice (P3) fills.
 *   - Backtest / Live — which source (FR-E3). Backtest is wired to the `/result`
 *     tearsheet; Live shows an honest "no live deployment yet" rest until the
 *     realized-live wiring lands.
 *
 * ## Numbers come from the engine, formatted once
 * Every figure is the engine's — `/result` for the curves and the QuantStats
 * stats, `/factors` for alpha — put through {@link tearsheetMetricRows}, the one
 * place the house honesty rules live (missing ⇒ em dash, never a fabricated
 * number). The values render white, matched to the reference.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import {
  tearsheetFactors,
  tearsheetResult,
  type BacktestResultBody,
} from '../../../engine/client';
import { focusStore } from '../../../engine/focusStore';
import { EM_DASH, tearsheetMetricRows } from '../../../engine/houseStats';
import { CenterState, SkeletonRows, tone } from '../../panelkit';
import { TearsheetChart } from '../../charts/TearsheetChart';
import { GRID_ACCENT } from '../gridTheme';
import { RoomPage, type PageVital, type RoomStatus } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

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

const STYLE_ID = 'auracle-tearsheet-styles';

/** Injected once. Widths are `@container auracle-grid`, never `@media` — the
 *  Grid is sized by its host pane, not the window (the pack's hard rule). */
const SHEET = `
.auracle-tearsheet { display: flex; flex-direction: column; gap: 14px; }
.auracle-tearsheet__seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 9px; border: 1px solid ${tone.border}; background: ${tone.surface}; }
.auracle-tearsheet__segbtn { appearance: none; font: inherit; font-size: 12px; font-weight: 600; line-height: 1; padding: 6px 12px; border: 0; border-radius: 6px; background: transparent; color: ${tone.text3}; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: color 150ms ease-out, background-color 150ms ease-out; }
.auracle-tearsheet__segbtn:hover { color: ${tone.text}; }
.auracle-tearsheet__segbtn[data-active="true"] { color: ${tone.text}; background: color-mix(in srgb, ${GRID_ACCENT} 16%, transparent); }
.auracle-tearsheet__segcount { font-size: 11px; color: ${tone.text3}; font-variant-numeric: tabular-nums; }
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

/** The backtest job id the focus points at, or null when it is not a backtest run. */
function focusedBacktestJob(): number | null {
  const run = focusStore.getSnapshot().run;
  if (!run || run.kind !== 'backtest') return null;
  const id = Number(run.id);
  return Number.isFinite(id) ? id : null;
}

/** The benchmark overlay's last cumulative-return point (already percent), or null. */
function benchmarkTail(result: BacktestResultBody): number | null {
  const points = result.benchmark?.points;
  if (!points || points.length === 0) return null;
  const last = points[points.length - 1];
  return typeof last === 'number' && Number.isFinite(last) ? last : null;
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

  return (
    <div className="auracle-tearsheet__dash" data-testid="tearsheet-dash">
      <section className="auracle-tearsheet__card">
        <header className="auracle-tearsheet__cardhead">
          <h3 className="auracle-tearsheet__cardtitle">Performance Chart</h3>
        </header>
        <div className="auracle-tearsheet__chartwrap">
          {chartable ? (
            <TearsheetChart
              data={{
                chart: result.chart!,
                drawdown: result.drawdown!,
                benchmark: result.benchmark ?? null,
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
  );
}

function contextFor(state: LoadState, mode: TearsheetMode): string {
  if (mode === 'live') return `${ROOM_CONTEXT.strategy} Live shows a deployment's realized results once one is running.`;
  const job = focusedBacktestJob();
  if (state.phase === 'loaded' && job !== null) {
    return `${ROOM_CONTEXT.strategy} Showing backtest job ${job}.`;
  }
  return ROOM_CONTEXT.strategy;
}

export function StrategyPage(_props: PanelHostProps): JSX.Element {
  ensureTearsheetStyles();
  const focus = useSyncExternalStore(focusStore.subscribe, focusStore.getSnapshot);
  const [view, setView] = useState<TearsheetView>('overview');
  const [mode, setMode] = useState<TearsheetMode>('backtest');
  const [state, setState] = useState<LoadState>(IDLE);
  // Bumped on every run/mode change so a slow fetch from a superseded run can
  // never write its result over the one the user is now looking at.
  const generation = useRef(0);

  const job = focus.run?.kind === 'backtest' ? Number(focus.run.id) : null;
  const runId = job !== null && Number.isFinite(job) ? job : null;

  useEffect(() => {
    if (mode !== 'backtest') return;
    if (runId === null) {
      setState(IDLE);
      return;
    }
    const gen = (generation.current += 1);
    setState({ phase: 'loading', result: null, alphaAnnual: null, benchmarkReturnPct: null });
    void (async () => {
      const [result, factors] = await Promise.all([tearsheetResult(runId), tearsheetFactors(runId)]);
      if (gen !== generation.current) return;
      if (!result) {
        setState({ phase: 'error', result: null, alphaAnnual: null, benchmarkReturnPct: null });
        return;
      }
      const alphaAnnual =
        typeof factors?.regression?.alpha_annual === 'number' ? factors.regression.alpha_annual : null;
      setState({
        phase: 'loaded',
        result,
        alphaAnnual,
        benchmarkReturnPct: benchmarkTail(result),
      });
    })();
  }, [runId, mode]);

  const status: RoomStatus = state.phase === 'error' ? 'attention' : 'nominal';
  const statusLabel =
    mode === 'live' ? 'live · idle' : state.phase === 'loading' ? 'loading' : undefined;

  // Vitals mirror three of the table's own rows, so the headline and the table
  // can never be two different runs; an em dash there becomes the frame's quiet
  // placeholder rather than a fabricated figure.
  const rows =
    state.phase === 'loaded' && state.result
      ? tearsheetMetricRows(state.result.stats ?? {}, {
          alphaAnnual: state.alphaAnnual,
          benchmarkReturnPct: state.benchmarkReturnPct,
        })
      : [];
  const vital = (label: string): string | null => {
    const value = rows.find((row) => row.label === label)?.value;
    return value && value !== EM_DASH ? value : null;
  };
  const vitals: PageVital[] =
    mode === 'live'
      ? []
      : [
          { label: 'Annualized Return', value: vital('Annualized Return') },
          { label: 'Sharpe', value: vital('Sharpe Ratio') },
          { label: 'max drawdown', value: vital('Max Drawdown'), emphasis: 'bad' },
        ];

  const tradeCount =
    typeof state.result?.trades === 'number' && state.result.trades > 0 ? state.result.trades : undefined;

  return (
    <RoomPage
      room="strategy"
      status={status}
      statusLabel={statusLabel}
      context={contextFor(state, mode)}
      vitals={vitals}
    >
      <div className="auracle-tearsheet" data-testid="tearsheet-room">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
        </div>

        {view === 'trades' ? (
          <div data-testid="tearsheet-trades-empty">
            <CenterState
              title="Per-trade view coming next"
              detail="This slice ships the Overview tearsheet; the trade-by-trade record and its thesis land in the next slice."
            />
          </div>
        ) : mode === 'live' ? (
          <div data-testid="tearsheet-live-empty">
            <CenterState
              title="No live deployment yet"
              detail="Deploy this strategy to paper or live and its realized equity, fills and metrics will render here."
            />
          </div>
        ) : (
          <Overview state={state} />
        )}
      </div>
    </RoomPage>
  );
}
