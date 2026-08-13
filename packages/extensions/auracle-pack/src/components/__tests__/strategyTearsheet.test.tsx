/**
 * The strategy tearsheet room (WS-E, AC-5).
 *
 * Two promises are pinned here. HONESTY: the Risk / Return table is the owner's
 * reference rows, in order, plus the Frontier additions (Confidence vs Luck #5,
 * Net Return / Net Sharpe #6), formatted to the reference (percentages at two
 * decimals, ratios at three, day-counts whole) — every value the engine's, put
 * through the house formatter. FIDELITY: the performance chart is driven by
 * `Plotly.react` with the reference's own traces (orange strategy line, grey
 * benchmark, steel underwater on the second y-axis) and layout (the two stacked
 * y-domains, the −45° ISO date ticks, `x unified` hover). Plotly is mocked —
 * jsdom paints nothing — so the figure is asserted from the call, not the pixels.
 *
 * The fetch seam is `client.tearsheetResult` / `tearsheetFactors`, the two
 * getJson-backed reads the room drives off; mocking them stands in for a
 * synthetic `/result` (+ `/factors`) without a live engine.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('plotly.js-basic-dist-min', () => ({
  default: {
    react: vi.fn(() => Promise.resolve()),
    newPlot: vi.fn(() => Promise.resolve()),
    purge: vi.fn(),
    Plots: { resize: vi.fn() },
  },
}));

vi.mock('../../engine/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/client')>();
  return {
    ...actual,
    tearsheetResult: vi.fn(),
    tearsheetFactors: vi.fn(),
    tearsheetTrades: vi.fn(),
    tearsheetRuns: vi.fn(),
  };
});

// The Live tab's deploy pane fetches connections/entitlements of its own and is
// pinned in liveDeploy.test.tsx; here it stands in as a marker so this suite
// stays on the tearsheet's own Backtest↔Live toggle.
vi.mock('../grid/pages/LiveDeploy', () => ({
  LiveDeployPane: () => <div data-testid="tearsheet-live-deploy" />,
}));

import Plotly from 'plotly.js-basic-dist-min';
import {
  tearsheetFactors,
  tearsheetResult,
  tearsheetRuns,
  tearsheetTrades,
  type BacktestResultBody,
  type FactorBatteryBody,
} from '../../engine/client';
import { focusStore } from '../../engine/focusStore';
import { buildTearsheetFigure } from '../charts/TearsheetChart';
import { benchmarkTail, growthToPercent } from '../grid/pages/Tearsheet';
import { StrategyPage } from '../grid/pages/StrategyPage';

const LABELS = ['2018-01-02', '2019-01-02', '2020-01-02', '2021-01-02', '2025-06-30'];

/** A synthetic `/result` whose numbers land on the reference's exact strings.
 *  The equity + benchmark curves are the engine's GROWTH-OF-$1 (first point
 *  1.0), the contract the tearsheet converts to cumulative-return % before it
 *  charts: growth 5.97 → +497% (matching total_return 4.97), benchmark growth
 *  2.73 → +173%. Drawdown is already percent. */
const RESULT: BacktestResultBody = {
  status: 'succeeded',
  chartable: true,
  strategy_path: 'strategies.desk.fund_pair.FundPair',
  as_of: '2026-08-05',
  n_bars: 1888,
  trades: 128,
  stats: {
    total_return: 4.97,
    annualized_return: 0.269,
    sharpe: 1.42,
    sortino: 1.95,
    calmar: 0.888,
    annualized_vol: 0.197,
    max_drawdown: -0.303,
    average_drawdown: -0.049,
    current_drawdown: -0.061,
    days_since_ath: 34,
    average_drawdown_days: 38,
    excess_sharpe: 0.47,
    deflated_psr: 0.87,
    // Net of trading costs (Frontier #6) — the engine's after-cost twins of
    // total_return / sharpe, plus the basis it charged (10 bps, 45% turnover).
    net_return: 4.72,
    net_sharpe: 1.31,
    cost_bps: 10,
    avg_turnover: 0.45,
    // Capacity (Frontier #7) — the AUM ceiling + the participation it assumed.
    capacity_usd: 2_400_000,
    capacity_participation: 0.1,
  },
  chart: { labels: LABELS, points: [1.0, 1.4, 0.88, 3.6, 5.97] },
  drawdown: { labels: LABELS, points: [0, -3.2, -30.3, -5.1, -6.1] },
  benchmark: { labels: LABELS, points: [1.0, 1.22, 0.92, 1.9, 2.73], symbol: 'SPY' },
};

