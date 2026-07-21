/**
 * Backtest run store — the single source of truth shared between the editor
 * "Run" document header (which triggers a run for the open file) and the
 * BacktestPanel (which renders it). They are separate components in the same
 * pack bundle, so a module-level store is how the header hands the run to the
 * panel it opens.
 *
 * State is replaced (never mutated) on every change so the panel can subscribe
 * with `useSyncExternalStore` and re-render on reference change.
 */
import {
  runBacktest as engineRunBacktest,
  backtestJobStatus,
  backtestJobResult,
  getJsonDetailed,
  resolveRunSource,
  type BacktestResultBody,
} from './client';
import { classifyLoadFailure } from './research';
import {
  excludedFromDiscovery,
  resolveStrategyFromFile,
  strategyOptionsFromDiscovery,
  type ExcludedStrategy,
  type StrategyOption,
} from './backtest';
import { normalizeVerdict, type ValidationVerdict } from './validation';

export type BacktestPhase =
  | 'idle'
  | 'resolving'
  | 'engine-down'
  | 'unmatched'
  | 'ambiguous'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed';

export type ValidationPhase = 'idle' | 'running' | 'error' | 'failed' | 'done';

/** The chartable result of a completed run — engine values only. */
export interface BacktestResultData {
  /** Cumulative-return curve (growth of $1). */
  equity: number[];
  /** Peak-to-trough drawdown %, aligned to `equity`. */
  drawdown: number[];
  /** ISO dates for both curves. The engine hands the same array to `chart`
   *  and `drawdown`, so one field carries both. Without these the charts
   *  render no x-axis and tooltips read "0", "1", "2". */
  labels: string[];
  /** Headline metrics (total_return, annualized_return, sharpe, max_drawdown, …). */
  stats: Record<string, number | null>;
  asOf: string;
  nBars: number;
  trades: number;
  /** The non-local source a persisted run declares (e.g. "quantconnect"), or
   *  undefined for a local backtest. Drives the viewer's provenance label. */
  source?: string;
}

export interface BacktestSnapshot {
  /** Absolute path of the .py the run is for. */
  file: string | null;
  /** Resolved strategy id + display class, once one is chosen. */
  strategyPath: string | null;
  cls: string | null;
  phase: BacktestPhase;
  /** Candidate strategies when a file defines more than one (phase 'ambiguous'). */
  options: StrategyOption[];
  /** Strategies the engine discovered but dropped, with reasons — additive, so
   *  empty on an older engine that never sends the key. Lets the 'unmatched'
   *  rescue card explain why the open file isn't backtestable. */
  excluded: ExcludedStrategy[];
  jobId: number | null;
  /** Human-readable failure detail, or the "engine outdated" hint. */
  detail: string | null;
  /** engine-down was a 404/405 — the build predates the route, not unreachable. */
  outdated: boolean;
  /** The equity curve + stats, once fetched after a succeeded run. Null when
   *  the engine predates the result route or the payload isn't chartable. */
  result: BacktestResultData | null;
  /** Where the shown run came from: `live` when the user just ran a file,
   *  `loaded` when it was fetched by job id (a stored run followed from focus).
   *  The two render identically; only the viewer's framing differs. */
  origin: 'live' | 'loaded';
  validation: { phase: ValidationPhase; detail?: string; verdict?: ValidationVerdict };
}

const IDLE: BacktestSnapshot = {
  file: null,
  strategyPath: null,
  cls: null,
  phase: 'idle',
  options: [],
  excluded: [],
  jobId: null,
  detail: null,
  outdated: false,
  result: null,
  origin: 'live',
  validation: { phase: 'idle' },
};

let state: BacktestSnapshot = IDLE;
const listeners = new Set<() => void>();
// Bumped on every new run/choose so a stale poll or validation from a prior
// strategy can't write over the current one.
let generation = 0;

