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

/**
 * The rf = 0 basis, stated once. The engine computes Sharpe and Sortino on
 * daily returns with the risk-free rate held at zero — a convention that has
 * already produced a documented house-vs-QuantConnect Sharpe gap. Every
 * surface that labels the convention reuses this literal so the wording never
 * drifts and no house ratio gets read as a QuantConnect one.
 */
export const RF_ZERO_SENTENCE = 'Sharpe and Sortino are daily returns at rf = 0, annualized.';

/**
 * The provenance caveat for a house-computed measure shown on a run whose
 * numbers originated elsewhere. Keeps cross-source comparability from being
 * implied: the figures are Auracle's own, computed from the run's returns, not
 * the source's native analytics. Returns null for a local run — there is no
 * other source to distinguish it from. `source` is the humanized label (e.g.
 * "QuantConnect").
 */
export function houseProvenanceNote(source?: string | null): string | null {
  if (!source) return null;
  return `Computed by Auracle from this run's own returns, not by ${source} — the two are not comparable across data sources.`;
}

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
 * The two figure formatters, for surfaces smaller than the tearsheet — the
 * Board's metrics peek quotes the same run these cards do, and a peek that
 * rounded differently would read as a second, disagreeing measurement of one
 * number. Exported rather than re-implemented for exactly that reason.
 */
export const statPercent = pct;
export const statDecimal = dec;

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

/* ── tearsheet metric table (WS-E / FR-E1, FR-E5) ───────────────────────── */

/** A ratio at the reference's three-decimal precision (Sharpe "1.420"). */
const ratio = (v: number | null | undefined): string => dec(v, 3);

/** A whole-day count — no decimals (Days Since ATH "34"). */
const days = (v: number | null | undefined): string => {
  const n = num(v);
  return n === null ? EM_DASH : String(Math.round(n));
};

/**
 * A value ALREADY in percent units — the benchmark's last cumulative-return
 * point arrives as 173.0 (meaning +173%), not the 0.xx fraction the `stats`
 * block uses, so it is formatted without the ×100 the fraction path applies.
 */
const pctDirect = (v: number | null | undefined): string => {
  const n = num(v);
  return n === null ? EM_DASH : `${n.toFixed(2)}%`;
};

/** A humanized dollar capacity — "$2.4M", "$850K", "$1.2B", "$740" — or an em
 *  dash when the engine computed no ceiling (nothing in the book constrains it). */
