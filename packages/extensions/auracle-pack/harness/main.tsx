/**
 * Local render harness — mounts a real auracle-pack panel with the engine
 * bridge stubbed to mock JSON, so panel changes can be screenshot-verified
 * without running the full IDE host. Dev-only; not part of the pack build
 * (vite entry is src/index.tsx) and never committed.
 */
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ValidationPanel } from '../src/components/ValidationPanel';
import { LiveAlgorithmsPanel, DeployWizardView } from '../src/components/LivePanel';
import type { DeploySnapshot } from '../src/engine/deploy';
import {
  BlotterPanel,
  IncidentsPanel,
  RunwayPanel,
  SchedulesPanel,
} from '../src/components/MonitorPanels';
import { AuracleConnections } from '../src/components/ConnectionsSettings';
import { AuracleStatusChip } from '../src/components/StatusChip';
import { ResearchPanel } from '../src/components/ResearchPanel';
import { QcImportPanel, QcBacktestResult } from '../src/components/QcImportPanel';
import { BacktestPanel, BacktestResultView } from '../src/components/BacktestPanel';
import { backtestStore, type BacktestResultData } from '../src/engine/backtestStore';
import { EquityChartShad } from '../src/components/charts/EquityChartShad';
import { GridPanel } from '../src/components/grid/GridPanel';
import { RunStrategyHeader } from '../src/components/RunStrategyHeader';

/* ── mock data ─────────────────────────────────────────────── */

const MOCK_JOURNAL: Array<{
  id: number;
  actor: string;
  action: string;
  target: string;
  pre_state: unknown;
  inverse: string;
  status: string;
  created_at: string;
  undone_at: string | null;
}> = [
  {
    id: 2,
    actor: 'auracle-ai',
    action: 'redeploy_deployment',
    target: 'sfx_hardened',
    pre_state: { state: 'errored', reason: 'data feed unavailable' },
    inverse: 'return the deployment to its recorded state',
    status: 'applied',
    created_at: '2026-07-27T09:12:04Z',
    undone_at: null,
  },
  {
    id: 1,
    actor: 'operator',
    action: 're_arm_schedule',
    target: 'eod reconcile',
    pre_state: { enabled: false },
    inverse: 'disable the schedule again',
    status: 'undone',
    created_at: '2026-07-26T16:20:00Z',
    undone_at: '2026-07-26T16:41:12Z',
  },
];

const MOCK_VERDICT = {
  as_of: '2026-07-12T10:00:00Z',
  strategy_path: 'strategies.desk.atlas.AtlasMomentum',
  plain: '5 of 7 checks look healthy · 1 needs attention · 1 couldn’t be checked',
  fired_details: ['monthly_concentration'],
  signals: [
    { signal: 'is_oos_sharpe', name: 'In-sample vs out-of-sample Sharpe', tier: 'green', value: 0.18, threshold: 0.5, plain: 'OOS Sharpe holds within 0.18 of in-sample. No decay.', what_usually_fixes_it: '' },
    { signal: 'wf_dispersion', name: 'Walk-forward dispersion', tier: 'green', value: 0.11, threshold: 0.35, plain: 'Fold-to-fold Sharpe is stable across the walk-forward.', what_usually_fixes_it: '' },
    { signal: 'param_sensitivity', name: 'Parameter sensitivity', tier: 'green', value: 0.09, threshold: 0.25, plain: 'Sharpe barely moves across the parameter neighbourhood.', what_usually_fixes_it: '' },
    { signal: 'trade_count', name: 'Trade-count sufficiency', tier: 'green', value: 1204, threshold: 200, plain: '1,204 trades — well above the minimum for a stable estimate.', what_usually_fixes_it: '' },
    { signal: 'monthly_concentration', name: 'Monthly concentration', tier: 'red', value: 0.41, threshold: 0.2, plain: '41% of the total return came from a single month.', what_usually_fixes_it: 'widen the universe or lengthen the holding period' },
    { signal: 'hyperparam_ratio', name: 'Hyperparameter ratio', tier: 'green', value: 0.05, threshold: 0.15, plain: 'Few tunable knobs relative to the length of the history.', what_usually_fixes_it: '' },
    { signal: 'dd_stability', name: 'Drawdown stability', tier: 'unknown', value: null, threshold: null, plain: 'Not enough out-of-sample history to compare drawdowns.', what_usually_fixes_it: '' },
  ],
};

const MOCK_DEPLOYMENTS = [
  { id: 1, name: 'Atlas Momentum', strategy_path: 'strategies.desk.atlas.AtlasMomentum', broker: 'IBKR', mode: 'paper', aum: 250000, state: 'running', equity: 280850, return_pct: 12.34, positions: [{ symbol: 'AAPL', quantity: 120, avg_cost: 228.44 }] },
  { id: 2, name: 'Fund Pair 60/40', strategy_path: 'strategies.desk.fundpair.FundPair', broker: 'Alpaca', mode: 'live', aum: 500000, state: 'running', equity: 533550, return_pct: 6.71, positions: [] },
  { id: 3, name: 'SFX Hardened', strategy_path: 'strategies.desk.sfx.SfxHardened', broker: 'IBKR', mode: 'paper', aum: 120000, state: 'stopped', equity: 117384, return_pct: -2.18, positions: [] },
];

