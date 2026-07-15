import { describe, expect, it } from 'vitest';
import {
  DeployWizard,
  Deployment,
  DeploymentOrders,
  activeCount,
  availableActions,
  canDeploy,
  computeLocked,
  deploymentContext,
  deploymentPrompt,
  formatReturn,
  isDestructive,
  isPaidTier,
  newWizard,
  selectedDeployment,
  setRows,
  splitStrategyPath,
  stateLabel,
  toRequest,
  validateWizard,
  verbEndpoint,
} from '../live';

describe('isPaidTier', () => {
  it('unlocks cloud only for real paid tiers', () => {
    expect(isPaidTier('pro')).toBe(true);
    expect(isPaidTier('institutional')).toBe(true);
    expect(isPaidTier('community')).toBe(false);
    expect(isPaidTier('free')).toBe(false);
    expect(isPaidTier('unknown')).toBe(false);
    expect(isPaidTier('')).toBe(false);
    expect(isPaidTier('   ')).toBe(false); // whitespace must not unlock
    expect(isPaidTier(' community ')).toBe(false);
    expect(isPaidTier(null)).toBe(false);
    expect(isPaidTier(undefined)).toBe(false);
  });

  it('fail-closes tiers it does not recognize (engine ranks unknowns as community)', () => {
    for (const tier of ['trial', 'starter', 'plus', 'garbage-tier']) {
      expect(isPaidTier(tier)).toBe(false);
    }
    expect(isPaidTier('enterprise')).toBe(true);
    expect(isPaidTier(' TEAM ')).toBe(true);
  });
});

describe('computeLocked', () => {
  it('locks cloud targets when not paid, never local', () => {
    expect(computeLocked('local', false)).toBe(false);
    expect(computeLocked('oci', false)).toBe(true);
    expect(computeLocked('aws', false)).toBe(true);
    expect(computeLocked('oci', true)).toBe(false);
    expect(computeLocked('aws', true)).toBe(false);
  });
});

describe('splitStrategyPath', () => {
  it('splits the discovery dotted path into module + class', () => {
    expect(splitStrategyPath('strategies.desk.vol.VolTarget')).toEqual({
      path: 'strategies.desk.vol',
      cls: 'VolTarget',
    });
    expect(splitStrategyPath('strategies.example_ma.MACrossover')).toEqual({
      path: 'strategies.example_ma',
      cls: 'MACrossover',
    });
    // Degenerate input never throws; empty class is caught by the caller's filter.
    expect(splitStrategyPath('nodots')).toEqual({ path: 'nodots', cls: '' });
  });
});

function readyLive(): DeployWizard {
  return {
    ...newWizard(),
    name: 'Momentum',
    strategy_path: 'strategies.momentum',
    strategy_cls: 'Momentum',
    mode: 'live',
    broker: 'clearstreet',
    aum: 100_000,
  };
}

describe('deploy wizard reducer (ported native tests)', () => {
  it('live requires positive aum', () => {
    const wizard = readyLive();
    expect(canDeploy(wizard)).toBe(true);

    expect(canDeploy({ ...wizard, aum: null })).toBe(false);
    expect(
      validateWizard({ ...wizard, aum: null }).some((e) => e.includes('Starting capital'))
    ).toBe(true);

    expect(canDeploy({ ...wizard, aum: 0 })).toBe(false);
  });

  it('paper does not require aum', () => {
    const wizard = { ...readyLive(), mode: 'paper' as const, aum: null };
    expect(canDeploy(wizard)).toBe(true);
  });

  it('missing strategy or broker blocks deploy', () => {
    expect(
      validateWizard({ ...readyLive(), broker: null }).some((e) => e.includes('brokerage'))
    ).toBe(true);
    expect(
      validateWizard({ ...readyLive(), strategy_cls: '' }).some((e) => e.includes('strategy'))
    ).toBe(true);
  });

  it('cloud requires a data source', () => {
    const wizard = { ...readyLive(), compute: 'oci' as const };
    expect(validateWizard(wizard).some((e) => e.includes('data source'))).toBe(true);
    expect(canDeploy({ ...wizard, data_providers: ['alpaca'] })).toBe(true);
  });

  it('to_request carries the keystone fields', () => {
    const body = toRequest(readyLive());
    expect(body.mode).toBe('live');
    expect(body.broker).toBe('clearstreet');
    expect(body.aum).toBe(100_000);
    expect(body.compute_kind).toBe('local');
    expect((body.resilience as { auto_restart: boolean }).auto_restart).toBe(true);
  });
});

