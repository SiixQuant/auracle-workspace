/**
 * Pure series helper for the chart components — no recharts import, so it's
 * cheap to unit-test in isolation.
 *
 * The engine serialises non-finite values (NaN / Inf) as JSON `null`, and not
 * every feed sanitises before handing points to a chart (the backtest result
 * path forwards `chart.points` / `drawdown.points` verbatim). Filtering here —
 * inside the shared chart, not only at each call site — keeps the LOCKED
 * honesty rule correct for every caller: fewer than two REAL points renders
 * nothing, and a curve is never drawn across a gap or a fabricated value.
 */

export interface ChartPoint {
  x: string;
  v: number;
}

/**
 * Pair each raw point with its label (by original index, so labels stay aligned
 * even when gaps are dropped), then keep only the finite ones.
 */
export function finitePoints(
  points: readonly (number | null | undefined)[] | null | undefined,
  labels?: readonly string[],
): ChartPoint[] {
  if (!Array.isArray(points)) return [];
  const out: ChartPoint[] = [];
  points.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.push({ x: labels?.[i] ?? String(i), v });
    }
  });
  return out;
}