const MOCK_ORDERS = {
  deployment_id: 1,
  orders: [
    { id: 2141, symbol: 'AAPL', action: 'buy', quantity: 120, filled_quantity: 120, avg_fill_price: 228.44, status: 'filled', created_at: '2026-07-11T14:30:00Z' },
    { id: 2140, symbol: 'MSFT', action: 'buy', quantity: 60, filled_quantity: 60, avg_fill_price: 441.02, status: 'filled', created_at: '2026-07-11T14:31:00Z' },
    { id: 2139, symbol: 'NVDA', action: 'sell', quantity: 40, filled_quantity: 40, avg_fill_price: 138.71, status: 'filled', created_at: '2026-07-11T14:33:00Z' },
  ],
  positions: [{ symbol: 'AAPL', quantity: 120, avg_cost: 228.44 }],
};

const _LIVE_EQ = [
  250000, 251900, 249400, 254300, 258700, 256100, 261800, 267200,
  264100, 271600, 277900, 275300, 279100, 280850,
];
const MOCK_LIVE_EQUITY = {
  deployment_id: 1, chartable: true, marks: 'mtm', points: _LIVE_EQ,
  labels: _LIVE_EQ.map((_, i) => `2026-06-${String(1 + i).padStart(2, '0')}`),
  n_points: _LIVE_EQ.length,
};

const MOCK_STRATEGIES = {
  strategies: [
    { path: 'strategies.desk.atlas.AtlasMomentum', kind: 'class', doc: '12-1 momentum, vol-scaled' },
    { path: 'strategies.desk.fundpair.FundPair', kind: 'class', doc: '60/40 blend' },
    { path: 'strategies.desk.signals.backtest_meanrev', kind: 'function', doc: 'mean-reversion signal' },
    // Two real-length symbols, kept here on purpose: a discovered class name is
    // routinely longer than a card is wide, and the Board's title clamp is only
    // demonstrable against one.
    {
      path: 'strategies.desk.overlay.ContinuousCashOverlayFiltersForAStaticGrowthDefensiveSleeve',
      kind: 'class',
      doc: 'cash overlay on a static sleeve',
    },
    {
      path: 'strategies.desk.tail.ReSGAALargeTailRiskModelForLearningValueAtRiskAndDrawdown',
      kind: 'class',
      doc: 'tail-risk learner',
    },
  ],
  // Additive discovery field: files discovery saw but dropped, with reasons.
  excluded: [
    { file: 'strategies/desk/wip_breakout.py', reason: "ImportError: No module named 'ta_lib'" },
    { file: 'strategies/desk/notes.py', reason: 'no Strategy class or backtest_* function' },
    { file: 'strategies/desk/a2_scheduler.py', reason: 'defines only a cron-scheduled module, not a Strategy class' },
  ],
};

// ── monitor feeds (blotter / incidents / schedules / runway) ──
const MOCK_BLOTTER = {
  orders: [
    { id: 2141, symbol: 'AAPL', action: 'buy', status: 'filled', plain: 'Bought 120 AAPL at $228.44' },
    { id: 2140, symbol: 'MSFT', action: 'buy', status: 'filled', plain: 'Bought 60 MSFT at $441.02' },
    { id: 2139, symbol: 'NVDA', action: 'sell', status: 'submitted', plain: 'Selling 40 NVDA — working' },
  ],
};

const MOCK_INCIDENTS = {
  incidents: [
    { severity: 'critical', cause: 'IBKR gateway disconnected', detail: 'no heartbeat for 4m', dismiss_kind: 'broker', dismiss_id: 7 },
    { severity: 'warning', cause: 'Daily bars stale for 3 symbols', detail: 'last ingest 26h ago', dismiss_kind: 'data', dismiss_id: 8 },
    { severity: 'info', cause: 'Scheduler skipped a holiday run' },
  ],
};

const MOCK_SCHEDULES = {
  schedules: [
    { id: 1, name: 'Atlas Momentum', cron: '30 9 * * 1-5', enabled: true },
    { id: 2, name: 'Fund Pair rebalance', cron: '0 16 * * 5', enabled: true },
    { id: 3, name: 'SFX Hardened', cron: '0 10 * * 1-5', enabled: false },
  ],
};

const MOCK_RUNWAY = {
  stages: {
    research: { reached: 'yes', evidence: 'AtlasMomentum spec + 3 sources' },
    build: { reached: 'yes', evidence: 'strategy compiles, 41 unit tests' },
    validate: { reached: 'yes', evidence: '6 of 7 overfit signals green' },
    paper: { reached: 'partial', evidence: 'paper live 11 days, +2.3%' },
    go_live: { reached: 'no', evidence: 'awaiting Pro plan + funded broker' },
    monitor: { reached: 'no', evidence: '' },
  },
};

