/**
 * Deploy handoff store — the single source of truth shared between the editor
 * "Deploy" document header (which resolves the open file to a strategy) and the
 * Live Algorithms panel's wizard (which renders the pre-bound deploy). They are
 * separate components in the same pack bundle, so a module-level store is how
 * the header hands the binding to the wizard it opens. Mirrors backtestStore.
 *
 * State is replaced (never mutated) on every change so the panel can subscribe
 * with `useSyncExternalStore` and re-render on reference change. Unlike the
 * backtest store there is no run lifecycle here — the wizard owns the deploy
 * POST; this store only holds the file→strategy binding.
 */
import { getJsonDetailed } from './client';
import { classifyLoadFailure } from './research';
import {
  resolveDeployableFromFile,
  type DeploySnapshot,
  type StrategyOption,
} from './deploy';

const IDLE: DeploySnapshot = {
  file: null,
  phase: 'idle',
  option: null,
  options: [],
  reason: null,
  outdated: false,
};

let state: DeploySnapshot = IDLE;
const listeners = new Set<() => void>();
// Bumped on every deploy/choose so a stale in-flight resolution can't write
// over a newer binding.
let generation = 0;

function set(patch: Partial<DeploySnapshot>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

async function loadDiscovery(): Promise<
  { ok: true; rows: Array<Record<string, unknown>> } | { ok: false; outdated: boolean }
> {
  const result = await getJsonDetailed<{ strategies?: Array<Record<string, unknown>> }>(
    '/ui/api/backtest/strategies?deployable=1'
  );
  if (!result.ok) return { ok: false, outdated: classifyLoadFailure(result.status) === 'outdated' };
  const rows = Array.isArray(result.body.strategies) ? result.body.strategies : [];
  return { ok: true, rows };
}

export const deployStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot(): DeploySnapshot {
    return state;
  },

  /**
   * Resolve `filePath` to a deployable strategy and bind the wizard to it.
   * Always lands on a non-idle phase (one / many / blocked / engine-down) so
   * the wizard opens even for a non-deployable file and owns the honest state.
   */
  async deploy(filePath: string): Promise<void> {
    const gen = ++generation;
    set({ file: filePath, phase: 'resolving', option: null, options: [], reason: null, outdated: false });
    const loaded = await loadDiscovery();
    if (gen !== generation) return;
    if (!loaded.ok) {
      set({ phase: 'engine-down', outdated: loaded.outdated });
      return;
    }
    const resolution = resolveDeployableFromFile(filePath, loaded.rows);
    if (resolution.kind === 'one') {
      set({ phase: 'one', option: resolution.option });
    } else if (resolution.kind === 'many') {
      set({ phase: 'many', options: resolution.options });
    } else {
      set({ phase: 'blocked', reason: resolution.reason });
    }
  },

  /** Pick one strategy from an ambiguous file — locks the wizard to it. */
  choose(option: StrategyOption): void {
    generation++;
    set({ phase: 'one', option, options: [], reason: null });
  },

  /** Drop the binding — the wizard returns to (or stays on) the global picker. */
  clear(): void {
    generation++;
    state = IDLE;
    for (const listener of listeners) listener();
  },
};