function set(patch: Partial<BacktestSnapshot>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function setValidation(patch: BacktestSnapshot['validation']): void {
  set({ validation: patch });
}

async function loadOptions(): Promise<
  { ok: true; options: StrategyOption[]; excluded: ExcludedStrategy[] } | { ok: false; outdated: boolean }
> {
  const result = await getJsonDetailed<{
    strategies?: Array<Record<string, unknown>>;
    excluded?: unknown;
  }>('/ui/api/backtest/strategies?deployable=1');
  if (!result.ok) return { ok: false, outdated: classifyLoadFailure(result.status) === 'outdated' };
  const rows = Array.isArray(result.body.strategies) ? result.body.strategies : [];
  // `excluded` is additive under ?deployable=1 — excludedFromDiscovery tolerates
  // its absence, so an older engine simply yields an empty list.
  return {
    ok: true,
    options: strategyOptionsFromDiscovery(rows),
    excluded: excludedFromDiscovery(result.body.excluded),
  };
}

function poll(jobId: number, gen: number): void {
  window.setTimeout(async () => {
    if (gen !== generation) return;
    const result = await backtestJobStatus(jobId);
    if (gen !== generation) return;
    if (!result.ok) {
      // A dropped status read mid-run: surface it rather than spinning forever.
      set({ phase: 'failed', detail: "The engine stopped responding while the backtest was running." });
      return;
    }
    if (result.status === 'succeeded') {
      set({ phase: 'succeeded' });
      void fetchResult(jobId, gen);
      return;
    }
    if (result.status === 'failed') {
      set({
        phase: 'failed',
        detail: "The backtest run failed. Open the full results for the engine's error detail.",
      });
      return;
    }
    // pending / running / unknown — keep waiting.
    if (state.phase !== 'running') set({ phase: 'running' });
    poll(jobId, gen);
  }, 1500);
}

/** Shape an engine result body into the panel's chartable form. One place so
 *  a live run (fetchResult) and a by-id load (loadJob) yield the same data. */
function normalizeResult(body: BacktestResultBody): BacktestResultData {
  return {
    equity: body.chart?.points ?? [],
    drawdown: body.drawdown?.points ?? [],
    labels: body.chart?.labels ?? [],
    stats: body.stats ?? {},
    asOf: body.as_of ?? '',
    nBars: body.n_bars ?? 0,
    trades: body.trades ?? 0,
    source: resolveRunSource(body),
  };
}

/**
 * After a run succeeds, pull its equity curve + stats so the panel can chart
 * it. Silent no-op on an older engine (404) or a non-chartable payload — the
 * panel then shows the honest "recorded — validate / open full results" state
 * rather than a fabricated curve.
 */
async function fetchResult(jobId: number, gen: number): Promise<void> {
  const res = await backtestJobResult(jobId);
  if (gen !== generation) return;
  if (!res.ok || !res.body.chartable || !res.body.chart) return;
  set({ result: normalizeResult(res.body) });
}

async function startBacktest(option: StrategyOption, gen: number): Promise<void> {
  set({
    strategyPath: option.path,
    cls: option.cls,
    phase: 'queued',
    jobId: null,
    detail: null,
    result: null,
    origin: 'live',
    validation: { phase: 'idle' },
  });
  const queued = await engineRunBacktest(option.path);
  if (gen !== generation) return;
  if (!queued.ok) {
    set({
      phase: 'failed',
      detail: queued.error ?? 'The engine refused the backtest. Make sure the stack is running.',
    });
    return;
  }
  set({ jobId: queued.jobId, phase: 'running' });
  poll(queued.jobId, gen);
}

export const backtestStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot(): BacktestSnapshot {
    return state;
  },

  /** Run the strategy defined in `filePath`. Resolves the file to a discovery id first. */
  async run(filePath: string): Promise<void> {
    const gen = ++generation;
    set({ file: filePath, phase: 'resolving', detail: null, options: [], excluded: [], jobId: null, validation: { phase: 'idle' } });
    const loaded = await loadOptions();
    if (gen !== generation) return;
    if (!loaded.ok) {
      set({
        phase: 'engine-down',
        outdated: loaded.outdated,
        detail: loaded.outdated
          ? 'This engine build predates the backtest surface. Update the Auracle stack, then run again.'
          : 'The backtest runs on your local Auracle engine. Make sure the stack is running, then run again.',
      });
      return;
    }
    // Keep the exclusions for the panel: an unmatched file can then show the
    // engine's own reason instead of a generic dead-end.
    set({ excluded: loaded.excluded });
    const resolution = resolveStrategyFromFile(filePath, loaded.options);
    if (resolution.kind === 'none') {
      set({ phase: 'unmatched' });
      return;
    }
    if (resolution.kind === 'many') {
      set({ phase: 'ambiguous', options: resolution.options });
      return;
    }
    await startBacktest(resolution.option, gen);
  },

  /** Pick one strategy from an ambiguous file and run it. */
  async choose(option: StrategyOption): Promise<void> {
    const gen = ++generation;
    await startBacktest(option, gen);
  },

  /**
   * Load a completed run by job id and show it through the SAME succeeded view
   * as a fresh local run — the load-by-id seam behind the Metrics Viewer. Used
   * to follow the focused run (a stored one, or a persisted external run such
   * as a QC import) when the panel opens. `origin` marks it `loaded` so the
   * viewer can frame it as a saved run without changing how the metrics render.
   */
  async loadJob(jobId: number): Promise<void> {
    const gen = ++generation;
    set({
      file: null,
      strategyPath: null,
      cls: null,
      phase: 'resolving',
      options: [],
      excluded: [],
      jobId,
      detail: null,
      result: null,
      origin: 'loaded',
      validation: { phase: 'idle' },
    });
    const res = await backtestJobResult(jobId);
    if (gen !== generation) return;
    if (!res.ok) {
      set({
        phase: 'failed',
        detail:
          res.status === 404
            ? "That run isn't on this engine — it may belong to another user or have been cleared."
            : 'The run could not be loaded. Make sure the Auracle stack is running, then try again.',
      });
      return;
    }
    // A non-chartable payload still counts as loaded: the succeeded view shows
    // the honest "recorded, no chartable series" note rather than a fake curve.
    set({
      phase: 'succeeded',
      strategyPath: res.body.strategy_path || null,
      result: res.body.chartable && res.body.chart ? normalizeResult(res.body) : null,
    });
  },

  /** Re-run the currently resolved strategy, or reload a run shown by id. */
  async retry(): Promise<void> {
    if (state.origin === 'loaded' && state.jobId !== null) {
      await this.loadJob(state.jobId);
      return;
    }
    if (!state.strategyPath || !state.cls) return;
    const gen = ++generation;
    await startBacktest({ path: state.strategyPath, cls: state.cls, label: state.cls }, gen);
  },

  /**
   * Run the overfit validation (the seven signals) on the resolved strategy.
   * Synchronous engine call, mirrors ValidationPanel; folds the honest
   * out-of-sample check into the same run-a-file flow.
   */
  async validate(): Promise<void> {
    const path = state.strategyPath;
    if (!path) return;
    // Not a new run — tag this to the current generation so a run/choose/retry
    // started mid-validation supersedes a late verdict instead of it landing on
    // the next strategy's panel.
    const gen = generation;
    setValidation({ phase: 'running' });
    const result = await getJsonDetailed<Record<string, unknown>>(
      `/ui/api/validation?strategy_path=${encodeURIComponent(path)}`
    );
    if (gen !== generation) return;
    if (!result.ok) {
      if (result.status === 422) {
        // 422 carries {detail} explaining why it's unmeasurable — read it off the
        // same response (getJsonDetailed keeps the body on failure); no re-fetch.
        const detail = (result.body as { detail?: string } | null)?.detail;
        setValidation({
          phase: 'error',
          detail: detail ?? 'The engine could not measure this strategy.',
        });
        return;
      }
      setValidation({ phase: 'failed' });
      return;
    }
    setValidation({ phase: 'done', verdict: normalizeVerdict(result.body) });
  },

  reset(): void {
    generation++;
    state = IDLE;
    for (const listener of listeners) listener();
  },
};