// ── research feed + scan status ──
const MOCK_RESEARCH_FEED = {
  findings: [
    { id: 1, paper_id: 'arXiv:2407.01234', source: 'arXiv', title: 'Cross-Sectional Momentum with Volatility Scaling', authors: 'A. Chen, R. Patel', abstract: 'We show that scaling a cross-sectional momentum signal by trailing realized volatility improves the risk-adjusted return of the long-short portfolio out of sample.', hypothesis: 'Vol-scaling a momentum signal lifts its Sharpe by reducing crash exposure.', technique: 'Cross-sectional ranking + vol targeting', asset_classes: ['equity'], score: 0.87, model: 'gpt', status: 'new', composite: 0.87, band: 'high', confidence: 'high', categories: ['q-fin.PM'], primary_category: 'q-fin.PM', published_at: '2026-07-02', url: 'https://arxiv.org/abs/2407.01234', doi: null, pdf_url: null, citation_count: 12, strategy_path: null },
    { id: 2, paper_id: 'SSRN:4501992', source: 'SSRN', title: 'Overnight Reversal in Liquid Futures', authors: 'M. Okafor', abstract: 'A robust overnight-to-intraday reversal exists across liquid futures, strongest around macro releases.', hypothesis: 'Overnight moves in liquid futures partially reverse intraday.', technique: 'Time-series reversal', asset_classes: ['futures'], score: 0.64, model: 'gpt', status: 'new', composite: 0.64, band: 'medium', confidence: 'medium', categories: ['q-fin.TR'], primary_category: 'q-fin.TR', published_at: '2026-06-28', url: 'https://ssrn.com/abstract=4501992', doi: null, pdf_url: null, citation_count: 3, strategy_path: null },
    { id: 3, paper_id: 'arXiv:2406.09981', source: 'arXiv', title: 'Attention-Weighted Factor Timing', authors: 'L. Vasquez, T. Ito', abstract: 'A transformer times classic factors; gains vanish after transaction costs.', hypothesis: 'Learned factor timing beats static weights net of costs.', technique: 'Transformer factor timing', asset_classes: ['equity'], score: 0.31, model: 'gpt', status: 'new', composite: 0.31, band: 'low', confidence: 'low', categories: ['q-fin.CP'], primary_category: 'q-fin.CP', published_at: '2026-06-19', url: 'https://arxiv.org/abs/2406.09981', doi: null, pdf_url: null, citation_count: 0, strategy_path: null },
  ],
  last_scan: '2026-07-12T08:00:00Z',
};

const MOCK_SCAN_STATUS = {
  running: false,
  started_at: null,
  finished_at: '2026-07-12T08:00:00Z',
  result: { fetched: 40, stored: 18, deduped: 6, llm_refined: 12 },
  error: null,
  last_scan: '2026-07-12T08:00:00Z',
};

// ── quantconnect projects ──
const MOCK_QC_PROJECTS = {
  connected: true,
  projects: [
    { projectId: 18234221, name: 'Momentum SPY', description: '12-1 momentum, monthly rebalance', modified: '2026-07-10T00:00:00Z', language: 'Py' },
    { projectId: 18234250, name: 'Mean Reversion Pairs', description: 'Cointegrated ETF pairs', modified: '2026-07-08T00:00:00Z', language: 'Py' },
  ],
};

// ── quantconnect cloud backtest (compile → run → stats → equity chart) ──
const MOCK_QC_STATUS = {
  connected: true, completed: true, progress: 1, error: null,
  statistics: {
    'Sharpe Ratio': '1.42', 'Total Return': '31.9%', 'Compounding Annual Return': '17.1%',
    'Drawdown': '8.4%', 'Win Rate': '58%', 'Total Trades': '212',
  },
};
const _QC_EQUITY = [
  100000, 101200, 99800, 103400, 106900, 104100, 108800, 112300,
  110500, 115900, 121200, 118400, 122700, 128100, 125300, 131900,
];
const MOCK_QC_CHART = {
  connected: true, chartable: true, points: _QC_EQUITY,
  labels: _QC_EQUITY.map((_, i) => `2024-${String(1 + (i % 12)).padStart(2, '0')}-01`),
  n_points: _QC_EQUITY.length,
};

// ── backtest result (equity curve + stats + drawdown) ──
// Shaped like a real decade-long run — a compounding curve over ISO dates, so
// the log axis, the date axis and the $-formatted ticks all get exercised. A
// two-dozen-point stub with "d0" labels exercised none of them, which is part
// of why the panel's own layout went unexamined for so long. Deterministic
// (no Math.random) so screenshots are stable across runs.
const _BARS = 2600; // ~10.3y of DAILY bars — n_bars from the engine is daily
const _EQ: number[] = (() => {
  const out: number[] = [];
  let v = 1;
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  // Sum-of-uniforms as a cheap normal, tuned to ~18% annualized vol and a
  // drift that compounds to roughly 74x, so the drawdown lands near -19%.
  for (let i = 0; i < _BARS; i += 1) {
    const z = rand() + rand() + rand() - 1.5;
    v = Math.max(0.05, v * (1 + 0.00166 + z * 0.0134));
    out.push(Number(v.toFixed(5)));
  }
  return out;
})();
/** Trading-day ISO labels, the shape the engine's `labels` array carries. */
const _LABELS: string[] = _EQ.map((_, i) => {
  const d = new Date(Date.UTC(2015, 9, 1) + i * 86_400_000 * 1.42);
  return d.toISOString().slice(0, 10);
});
function _dd(points: number[]): number[] {
  let peak = -Infinity;
  return points.map((v) => {
    peak = Math.max(peak, v);
    return Number((((v - peak) / peak) * 100).toFixed(2));
  });
}
const MOCK_BACKTEST_RESULT: BacktestResultData = {
  equity: _EQ,
  drawdown: _dd(_EQ),
  labels: _LABELS,
  // The full set the engine actually returns — all fractions, never percents.
  stats: {
    total_return: _EQ[_EQ.length - 1] - 1,
    annualized_return: 0.2981,
    sharpe: 1.31,
    sortino: 1.84,
    annualized_vol: 0.1804,
    max_drawdown: Math.min(..._dd(_EQ)) / 100,
    calmar: 1.56,
    worst_day: -0.0448,
    best_day: 0.0521,
    win_rate: 0.5503,
    profit_factor: 1.42,
    var_5pct: -0.021,
    cvar_5pct: -0.0318,
  },
  asOf: '2026-07-15',
  nBars: _EQ.length,
  trades: 200,
};

