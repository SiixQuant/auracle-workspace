/**
 * Runs a Flow node's backtest on the engine's ASYNC job route — submit, poll to
 * a terminal status, then fetch the chartable result — and maps it to a Flow
 * summary (scalars + equity curve). The canvas used to POST the synchronous
 * `/backtest` route, whose contract carries no equity series; this path does,
 * so a run can render a real equity chart.
 *
 * Any transport or engine failure resolves to `{ ok: false }`; the caller then
 * leaves the node's prior summary untouched — matching the old behaviour where
 * a failed run changed nothing on the canvas.
 */
import { runBacktest, backtestJobStatus, backtestJobResult } from './client';
import { summaryFromJobResult, type BacktestSummary } from './flow';

/** How long to wait between job-status polls. Mirrors backtestStore. */
const POLL_MS = 1500;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type FlowRunResult =
  | { ok: true; summary: BacktestSummary }
  | { ok: false; error: string };

/**
 * Submit `strategyPath`, poll until the job is terminal, then return its
 * summary. `pollMs` is injectable so tests need not wait out the real interval.
 */
export async function runFlowBacktest(
  strategyPath: string,
  pollMs: number = POLL_MS
): Promise<FlowRunResult> {
  const queued = await runBacktest(strategyPath);
  if (!queued.ok) {
    return {
      ok: false,
      error: queued.error ?? 'The engine refused the backtest. Make sure the stack is running.',
    };
  }
  for (;;) {
    const status = await backtestJobStatus(queued.jobId);
    if (!status.ok) {
      return { ok: false, error: 'The engine stopped responding while the backtest was running.' };
    }
    if (status.status === 'succeeded') break;
    if (status.status === 'failed') {
      return {
        ok: false,
        error: 'The backtest run failed. Open the full results for the engine error detail.',
      };
    }
    // pending / running / unknown — keep waiting.
    await delay(pollMs);
  }
  const result = await backtestJobResult(queued.jobId);
  if (!result.ok) {
    return { ok: false, error: 'The backtest finished but its result could not be read.' };
  }
  return { ok: true, summary: summaryFromJobResult(strategyPath, result.body) };
}
