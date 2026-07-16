/**
 * The honesty rules for the Backtest panel's card rows.
 *
 * These exist because two engine sentinels, printed raw, tell the reader the
 * OPPOSITE of what they mean — and both fire on exactly the runs a strategy
 * author most needs to distrust. Verified against auracle/backtest/stats.py:
 *   sortino_ratio  -> `if len(downside) == 0: return 10.0 ...`
 *   profit_factor  -> `if losses == 0: return float("inf") ...`
 *                     docstring: "suspicious — probably overfit"
 * The result endpoint's _clean() then nulls the +inf, so profit factor arrives
 * looking like absent data rather than a finding.
 */
import { describe, expect, it } from 'vitest';
import { detailCards, hasNoLosingDays, headlineCards, houseFootnote, subAnnual } from '../houseStats';

/** A run with a real downside sample — nothing suspicious. */
const HEALTHY = {
  annualized_return: 0.2981,
  sharpe: 1.31,
  sortino: 1.84,
  annualized_vol: 0.18,
  max_drawdown: -0.1909,
  calmar: 1.56,
  worst_day: -0.0448,
  best_day: 0.052,
  win_rate: 0.55,
  profit_factor: 1.42,
  var_5pct: -0.021,
  cvar_5pct: -0.032,
};

/** The shape the engine emits when NO bar lost money. */
const NO_LOSING_DAYS = {
  ...HEALTHY,
  sortino: 10,
  profit_factor: null, // _clean() nulled the +inf
  worst_day: 0.0004, // returns.min() >= 0 — this is what fired both sentinels
};

const find = (cards: ReturnType<typeof headlineCards>, label: string) =>
  cards.find((c) => c.label === label)!;

describe('no-losing-days sentinels', () => {
  it('detects the condition from worst_day, which is returns.min()', () => {
    expect(hasNoLosingDays(HEALTHY)).toBe(false);
    expect(hasNoLosingDays(NO_LOSING_DAYS)).toBe(true);
  });

  it('never prints a bare 10.00 Sortino — the cap is not a score', () => {
    const capped = find(headlineCards(NO_LOSING_DAYS, 2500), 'Sortino');
    expect(capped.value).toBe('≥ 10.00');
    expect(capped.sub).toBe('no losing days — capped');
    // Left raw this reads as the best number on the row.
    expect(capped.value).not.toBe('10.00');
  });

  it('leaves an ordinary Sortino alone', () => {
    const normal = find(headlineCards(HEALTHY, 2500), 'Sortino');
    expect(normal.value).toBe('1.84');
    expect(normal.sub).toBe('rf = 0');
  });

  it('reports a voided profit factor as a finding, not as missing data', () => {
    const card = find(detailCards(NO_LOSING_DAYS, 200), 'Profit factor');
    expect(card.value).toBe('no losing days');
    expect(card.sub).toBe('check for overfit');
    expect(card.value).not.toBe('—');
  });

  it('still shows an em dash when profit factor is genuinely absent', () => {
    // Null profit factor WITHOUT the no-losing-days condition is real absence.
    const card = find(detailCards({ ...HEALTHY, profit_factor: null }, 200), 'Profit factor');
    expect(card.value).toBe('—');
  });
});

describe('house honesty rules', () => {
  it('withholds CAGR below a year of bars rather than annualizing a stub', () => {
    expect(subAnnual(120)).toBe(true);
    expect(subAnnual(252)).toBe(false);
    expect(find(headlineCards(HEALTHY, 120), 'CAGR').value).toBe('—');
    expect(find(headlineCards(HEALTHY, 2500), 'CAGR').value).toBe('29.81%');
  });

  it('renders Alpha as an em dash — a backtest job has no benchmark', () => {
    const alpha = find(headlineCards(HEALTHY, 2500), 'Alpha');
    expect(alpha.value).toBe('—');
    expect(alpha.sub).toBe('needs a benchmark');
  });

  it('states the rf = 0 convention on both ratios', () => {
    expect(find(headlineCards(HEALTHY, 2500), 'Sharpe').sub).toBe('rf = 0');
    expect(houseFootnote(HEALTHY, 2500, '2026-07-15')).toContain('rf = 0');
  });

  it('converts fractions to percent — the engine returns 0.55, not 55', () => {
    expect(find(headlineCards(HEALTHY, 2500), 'Ann. vol').value).toBe('18.00%');
    expect(find(detailCards(HEALTHY, 200), 'Win rate').value).toBe('55.0%');
    expect(find(detailCards(HEALTHY, 200), 'Worst day').value).toBe('-4.48%');
  });

  it('never fabricates a number for a missing stat', () => {
    const cards = [...headlineCards({}, 2500), ...detailCards({}, 0)];
    for (const c of cards) {
      expect(typeof c.value === 'string' ? c.value : '').not.toMatch(/NaN|Infinity|undefined|null/);
    }
    expect(find(headlineCards({}, 2500), 'Sharpe').value).toBe('—');
  });

  it('discloses the sentinels in the footnote when they fire', () => {
    expect(houseFootnote(NO_LOSING_DAYS, 2500, '')).toContain('no losing days');
    expect(houseFootnote(HEALTHY, 2500, '')).not.toContain('no losing days');
  });
});