// What the engine's /result route actually returns (wire shape) — the store
// parses this into the BacktestResultData above.
const MOCK_BACKTEST_RESULT_BODY = {
  status: 'succeeded',
  chartable: true,
  strategy_path: 'strategies.desk.atlas.AtlasMomentum',
  as_of: MOCK_BACKTEST_RESULT.asOf,
  n_bars: MOCK_BACKTEST_RESULT.nBars,
  stats: MOCK_BACKTEST_RESULT.stats,
  // The route hands the SAME labels array to both curves.
  chart: { labels: _LABELS, points: MOCK_BACKTEST_RESULT.equity },
  drawdown: { labels: _LABELS, points: MOCK_BACKTEST_RESULT.drawdown },
  trades: MOCK_BACKTEST_RESULT.trades,
};

function QcResultHarness(): JSX.Element {
  // The completed-QC-backtest render (equity curve + headline stats), the same
  // component the QC panel shows after a cloud backtest finishes. The live poll
  // can't be driven under StrictMode (the panel's cancel-ref trips on the
  // double-mount), so this exercises the render path directly.
  const stats = Object.entries(MOCK_QC_STATUS.statistics).map(([label, value]) => ({ label, value }));
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '22px 28px 48px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <QcBacktestResult stats={stats} equity={MOCK_QC_CHART.points} empty={false} />
    </div>
  );
}

function BacktestResultHarness(): JSX.Element {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '22px 28px 48px' }}>
      <BacktestResultView result={MOCK_BACKTEST_RESULT} />
    </div>
  );
}

function BacktestSuccessHarness(): JSX.Element {
  // The whole panel in its finished state, driven through the REAL store flow
  // (resolve -> run -> poll -> fetch result) against the mocked engine — the
  // only way to see the result-leads/one-verb layout without the IDE host.
  useEffect(() => {
    void backtestStore.run('/Users/you/Desktop/Auracle Strategies/desk/atlas.py');
    return () => backtestStore.reset();
  }, []);
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '22px 28px 48px' }}>
      <BacktestPanel />
    </div>
  );
}

function ShadChartHarness(): JSX.Element {
  // The shadcn chart block (recharts + shadcn Card chrome) on a real series.
  const equity = MOCK_BACKTEST_RESULT.equity;
  const drawdown = MOCK_BACKTEST_RESULT.drawdown;
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '22px 28px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <EquityChartShad
        points={equity}
        title="Equity"
        description="Growth of $1 over the backtest"
        format={(v) => `$${v.toFixed(2)}`}
      />
      <EquityChartShad
        points={drawdown}
        variant="drawdown"
        title="Drawdown"
        description="Peak-to-trough decline"
        footer={false}
        format={(v) => `${v.toFixed(1)}%`}
      />
      <EquityChartShad points={[1]} title="Honesty gate (1 point → nothing)" />
    </div>
  );
}

// ── connections registry (list + per-connector detail) ──
const MOCK_CONNECTORS = [
  { id: 'ibkr', display_label: 'Interactive Brokers', blurb: 'Live + paper trading via IB Gateway', kind: 'broker', status: { state: 'connected', detail: 'paper' }, test_supported: true, asset_kinds: ['equity', 'option'] },
  { id: 'alpaca', display_label: 'Alpaca', blurb: 'Commission-free US equities', kind: 'broker', status: { state: 'not_configured' }, test_supported: true },
  { id: 'yfinance', display_label: 'Yahoo Finance', blurb: 'Free daily bars, zero config', kind: 'data_provider', status: { state: 'connected' }, test_supported: false },
  { id: 'polygon', display_label: 'Polygon.io', blurb: 'Real-time + historical market data', kind: 'data_provider', status: { state: 'not_configured' }, gated: true, gated_reason: 'Requires the Pro plan' },
  { id: 'quantconnect', display_label: 'QuantConnect', blurb: 'Cloud backtesting + live', kind: 'integration', status: { state: 'error', detail: 'token expired' }, test_supported: true },
];

/**
 * The engine's consolidated status call, composed from the very mocks the
 * per-room routes above serve — so the harness plan and the harness rooms tell
 * the same story rather than two.
 */
const MOCK_SUMMARY = () => {
  const byState: Record<string, number> = {};
  for (const connector of MOCK_CONNECTORS) {
    byState[connector.status.state] = (byState[connector.status.state] ?? 0) + 1;
  }
  return {
    as_of: new Date().toISOString(),
    open_alerts: MOCK_INCIDENTS.incidents.length,
    research: {
      findings: MOCK_RESEARCH_FEED.findings.length,
      top_score: Math.round(MOCK_RESEARCH_FEED.findings[0].score * 100),
    },
    deployments: {
      total: MOCK_DEPLOYMENTS.length,
      running: MOCK_DEPLOYMENTS.filter((row) => row.state === 'running').length,
      errored: MOCK_DEPLOYMENTS.filter((row) => row.state === 'errored').length,
    },
    schedules: {
      total: MOCK_SCHEDULES.schedules.length,
      active: MOCK_SCHEDULES.schedules.filter((row) => row.enabled).length,
    },
    connections: {
      total: MOCK_CONNECTORS.length,
      by_state: byState,
      connected: byState.connected ?? 0,
    },
    runway: {
      reached: Object.fromEntries(
        Object.entries(MOCK_RUNWAY.stages).map(([name, stage]) => [name, stage.reached])
      ),
    },
    degraded: [],
  };
};

