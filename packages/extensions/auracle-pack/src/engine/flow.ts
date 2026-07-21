/**
 * The Flow canvas core — ported 1:1 (with its unit tests) from the native
 * client. Owns the graph state and the pure decisions over it:
 *
 * - `buildFlow` lays the user's strategies out as a grid of nodes.
 * - `compareMetrics` diffs two runs HONESTLY — a delta exists only for a
 *   metric BOTH runs report; anything absent on either side stays null so the
 *   canvas renders an em-dash, never a fabricated difference.
 * - `fork` adds a client-side draft child linked by a fork edge — a starting
 *   point to iterate, never a fabricated engine run.
 *
 * Node metrics fill only after a backtest runs (`setSummary`), so an un-run
 * node honestly shows no numbers rather than zeros.
 */

export interface EquityPoint {
  t: string;
  v: number;
}

export interface BacktestSummary {
  strategy: string;
  net_profit: number | null;
  total_return: number | null;
  sharpe: number | null;
  max_drawdown: number | null;
  win_rate: number | null;
  turnover: number | null;
  num_trades: number | null;
  equity: EquityPoint[];
}

export function emptySummary(strategy: string): BacktestSummary {
  return {
    strategy,
    net_profit: null,
    total_return: null,
    sharpe: null,
    max_drawdown: null,
    win_rate: null,
    turnover: null,
    num_trades: null,
    equity: [],
  };
}

/**
 * Parse the engine `/backtest` response (`{ "stats": { … } }`), leaving any
 * absent or non-numeric stat null.
 */
export function summaryFromEngine(strategy: string, value: unknown): BacktestSummary {
  const stats =
    value && typeof value === 'object' ? ((value as Record<string, unknown>).stats ?? {}) : {};
  const record = (stats ?? {}) as Record<string, unknown>;
  const number = (key: string): number | null =>
    typeof record[key] === 'number' && Number.isFinite(record[key] as number)
      ? (record[key] as number)
      : null;
  return {
    ...emptySummary(strategy),
    net_profit: number('net_profit'),
    total_return: number('total_return'),
    sharpe: number('sharpe'),
    max_drawdown: number('max_drawdown'),
    win_rate: number('win_rate'),
    turnover: number('turnover'),
    num_trades: number('num_trades'),
  };
}

/** Zip an engine chart's `{ labels, points }` into equity points, keeping only
 *  finite values and falling back to the index when a label is missing. Returns
 *  [] unless the engine marked the result chartable, so a non-chartable run
 *  draws no curve rather than a fabricated one. */
function equityFromChart(chartable: unknown, chart: unknown): EquityPoint[] {
  if (chartable !== true || !chart || typeof chart !== 'object') return [];
  const points = (chart as { points?: unknown }).points;
  const labels = (chart as { labels?: unknown }).labels;
  if (!Array.isArray(points)) return [];
  const labelAt = Array.isArray(labels) ? labels : [];
  const out: EquityPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const v = points[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out.push({ t: typeof labelAt[i] === 'string' ? (labelAt[i] as string) : String(i), v });
  }
  return out;
}

/**
 * Parse the engine's ASYNC backtest job result (`/ui/api/backtest/job/{id}/result`)
 * into a summary. Unlike {@link summaryFromEngine} — which reads the synchronous
 * `/backtest` response that has no equity — this carries a `chart` series, so the
 * canvas can draw a real equity curve. Scalar stats come from the same `.stats`
 * shape; the trade count reads the payload's top-level `trades`.
 */
export function summaryFromJobResult(strategy: string, value: unknown): BacktestSummary {
  const base = summaryFromEngine(strategy, value);
  const body = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const trades =
    typeof body.trades === 'number' && Number.isFinite(body.trades) ? body.trades : base.num_trades;
  return {
    ...base,
    num_trades: trades,
    equity: equityFromChart(body.chartable, body.chart),
  };
}

export interface Pos {
  x: number;
  y: number;
}

export type NodeKind = 'strategy' | 'draft';

export interface FlowNode {
  /** Stable identity: the strategy's dotted path, or `draft:N` for a fork. */
  id: string;
  name: string;
  path: string | null;
  doc: string;
  bundled: boolean;
  kind: NodeKind;
  /** Backtest metrics — null until this node's backtest has been run. */
  summary: BacktestSummary | null;
  pos: Pos;
}

export interface FlowEdge {
  from: string;
  to: string;
  kind: 'fork';
}

