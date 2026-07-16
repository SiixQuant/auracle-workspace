/**
 * houseStats — maps an engine stats payload onto the house tearsheet's card
 * rows, applying the honesty rules that keep a backtest from overselling
 * itself. Pure and render-free so the rules can be unit-tested directly;
 * they are exactly the ones worth testing, because they are the ones that
 * stop a number from lying.
 *
 * Two engine sentinels are decoded here rather than printed raw. Both are
 * documented in auracle/backtest/stats.py and both, left alone, reach the
 * reader as their OPPOSITE:
 *
 *   - sortino_ratio returns exactly 10.0 when a run had no losing days
 *     ("Capped at 10.0 ... instead of +inf" so JSON survives). Printed as
 *     "10.00" it is the best number on the row; it actually means the
 *     downside sample is empty.
 *   - profit_factor returns +inf on the same condition (its docstring:
 *     "Inf when there are no losing days (suspicious — probably overfit)").
 *     The result endpoint's _clean() nulls non-finite values, so the
 *     loudest overfit tell arrives disguised as missing data.
 *
 * Both conditions are recoverable from worst_day, which is returns.min():
 * worst_day >= 0 means no bar lost money, which is what fired the cap.
 */
import type { MetricProps } from '../components/panelkit';
import { tone } from '../components/panelkit';

/** House rule: missing data is an em dash, never a fabricated number. */
export const EM_DASH = '—';

/** Trading days in a year — the engine's own annualization constant. */
const PERIODS_PER_YEAR = 252;

/** The value sortino_ratio returns when the downside sample is empty. */
const SORTINO_NO_DOWNSIDE = 10;

type Stats = Record<string, number | null>;

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const pct = (v: number | null | undefined, digits = 2): string => {
  const n = num(v);
  return n === null ? EM_DASH : `${(n * 100).toFixed(digits)}%`;
};

const dec = (v: number | null | undefined, digits = 2): string => {
  const n = num(v);
  return n === null ? EM_DASH : n.toFixed(digits);
};

/**
 * True when the engine's no-losing-days sentinels fired. Reconstructed from
 * worst_day because the endpoint nulls the +inf that profit_factor returned.
 */
export function hasNoLosingDays(stats: Stats): boolean {
  const worst = num(stats.worst_day);
  return worst !== null && worst >= 0;
}

/** A run shorter than a year cannot report an honest annualized figure. */
export function subAnnual(nBars: number): boolean {
  return nBars > 0 && nBars < PERIODS_PER_YEAR;
}

/**
 * The house headline six, in house order: CAGR, Sharpe, Sortino, Ann. Vol,
 * Max DD, Alpha. Alpha has no benchmark in a backtest job, so it renders as
 * an em dash rather than a number the engine never computed.
 */
export function headlineCards(stats: Stats, nBars: number): MetricProps[] {
  const cagr = num(stats.annualized_return ?? stats.cagr);
  const sortino = num(stats.sortino);
  const cappedSortino = sortino !== null && sortino >= SORTINO_NO_DOWNSIDE && hasNoLosingDays(stats);

  return [
    {
      label: 'CAGR',
      value: subAnnual(nBars) ? EM_DASH : pct(cagr),
      sub: subAnnual(nBars) ? 'under one year' : undefined,
      valueColor: tone.text,
    },
    { label: 'Sharpe', value: dec(stats.sharpe), sub: 'rf = 0', valueColor: tone.text },
    {
      label: 'Sortino',
      value: cappedSortino ? `≥ ${SORTINO_NO_DOWNSIDE.toFixed(2)}` : dec(sortino),
      sub: cappedSortino ? 'no losing days — capped' : 'rf = 0',
      valueColor: cappedSortino ? tone.caution : tone.text,
    },
    { label: 'Ann. vol', value: pct(stats.annualized_vol), valueColor: tone.text },
    { label: 'Max drawdown', value: pct(stats.max_drawdown), valueColor: tone.danger },
    { label: 'Alpha', value: EM_DASH, sub: 'needs a benchmark', valueColor: tone.text3 },
  ];
}

/**
 * The eight the panel used to discard. Profit factor decodes the nulled
 * +inf: an empty loss sample is a finding, not a blank.
 */
export function detailCards(stats: Stats, trades: number): MetricProps[] {
  const noLosses = hasNoLosingDays(stats);
  const profitFactor = num(stats.profit_factor);

  return [
    { label: 'Calmar', value: dec(stats.calmar), valueColor: tone.text },
    { label: 'Worst day', value: pct(stats.worst_day), valueColor: tone.danger },
    { label: 'Best day', value: pct(stats.best_day), valueColor: tone.text },
    { label: 'Win rate', value: pct(stats.win_rate, 1), valueColor: tone.text },
    {
      label: 'Profit factor',
      value: profitFactor === null && noLosses ? 'no losing days' : dec(profitFactor),
      sub: profitFactor === null && noLosses ? 'check for overfit' : undefined,
      valueColor: profitFactor === null && noLosses ? tone.caution : tone.text,
    },
    { label: 'VaR 95%', value: pct(stats.var_5pct), valueColor: tone.danger },
    { label: 'CVaR 95%', value: pct(stats.cvar_5pct), valueColor: tone.danger },
    { label: 'Trades', value: trades > 0 ? String(trades) : EM_DASH, valueColor: tone.text },
  ];
}

/**
 * The one-line takeaway beside the DRAWDOWN title — the three tail figures
 * that mean the most where the drawdown is, per the house's risk-profile row.
 */
export function tailFacts(stats: Stats): string {
  const parts = [
    `Worst day ${pct(stats.worst_day)}`,
    `VaR 95% ${pct(stats.var_5pct)}`,
    `CVaR 95% ${pct(stats.cvar_5pct)}`,
  ];
  return parts.join(' · ');
}

/**
 * The house footnote: explains the em dash, the rf = 0 convention (which has
 * already caused a documented house-vs-QuantConnect Sharpe discrepancy), and
 * the -100% drawdown floor the engine applies.
 */
export function houseFootnote(stats: Stats, nBars: number, asOf: string): string {
  const lines = [
    'In-Sample simulation — results are hypothetical.',
    'Sharpe and Sortino are daily returns at rf = 0, annualized.',
    'VaR and CVaR are 1-day historical at 95%. Max drawdown is floored at -100%.',
    'Alpha needs a benchmark and is not measured in this run.',
  ];
  if (subAnnual(nBars)) {
    lines.push(`CAGR is withheld below one year of bars (${nBars} here) — annualizing a short window overstates it.`);
  }
  if (hasNoLosingDays(stats)) {
    lines.push('This run has no losing days, which caps Sortino and voids profit factor.');
  }
  if (asOf) lines.push(`Computed ${asOf}.`);
  return lines.join(' ');
}