const connectorDetail = (id: string) => {
  const base = MOCK_CONNECTORS.find((c) => c.id === id) ?? MOCK_CONNECTORS[0];
  return {
    ...base,
    fields: [
      { name: 'account', label: 'Account ID', kind: 'text', required: true, has_value: true, preview: 'U1234•••', options: [] },
      { name: 'port', label: 'Gateway port', kind: 'text', required: false, has_value: false, preview: '', options: [] },
    ],
  };
};

// ── the Board's own lane ───────────────────────────────────────────────────
// Sources the engine has been told about, the vault slots, and the settings
// pref the Board graph is kept in. The engine routes for the first two do not
// exist yet (they land in a parallel change); these mocks are what makes the
// whole on-canvas flow — describe, key, connect, wire — demoable meanwhile.
//
// The vault mock deliberately does NOT keep the secret it is sent: it records
// that the slot is set and drops the value, which is the only behaviour the
// real one is allowed to have from the client's point of view.
const MOCK_BOARD_SOURCES: Array<Record<string, unknown>> = [];
const MOCK_VAULT: Record<string, { name: string; set: boolean; updated_at: string }> = {};
const MOCK_PREFS: Record<string, unknown> = {};

// A board somebody has actually worked on, behind `&board=demo`. The default
// harness board is EMPTY on purpose (it is the onboarding), and an empty plane
// is exactly the board on which the pipeline's own composition cannot be seen.
if (new URLSearchParams(location.search).get('board') === 'demo') {
  MOCK_PREFS.board_graph = {
    '': {
      nodes: [
        { id: 'src-bars', kind: 'source', source: { name: 'Daily bars', connectorKind: 'yfinance', endpoint: '', payloadType: 'bars' } },
        { id: 'src-papers', kind: 'source', source: { name: 'arXiv q-fin feed', connectorKind: 'http', endpoint: 'https://arxiv.org', payloadType: 'papers' } },
        { id: 'src-macro', kind: 'source', source: { name: 'Macro release calendar', connectorKind: 'http', endpoint: 'https://example.test', payloadType: 'json' } },
        { id: 'q-vol', kind: 'research', research: { hypothesis: 'Does vol-scaling a momentum signal lift its Sharpe out of sample?' } },
        { id: 'q-rev', kind: 'research', research: { hypothesis: 'Do overnight moves in liquid futures reverse intraday?' } },
      ],
      edges: [
        { id: 'e1', from: 'src-bars', to: 'q-vol', origin: 'user' },
        { id: 'e2', from: 'src-papers', to: 'q-vol', origin: 'user' },
        { id: 'e3', from: 'src-macro', to: 'q-rev', origin: 'user' },
      ],
    },
  };
}

// The research loop's half of the same lane, in the ENGINE's shapes: a question
// row carries its own count (there is no counters list — the badge is read off
// the question list), a counter is put back through the counters route, and the
// budget states `used` against a cap that may be `unlimited`.
//
// A registered question starts GATHERING immediately — one mock item every few
// seconds — which is what makes the badge, the distinct Synthesize label and the
// auto pass all demoable in a single sitting. Dispatching resets that count and
// spends one of the month's allowance, and once the allowance is gone the engine
// REFUSES an automatic dispatch (429, with the budget that refused it) while
// still running one a person asked for and marking it over budget. Both states
// are reachable without editing anything.
interface MockQuestion {
  hypothesis: string;
  since: number;
  enabled: boolean;
  sources: string[];
  threshold: number;
  created_at: string;
  last_reset_at: string | null;
}

const MOCK_QUESTIONS: Record<string, MockQuestion> = {};
const MOCK_BUDGET = { cap: 20, used: 17 };
/** How fast the harness pretends material arrives, and how much can pile up. */
const MOCK_GATHER_MS = 6000;
const MOCK_GATHER_MAX = 9;

function mockMaterial(row: MockQuestion): number {
  return Math.min(MOCK_GATHER_MAX, Math.floor((Date.now() - row.since) / MOCK_GATHER_MS));
}

/** One question as the engine states it — registration and count together. */
function mockQuestion(node_id: string): Record<string, unknown> {
  const row = MOCK_QUESTIONS[node_id];
  const material = mockMaterial(row);
  const now = new Date().toISOString();
  return {
    node_id,
    hypothesis: row.hypothesis,
    sources: row.sources,
    threshold: row.threshold,
    enabled: row.enabled,
    new_material: material,
    last_match_at: material > 0 ? now : null,
    last_scored_at: now,
    last_reset_at: row.last_reset_at,
    created_at: row.created_at,
  };
}

function mockBudget(): Record<string, unknown> {
  const { cap, used } = MOCK_BUDGET;
  const unlimited = cap <= 0;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    period: start.toISOString().slice(0, 7),
    period_start: start.toISOString(),
    resets_at: next.toISOString(),
    unit: 'agent_sessions',
    cap,
    unlimited,
    used,
    remaining: unlimited ? null : Math.max(0, cap - used),
    // The engine's own verdict, not the surface's arithmetic.
    paused: !unlimited && used >= cap,
  };
}

