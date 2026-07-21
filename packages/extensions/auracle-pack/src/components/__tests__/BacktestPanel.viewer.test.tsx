/**
 * The Metrics Viewer behaviour on the Backtest surface: it follows the run
 * focused on the Spine, loads it by id through the same succeeded view as a
 * local run (a QC-imported run included, labelled with its source), publishes
 * the run it shows, and releases a followed run on Escape. The mocked seam is
 * the engine client's result read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BacktestPanel } from '../BacktestPanel';
import { backtestStore } from '../../engine/backtestStore';
import { focusStore } from '../../engine/focusStore';

vi.mock('../../engine/client', async (importActual) => {
  const actual = await importActual<typeof import('../../engine/client')>();
  return { ...actual, backtestJobResult: vi.fn() };
});

import { backtestJobResult } from '../../engine/client';

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
const qcRun = { ...localRun, kind: 'qc_import', strategy_path: 'imported.qc.MomentumBurst' };

const result = (body: Record<string, unknown>) => ({ ok: true as const, body });

beforeEach(() => {
  vi.mocked(backtestJobResult).mockResolvedValue(result(localRun) as never);
});

afterEach(() => {
  cleanup();
  backtestStore.reset();
  focusStore.clear();
  vi.clearAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('Metrics Viewer — follow, load-by-id, publish, release', () => {
  it('follows the focused run on open and loads it by id', async () => {
    focusStore.publish({ run: { kind: 'backtest', id: '42' } });

    render(<BacktestPanel />);

    // Loaded through the succeeded view, framed as a saved run.
    expect(await screen.findByTestId('metrics-viewer')).toBeTruthy();
    expect(vi.mocked(backtestJobResult)).toHaveBeenCalledWith(42);
    expect(screen.getByTestId('release-run')).toBeTruthy();
    // The headline metrics render (same code path as a local run).
    expect(screen.getByText('CAGR')).toBeTruthy();
    // A local run carries no source label.
    expect(screen.queryByTestId('run-source')).toBeNull();
  });

  it('renders a QC-imported run through the same view with a source label', async () => {
    vi.mocked(backtestJobResult).mockResolvedValue(result(qcRun) as never);
    focusStore.publish({ run: { kind: 'backtest', id: '77' } });

    render(<BacktestPanel />);

    expect(await screen.findByTestId('metrics-viewer')).toBeTruthy();
    // Identical metrics chrome...
    expect(screen.getByText('CAGR')).toBeTruthy();
    // ...plus the provenance label a non-local source earns.
    const source = screen.getByTestId('run-source');
    expect(source.textContent).toContain('QuantConnect');
  });

  it('publishes the run it shows to the Spine', async () => {
    render(<BacktestPanel />);
    await act(async () => {
      await backtestStore.loadJob(42);
    });

    await waitFor(() =>
      expect(focusStore.getSnapshot().run).toEqual({ kind: 'backtest', id: '42' })
    );
  });

  it('preserves an already-focused strategy while following its run', async () => {
    focusStore.publish({
      strategy: { filePath: 'strategies/desk/atlas.py', dottedPath: 'strategies.desk.atlas.Atlas' },
      run: { kind: 'backtest', id: '42' },
    });
    render(<BacktestPanel />);

    expect(await screen.findByTestId('metrics-viewer')).toBeTruthy();
    // Loading the run by id must not blank the strategy the Spine was holding.
    await waitFor(() =>
      expect(focusStore.getSnapshot().strategy).toEqual({
        filePath: 'strategies/desk/atlas.py',
        dottedPath: 'strategies.desk.atlas.Atlas',
      })
    );
  });

  it('releases a followed run on Escape, scoped to the panel', async () => {
    focusStore.publish({ run: { kind: 'backtest', id: '42' } });
    render(<BacktestPanel />);
    const viewer = await screen.findByTestId('metrics-viewer');

    fireEvent.keyDown(viewer, { key: 'Escape' });

    // The saved-run view is released and the run drops out of focus.
    await waitFor(() => expect(screen.queryByTestId('metrics-viewer')).toBeNull());
    expect(focusStore.getSnapshot().run).toBeUndefined();
    expect(backtestStore.getSnapshot().phase).toBe('idle');
  });

  it('does not clobber a run in flight to follow a newly focused one', async () => {
    // Hold the strategy-discovery read open so a local run stays mid-resolve.
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      invoke: () => new Promise(() => {}),
    };
    act(() => {
      void backtestStore.run('/w/desk/atlas.py');
    });
    expect(backtestStore.getSnapshot().phase).toBe('resolving');

    // Focus a different run while the local one is still resolving.
    focusStore.publish({ run: { kind: 'backtest', id: '99' } });
    render(<BacktestPanel />);

    // The in-flight run is not interrupted by a follow-load.
    expect(vi.mocked(backtestJobResult)).not.toHaveBeenCalled();
  });
});
