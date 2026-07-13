/**
 * Local render harness — mounts a real auracle-pack panel with the engine
 * bridge stubbed to mock JSON, so panel changes can be screenshot-verified
 * without running the full IDE host. Dev-only; not part of the pack build
 * (vite entry is src/index.tsx) and never committed.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ValidationPanel } from '../src/components/ValidationPanel';
import { LiveAlgorithmsPanel } from '../src/components/LivePanel';
import {
  BlotterPanel,
  IncidentsPanel,
  RunwayPanel,
  SchedulesPanel,
} from '../src/components/MonitorPanels';
import { AuracleConnections } from '../src/components/ConnectionsSettings';
import { AuracleStatusChip } from '../src/components/StatusChip';

/* ── mock data ─────────────────────────────────────────────── */

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

const MOCK_STRATEGIES = {
  strategies: [
    { path: 'strategies.desk.atlas.AtlasMomentum', kind: 'strategy', doc: '12-1 momentum, vol-scaled' },
    { path: 'strategies.desk.fundpair.FundPair', kind: 'strategy', doc: '60/40 blend' },
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

// ── connections registry (list + per-connector detail) ──
const MOCK_CONNECTORS = [
  { id: 'ibkr', display_label: 'Interactive Brokers', blurb: 'Live + paper trading via IB Gateway', kind: 'broker', status: { state: 'connected', detail: 'paper' }, test_supported: true, asset_kinds: ['equity', 'option'] },
  { id: 'alpaca', display_label: 'Alpaca', blurb: 'Commission-free US equities', kind: 'broker', status: { state: 'not_configured' }, test_supported: true },
  { id: 'yfinance', display_label: 'Yahoo Finance', blurb: 'Free daily bars, zero config', kind: 'data_provider', status: { state: 'connected' }, test_supported: false },
  { id: 'polygon', display_label: 'Polygon.io', blurb: 'Real-time + historical market data', kind: 'data_provider', status: { state: 'not_configured' }, gated: true, gated_reason: 'Requires the Pro plan' },
  { id: 'quantconnect', display_label: 'QuantConnect', blurb: 'Cloud backtesting + live', kind: 'integration', status: { state: 'error', detail: 'token expired' }, test_supported: true },
];

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

const ok = (body: unknown) => ({ ok: true, status: 200, body });
const notFound = { ok: false, status: 404, body: null };

function engineRequest(method: string, path: string): { ok: boolean; status: number; body: unknown } {
  const p = String(path);
  if (/^\/deployments\/\d+\/orders/.test(p)) return ok(MOCK_ORDERS);
  if (p === '/deployments') return ok(MOCK_DEPLOYMENTS);
  if (p.startsWith('/ui/api/orders')) return ok(MOCK_BLOTTER);
  if (p.startsWith('/ui/api/incidents')) return ok(MOCK_INCIDENTS);
  if (p.startsWith('/ui/api/schedules')) return ok(MOCK_SCHEDULES);
  if (p.startsWith('/ui/api/runway')) return ok(MOCK_RUNWAY);
  if (p.startsWith('/ui/api/validation')) return ok(MOCK_VERDICT);
  if (p.startsWith('/ui/api/backtest/strategies')) return ok(MOCK_STRATEGIES);
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
        return engineRequest(args[0] as string, args[1] as string);
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

/* ── IDE dark theme vars so panelkit tokens resolve ─────────── */
const r = document.documentElement.style;
r.setProperty('--bg-primary', '#0e1013');
r.setProperty('--bg-secondary', '#16191e');
r.setProperty('--text-primary', '#d7dae0');
r.setProperty('--text-secondary', '#b9bec7');
r.setProperty('--text-tertiary', '#8a8f98');
r.setProperty('--border-primary', 'rgba(146,152,166,0.20)');
r.setProperty('--accent-primary', '#60a5fa');
r.setProperty('--font-family-ui', '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif');
document.body.style.cssText = 'margin:0;background:#0e1013;min-height:100vh';

const PANELS: Record<string, (props: { host: never }) => JSX.Element> = {
  live: LiveAlgorithmsPanel,
  validation: ValidationPanel,
  blotter: BlotterPanel,
  incidents: IncidentsPanel,
  schedules: SchedulesPanel,
  runway: RunwayPanel,
  connections: AuracleConnections as (props: { host: never }) => JSX.Element,
  statuschip: AuracleStatusChip as (props: { host: never }) => JSX.Element,
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