const FACTORS: FactorBatteryBody = {
  ok: true,
  regression: { alpha_annual: 0.082, alpha_tstat: 2.3 },
};

const host = { panelId: 'com.auracle.pack.grid', extensionId: 'com.auracle.pack' } as never;

/** The reference's rows, in order: [slug, rendered value]. */
const EXPECTED_ROWS: Array<[string, string, string]> = [
  ['strategy-return', 'Strategy Return', '497.00%'],
  ['annualized-return', 'Annualized Return', '26.90%'],
  ['sharpe-ratio', 'Sharpe Ratio', '1.420'],
  ['sortino-ratio', 'Sortino Ratio', '1.950'],
  ['calmar-ratio', 'Calmar Ratio', '0.888'],
  ['annualized-volatility', 'Annualized Volatility', '19.70%'],
  ['max-drawdown', 'Max Drawdown', '-30.30%'],
  ['average-drawdown', 'Average Drawdown', '-4.90%'],
  ['current-drawdown', 'Current Drawdown', '-6.10%'],
  ['days-since-ath', 'Days Since ATH', '34'],
  ['average-drawdown-days', 'Average Drawdown Days', '38'],
  ['benchmark-return', 'Benchmark Return', '173.00%'],
  ['alpha', 'Alpha', '8.20%'],
  ['excess-sharpe', 'Excess Sharpe', '0.470'],
  // The luck-adjusted read (Frontier #5): the engine's deflated PSR, folded
  // into `stats` — the probability this Sharpe beats what the best of every
  // backtest tried on the strategy would reach by luck alone.
  ['confidence-vs-luck', 'Confidence vs Luck', '87.00%'],
  // Net of trading costs (Frontier #6): the after-cost twins of Strategy Return
  // and Sharpe — net_return 4.72 → +472%, net_sharpe 1.31 at three decimals.
  ['net-return', 'Net Return', '472.00%'],
  ['net-sharpe', 'Net Sharpe', '1.310'],
  // Capacity (Frontier #7): capacity_usd 2.4M humanized to "$2.4M".
  ['capacity', 'Capacity', '$2.4M'],
];

beforeEach(() => {
  vi.mocked(tearsheetResult).mockResolvedValue(RESULT);
  vi.mocked(tearsheetFactors).mockResolvedValue(FACTORS);
  // The Trades view (its own slice) fetches lazily; default it to an empty
  // succeeded list so this suite's focus stays on the Overview tearsheet.
  vi.mocked(tearsheetTrades).mockResolvedValue({ status: 'succeeded', trades: [] });
  // The recent-runs picker reads this on mount; empty keeps it hidden so this
  // suite stays on the Overview tearsheet.
  vi.mocked(tearsheetRuns).mockResolvedValue([]);
  // The room keys off the Spine's focus — point it at a backtest run.
  focusStore.publish({ run: { kind: 'backtest', id: '42' } });
});

afterEach(() => {
  cleanup();
  focusStore.clear();
  vi.clearAllMocks();
});

