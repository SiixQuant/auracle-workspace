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

/**
 * A log axis is only meaningful on strictly-positive data — log(0) is -Inf
 * and negatives are undefined. A fully-wiped equity curve reaches zero, so
 * the caller must be able to ask before switching scales.
 */
export function canUseLogScale(data: readonly ChartPoint[]): boolean {
  return data.length >= 2 && data.every((d) => d.v > 0);
}

/**
 * Decade ticks (1, 2, 5 x 10^n) spanning the data.
 *
 * Recharts generates no usable ticks on a log axis and misbehaves on
 * `domain={['auto','auto']}`, so both the domain and the ticks have to be
 * handed to it explicitly. Without this the axis renders blank or linear.
 */
export function logTicks(lo: number, hi: number): number[] {
  if (!(lo > 0) || !(hi > 0) || hi < lo) return [];
  const ticks: number[] = [];
  const from = Math.floor(Math.log10(lo));
  const to = Math.ceil(Math.log10(hi));
  for (let e = from; e <= to; e += 1) {
    for (const m of [1, 2, 5]) {
      const t = m * 10 ** e;
      if (t >= lo && t <= hi) ticks.push(t);
    }
  }
  return ticks;
}
