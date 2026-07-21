import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backtestStore } from '../backtestStore';
import { registerPanelEventSink, __resetPanelEventSinkForTests } from '../panelEvents';

/**
 * The pack EMIT POINTS: a live run reaching a terminal state, and a validation
 * pass finishing, must fire a typed envelope through the host AI sink — while
 * loading a stored run by id must not. The whole seam is (a) the mocked engine
 * bridge that drives the store to a terminal state and (b) a mock notify sink
 * registered the way an aiSupported panel registers `host.ai`.
 */

type BridgeResponse = { ok: boolean; status: number; body: unknown };
type Route = (method: string, path: string, body?: unknown) => BridgeResponse;

let route: Route;
let notifyChange: ReturnType<typeof vi.fn>;

function installBridge(r: Route): void {
  route = r;
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    invoke: async (_channel: string, method: string, path: string, body?: unknown) => route(method, path, body),
  };
}

const FILE = 'strategies/desk/atlas.py';
const STRATEGY = 'strategies.desk.atlas.AtlasMomentum';

const discovery: BridgeResponse = {
  ok: true,
  status: 200,
  body: { strategies: [{ path: STRATEGY, doc: '' }] },
};
const runQueued: BridgeResponse = { ok: true, status: 200, body: { ok: true, job_id: 42 } };
const resultBody: BridgeResponse = {
  ok: true,
  status: 200,
  body: {
    status: 'succeeded',
    chartable: true,
    strategy_path: STRATEGY,
    stats: { sharpe: 1.3, annualized_return: 0.22 },
    chart: { labels: ['2020-01-01'], points: [1] },
    drawdown: { labels: ['2020-01-01'], points: [0] },
    n_bars: 1,
    trades: 1,
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  notifyChange = vi.fn();
  registerPanelEventSink({ notifyChange });
});

afterEach(() => {
  vi.useRealTimers();
  backtestStore.reset();
  __resetPanelEventSinkForTests();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

/** The type + envelope of the last notifyChange call. */
function lastEmit(): { event: string; envelope: any } | null {
  if (notifyChange.mock.calls.length === 0) return null;
  const [event, envelope] = notifyChange.mock.calls[notifyChange.mock.calls.length - 1];
  return { event, envelope };
}

describe('backtestStore — backtest.finished emit', () => {
  it('emits succeeded with headline stats when a live run completes', async () => {
    installBridge((method, path) => {
      if (path.includes('/strategies')) return discovery;
      if (path.includes('/run')) return runQueued;
      if (path.includes('/status')) return { ok: true, status: 200, body: { status: 'succeeded' } };
      if (path.includes('/result')) return resultBody;
      return { ok: false, status: 404, body: null };
    });

    await backtestStore.run(FILE);
    await vi.runAllTimersAsync();

    const emit = lastEmit();
    expect(emit?.event).toBe('backtest.finished');
    expect(emit?.envelope).toMatchObject({ v: 1, type: 'backtest.finished', subject: '42' });
    expect(emit?.envelope.payload.outcome).toBe('succeeded');
    expect(emit?.envelope.payload.stats).toMatchObject({ sharpe: 1.3 });
  });

  it('emits failed (no stats) when the run fails', async () => {
    installBridge((method, path) => {
      if (path.includes('/strategies')) return discovery;
      if (path.includes('/run')) return runQueued;
      if (path.includes('/status')) return { ok: true, status: 200, body: { status: 'failed' } };
      return { ok: false, status: 404, body: null };
    });

    await backtestStore.run(FILE);
    await vi.runAllTimersAsync();

    const emit = lastEmit();
    expect(emit?.event).toBe('backtest.finished');
    expect(emit?.envelope.payload.outcome).toBe('failed');
    expect(emit?.envelope.payload.stats).toBeUndefined();
  });

  it('emits failed when the engine refuses the run at queue time', async () => {
    installBridge((method, path) => {
      if (path.includes('/strategies')) return discovery;
      if (path.includes('/run')) return { ok: false, status: 500, body: { error: 'stack down' } };
      return { ok: false, status: 404, body: null };
    });

    await backtestStore.run(FILE);
    await vi.runAllTimersAsync();

    expect(lastEmit()?.envelope.payload.outcome).toBe('failed');
  });

  it('does NOT emit when a stored run is loaded by id', async () => {
    installBridge((method, path) => {
      if (path.includes('/result')) return resultBody;
      return { ok: false, status: 404, body: null };
    });

    await backtestStore.loadJob(42);
    await vi.runAllTimersAsync();

    expect(notifyChange).not.toHaveBeenCalled();
  });
});

describe('backtestStore — validation.completed emit', () => {
  it('emits when an inline validation pass finishes', async () => {
    installBridge((method, path) => {
      if (path.includes('/strategies')) return discovery;
      if (path.includes('/run')) return runQueued;
      if (path.includes('/status')) return { ok: true, status: 200, body: { status: 'succeeded' } };
      if (path.includes('/result')) return resultBody;
      if (path.includes('/validation')) {
        return { ok: true, status: 200, body: { strategy_path: STRATEGY, plain: 'Holds up out of sample', signals: [] } };
      }
      return { ok: false, status: 404, body: null };
    });

    // Run first so the store has a resolved strategy to validate.
    await backtestStore.run(FILE);
    await vi.runAllTimersAsync();
    notifyChange.mockClear();

    await backtestStore.validate();

    const emit = lastEmit();
    expect(emit?.event).toBe('validation.completed');
    expect(emit?.envelope).toMatchObject({ type: 'validation.completed', subject: STRATEGY });
    expect(emit?.envelope.payload.verdict).toBe('Holds up out of sample');
  });
});