describe('the Risk / Return table matches the reference', () => {
  it('renders exactly the reference rows plus the Frontier additions, in order (all white)', async () => {
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(screen.getByTestId('tearsheet-metrics')).toBeTruthy());

    const root = screen.getByTestId('tearsheet-metrics');
    const values = root.querySelectorAll('[data-testid^="tearsheet-metric-value-"]');
    expect(values).toHaveLength(18);

    // Order and value, row by row.
    const orderedLabels = Array.from(root.children).map(
      (row) => row.querySelector('.auracle-tearsheet__mk')?.textContent
    );
    expect(orderedLabels).toEqual(EXPECTED_ROWS.map(([, label]) => label));

    for (const [slug, , value] of EXPECTED_ROWS) {
      const cell = screen.getByTestId(`tearsheet-metric-value-${slug}`);
      expect(cell.textContent).toBe(value);
    }
  });

  it('reads alpha from /factors and the benchmark return from the overlay tail', async () => {
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(screen.getByTestId('tearsheet-metric-value-alpha')).toBeTruthy());
    expect(vi.mocked(tearsheetFactors)).toHaveBeenCalledWith(42);
    expect(screen.getByTestId('tearsheet-metric-value-alpha').textContent).toBe('8.20%');
    expect(screen.getByTestId('tearsheet-metric-value-benchmark-return').textContent).toBe('173.00%');
  });

  it('hides a metric the engine did not compute rather than printing a half-empty row', async () => {
    vi.mocked(tearsheetResult).mockResolvedValue({
      ...RESULT,
      stats: { ...RESULT.stats, calmar: null },
    });
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(screen.getByTestId('tearsheet-metrics')).toBeTruthy());
    // The unmeasured metric drops its row — no em-dash cell to render.
    expect(screen.queryByTestId('tearsheet-metric-value-calmar-ratio')).toBeNull();
    // The measured rows are untouched, so the table is trimmed, not empty.
    expect(screen.getByTestId('tearsheet-metric-value-sharpe-ratio').textContent).toBe('1.420');
    expect(screen.getByTestId('tearsheet-metrics').querySelectorAll('[data-testid^="tearsheet-metric-value-"]')).toHaveLength(17);
  });
});

describe('the performance chart is a Plotly figure matched to the reference', () => {
  it('invokes Plotly.react with the strategy, benchmark and drawdown traces', async () => {
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(vi.mocked(Plotly.react)).toHaveBeenCalled());

    const traces = vi.mocked(Plotly.react).mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(traces).toHaveLength(3);

    const [strategy, benchmark, drawdown] = traces;
    expect(strategy.name).toBe('Strategy');
    expect(strategy.line).toEqual({ color: '#f26430', width: 1.6 });
    expect(strategy.yaxis).toBe('y');
    // The engine's growth-of-$1 curve is converted to cumulative-return % —
    // (v − 1) × 100 — before Plotly, so the fixture's growth curve plots as
    // these percents. Rounded to shed the float dust the subtraction leaves.
    expect((strategy.y as number[]).map((v) => Math.round(v * 100) / 100)).toEqual([
      0, 40, -12, 260, 497,
    ]);

    expect(benchmark.name).toBe('Benchmark');
    expect(benchmark.line).toEqual({ color: '#cfd3d8', width: 1.2 });
    expect(benchmark.yaxis).toBe('y');
    // Benchmark growth 2.73 tail plots as +173% too.
    expect((benchmark.y as number[]).map((v) => Math.round(v * 100) / 100)).toEqual([
      0, 22, -8, 90, 173,
    ]);

    expect(drawdown.name).toBe('Drawdown');
    expect(drawdown.line).toEqual({ color: '#86a0bd', width: 1.2 });
    expect(drawdown.yaxis).toBe('y2');
    expect(drawdown.y).toEqual([0, -3.2, -30.3, -5.1, -6.1]);
  });

  it('drives the stacked y-domains, ISO −45° date ticks and % suffixes from the reference layout', async () => {
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(vi.mocked(Plotly.react)).toHaveBeenCalled());

    const call = vi.mocked(Plotly.react).mock.calls[0];
    const layout = call[2] as Record<string, Record<string, unknown>>;
    const config = call[3] as Record<string, unknown>;

    expect(layout.yaxis.domain).toEqual([0.3, 1.0]);
    expect(layout.yaxis2.domain).toEqual([0, 0.2]);
    expect(layout.xaxis.anchor).toBe('y2');
    expect(layout.xaxis.tickformat).toBe('%Y-%m-%d');
    expect(layout.xaxis.tickangle).toBe(-45);
    expect(layout.yaxis.ticksuffix).toBe('%');
    expect(layout.yaxis2.ticksuffix).toBe('%');
    expect(layout.paper_bgcolor).toBe('#0e0f13');
    expect(layout.hovermode).toBe('x unified');
    expect(config).toEqual({ displayModeBar: false, responsive: true });
  });

  it('omits the benchmark trace and its return when the run has no benchmark', async () => {
    vi.mocked(tearsheetResult).mockResolvedValue({ ...RESULT, benchmark: null });
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(vi.mocked(Plotly.react)).toHaveBeenCalled());

    const traces = vi.mocked(Plotly.react).mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(traces).toHaveLength(2);
    expect(traces.map((t) => t.name)).toEqual(['Strategy', 'Drawdown']);
    // No benchmark → no Benchmark Return row (dropped, not shown as an em dash).
    expect(screen.queryByTestId('tearsheet-metric-value-benchmark-return')).toBeNull();
  });
});

