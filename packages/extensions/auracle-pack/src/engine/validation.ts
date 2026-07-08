/**
 * Validation view model — types + pure helpers over the engine's
 * /ui/api/validation surface (the seven overfit signals).
 *
 * The engine computes the whole rail (real backtest + walk-forward), so
 * the panel renders its verdict verbatim: tri-state signals, the plain
 * summary, and the fix each red signal usually needs. No client-side
 * judgment — the tier is the engine's word.
 */

export type SignalTier = 'green' | 'red' | 'unknown';

export interface ValidationSignal {
  signal: string;
  name: string;
  tier: SignalTier;
  value: number | null;
  threshold: number | null;
  plain: string;
  what_usually_fixes_it: string;
}

export interface ValidationVerdict {
  as_of: string | null;
  strategy_path: string;
  signals: ValidationSignal[];
  fired_details: string[];
  plain: string;
}

/** Coerce a raw signal row into the known shape, defaulting honestly. */
export function normalizeSignal(raw: Record<string, unknown>): ValidationSignal {
  const str = (v: unknown, fallback = ''): string =>
    typeof v === 'string' ? v : fallback;
  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const tier = str(raw.tier);
  return {
    signal: str(raw.signal),
    name: str(raw.name) || str(raw.signal) || '(signal)',
    tier: tier === 'green' || tier === 'red' ? tier : 'unknown',
    value: numOrNull(raw.value),
    threshold: numOrNull(raw.threshold),
    plain: str(raw.plain),
    what_usually_fixes_it: str(raw.what_usually_fixes_it),
  };
}

export function normalizeVerdict(body: Record<string, unknown>): ValidationVerdict {
  const rows = Array.isArray(body.signals)
    ? (body.signals as Record<string, unknown>[])
    : [];
  return {
    as_of: typeof body.as_of === 'string' ? body.as_of : null,
    strategy_path: typeof body.strategy_path === 'string' ? body.strategy_path : '',
    signals: rows.map(normalizeSignal),
    fired_details: Array.isArray(body.fired_details)
      ? body.fired_details.filter((x): x is string => typeof x === 'string')
      : [],
    plain: typeof body.plain === 'string' ? body.plain : '',
  };
}

/** A one-line health count from the rail (green of total; reds flagged). */
export function railHeadline(signals: ValidationSignal[]): string {
  if (signals.length === 0) return 'No signals returned.';
  const reds = signals.filter((s) => s.tier === 'red').length;
  const unknowns = signals.filter((s) => s.tier === 'unknown').length;
  const healthy = signals.length - reds - unknowns;
  const bits = [`${healthy} of ${signals.length} checks look healthy`];
  if (reds) bits.push(`${reds} need attention`);
  if (unknowns) bits.push(`${unknowns} couldn't be checked`);
  return bits.join(' · ');
}
