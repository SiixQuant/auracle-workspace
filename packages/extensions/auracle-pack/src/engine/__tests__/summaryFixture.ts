/**
 * The engine's consolidated status payload, as the sheet's tests serve it.
 *
 * Shared so every Grid test states the same wire shape: the field names here
 * are the engine's own (`open_alerts`, `research.findings`,
 * `connections.by_state`, `runway.reached`), and a test that patches one block
 * inherits a quiet, answered engine for all the others. A block passed as
 * `null` is the engine's honest "this district's read failed" — the shape a
 * degraded block actually arrives in.
 */
import type { DeploymentsBlock, SummaryBody } from '../gridVitals';

/**
 * The deployments block the engine would compute for `rows` — its own counts,
 * derived here the same way (`total` is every row, `running` and `errored` are
 * the two states it names). Lets a test describe deployments once and serve
 * both the consolidated counts and the naming read from the same list.
 */
export function deploymentsBlock(rows: ReadonlyArray<{ state: string }>): DeploymentsBlock {
  return {
    total: rows.length,
    running: rows.filter((row) => row.state === 'running').length,
    errored: rows.filter((row) => row.state === 'errored').length,
  };
}

export function summaryBody(patch: Partial<SummaryBody> = {}): SummaryBody {
  return {
    open_alerts: 0,
    research: { findings: 0, top_score: null },
    deployments: { total: 0, running: 0, errored: 0 },
    schedules: { total: 0, active: 0 },
    connections: { total: 0, by_state: {}, connected: 0 },
    runway: { reached: {} },
    degraded: [],
    ...patch,
  };
}