describe('the pure figure builder (paint-free)', () => {
  it('assembles the reference traces, domains and config', () => {
    // The builder's contract is percent, so convert the growth fixture first —
    // exactly as the Overview does before handing the chart data over.
    const figure = buildTearsheetFigure({
      chart: { ...RESULT.chart!, points: growthToPercent(RESULT.chart!.points) },
      drawdown: RESULT.drawdown!,
      benchmark: RESULT.benchmark
        ? { ...RESULT.benchmark, points: growthToPercent(RESULT.benchmark.points) }
        : RESULT.benchmark,
    });
    expect(figure.traces.map((t) => [t.name, t.yaxis])).toEqual([
      ['Strategy', 'y'],
      ['Benchmark', 'y'],
      ['Drawdown', 'y2'],
    ]);
    expect((figure.layout.yaxis as { domain: number[] }).domain).toEqual([0.3, 1.0]);
    expect((figure.layout.yaxis2 as { domain: number[] }).domain).toEqual([0, 0.2]);
    expect(figure.config).toEqual({ displayModeBar: false, responsive: true });
  });
});

describe('growth-of-$1 → cumulative-return % (Fix 1)', () => {
  it('converts a growth curve to percent: (v − 1) × 100', () => {
    expect(growthToPercent([1.0, 2.0, 0.5])).toEqual([0, 100, -50]);
  });

  it('is robust to empty and single-point curves', () => {
    expect(growthToPercent([])).toEqual([]);
    expect(growthToPercent([1.0])).toEqual([0]);
  });

  it('reads the benchmark return from the growth tail — SPY ending 8.924 is +792.4%', () => {
    const tail = benchmarkTail({
      status: 'succeeded',
      benchmark: { labels: ['2010-01-04', '2026-07-15'], points: [1.0, 8.924] },
    } as BacktestResultBody);
    expect(tail).not.toBeNull();
    expect(tail as number).toBeCloseTo(792.4, 1);
  });

  it('is null when the run carries no benchmark', () => {
    expect(benchmarkTail({ status: 'succeeded' } as BacktestResultBody)).toBeNull();
  });
});