const ok = (body: unknown) => ({ ok: true, status: 200, body });
const notFound = { ok: false, status: 404, body: null };

function boardRoute(
  method: string,
  p: string,
  body: unknown
): { ok: boolean; status: number; body: unknown } | null {
  const record = (body ?? {}) as Record<string, unknown>;

  if (p === '/ui/api/board/sources') {
    if (method === 'POST') {
      const id = String(record.id ?? '');
      const row = { ...record, state: 'ingesting', last_ingest_at: new Date().toISOString() };
      const at = MOCK_BOARD_SOURCES.findIndex((source) => source.id === id);
      if (at >= 0) MOCK_BOARD_SOURCES[at] = row;
      else MOCK_BOARD_SOURCES.push(row);
      return ok({ ok: true, source: row });
    }
    return ok({ sources: MOCK_BOARD_SOURCES });
  }

  const removed = p.match(/^\/ui\/api\/board\/sources\/([^/]+)\/delete$/);
  if (removed) {
    const id = decodeURIComponent(removed[1]);
    const at = MOCK_BOARD_SOURCES.findIndex((source) => source.id === id);
    if (at >= 0) MOCK_BOARD_SOURCES.splice(at, 1);
    return ok({ ok: true });
  }

  if (p === '/ui/api/board/budget') return ok(mockBudget());

  if (p === '/ui/api/board/synthesis' && method === 'POST') {
    const trigger = String(record.trigger ?? 'auto');
    const before = mockBudget();
    const over = before.paused === true;
    // The month is spent and nobody asked by hand: refused, and NOTHING is
    // recorded. The refusal carries the whole budget, so the surface can say
    // why without going back to ask.
    if (over && trigger === 'auto') {
      return {
        ok: false,
        status: 429,
        body: {
          detail: 'the monthly dispatch budget is spent',
          recorded: false,
          over_budget: true,
          budget: before,
        },
      };
    }
    MOCK_BUDGET.used += 1;
    return ok({
      ok: true,
      recorded: true,
      // A person asking over the cap is run and MARKED, never refused.
      over_budget: over,
      budget: mockBudget(),
      dispatch: {
        node_id: String(record.node_id ?? ''),
        trigger,
        detail: String(record.detail ?? ''),
      },
    });
  }

  if (p === '/ui/api/board/questions') {
    if (method === 'POST') {
      const id = String(record.node_id ?? '');
      // Re-registering an EDITED question keeps whatever it has gathered: the
      // engine is watching the same card, not a new one.
      const held = MOCK_QUESTIONS[id];
      MOCK_QUESTIONS[id] = {
        hypothesis: String(record.hypothesis ?? ''),
        since: held?.since ?? Date.now(),
        enabled: true,
        sources: Array.isArray(record.sources) ? (record.sources as string[]) : (held?.sources ?? []),
        threshold: typeof record.threshold === 'number' ? record.threshold : (held?.threshold ?? 1),
        created_at: held?.created_at ?? new Date().toISOString(),
        last_reset_at: held?.last_reset_at ?? null,
      };
      return ok({ ok: true, question: mockQuestion(id) });
    }
    // The badge for a whole board, in one read: every question, with its count.
    return ok({ questions: Object.keys(MOCK_QUESTIONS).map(mockQuestion) });
  }

  const withdrawn = p.match(/^\/ui\/api\/board\/questions\/([^/]+)\/delete$/);
  if (withdrawn) {
    const id = decodeURIComponent(withdrawn[1]);
    const deleted = Boolean(MOCK_QUESTIONS[id]);
    delete MOCK_QUESTIONS[id];
    return ok({ ok: true, deleted });
  }

  const counted = p.match(/^\/ui\/api\/board\/counters\/([^/]+)\/reset$/);
  if (counted) {
    const id = decodeURIComponent(counted[1]);
    const row = MOCK_QUESTIONS[id];
    const cleared = row ? mockMaterial(row) : 0;
    const at = new Date().toISOString();
    if (row) {
      row.since = Date.now();
      row.last_reset_at = at;
    }
    return ok({
      node_id: id,
      new_material: 0,
      as_of: at,
      registered: Boolean(row),
      enabled: row?.enabled ?? false,
      hypothesis: row?.hypothesis ?? '',
      last_match_at: null,
      last_reset_at: row ? at : null,
      cleared,
    });
  }

  const cleared = p.match(/^\/ui\/api\/board\/credentials\/([^/]+)\/clear$/);
  if (cleared) {
    delete MOCK_VAULT[decodeURIComponent(cleared[1])];
    return ok({ ok: true });
  }

  const slot = p.match(/^\/ui\/api\/board\/credentials\/([^/]+)$/);
  if (slot) {
    const name = decodeURIComponent(slot[1]);
    if (method === 'POST') {
      // The value is read and thrown away — a vault answers with state.
      MOCK_VAULT[name] = { name, set: true, updated_at: new Date().toISOString() };
      return ok({ ok: true, slot: MOCK_VAULT[name] });
    }
    return MOCK_VAULT[name] ? ok(MOCK_VAULT[name]) : notFound;
  }

  return null;
}

