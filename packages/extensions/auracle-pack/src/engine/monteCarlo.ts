/**
 * Monte-Carlo robustness view-model over `/backtest/job/{id}/montecarlo`.
 *
 * The engine resamples a completed run's day-over-day returns with replacement
 * and returns 5 / 50 / 95th-percentile equity paths plus their terminals. It
 * returns ONLY numbers — no verdict, no p-value. So, unlike the factor battery,
 * this layer renders strictly FACTUAL descriptions: where the realised curve
 * ended relative to the resampled median, and how wide the band is. It never
 * declares a run "lucky" or "skilled" — that judgment stays with the reader.
 */

/** The raw `/montecarlo` response. */
export interface MonteCarloBody {
  ok: boolean;
  /** Present on a 4xx: the engine's plain reason (insufficient data, not
   *  found, job not succeeded). */
  error?: string;
  n_paths?: number;
  labels?: string[];
  p05?: number[];
  p50?: number[];
  p95?: number[];
  realised_terminal?: number;
  p50_terminal?: number;
  p05_terminal?: number;
  p95_terminal?: number;
}

/** The normalized bands the fan + stat band render from. */
export interface MonteCarlo {
  nPaths: number;
  labels: string[];
  p05: number[];
  p50: number[];
  p95: number[];
  realised: number;
  medianTerminal: number;
  p05Terminal: number;
  p95Terminal: number;
}

const nums = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [];

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Coerce a raw body into the render model (drops non-finite values). */
export function normalizeMonteCarlo(body: MonteCarloBody): MonteCarlo {
  const p50 = nums(body.p50);
  return {
    nPaths: Math.max(0, Math.round(num(body.n_paths))),
    labels: Array.isArray(body.labels) ? body.labels.map((l) => String(l)) : [],
    p05: nums(body.p05),
    p50,
    p95: nums(body.p95),
    realised: num(body.realised_terminal),
    medianTerminal: num(body.p50_terminal, p50.length ? p50[p50.length - 1] : 0),
    p05Terminal: num(body.p05_terminal),
    p95Terminal: num(body.p95_terminal),
  };
}

/** True when the body carries a usable, chartable fan (all three bands aligned
 *  and long enough to draw). */
export function hasFan(mc: MonteCarlo): boolean {
  const n = mc.p50.length;
  return n >= 2 && mc.p05.length === n && mc.p95.length === n;
}

const MC_ABSENCE_DEFAULT = 'Monte-Carlo needs a completed run with at least 30 bars.';

/** The engine's own reason for not producing a fan, or an honest default —
 *  never a client-invented excuse or a blank section. */
export function mcAbsence(status: number, body: unknown): string {
  const b = (body ?? {}) as MonteCarloBody;
  if (typeof b.error === 'string' && b.error) return b.error;
  if (status === 404) return 'That run was not found.';
  return MC_ABSENCE_DEFAULT;
}

/**
 * A neutral, factual one-liner. Describes the resampled range and where the
 * realised terminal falls within it — as description, not a verdict. A wider
 * band means more path-dependent variance; the reader draws the conclusion.
 */
export function monteCarloRead(mc: MonteCarlo): string {
  const x = (v: number) => `${v.toFixed(2)}×`;
  const where =
    mc.realised >= mc.p95Terminal
      ? 'at or above the resampled 95th percentile'
      : mc.realised <= mc.p05Terminal
        ? 'at or below the resampled 5th percentile'
        : mc.realised >= mc.medianTerminal
          ? 'above the resampled median'
          : 'below the resampled median';
  return (
    `Across ${mc.nPaths.toLocaleString()} resampled orderings of the same daily returns, ` +
    `terminal growth ran ${x(mc.p05Terminal)} (5th) to ${x(mc.p95Terminal)} (95th), ` +
    `median ${x(mc.medianTerminal)}. The realised curve ended at ${x(mc.realised)} — ${where}.`
  );
}