describe('the data-provenance line (Fix 3)', () => {
  it('states the real bar count and date range from the run itself', async () => {
    render(<StrategyPage host={host} />);
    const prov = await screen.findByTestId('tearsheet-provenance');
    // Bar count with thousands separators, and the chart's first → last label.
    expect(prov.textContent).toContain('1,888 daily bars');
    expect(prov.textContent).toContain('2018-01-02 → 2025-06-30');
    // No fabricated data-source name — bar count and date range only.
    expect(prov.textContent?.toLowerCase()).not.toContain('yfinance');
  });

  it('omits the line for a run carrying no bar count or curve', async () => {
    vi.mocked(tearsheetResult).mockResolvedValue({
      status: 'succeeded',
      chartable: false,
      strategy_path: 'strategies.desk.fund_pair.FundPair',
      stats: {},
    });
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(screen.getByTestId('tearsheet-metrics')).toBeTruthy());
    expect(screen.queryByTestId('tearsheet-provenance')).toBeNull();
  });
});

describe('the net-of-cost basis line (Frontier #6)', () => {
  it('states the assumed cost rate and the run’s own average turnover', async () => {
    render(<StrategyPage host={host} />);
    const note = await screen.findByTestId('tearsheet-cost-basis');
    // The rate the engine charged and the turnover it implied — so "Net" is
    // never an unexplained number. Plain prose, no fabricated figure.
    expect(note.textContent).toContain('10 bps per unit of turnover');
    expect(note.textContent).toContain('45% average turnover');
  });

  it('drops both net rows and hides the basis line before cost modeling', async () => {
    // A run scored before #6 carries no net figures — the gross table stands,
    // the two Net rows are omitted (not shown as half-empty em dashes), and no
    // cost basis is invented.
    const grossOnly = { ...RESULT.stats };
    delete grossOnly.net_return;
    delete grossOnly.net_sharpe;
    delete grossOnly.cost_bps;
    delete grossOnly.avg_turnover;
    vi.mocked(tearsheetResult).mockResolvedValue({ ...RESULT, stats: grossOnly });
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(screen.getByTestId('tearsheet-metrics')).toBeTruthy());
    expect(screen.queryByTestId('tearsheet-metric-value-net-return')).toBeNull();
    expect(screen.queryByTestId('tearsheet-metric-value-net-sharpe')).toBeNull();
    expect(screen.queryByTestId('tearsheet-cost-basis')).toBeNull();
  });
});

describe('the capacity line (Frontier #7)', () => {
  it('shows the humanized capacity and states its participation assumption', async () => {
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(screen.getByTestId('tearsheet-metric-value-capacity')).toBeTruthy());
    // capacity_usd 2_400_000 → "$2.4M"; the note names the participation share.
    expect(screen.getByTestId('tearsheet-metric-value-capacity').textContent).toBe('$2.4M');
    const note = await screen.findByTestId('tearsheet-capacity-basis');
    expect(note.textContent).toContain('10% of');
    expect(note.textContent?.toLowerCase()).toContain('average daily volume');
  });

  it('drops the capacity row and hides the line before capacity modeling', async () => {
    const stats = { ...RESULT.stats };
    delete stats.capacity_usd;
    delete stats.capacity_participation;
    vi.mocked(tearsheetResult).mockResolvedValue({ ...RESULT, stats });
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(screen.getByTestId('tearsheet-metrics')).toBeTruthy());
    expect(screen.queryByTestId('tearsheet-metric-value-capacity')).toBeNull();
    expect(screen.queryByTestId('tearsheet-capacity-basis')).toBeNull();
  });
});

describe('the reproducibility line (Frontier #14)', () => {
  it('shows the run’s reproducibility hash when the engine stamped it', async () => {
    vi.mocked(tearsheetResult).mockResolvedValue({
      ...RESULT,
      stats: { ...RESULT.stats, repro_hash: 'a1b2c3d4e5f6a1b2' } as unknown as typeof RESULT.stats,
    });
    render(<StrategyPage host={host} />);
    const line = await screen.findByTestId('tearsheet-repro');
    expect(line.textContent).toContain('a1b2c3d4e5f6a1b2');
    expect(line.textContent?.toLowerCase()).toContain('reproduce');
  });

  it('hides the line for a run made before the reproducibility stamp', async () => {
    render(<StrategyPage host={host} />); // default RESULT carries no repro_hash
    await waitFor(() => expect(screen.getByTestId('tearsheet-metrics')).toBeTruthy());
    expect(screen.queryByTestId('tearsheet-repro')).toBeNull();
  });
});

