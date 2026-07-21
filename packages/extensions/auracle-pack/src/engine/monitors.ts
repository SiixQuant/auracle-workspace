/**
 * Monitor panels view model — the ambient-context builders for the blotter,
 * incidents, and runway feeds. Pure: given a feed payload, produce the compact
 * object the panel publishes to the AI chat via `host.ai.setContext`.
 */

export interface BlotterOrder {
  id?: number;
  symbol?: string;
  action?: string;
  status?: string;
  plain?: string;
  broker_order_id?: string | null;
}

/** The engine's onward action for an incident. */
export interface IncidentAction {
  /** The jump this incident offers, e.g. `open_job`. */
  kind?: string;
  /** The job it points at (present for `open_job`). Incidents carry a JOB id,
   *  never a deployment id. */
  job_id?: number;
}

/** The engine's dismiss target for an incident (nested). */
export interface IncidentDismiss {
  kind?: string;
  id?: number;
}

export interface Incident {
  kind?: string;
  id?: number | string;
  severity?: string;
  cause?: string;
  detail?: string;
  /** The engine's onward action (nested), if any. */
  action?: IncidentAction | null;
  /** The engine's dismiss target (nested). */
  dismiss?: IncidentDismiss | null;
  /** Legacy flat dismiss fields (older engine) — tolerated on read. */
  dismiss_kind?: string;
  dismiss_id?: number;
}

export interface StageTruth {
  reached?: string;
  evidence?: string;
}

/** Ambient context for the order blotter (bounded to the most recent 20). */
export function blotterContext(orders: BlotterOrder[]): Record<string, unknown> {
  return {
    panel: 'blotter',
    count: orders.length,
    orders: orders.slice(0, 20).map((o) => ({
      symbol: o.symbol ?? null,
      action: o.action ?? null,
      status: o.status ?? 'unknown',
      summary: o.plain ?? null,
    })),
  };
}

/** Ambient context for the incidents wall. */
export function incidentsContext(incidents: Incident[]): Record<string, unknown> {
  return {
    panel: 'incidents',
    count: incidents.length,
    incidents: incidents.map((i) => ({
      severity: i.severity ?? 'info',
      cause: i.cause ?? null,
      detail: i.detail ?? null,
    })),
  };
}

/**
 * The {kind, id} needed to dismiss this incident. Prefers the engine's nested
 * `dismiss` object and tolerates the older flat `dismiss_kind`/`dismiss_id`.
 * Null when the incident carries no dismiss target.
 */
export function incidentDismissTarget(i: Incident): { kind: string; id: number } | null {
  const kind = i.dismiss?.kind ?? i.dismiss_kind;
  const id = i.dismiss?.id ?? i.dismiss_id;
  return typeof kind === 'string' && kind.length > 0 && typeof id === 'number'
    ? { kind, id }
    : null;
}

/**
 * The job this incident points at (its `open_job` action), or null when it
 * identifies no job. Incidents are derived from the jobs feed and carry a JOB
 * id, never a deployment id, so the honest jump is to the run.
 */
export function incidentJobId(i: Incident): number | null {
  return i.action?.kind === 'open_job' && typeof i.action.job_id === 'number'
    ? i.action.job_id
    : null;
}

/** The "Open the run" hand-off prompt: point the agent at the incident's job. */
export function incidentJobPrompt(i: Incident, jobId: number): string {
  const lines: string[] = [
    `An Auracle incident points at job ${jobId}${i.severity ? ` (${i.severity})` : ''}.`,
  ];
  if (i.cause) lines.push(`Cause: ${i.cause}.${i.detail ? ` ${i.detail}.` : ''}`);
  lines.push(
    '',
    `Open this run (job ${jobId}) through the Auracle engine: read its logs and result, explain what happened, and if it failed propose concrete next steps to fix or re-run it.`
  );
  return lines.join('\n');
}

/** Ambient context for the research-to-live runway. */
export function runwayContext(stages: Record<string, StageTruth>): Record<string, unknown> {
  const out: Record<string, { reached: string; evidence: string }> = {};
  for (const [stage, truth] of Object.entries(stages)) {
    out[stage] = { reached: truth.reached ?? 'unknown', evidence: truth.evidence ?? '' };
  }
  return { panel: 'runway', stages: out };
}
