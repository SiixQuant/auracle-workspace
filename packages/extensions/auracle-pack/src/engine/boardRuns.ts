/**
 * The results behind the Board's metrics peek — fetched once, on demand, per
 * job.
 *
 * ## Why this is not a poll
 * A Board can carry many test cards and a person looks at one at a time. So the
 * curve and the stats are read when a card is actually asked about, cached for
 * the session, and never read again — a completed run's numbers do not change.
 * That keeps the Board's whole cost to the two lanes the plan already runs (see
 * `boardMaterialize`) plus one request per card a person actually rests on.
 *
 * ## The session's own run costs nothing
 * When the job asked about is the one {@link backtestStore} is already holding,
 * its result is used directly. The store fetched it when the run finished, so
 * re-fetching would be a second read of a number the pack has in hand — and,
 * worse, could disagree with the panel showing the same run.
 *
 * A run the engine cannot serve settles on `missing` and stays there: the peek
 * then says it has no figures, which is the honest end state for a job this
 * engine does not know (cleared, or belonging to another install).
 */
import { backtestJobResult } from './client';
import { backtestStore, normalizeResult, type BacktestResultData, type BacktestSnapshot } from './backtestStore';

export type BoardRun =
  /** Nothing has been asked for this job yet. */
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; result: BacktestResultData }
  /** The engine could not serve it, or served nothing chartable. */
  | { phase: 'missing' };

export type BoardRunCache = Readonly<Record<string, BoardRun>>;

const IDLE: BoardRun = { phase: 'idle' };

let cache: BoardRunCache = {};
const listeners = new Set<() => void>();

function set(jobId: string, entry: BoardRun): void {
  cache = { ...cache, [jobId]: entry };
  for (const listener of listeners) listener();
}

/**
 * What is known about a job RIGHT NOW, from the session's run first and the
 * cache second. Pure, so the precedence rule is testable without a transport.
 */
export function runFor(jobId: string, session: BacktestSnapshot, runs: BoardRunCache): BoardRun {
  if (session.jobId !== null && String(session.jobId) === jobId && session.result) {
    return { phase: 'ready', result: session.result };
  }
  return runs[jobId] ?? IDLE;
}

export const boardRuns = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): BoardRunCache {
    return cache;
  },

  /**
   * Ask for a job's result, once. A job the session already holds, one already
   * in flight, and one already settled are all no-ops — so a pointer resting on
   * the same card twice issues one request between them.
   */
  async load(jobId: string): Promise<void> {
    if (!jobId) return;
    if (runFor(jobId, backtestStore.getSnapshot(), cache).phase !== 'idle') return;
    set(jobId, { phase: 'loading' });
    const id = Number(jobId);
    if (!Number.isFinite(id)) {
      set(jobId, { phase: 'missing' });
      return;
    }
    const response = await backtestJobResult(id);
    if (!response.ok || !response.body.chartable || !response.body.chart) {
      set(jobId, { phase: 'missing' });
      return;
    }
    set(jobId, { phase: 'ready', result: normalizeResult(response.body) });
  },

  /** Forget everything. Tests use it; nothing in the product does. */
  reset(): void {
    cache = {};
    for (const listener of listeners) listener();
  },
};