function engineRequest(
  method: string,
  path: string,
  body?: unknown
): { ok: boolean; status: number; body: unknown } {
  const p = String(path);
  const board = boardRoute(method, p, body);
  if (board) return board;
  // The synced settings lane, which is where a Board graph is kept.
  if (p === '/ui/api/settings') {
    if (method === 'PUT') {
      Object.assign(MOCK_PREFS, ((body ?? {}) as { prefs?: Record<string, unknown> }).prefs ?? {});
      return ok({ ok: true });
    }
    return ok({ prefs: MOCK_PREFS });
  }
  // Live-quote snapshot. The STREAM is a native EventSource the invoke bridge
  // cannot mock, so in the harness the card's EventSource fails against the mock
  // origin and degrades to this snapshot — which is itself a fair demonstration
  // of the fallback path. Prices are deterministic per symbol.
  if (p.startsWith('/ui/api/quotes/snapshot')) {
    const query = p.split('?')[1] ?? '';
    let refs: Array<Record<string, unknown>> = [];
    try {
      const raw = new URLSearchParams(query).get('ref');
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) refs = parsed as Array<Record<string, unknown>>;
    } catch {
      refs = [];
    }
    const quotes = refs.map((ref, index) => {
      const symbol = String(ref.symbol ?? '');
      const base = 80 + ((symbol.charCodeAt(0) || 65) % 60) + index;
      return {
        symbol,
        sec_type: ref.sec_type ?? 'STK',
        last: base + 0.25,
        bid: base + 0.2,
        ask: base + 0.31,
        bid_size: 100,
        ask_size: 140,
        volume: 12_500,
        ts: new Date().toISOString(),
        quality: 'realtime',
        market_data_type: 1,
        expiry: ref.expiry,
        strike: ref.strike,
        right: ref.right,
        currency: ref.currency,
      };
    });
    return ok({ quotes });
  }
  if (/^\/deployments\/\d+\/equity/.test(p)) return ok(MOCK_LIVE_EQUITY);
  if (/^\/deployments\/\d+\/orders/.test(p)) return ok(MOCK_ORDERS);
  if (p === '/deployments') return ok(MOCK_DEPLOYMENTS);
  // ── ops journal: two recorded actions, one still reversible ──
  if (p.startsWith('/ui/api/ops/journal') && p.includes('/undo')) {
    const id = p.split('/').slice(-2)[0];
    const row = MOCK_JOURNAL.find((e) => String(e.id) === id);
    if (!row) return { ok: false, status: 404, body: { detail: 'no such entry' } };
    if (row.status !== 'applied') return { ok: false, status: 409, body: { detail: 'already undone' } };
    row.status = 'undone';
    row.undone_at = new Date().toISOString();
    return ok({ entry: row });
  }
  if (p.startsWith('/ui/api/ops/journal')) return ok({ entries: MOCK_JOURNAL });
  if (p.startsWith('/ui/api/ops/repair')) {
    const row = {
      id: MOCK_JOURNAL.length + 1,
      actor: 'auracle-ai',
      action: 'restart_data_feed',
      target: 'ibkr-gateway',
      pre_state: { state: 'error' },
      inverse: 'restore recorded connector state',
      status: 'applied',
      created_at: new Date().toISOString(),
      undone_at: null as string | null,
    };
    MOCK_JOURNAL.unshift(row);
    return ok({ entry: row });
  }
  if (p.startsWith('/ui/api/orders')) return ok(MOCK_BLOTTER);
  if (p.startsWith('/ui/api/summary')) return ok(MOCK_SUMMARY());
  if (p.startsWith('/ui/api/incidents')) return ok(MOCK_INCIDENTS);
  if (p.startsWith('/ui/api/schedules')) return ok(MOCK_SCHEDULES);
  if (p.startsWith('/ui/api/runway')) return ok(MOCK_RUNWAY);
  if (p.startsWith('/ui/api/validation')) return ok(MOCK_VERDICT);
  if (p.startsWith('/ui/api/backtest/strategies')) return ok(MOCK_STRATEGIES);
  if (/^\/ui\/api\/backtest\/job\/\d+\/result$/.test(p)) return ok(MOCK_BACKTEST_RESULT_BODY);
  if (/^\/ui\/api\/backtest\/job\/\d+\/status$/.test(p)) return ok({ status: 'succeeded' });
  if (p === '/ui/api/backtest/run') return ok({ ok: true, job_id: 33 });
  if (p.startsWith('/ui/api/research/scan/status')) return ok(MOCK_SCAN_STATUS);
  if (p.startsWith('/ui/api/research/feed')) return ok(MOCK_RESEARCH_FEED);
  if (p === '/ui/api/quantconnect/projects') return ok(MOCK_QC_PROJECTS);
  if (/\/ui\/api\/quantconnect\/projects\/\d+\/compile\/.+/.test(p)) return ok({ state: 'BuildSuccess', logs: [] });
  if (/\/ui\/api\/quantconnect\/projects\/\d+\/compile$/.test(p)) return ok({ connected: true, compile_id: 'c-1' });
  if (/\/ui\/api\/quantconnect\/projects\/\d+\/backtest\/[^/]+\/chart$/.test(p)) return ok(MOCK_QC_CHART);
  if (/\/ui\/api\/quantconnect\/projects\/\d+\/backtest\/[^/]+$/.test(p)) return ok(MOCK_QC_STATUS);
  if (/\/ui\/api\/quantconnect\/projects\/\d+\/backtest$/.test(p)) return ok({ connected: true, backtest_id: 'bt-1' });
  const cap = p.match(/^\/ui\/api\/connections\/([^/?]+)\/capability/);
  if (cap) return ok({ asset_kinds: ['equity', 'option'] });
  const detail = p.match(/^\/ui\/api\/connections\/([^/?]+)$/);
  if (detail) return ok(connectorDetail(detail[1]));
  if (p.startsWith('/ui/api/connections')) return ok({ connections: MOCK_CONNECTORS });
  if (p.startsWith('/ui/api/ide/connect-check')) return ok({ ok: true, engine: { name: 'Auracle', version: '2.8.1' } });
  return notFound;
}

