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

export interface Incident {
  severity?: string;
  cause?: string;
  detail?: string;
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

/** Ambient context for the research-to-live runway. */
export function runwayContext(stages: Record<string, StageTruth>): Record<string, unknown> {
  const out: Record<string, { reached: string; evidence: string }> = {};
  for (const [stage, truth] of Object.entries(stages)) {
    out[stage] = { reached: truth.reached ?? 'unknown', evidence: truth.evidence ?? '' };
  }
  return { panel: 'runway', stages: out };
}
