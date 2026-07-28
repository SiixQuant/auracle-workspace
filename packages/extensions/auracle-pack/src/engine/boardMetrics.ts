/**
 * What a Board card's metrics peek says — every rule, none of the drawing.
 *
 * ## The provenance badge is the load-bearing part
 * A run's numbers came from ONE place. The badge says which, in two states and
 * never a third: a run the engine declares a non-local source for is
 * CERTIFIED and names that source; a run with no declared source is a LOCAL
 * DEV RUN. There is deliberately no "mostly", no "partly", and no state that
 * covers both — a blended badge would let a local number borrow the authority
 * of a certified one, which is the exact dishonesty the house forbids. The
 * source itself is read with {@link resolveRunSource}, the same normalizer the
 * full results page uses, so the two surfaces can never disagree about where a
 * run came from.
 *
 * ## The figures are the page's figures
 * CAGR, Sharpe and max drawdown are printed with {@link statPercent} and
 * {@link statDecimal} — the tearsheet's own formatters — and CAGR is withheld
 * below a year of bars by the same {@link subAnnual} rule. A peek is a smaller
 * view of one measurement, not a second measurement of the same run.
 *
 * ## Absent, never zero
 * A stat the engine did not report prints an em dash. A curve with fewer than
 * two real points draws NOTHING rather than a flat line, because a flat line is
 * a claim about a strategy and an empty box is not.
 */
import { resolveRunSource } from './client';
import type { BacktestResultData, BacktestSnapshot } from './backtestStore';
import { EM_DASH, statDecimal, statPercent, subAnnual } from './houseStats';

/* ── provenance ──────────────────────────────────────────────────────── */

/** Two states, and no third. See the header. */
export type ProvenanceKind = 'certified' | 'local';

export interface ProvenanceBadge {
  kind: ProvenanceKind;
  /** What the badge reads on screen. */
  label: string;
  /** The one-line explanation the peek shows under the figures. */
  note: string;
}

const LOCAL_BADGE: ProvenanceBadge = {
  kind: 'local',
  label: 'local dev run',
  note: 'Measured on this machine — not certified anywhere else.',
};

/** Title-case a source token this build has never heard of, so a future
 *  engine source still reads as a name rather than a slug. */
function titled(source: string): string {
  return source.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The badge for a run's declared source. `undefined`, an empty token, and the
 * engine's own local synonyms all resolve to the local badge — that is
 * {@link resolveRunSource}'s job and this function does not second-guess it.
 */
export function provenanceBadge(source?: string): ProvenanceBadge {
  const token = resolveRunSource({ source });
  if (!token) return LOCAL_BADGE;
  const key = token.trim().toLowerCase();
  const name = key === 'quantconnect' || key === 'qc' ? 'QC' : titled(token);
  return {
    kind: 'certified',
    label: `${name}-certified`,
    note: `Measured on ${name === 'QC' ? 'QuantConnect' : name}, not re-run locally.`,
  };
}

/* ── the figures ─────────────────────────────────────────────────────── */

export interface PeekMetric {
  label: string;
  value: string;
}

/**
 * The four figures a peek carries, in house order. Every one is an engine
 * value put through the tearsheet's own formatter; nothing is derived here.
 */
export function peekMetrics(result: BacktestResultData): PeekMetric[] {
  const stats = result.stats ?? {};
  const cagr = stats.annualized_return ?? stats.cagr;
  return [
    // Withheld below a year of bars for the reason the full page gives:
    // annualizing a short window overstates it.
    { label: 'CAGR', value: subAnnual(result.nBars) ? EM_DASH : statPercent(cagr) },
    { label: 'Sharpe', value: statDecimal(stats.sharpe) },
    { label: 'Max DD', value: statPercent(stats.max_drawdown) },
    { label: 'Trades', value: result.trades > 0 ? String(result.trades) : EM_DASH },
  ];
}

/* ── validation ──────────────────────────────────────────────────────── */

export type ValidationState =
  | 'unchecked'
  | 'checking'
  | 'unmeasurable'
  | 'failed'
  | 'clean'
  | 'attention';

export interface ValidationReading {
  state: ValidationState;
  label: string;
}

const NOT_CHECKED: ValidationReading = { state: 'unchecked', label: 'not checked in this session' };

/**
 * The overfit check's standing for one run.
 *
 * The engine stores no verdict, so the only place the answer exists is the
 * session that ran it: a card whose run is NOT the one the session validated
 * reads "not checked", never the verdict belonging to a different run. The
 * wording matches the plan's validation room exactly, so one check does not
 * get described two ways.
 */
export function validationReading(jobId: string, run: BacktestSnapshot): ValidationReading {
  if (run.jobId === null || String(run.jobId) !== jobId) return NOT_CHECKED;
  const validation = run.validation;
  switch (validation.phase) {
    case 'running':
      return { state: 'checking', label: 'checking the signals' };
    case 'error':
      return { state: 'unmeasurable', label: 'not measurable' };
    case 'failed':
      return { state: 'failed', label: 'check failed' };
    case 'done': {
      const signals = validation.verdict?.signals ?? [];
      if (signals.length === 0) return { state: 'unchecked', label: 'no signals returned' };
      const red = signals.filter((signal) => signal.tier === 'red').length;
      return red > 0
        ? { state: 'attention', label: `${red} of ${signals.length} checks need attention` }
        : { state: 'clean', label: `${signals.length} checks healthy` };
    }
    default:
      return NOT_CHECKED;
  }
}

/* ── the sparkline ───────────────────────────────────────────────────── */

/** Two decimals is finer than any screen this is drawn on, and it makes the
 *  path a stable string a test can assert against. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * An SVG path for an equity curve inside a `width` x `height` box, or NULL when
 * there is no curve to draw.
 *
 * Null rather than an empty path, and null for a series of ONE as well as none:
 * a single point drawn as a line is a claim that the equity did not move, which
 * is a different statement from "there is nothing to show yet". Non-finite
 * values (the engine serializes NaN and Inf as JSON null) are dropped rather
 * than interpolated across.
 *
 * A perfectly flat series is the one case that does draw: it is a real reading,
 * and it is centred rather than pinned to an edge, because with no range there
 * is no top or bottom to be at.
 */
export function sparklinePath(
  points: readonly (number | null | undefined)[] | null | undefined,
  width: number,
  height: number
): string | null {
  if (!Array.isArray(points)) return null;
  const values = points.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = width / (values.length - 1);

  return values
    .map((value, index) => {
      const x = round(index * step);
      const y = round(span === 0 ? height / 2 : height - ((value - min) / span) * height);
      return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ');
}