describe('live algorithms lifecycle (ported native tests)', () => {
  it('actions follow lifecycle', () => {
    expect(availableActions('running')).toEqual(['stop', 'liquidate']);
    expect(availableActions('stopped')).toEqual(['restart', 'liquidate']);
    expect(availableActions('errored')).toEqual(['restart', 'liquidate']);
    expect(availableActions('archived')).toEqual([]);
    expect(availableActions('preflight')).toEqual([]);
  });

  it('verb endpoint targets the root-mounted router and liquidate confirms', () => {
    // Deviation from the native source, which pointed at /ui/api/… — the
    // engine serves the live router at root (verified: /ui/api 404s).
    expect(verbEndpoint(7, 'liquidate')).toBe('/deployments/7/liquidate');
    expect(isDestructive('liquidate')).toBe(true);
    expect(isDestructive('stop')).toBe(false);
  });

  it('selection drops when row disappears', () => {
    let model = setRows({ rows: [], selected: null }, [
      { id: 1, state: 'running', name: '', strategy_path: '', broker: '', mode: '', positions: [] },
    ]);
    model = { ...model, selected: 1 };
    expect(selectedDeployment(model)).toBeDefined();
    expect(activeCount(model)).toBe(1);

    model = setRows(model, [
      { id: 2, state: 'stopped', name: '', strategy_path: '', broker: '', mode: '', positions: [] },
    ]);
    expect(selectedDeployment(model)).toBeUndefined();
    expect(activeCount(model)).toBe(0);
  });

  it('parses the engine ledger payload', () => {
    const parsed = JSON.parse(`{
      "deployment_id": 3,
      "orders": [
        {"id": 10, "symbol": "SPY", "action": "BUY", "quantity": 10.0,
         "filled_quantity": 10.0, "avg_fill_price": 100.5, "status": "filled",
         "broker": "clearstreet", "created_at": "2026-06-30T12:00:00+00:00"}
      ],
      "positions": [{"symbol": "SPY", "quantity": 10.0, "avg_cost": 100.5}]
    }`) as DeploymentOrders;
    expect(parsed.deployment_id).toBe(3);
    expect(parsed.orders).toHaveLength(1);
    expect(parsed.orders[0].symbol).toBe('SPY');
    expect(parsed.positions[0].quantity).toBe(10);
  });

  it('formats returns and labels states', () => {
    expect(formatReturn(12.345)).toBe('+12.35%');
    expect(formatReturn(-3.1)).toBe('-3.10%');
    expect(formatReturn(null)).toBe('—');
    expect(stateLabel('running')).toBe('Live');
    expect(stateLabel('provisioning')).toBe('Preparing');
    expect(stateLabel('nonsense')).toBe('Unknown');
  });
});

function deployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: 1,
    name: 'Momentum SPY',
    strategy_path: 'strategies.desk.momo.Momo',
    broker: 'alpaca',
    mode: 'paper',
    state: 'running',
    aum: 100000,
    equity: 101250,
    return_pct: 1.25,
    positions: [{ symbol: 'SPY', quantity: 10, avg_cost: 500 }],
    ...overrides,
  };
}

describe('deploymentContext (ambient)', () => {
  it('captures the live state and positions, panel-tagged', () => {
    const ctx = deploymentContext(deployment());
    expect(ctx.panel).toBe('live-algorithms');
    expect(ctx.deployment).toBe('Momentum SPY');
    expect(ctx.status).toBe('Live'); // stateLabel('running')
    expect(ctx.return).toBe('+1.25%');
    expect(ctx.positions).toEqual([{ symbol: 'SPY', quantity: 10, avg_cost: 500 }]);
  });
});

describe('deploymentPrompt (hand-off)', () => {
  it('names the strategy, its status, and asks to investigate', () => {
    const prompt = deploymentPrompt(deployment({ state: 'errored', return_pct: -8 }));
    expect(prompt).toContain('strategies.desk.momo.Momo');
    expect(prompt).toContain('Status: Errored.');
    expect(prompt).toContain('Return: -8.00%');
    expect(prompt).toContain('- SPY: 10 @ 500');
    expect(prompt).toContain('Investigate this deployment');
  });
});