(window as unknown as { electronAPI: unknown }).electronAPI = {
  invoke: async (channel: string, ...args: unknown[]) => {
    switch (channel) {
      case 'auracle:engine-request':
        return engineRequest(args[0] as string, args[1] as string, args[2]);
      case 'auracle:engine-config':
        return { engineUrl: 'http://mock', hasKey: true };
      case 'auracle:auth-state':
        return { signedIn: true, email: 'you@aurapointcapital.com', tier: 'pro' };
      case 'auracle:auth-bases':
        return { hq: '', engine: 'http://mock' };
      default:
        return null;
    }
  },
};

/* ── host shell stubs. The pack owns its Hermes palette as literals now;
      only the UI font var and the charcoal canvas matter here. ─────────── */
const r = document.documentElement.style;
r.setProperty('--font-family-ui', '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif');
document.body.style.cssText = 'margin:0;background:#0b0c0e;min-height:100vh';

// ── deploy wizard states (pre-bound happy / non-deployable / picker+exclusions) ──
const DEPLOY_BOUND: DeploySnapshot = {
  file: '/Users/you/Desktop/Auracle Strategies/desk/atlas.py',
  phase: 'one',
  option: {
    path: 'strategies.desk.atlas.AtlasMomentum',
    cls: 'AtlasMomentum',
    label: 'AtlasMomentum — 12-1 momentum, vol-scaled',
  },
  options: [],
  reason: null,
  outdated: false,
};
const DEPLOY_BLOCKED: DeploySnapshot = {
  file: '/Users/you/Desktop/Auracle Strategies/desk/signals.py',
  phase: 'blocked',
  option: null,
  options: [],
  reason: 'function-only',
  outdated: false,
};

function DeployWizardHarness({ deploy }: { deploy: DeploySnapshot | null }): JSX.Element {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '22px 28px 48px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#d7dae0' }}>Deploy a strategy</div>
        <div style={{ fontSize: 12.5, color: '#8a8f98', marginTop: 2 }}>
          Launch to paper or live. You can stop or liquidate it any time from the dashboard.
        </div>
      </div>
      <DeployWizardView deploy={deploy} onDone={() => {}} onCancel={() => {}} onClear={() => {}} />
    </div>
  );
}

function RunHeaderHarness(): JSX.Element {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0b0c0e' }}>
      <RunStrategyHeader
        filePath="/Users/you/Desktop/Auracle Strategies/desk/atlas_momentum.py"
        fileName="atlas_momentum.py"
        getContent={() => ''}
        contentVersion={0}
      />
      <div
        style={{
          flex: 1,
          padding: 20,
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontSize: 12.5,
          color: '#7c8694',
          opacity: 0.5,
        }}
      >
        <pre style={{ margin: 0 }}>{'# editor surface (mock)\nclass AtlasMomentum(Strategy):\n    ...'}</pre>
      </div>
    </div>
  );
}

const PANELS: Record<string, (props: { host: never }) => JSX.Element> = {
  live: LiveAlgorithmsPanel,
  grid: GridPanel as (props: { host: never }) => JSX.Element,
  'run-header': RunHeaderHarness as (props: { host: never }) => JSX.Element,
  'deploy-bound': (() => <DeployWizardHarness deploy={DEPLOY_BOUND} />) as (props: { host: never }) => JSX.Element,
  'deploy-blocked': (() => <DeployWizardHarness deploy={DEPLOY_BLOCKED} />) as (props: { host: never }) => JSX.Element,
  'deploy-wizard': (() => <DeployWizardHarness deploy={null} />) as (props: { host: never }) => JSX.Element,
  validation: ValidationPanel,
  blotter: BlotterPanel,
  incidents: IncidentsPanel,
  schedules: SchedulesPanel,
  runway: RunwayPanel,
  connections: AuracleConnections as (props: { host: never }) => JSX.Element,
  statuschip: AuracleStatusChip as (props: { host: never }) => JSX.Element,
  research: ResearchPanel as (props: { host: never }) => JSX.Element,
  qc: QcImportPanel as (props: { host: never }) => JSX.Element,
  'qc-result': QcResultHarness as (props: { host: never }) => JSX.Element,
  backtest: BacktestPanel as (props: { host: never }) => JSX.Element,
  'backtest-success': BacktestSuccessHarness as (props: { host: never }) => JSX.Element,
  'backtest-result': BacktestResultHarness as (props: { host: never }) => JSX.Element,
  'shad-chart': ShadChartHarness as (props: { host: never }) => JSX.Element,
};

const which = new URLSearchParams(location.search).get('panel') ?? 'live';
const Panel = PANELS[which] ?? LiveAlgorithmsPanel;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ height: '100vh' }}>
      {/* host is optional at runtime; the harness drives data via the stubbed bridge */}
      <Panel host={undefined as never} />
    </div>
  </StrictMode>
);
