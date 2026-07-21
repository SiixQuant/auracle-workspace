/**
 * Factor-battery view model — types + pure helpers over the engine's
 * `/ui/api/backtest/job/{id}/factors` surface (the factor-attribution rail).
 *
 * The engine does every statistical judgment: it regresses the run's returns
 * on the bundled Fama-French + momentum factors and returns, per measure, a
 * categorical `verdict` and a plain-English `reading` (auracle.backtest.
 * factor_verdict). This module only coerces those strings into a known shape —
 * it never re-derives significance, never applies a p-value threshold, and
 * never invents a verdict the engine didn't send. The rail renders the strings
 * verbatim.
 */
import type { FactorBatteryBody } from './client';

/** One row of the decomposition — alpha, market exposure, a style tilt, or fit. */
export interface FactorMeasure {
  /** Stable id: `alpha` | `market_exposure` | `tilt_smb|hml|umd` | `fit`. */
  measure: string;
  label: string;
  /** The engine's categorical verdict (e.g. `significant_positive`). */
  verdict: string;
  /** The engine's plain-English reading — rendered verbatim. */
  reading: string;
  /** Row numerics, present per measure kind; carried for the neutral figure. */
  annual: number | null;
  beta: number | null;
  tstat: number | null;
  pvalue: number | null;
  rSquared: number | null;
}

export interface FactorBattery {
  jobId: number | null;
  nObs: number | null;
  factorSet: string[];
  window: { start: string; end: string } | null;
  /** The engine's factor-data coverage/staleness note — rendered verbatim. */
  factorNote: string | null;
  stale: boolean;
  hacLags: number | null;
  periodsPerYear: number | null;
  measures: FactorMeasure[];
}

const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

/** Coerce one raw measure row into the known shape, defaulting honestly. */
export function normalizeMeasure(raw: Record<string, unknown>): FactorMeasure {
  return {
    measure: str(raw.measure),
    label: str(raw.label) || str(raw.measure) || '(measure)',
    verdict: str(raw.verdict),
    reading: str(raw.reading),
    annual: numOrNull(raw.annual),
    beta: numOrNull(raw.beta),
    tstat: numOrNull(raw.tstat),
    pvalue: numOrNull(raw.pvalue),
    rSquared: numOrNull(raw.r_squared),
  };
}

export function normalizeBattery(body: FactorBatteryBody): FactorBattery {
  const rows = Array.isArray(body.measures) ? body.measures : [];
  const start = str(body.window?.start);
  const end = str(body.window?.end);
  return {
    jobId: numOrNull(body.job_id),
    nObs: numOrNull(body.n_obs),
    factorSet: Array.isArray(body.factor_set)
      ? body.factor_set.filter((f): f is string => typeof f === 'string')
      : [],
    window: start && end ? { start, end } : null,
    factorNote: typeof body.factor_data?.note === 'string' ? body.factor_data.note : null,
    stale: body.factor_data?.stale === true,
    hacLags: numOrNull(body.hac_lags),
    periodsPerYear: numOrNull(body.periods_per_year),
    measures: rows.map((r) => normalizeMeasure(r as Record<string, unknown>)),
  };
}

/**
 * The reason the battery is absent, for the explicit absent state. The engine
 * returns `{ ok: false, error }` on a 4xx/5xx (window too short, no factor
 * overlap, run not found, quant extra missing) — surface that verbatim. Only
 * when the transport gave us nothing (status 0, no body) do we fall back to a
 * generic "engine didn't respond", never a client-invented statistical excuse.
 */
export function batteryAbsence(status: number, body: unknown): string {
  const error =
    body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : '';
  if (error) return error;
  if (status === 0) {
    return "The factor battery runs on your local Auracle engine. Make sure the stack is running, then reopen this run.";
  }
  return 'The engine could not return a factor battery for this run.';
}

/**
 * A readable form of the engine's snake_case verdict for the status chip
 * (`significant_positive` → `significant positive`). Presentation only — the
 * word itself is the engine's, unchanged in meaning; the chip's own CSS
 * upper-cases it, exactly as the validation rail does with its tier words.
 */
export function humanizeVerdict(verdict: string): string {
  return verdict.replace(/_/g, ' ').trim();
}

/**
 * The neutral headline magnitude for a row — the "how big", never the "is it
 * real" (the verdict and reading own significance). A factor loading is a
 * magnitude, not a health state, so this is rendered quietly, like the
 * research surface's factor bars: annualized alpha as a signed percent, a
 * factor beta, or the fit as R-squared. Returns null when the row carries no
 * headline number.
 */
export function measureFigure(m: FactorMeasure): string | null {
  if (m.annual !== null) {
    const sign = m.annual > 0 ? '+' : '';
    return `${sign}${(m.annual * 100).toFixed(1)}% / yr`;
  }
  if (m.beta !== null) return `β ${m.beta.toFixed(2)}`;
  if (m.rSquared !== null) return `R² ${(m.rSquared * 100).toFixed(0)}%`;
  return null;
}