export interface FlowView {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface StrategyListItem {
  name: string;
  path: string;
  doc: string;
  bundled: boolean;
}

/** Display name for a dotted strategy path: its last segment. */
export function displayName(path: string): string {
  const segments = path.split('.');
  return segments[segments.length - 1] || path;
}

export const NODE_W = 220;
export const NODE_H = 150;
const COL_GAP = 48;
const ROW_GAP = 40;
export const MARGIN = 24;
const COLS = 3;

/** Seed the canvas from the strategy list, in a deterministic 3-column grid. */
export function buildFlow(rows: StrategyListItem[]): FlowView {
  return {
    nodes: rows.map((item, index) => ({
      id: item.path,
      name: item.name,
      path: item.path,
      doc: item.doc,
      bundled: item.bundled,
      kind: 'strategy' as const,
      summary: null,
      pos: {
        x: MARGIN + (index % COLS) * (NODE_W + COL_GAP),
        y: MARGIN + Math.floor(index / COLS) * (NODE_H + ROW_GAP),
      },
    })),
    edges: [],
  };
}

export type Direction = 'higher-better' | 'lower-better' | 'closer-to-zero-better' | 'neutral';

export interface CompareRow {
  label: string;
  a: number | null;
  b: number | null;
  /** `b - a`, present ONLY when both sides have a value — never fabricated. */
  delta: number | null;
  direction: Direction;
}

/**
 * Whether `b` improves on `a` given the metric's direction. Null when there is
 * no delta or the direction is neutral, so the renderer stays tone-neutral.
 * Drawdown uses magnitude so no direction is claimed that the engine's sign
 * convention doesn't support.
 */
export function improved(row: CompareRow): boolean | null {
  switch (row.direction) {
    case 'neutral':
      return null;
    case 'closer-to-zero-better': {
      if (row.a === null || row.b === null) return null;
      const aMag = Math.abs(row.a);
      const bMag = Math.abs(row.b);
      if (aMag === bMag) return null;
      return bMag < aMag;
    }
    case 'higher-better':
      if (row.delta === null || row.delta === 0) return null;
      return row.delta > 0;
    case 'lower-better':
      if (row.delta === null || row.delta === 0) return null;
      return row.delta < 0;
  }
}

export function compareRow(
  label: string,
  a: number | null,
  b: number | null,
  direction: Direction
): CompareRow {
  return { label, a, b, delta: a !== null && b !== null ? b - a : null, direction };
}

/** Diff two runs. A delta exists only when the engine returned the metric for BOTH. */
export function compareMetrics(a: BacktestSummary, b: BacktestSummary): CompareRow[] {
  return [
    compareRow('Net profit', a.net_profit, b.net_profit, 'higher-better'),
    compareRow('Return', a.total_return, b.total_return, 'higher-better'),
    compareRow('Sharpe', a.sharpe, b.sharpe, 'higher-better'),
    compareRow('Max drawdown', a.max_drawdown, b.max_drawdown, 'closer-to-zero-better'),
    compareRow('Win rate', a.win_rate, b.win_rate, 'higher-better'),
    compareRow('Turnover', a.turnover, b.turnover, 'lower-better'),
    compareRow('Trades', a.num_trades, b.num_trades, 'neutral'),
  ];
}

/** Attach a node's backtest metrics. Returns whether a matching node was found. */
export function setSummary(view: FlowView, id: string, summary: BacktestSummary): boolean {
  const node = view.nodes.find((n) => n.id === id);
  if (!node) return false;
  node.summary = summary;
  return true;
}

/** Move a node by a drag delta. Returns whether a matching node was found. */
export function moveNode(view: FlowView, id: string, dx: number, dy: number): boolean {
  const node = view.nodes.find((n) => n.id === id);
  if (!node) return false;
  node.pos = { x: node.pos.x + dx, y: node.pos.y + dy };
  return true;
}

/**
 * Fork a node: add a client-side draft child just below-right of its parent,
 * linked by a fork edge. Returns the new draft's id, or null if the parent is
 * gone. A draft carries the parent's path but no metrics of its own until run.
 */
export function fork(view: FlowView, parentId: string, draftSeq: number): string | null {
  const parent = view.nodes.find((n) => n.id === parentId);
  if (!parent) return null;
  const draftId = `draft:${draftSeq}`;
  view.nodes.push({
    id: draftId,
    name: `${parent.name} (fork)`,
    path: parent.path,
    doc: parent.doc,
    bundled: false,
    kind: 'draft',
    summary: null,
    pos: { x: parent.pos.x + 40, y: parent.pos.y + NODE_H + 24 },
  });
  view.edges.push({ from: parentId, to: draftId, kind: 'fork' });
  return draftId;
}

export function nodeCenter(node: FlowNode): Pos {
  return { x: node.pos.x + NODE_W / 2, y: node.pos.y + NODE_H / 2 };
}

export function centerOf(view: FlowView, id: string): Pos | null {
  const node = view.nodes.find((n) => n.id === id);
  return node ? nodeCenter(node) : null;
}
