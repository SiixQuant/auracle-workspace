/**
 * scenarios — historical stress-window replay (Frontier #11).
 *
 * "How would this strategy have done in 2008? in COVID?" is answered without
 * re-running anything: a completed backtest's stored equity curve ALREADY
 * contains those periods, so we SLICE it to each named window and read the
 * in-window return and drawdown off the segment. That is more honest than
 * re-running the strategy over the window alone — the slice carries the real
 * warm-up state the strategy had going into the crisis, not an artificial
 * cold start. A window that falls before the strategy's history simply isn't
 * covered, and says so rather than inventing a number.
 *
 * Pure and render-free: the windows and the slice math are the part worth
 * unit-testing; the room draws the result with the shared DataGrid/Sparkline.
 */

export interface StressWindow {
  id: string;
  /** Human name, e.g. "Global Financial Crisis". */
  name: string;
  /** Inclusive ISO bounds (YYYY-MM-DD) — compared lexically against labels. */
  start: string;
  end: string;
  /** Short human range, e.g. "Oct 2007 – Mar 2009". */
  blurb: string;
  /** One plain line on what happened, for the row's hover. */
  what: string;
}

/** The named historical stress windows, oldest first. Bounds are the widely
 *  cited peak→trough spans; the slice tolerates a strategy covering only part. */
export const STRESS_WINDOWS: readonly StressWindow[] = [
  {
    id: 'gfc',
    name: 'Global Financial Crisis',
    start: '2007-10-09',
    end: '2009-03-09',
    blurb: 'Oct 2007 – Mar 2009',
    what: 'The credit crisis; the S&P 500 fell roughly 57% peak to trough.',
  },
  {
    id: 'debt-2011',
    name: '2011 Debt-Ceiling',
    start: '2011-07-22',
    end: '2011-10-03',
    blurb: 'Jul – Oct 2011',
    what: 'The US downgrade and euro-zone stress; a fast ~19% drawdown.',
  },
  {
    id: 'q4-2018',
    name: '2018 Q4 Selloff',
    start: '2018-09-20',
    end: '2018-12-24',
    blurb: 'Sep – Dec 2018',
    what: 'Rate-hike fears drove a ~20% quarter-end selloff.',
  },
  {
    id: 'covid',
    name: 'COVID Crash',
    start: '2020-02-19',
    end: '2020-03-23',
    blurb: 'Feb – Mar 2020',
    what: 'The fastest ~34% drop on record, over about five weeks.',
  },
  {
    id: 'rate-2022',
    name: '2022 Rate Shock',
    start: '2022-01-03',
    end: '2022-10-12',
    blurb: 'Jan – Oct 2022',
    what: 'Inflation and rapid rate hikes; a grinding ~25% bear market.',
  },
];

export interface ScenarioResult {
  window: StressWindow;
  /** Does the strategy's history overlap the window (≥ 2 points)? */
  covered: boolean;
  /** In-window total return, or null when not covered. */
  ret: number | null;
  /** In-window max drawdown (≤ 0), or null when not covered. */
  maxDrawdown: number | null;
  /** The window's growth curve rebased to 1.0 at its start (for a sparkline). */
  series: number[];
  /** Points that fell inside the window. */
  nDays: number;
}

/**
 * Slice one window out of a growth-of-$1 equity curve and read its in-window
 * return and drawdown. `labels` are ISO dates (compared lexically); `points`
 * are the cumulative curve. Fewer than two points in-window ⇒ not covered.
 */
export function sliceScenario(
  labels: string[],
  points: number[],
  w: StressWindow
): ScenarioResult {
  const seg: number[] = [];
  const n = Math.min(labels.length, points.length);
  for (let i = 0; i < n; i++) {
    const d = labels[i];
    if (d >= w.start && d <= w.end && Number.isFinite(points[i])) seg.push(points[i]);
  }
  if (seg.length < 2 || seg[0] === 0) {
    return { window: w, covered: false, ret: null, maxDrawdown: null, series: [], nDays: seg.length };
  }
  const base = seg[0];
  const rebased = seg.map((v) => v / base);
  const ret = rebased[rebased.length - 1] - 1;
  let peak = rebased[0];
  let mdd = 0;
  for (const v of rebased) {
    if (v > peak) peak = v;
    const dd = v / peak - 1;
    if (dd < mdd) mdd = dd;
  }
  return { window: w, covered: true, ret, maxDrawdown: mdd, series: rebased, nDays: seg.length };
}

/** Every named window sliced out of one curve, in {@link STRESS_WINDOWS} order. */
export function runScenarios(labels: string[], points: number[]): ScenarioResult[] {
  return STRESS_WINDOWS.map((w) => sliceScenario(labels, points, w));
}