describe('the in-room segmented controls (WS-E FR-E3)', () => {
  it('Live shows the deploy pane, and toggles back to the backtest tearsheet', async () => {
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(screen.getByTestId('tearsheet-metrics')).toBeTruthy());

    fireEvent.click(screen.getByTestId('tearsheet-mode-live'));
    expect(screen.getByTestId('tearsheet-live-deploy')).toBeTruthy();
    expect(screen.queryByTestId('tearsheet-metrics')).toBeNull();
    expect(screen.queryByTestId('tearsheet-chart')).toBeNull();

    fireEvent.click(screen.getByTestId('tearsheet-mode-backtest'));
    await waitFor(() => expect(screen.getByTestId('tearsheet-metrics')).toBeTruthy());
  });

  it('Trades swaps in the per-trade view; Overview holds the tearsheet', async () => {
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(screen.getByTestId('tearsheet-metrics')).toBeTruthy());

    fireEvent.click(screen.getByTestId('tearsheet-tab-trades'));
    await waitFor(() => expect(screen.getByTestId('tearsheet-trades')).toBeTruthy());
    expect(screen.queryByTestId('tearsheet-metrics')).toBeNull();

    fireEvent.click(screen.getByTestId('tearsheet-tab-overview'));
    await waitFor(() => expect(screen.getByTestId('tearsheet-metrics')).toBeTruthy());
  });

  it('rests with a prompt when no backtest run is focused', async () => {
    focusStore.clear();
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(screen.getByText('No run focused yet')).toBeTruthy());
    expect(screen.queryByTestId('tearsheet-metrics')).toBeNull();
    expect(vi.mocked(tearsheetResult)).not.toHaveBeenCalled();
  });
});

describe('the recent-runs picker (WS-E)', () => {
  it('lists recent runs by humanized name and, on select, focuses the chosen run', async () => {
    vi.mocked(tearsheetRuns).mockResolvedValue([
      {
        jobId: 42,
        strategyPath: 'strategies.desk.fund_pair.FundPair',
        asOf: '2026-08-05',
        nBars: 1888,
        finishedAt: '2026-08-05T00:00:00Z',
        totalReturn: 4.97,
        sharpe: 1.42,
        maxDrawdown: -0.303,
      },
      {
        jobId: 51,
        strategyPath: 'strategies.momentum.Mom',
        asOf: '2026-08-04',
        nBars: 900,
        finishedAt: '2026-08-04T00:00:00Z',
        totalReturn: 0.12,
        sharpe: 0.9,
        maxDrawdown: -0.15,
      },
    ]);
    render(<StrategyPage host={host} />);

    const picker = await screen.findByTestId('tearsheet-run-picker');
    // Humanized via prettifyPath (module path stripped to the class tail), with
    // the finished date and the total-return % from the house formatter.
    expect(picker.textContent).toContain('FundPair · Aug 5 · 497.00%');

    fireEvent.change(picker, { target: { value: '51' } });
    expect(focusStore.getSnapshot().run).toEqual({ kind: 'backtest', id: '51' });
    expect(focusStore.getSnapshot().strategy?.dottedPath).toBe('strategies.momentum.Mom');
  });

  it('stays hidden when there are no recent runs', async () => {
    vi.mocked(tearsheetRuns).mockResolvedValue([]);
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(screen.getByTestId('tearsheet-metrics')).toBeTruthy());
    expect(screen.queryByTestId('tearsheet-run-picker')).toBeNull();
  });
});
