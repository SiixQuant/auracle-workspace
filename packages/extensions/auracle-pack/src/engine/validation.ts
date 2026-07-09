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

/**
 * The ambient context a validation verdict publishes to the AI chat via
 * `host.ai.setContext` (panel is `aiSupported`). Kept compact and stable so
 * the agent can answer "what does this validation mean?" from any session
 * without the panel having to hand anything off explicitly.
 */
export function validationContext(verdict: ValidationVerdict): Record<string, unknown> {
  return {
    panel: 'validation',
    strategy_path: verdict.strategy_path,
    as_of: verdict.as_of,
    summary: verdict.plain || railHeadline(verdict.signals),
    signals: verdict.signals.map((s) => ({
      name: s.name,
      tier: s.tier,
      plain: s.plain,
      fix: s.what_usually_fixes_it,
    })),
  };
}

/**
 * The explicit hand-off prompt for the "Ask the agent" button. Embeds the
 * flagged signals directly (so the agent has the verdict even in a fresh
 * session) and points it at the strategy file + the engine to re-check.
 */
export function validationPrompt(verdict: ValidationVerdict): string {
  const reds = verdict.signals.filter((s) => s.tier === 'red');
  const unknowns = verdict.signals.filter((s) => s.tier === 'unknown');
  const lines: string[] = [
    `Auracle's overfit validation just ran on the strategy \`${verdict.strategy_path}\`.`,
    `Verdict: ${verdict.plain || railHeadline(verdict.signals)}.`,
  ];
  if (reds.length > 0) {
    lines.push('', 'Signals that need attention:');
    for (const s of reds) {
      const fix = s.what_usually_fixes_it ? ` (usually fixed by: ${s.what_usually_fixes_it})` : '';
      lines.push(`- ${s.name}: ${s.plain}${fix}`);
    }
  }
  if (unknowns.length > 0) {
    lines.push('', `Couldn't be checked on this history: ${unknowns.map((s) => s.name).join(', ')}.`);
  }
  lines.push(
    '',
    'Read this strategy in my workspace, explain what each flagged signal means for THIS strategy specifically, and propose concrete, minimal changes to address the red signals without overfitting further. You can re-run validation through the Auracle engine to check your changes.'
  );
  return lines.join('\n');
}
