import { afterEach, describe, expect, it } from 'vitest';

import { backtestStore } from '../backtestStore';

/**
 * The load-by-id seam behind the Metrics Viewer. `loadJob` fetches a completed
 * run through the standard result route and renders it through the same
 * succeeded state as a fresh local run. Stubbing the main-process engine bridge
 * (the client's only I/O) is the whole mocked seam — one response drives it.
 */
function installBridge(response: { ok: boolean; status: number; body: unknown }) {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    invoke: async (channel: string) => (channel === 'auracle:engine-request' ? response : null),
  };
}

const okResult = (body: Record<string, unknown>) => ({ ok: true, status: 200, body });

const localRun = {
  status: 'succeeded',
  chartable: true,
  strategy_path: 'strategies.desk.atlas.AtlasMomentum',
  as_of: '2026-01-02',
  n_bars: 300,
  stats: { annualized_return: 0.22, sharpe: 1.3, max_drawdown: -0.2 },
  chart: { labels: ['2020-01-01', '2020-06-01', '2021-01-01'], points: [1, 1.2, 1.5] },
  drawdown: { labels: ['2020-01-01', '2020-06-01', '2021-01-01'], points: [0, -5, -2] },
  trades: 12,
};

// A QC-imported run persists with result kind "qc_import"; the same route
// serves it, so it must normalize into the identical shape plus a source.
const qcRun = { ...localRun, kind: 'qc_import', strategy_path: 'imported.qc.MomentumBurst' };

afterEach(() => {
  backtestStore.reset();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('backtestStore.loadJob', () => {
  it('loads a completed local run into the succeeded view', async () => {
    installBridge(okResult(localRun));
    await backtestStore.loadJob(42);

    const snap = backtestStore.getSnapshot();
    expect(snap.phase).toBe('succeeded');
    expect(snap.origin).toBe('loaded');
    expect(snap.jobId).toBe(42);
    expect(snap.strategyPath).toBe('strategies.desk.atlas.AtlasMomentum');
    expect(snap.result).toMatchObject({
      equity: [1, 1.2, 1.5],
      drawdown: [0, -5, -2],
      labels: ['2020-01-01', '2020-06-01', '2021-01-01'],
      nBars: 300,
      trades: 12,
    });
    // A local run declares no source.
    expect(snap.result?.source).toBeUndefined();
  });

  it('loads a QC-imported run identically, carrying its source', async () => {
    installBridge(okResult(qcRun));
    await backtestStore.loadJob(77);

    const snap = backtestStore.getSnapshot();
    expect(snap.phase).toBe('succeeded');
    expect(snap.origin).toBe('loaded');
    // Same normalized curve + stats as the local run — one code path.
    expect(snap.result).toMatchObject({ equity: [1, 1.2, 1.5], nBars: 300 });
    // The result-kind marker resolves to a non-local source.
    expect(snap.result?.source).toBe('quantconnect');
  });

  it('marks a run recorded-but-not-chartable without inventing a curve', async () => {
    installBridge(okResult({ status: 'succeeded', chartable: false, strategy_path: 'fn.signal' }));
    await backtestStore.loadJob(9);

    const snap = backtestStore.getSnapshot();
    expect(snap.phase).toBe('succeeded');
    expect(snap.origin).toBe('loaded');
    expect(snap.result).toBeNull();
  });

  it('surfaces a missing run as a failure, not a blank curve', async () => {
    installBridge({ ok: false, status: 404, body: { status: 'not_found' } });
    await backtestStore.loadJob(404);

    const snap = backtestStore.getSnapshot();
    expect(snap.phase).toBe('failed');
    expect(snap.origin).toBe('loaded');
    expect(snap.detail).toMatch(/isn't on this engine/i);
  });

  it('reloads a loaded run on retry rather than starting a new backtest', async () => {
    installBridge(okResult(qcRun));
    await backtestStore.loadJob(77);
    // origin is 'loaded' with no strategy/class, so retry must route back
    // through loadJob (a new backtest would need a resolved strategy).
    await backtestStore.retry();

    const snap = backtestStore.getSnapshot();
    expect(snap.phase).toBe('succeeded');
    expect(snap.jobId).toBe(77);
    expect(snap.result?.source).toBe('quantconnect');
  });
});

describe('backtestStore.loadJob — caller-supplied source (the QC open-in-viewer edge)', () => {
  // The standard result route serves a persisted QC run SOURCE-BLIND (it does
  // not echo the stored kind/source), so the open edge, which knows the run is
  // external, passes the provenance itself.
  const sourceBlindQc = { ...localRun, strategy_path: 'quantconnect:9:bt-9' };

  it('labels a source-blind result with the supplied source hint', async () => {
    installBridge(okResult(sourceBlindQc));
    await backtestStore.loadJob(88, { source: 'quantconnect' });

    expect(backtestStore.getSnapshot().result?.source).toBe('quantconnect');
  });

  it('lets a source the body DOES declare win over the hint', async () => {
    installBridge(okResult(qcRun)); // body carries kind: 'qc_import'
    await backtestStore.loadJob(88, { source: 'ignored' });

    expect(backtestStore.getSnapshot().result?.source).toBe('quantconnect');
  });

  it('preserves the source across a retry reload of a source-blind run', async () => {
    installBridge(okResult(sourceBlindQc));
    await backtestStore.loadJob(88, { source: 'quantconnect' });
    await backtestStore.retry();

    const snap = backtestStore.getSnapshot();
    expect(snap.jobId).toBe(88);
    expect(snap.result?.source).toBe('quantconnect');
  });
});
