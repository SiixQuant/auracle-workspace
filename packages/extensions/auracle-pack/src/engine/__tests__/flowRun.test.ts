import { afterEach, describe, expect, it } from 'vitest';

import { runFlowBacktest } from '../flowRun';

/**
 * Stub the main-process engine bridge the client calls. runFlowBacktest walks
 * the async job route — POST /ui/api/backtest/run, then the job status + result
 * GETs — so the handler routes on the request path.
 */
type Resp = { ok: boolean; status: number; body: unknown };

function installBridge(handler: (method: string, path: string) => Resp) {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    invoke: async (channel: string, ...args: unknown[]) => {
      if (channel !== 'auracle:engine-request') return null;
      const [method, path] = args as [string, string];
      return handler(method, path);
    },
  };
}

const ok = (body: unknown): Resp => ({ ok: true, status: 200, body });
const fail = (status: number): Resp => ({ ok: false, status, body: null });

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('runFlowBacktest', () => {
  it('submits, polls to success, and maps the equity curve + scalars', async () => {
    installBridge((_method, path) => {
      if (path === '/ui/api/backtest/run') return ok({ ok: true, job_id: 7 });
      if (path.endsWith('/status')) return ok({ status: 'succeeded' });
      if (path.endsWith('/result')) {
        return ok({
          status: 'succeeded',
          chartable: true,
          chart: { labels: ['2020-01', '2020-02', '2020-03'], points: [1, 1.1, 1.25] },
          stats: { sharpe: 1.2, total_return: 0.25, max_drawdown: -0.08 },
          trades: 42,
        });
      }
      return fail(404);
    });

    const result = await runFlowBacktest('strategies.desk.atlas.Atlas', 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.equity).toEqual([
      { t: '2020-01', v: 1 },
      { t: '2020-02', v: 1.1 },
      { t: '2020-03', v: 1.25 },
    ]);
    expect(result.summary.sharpe).toBe(1.2);
    expect(result.summary.total_return).toBe(0.25);
    expect(result.summary.max_drawdown).toBe(-0.08);
    expect(result.summary.num_trades).toBe(42);
  });

  it('keeps polling until the job leaves a non-terminal state', async () => {
    let statusCalls = 0;
    installBridge((_method, path) => {
      if (path === '/ui/api/backtest/run') return ok({ ok: true, job_id: 9 });
      if (path.endsWith('/status')) {
        statusCalls += 1;
        return ok({ status: statusCalls < 3 ? 'running' : 'succeeded' });
      }
      if (path.endsWith('/result')) {
        return ok({ status: 'succeeded', chartable: true, chart: { labels: ['a', 'b'], points: [1, 1.05] }, stats: {}, trades: 0 });
      }
      return fail(404);
    });

    const result = await runFlowBacktest('s.X', 0);

    expect(statusCalls).toBe(3);
    expect(result.ok).toBe(true);
  });

  it('maps a non-chartable result to scalars with no curve', async () => {
    installBridge((_method, path) => {
      if (path === '/ui/api/backtest/run') return ok({ ok: true, job_id: 8 });
      if (path.endsWith('/status')) return ok({ status: 'succeeded' });
      if (path.endsWith('/result')) return ok({ status: 'succeeded', chartable: false, stats: { sharpe: 0.9 }, trades: 0 });
      return fail(404);
    });

    const result = await runFlowBacktest('s.X', 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.equity).toEqual([]);
    expect(result.summary.sharpe).toBe(0.9);
  });

  it('fails when the engine refuses the run', async () => {
    installBridge((_method, path) =>
      path === '/ui/api/backtest/run' ? ok({ ok: false, error: 'Engine offline' }) : fail(0)
    );

    const result = await runFlowBacktest('s.X', 0);

    expect(result).toEqual({ ok: false, error: 'Engine offline' });
  });

  it('fails when the job reports a failed status', async () => {
    installBridge((_method, path) => {
      if (path === '/ui/api/backtest/run') return ok({ ok: true, job_id: 3 });
      if (path.endsWith('/status')) return ok({ status: 'failed' });
      return fail(404);
    });

    const result = await runFlowBacktest('s.X', 0);

    expect(result.ok).toBe(false);
  });

  it('fails when the succeeded result cannot be read', async () => {
    installBridge((_method, path) => {
      if (path === '/ui/api/backtest/run') return ok({ ok: true, job_id: 5 });
      if (path.endsWith('/status')) return ok({ status: 'succeeded' });
      if (path.endsWith('/result')) return fail(404);
      return fail(0);
    });

    const result = await runFlowBacktest('s.X', 0);

    expect(result.ok).toBe(false);
  });
});
