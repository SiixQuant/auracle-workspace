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
  getJsonDetailed,
} from './client';
import { classifyLoadFailure } from './research';
import {
  resolveStrategyFromFile,
  strategyOptionsFromDiscovery,
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

export interface BacktestSnapshot {
  /** Absolute path of the .py the run is for. */
  file: string | null;
  /** Resolved strategy id + display class, once one is chosen. */
  strategyPath: string | null;
  cls: string | null;
  phase: BacktestPhase;
  /** Candidate strategies when a file defines more than one (phase 'ambiguous'). */
  options: StrategyOption[];
  jobId: number | null;
  /** Human-readable failure detail, or the "engine outdated" hint. */
  detail: string | null;
  /** engine-down was a 404/405 — the build predates the route, not unreachable. */
  outdated: boolean;
  validation: { phase: ValidationPhase; detail?: string; verdict?: ValidationVerdict };
}

const IDLE: BacktestSnapshot = {
  file: null,
  strategyPath: null,
  cls: null,
  phase: 'idle',
  options: [],
  jobId: null,
  detail: null,
  outdated: false,
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
  { ok: true; options: StrategyOption[] } | { ok: false; outdated: boolean }
> {
  const result = await getJsonDetailed<{ strategies?: Array<Record<string, unknown>> }>(
    '/ui/api/backtest/strategies?deployable=1'
  );
  if (!result.ok) return { ok: false, outdated: classifyLoadFailure(result.status) === 'outdated' };
  const rows = Array.isArray(result.body.strategies) ? result.body.strategies : [];
  return { ok: true, options: strategyOptionsFromDiscovery(rows) };
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

async function startBacktest(option: StrategyOption, gen: number): Promise<void> {
  set({
    strategyPath: option.path,
    cls: option.cls,
    phase: 'queued',
    jobId: null,
    detail: null,
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
    set({ file: filePath, phase: 'resolving', detail: null, options: [], jobId: null, validation: { phase: 'idle' } });
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

  /** Re-run the currently resolved strategy. */
  async retry(): Promise<void> {
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
