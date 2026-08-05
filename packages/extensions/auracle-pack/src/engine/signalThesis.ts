/**
 * signalThesis — composes a per-trade thesis from a TradeRecord's structured
 * SignalFacts (WS-G / FR-B6, INV-2). This is the ONE place a `{rule, values}`
 * fact becomes readable text, so the Trades view never hand-rolls its own
 * phrasing and every clause reads the same way.
 *
 * The hard rule is INV-2 and the house honesty wall (INV-1): the text only ever
 * RESTATES the facts the engine logged. It humanizes the rule slug and renders
 * each logged value; it invents nothing — no dollar figure, no per-trade return,
 * no narrative the facts don't support. A trade that logged no signal composes
 * to NULL (not an empty string, not a guessed sentence) so the view shows its
 * quiet "no logged signal" rest instead of a fabricated one.
 */
import type { SignalFact } from './client';
import { humanizeRule } from './humanize';

/** A slug's lower-cased alphabetic tokens (numeric parameters dropped). */
function alphaTokens(slug: string): string[] {
  return slug
    .toLowerCase()
    .split(/[\s._-]+/)
    .filter((token) => token.length > 0 && !/^\d/.test(token));
}

/** A value KEY as a readable, lower-case name, with a trailing percent marker
 *  stripped: 'gap_pct' ⇒ 'gap', 'hold_days' ⇒ 'hold days'. */
function valueName(name: string): string {
  const base = name.replace(/[_-]?pct$/i, '');
  const readable = base
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase())
    .join(' ');
  return readable || name.toLowerCase();
}

/** True when a value key names a percent quantity (suffix `pct`/`_pct`). */
function isPercentKey(name: string): boolean {
  return /pct$/i.test(name);
}

/** A fraction as a signed percent at one decimal: 0.031 ⇒ '+3.1%'. */
function signedPercent(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${Math.abs(value * 100).toFixed(1)}%`;
}

/** A plain number with trailing zeros trimmed: 0.62 ⇒ '0.62', 20 ⇒ '20'. */
function plainNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(parseFloat(value.toFixed(2)));
}

/**
 * A confirming boolean flag (`crossed:true` under an `..._cross` rule) merely
 * restates the rule name — the clause already says "MA cross" — so it is
 * dropped. Guarded to rule tokens of 3+ chars so a two-letter indicator ('ma')
 * cannot swallow an unrelated flag. Only TRUE flags are elided this way; a FALSE
 * flag always renders, because "not X" carries non-obvious information.
 */
function restatesRule(name: string, ruleTokens: string[]): boolean {
  const stem = name.toLowerCase().replace(/[\s._-]+/g, '');
  return ruleTokens.some((token) => token.length >= 3 && (stem.includes(token) || token.includes(stem)));
}

/** One `{name: value}` pair as a clause fragment, or null when it is dropped
 *  (a redundant confirming flag, or a non-finite number). */
function renderValue(name: string, value: number | boolean, ruleTokens: string[]): string | null {
  if (typeof value === 'boolean') {
    if (value) return restatesRule(name, ruleTokens) ? null : valueName(name);
    return `not ${valueName(name)}`;
  }
  if (!Number.isFinite(value)) return null;
  return isPercentKey(name)
    ? `${valueName(name)} ${signedPercent(value)}`
    : `${valueName(name)} ${plainNumber(value)}`;
}

/**
 * One SignalFact as a readable clause: the humanized rule, then each logged
 * value, joined by ' · '. So `{rule:'ma_cross_20_50', values:{crossed:true,
 * gap_pct:0.031}}` composes to '20/50 MA cross · gap +3.1%'.
 */
export function composeSignalClause(fact: SignalFact): string {
  const label = humanizeRule(fact.rule) ?? 'signal';
  const ruleTokens = alphaTokens(fact.rule ?? '');
  const parts: string[] = [];
  for (const [name, value] of Object.entries(fact.values ?? {})) {
    const part = renderValue(name, value, ruleTokens);
    if (part) parts.push(part);
  }
  return [label, ...parts].join(' · ');
}

/**
 * The per-trade thesis: one composed clause per SignalFact, in order. Returns
 * NULL when the trade logged no signal (INV-2) — the caller then shows a
 * facts-only rest, never an invented sentence. Never returns an empty array.
 */
export function composeThesis(signals: SignalFact[] | null | undefined): string[] | null {
  if (!Array.isArray(signals) || signals.length === 0) return null;
  return signals.map(composeSignalClause);
}