const usd = (v: number | null | undefined): string => {
  const n = num(v);
  if (n === null) return EM_DASH;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

/** One label/value line of the Risk / Return table. Values are strings the
 *  component prints verbatim (all white) — never re-derived downstream. */
export interface TearsheetMetricRow {
  label: string;
  value: string;
}

/** What the tearsheet's 14 rows need beyond the `stats` block: alpha comes from
 *  the `/factors` battery and the benchmark return from the overlay's tail. */
export interface TearsheetMetricInputs {
  /** annualized alpha as a FRACTION (`factors.regression.alpha_annual`). */
  alphaAnnual?: number | null;
  /** the benchmark overlay's last point, already in PERCENT units. */
  benchmarkReturnPct?: number | null;
}

/**
 * The reference's Risk / Return table, in its exact order and labels — the
 * 14 rows the owner's tearsheet shows (`_a.html`). Formatting matches the
 * reference precisely: fraction-based percentages at two decimals, the four
 * ratios at three, the two day-counts as integers, and the benchmark return
 * printed from its own percent units. Every missing value is an em dash, never
 * a fabricated number (the house rule). The Sortino cap is decoded like the
 * headline cards so a no-losing-days run cannot read its emptiness as a score.
 */
export function tearsheetMetricRows(
  stats: Stats,
  inputs: TearsheetMetricInputs = {}
): TearsheetMetricRow[] {
  const sortinoRaw = num(stats.sortino);
  const sortino =
    sortinoRaw !== null && sortinoRaw >= SORTINO_NO_DOWNSIDE && hasNoLosingDays(stats)
      ? `≥ ${SORTINO_NO_DOWNSIDE.toFixed(3)}`
      : ratio(stats.sortino);

  return [
    { label: 'Strategy Return', value: pct(stats.total_return) },
    { label: 'Annualized Return', value: pct(stats.annualized_return) },
    { label: 'Sharpe Ratio', value: ratio(stats.sharpe) },
    { label: 'Sortino Ratio', value: sortino },
    { label: 'Calmar Ratio', value: ratio(stats.calmar) },
    { label: 'Annualized Volatility', value: pct(stats.annualized_vol) },
    { label: 'Max Drawdown', value: pct(stats.max_drawdown) },
    { label: 'Average Drawdown', value: pct(stats.average_drawdown) },
    { label: 'Current Drawdown', value: pct(stats.current_drawdown) },
    { label: 'Days Since ATH', value: days(stats.days_since_ath) },
    { label: 'Average Drawdown Days', value: days(stats.average_drawdown_days) },
    { label: 'Benchmark Return', value: pctDirect(inputs.benchmarkReturnPct) },
    { label: 'Alpha', value: pct(inputs.alphaAnnual) },
    { label: 'Excess Sharpe', value: ratio(stats.excess_sharpe) },
    // The luck-adjusted read (#5): the probability this Sharpe beats what the
    // best of every backtest tried on this strategy would reach by luck alone
    // (the engine's deflated PSR, folded into `stats`). An em dash until the
    // engine has recorded a trial — a missing value is never a fabricated one.
    { label: 'Confidence vs Luck', value: pct(stats.deflated_psr) },
    // Net of trading costs (#6): the engine subtracts an assumed linear cost of
    // `cost_bps` per unit of turnover from the gross curve, then re-scores it —
    // so the two rows above (gross Strategy Return / Sharpe) meet their after-
    // cost twins here. Both are em dashes on a run scored before cost modeling;
    // the cost basis (rate + turnover) is stated in prose beneath the table by
    // {@link costBasisNote}, never implied by these numbers alone.
    { label: 'Net Return', value: pct(stats.net_return) },
    { label: 'Net Sharpe', value: ratio(stats.net_sharpe) },
    // Capacity (#7): the AUM at which the book's largest position would first
    // exceed the engine's participation cap on a name's average daily volume.
    // Em dash on a run scored before capacity modeling; the assumption behind
    // it is stated beneath the table by {@link capacityNote}.
    { label: 'Capacity', value: usd(stats.capacity_usd) },
  ];
}

/** A basis-point count without a trailing ".0" — 10.0 → "10", 12.5 → "12.5". */
function formatBps(bps: number): string {
  return Number.isInteger(bps) ? String(bps) : String(Number(bps.toFixed(1)));
}

/**
 * The trading-cost basis, in plain prose, for the quiet line beneath the
 * Risk / Return table (#6). The two "Net" rows are only honest if the reader
 * can see what "net" assumed: the engine's linear cost of `cost_bps` per unit
 * of turnover, and how much turnover the run actually ran. Returns null when
 * the run carries no net figures — a run the engine scored before cost modeling
 * shows the gross table with no cost line, never a fabricated assumption. No
 * jargon beyond "turnover", which this audience's tearsheet already trades in.
 */
export function costBasisNote(stats: Stats): string | null {
  const netSharpe = num(stats.net_sharpe);
  const netReturn = num(stats.net_return);
  if (netSharpe === null && netReturn === null) return null;
  const bps = num(stats.cost_bps);
  const turnover = num(stats.avg_turnover);
  const rate =
    bps === null ? 'an assumed linear cost' : `an assumed ${formatBps(bps)} bps per unit of turnover`;
  const churn = turnover === null ? null : `${(turnover * 100).toFixed(0)}% average turnover per rebalance`;
  return churn
    ? `Net rows subtract trading costs — ${rate}, which came to ${churn} here.`
    : `Net rows subtract trading costs — ${rate}.`;
}

/**
 * The capacity basis, in plain prose (#7). The Capacity row is only honest if
 * the reader can see what it assumes: the AUM ceiling is where the strategy's
 * largest position would first exceed `participation` of a name's average daily
 * volume. Returns null when the run carries no capacity figure — a run scored
 * before capacity modeling shows the gross table with no capacity line, never a
 * fabricated ceiling.
 */
export function capacityNote(stats: Stats): string | null {
  const cap = num(stats.capacity_usd);
  if (cap === null) return null;
  const part = num(stats.capacity_participation);
  const share = part === null ? 'a set share of' : `${(part * 100).toFixed(0)}% of`;
  return `Capacity is the AUM at which the largest position would first exceed ${share} a name's average daily volume.`;
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
export function houseFootnote(stats: Stats, nBars: number, asOf: string, external = false): string {
  const lines = [
    // An external run (a persisted QC import) is measured on the source
    // platform, not simulated here, so it never claims the in-sample framing.
    external
      ? 'External result — measured on the source platform, not simulated locally.'
      : 'In-Sample simulation — results are hypothetical.',
    RF_ZERO_SENTENCE,
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
