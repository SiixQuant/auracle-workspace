/**
 * RecentRunsGrid — recent backtests as a dense grid (Frontier #19 adoption).
 *
 * The engine's recent-runs feed, rendered through the DataGrid: each strategy a
 * live pivot to its tearsheet, a row click focusing that run exactly as the old
 * dropdown did, the focused run marked, and the room's empty state shown when
 * there is nothing to list. Also pins the two pure builders — the drawdown scale
 * derived from the column, and the six-column shape.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../engine/client', () => ({ tearsheetRuns: vi.fn() }));

import { tearsheetRuns, type RecentRun } from '../../engine/client';
import { focusStore } from '../../engine/focusStore';
import { getActiveRoom, openGridHome } from '../grid/gridNav';
import { RecentRunsGrid, drawdownScale, recentRunColumns } from '../grid/RecentRunsGrid';

const runsMock = tearsheetRuns as unknown as Mock;

const run = (over: Partial<RecentRun> = {}): RecentRun => ({
  jobId: 1,
  strategyPath: 'strategies.desk.fund_pair.FundPair',
  asOf: '2026-01-02',
  nBars: 2500,
  finishedAt: '2026-08-01T12:00:00Z',
  totalReturn: 0.73,
  sharpe: 1.31,
  maxDrawdown: -0.19,
  ...over,
});

afterEach(() => {
  cleanup();
  focusStore.clear();
  openGridHome();
  vi.clearAllMocks();
});

describe('drawdownScale', () => {
  it('anchors the red end on the deepest drawdown', () => {
    const scale = drawdownScale([run({ maxDrawdown: -0.1 }), run({ maxDrawdown: -0.4 })]);
    expect(scale).toEqual({ min: -0.4, max: 0, mid: -0.2 });
  });
  it('is undefined when nothing drew down', () => {
    expect(drawdownScale([run({ maxDrawdown: 0 }), run({ maxDrawdown: null })])).toBeUndefined();
  });
});

describe('recentRunColumns', () => {
  it('is the six-column run shape, with a return trend and a Sharpe heat', () => {
    const cols = recentRunColumns([run()]);
    expect(cols.map((c) => c.key)).toEqual(['strategy', 'finished', 'return', 'sharpe', 'maxdd', 'bars']);
    expect(cols.find((c) => c.key === 'return')?.trend).toBe(true);
    expect(cols.find((c) => c.key === 'sharpe')?.heat).toEqual({ min: -1, max: 3, mid: 0 });
    // the strategy column is a pivot
    expect(cols.find((c) => c.key === 'strategy')?.link?.(run())?.kind).toBe('run');
  });
  it('drops the drawdown heat when the column never drew down', () => {
    const cols = recentRunColumns([run({ maxDrawdown: 0 })]);
    expect(cols.find((c) => c.key === 'maxdd')?.heat).toBeUndefined();
  });
});

describe('RecentRunsGrid', () => {
  it('renders one row per run, the strategy a pivot, the focused run marked', async () => {
    runsMock.mockResolvedValue([
      run({ jobId: 7 }),
      run({ jobId: 8, strategyPath: 'strategies.desk.vmt4.VMT4', sharpe: -0.4, totalReturn: -0.1 }),
    ]);
    render(<RecentRunsGrid focusedJob={7} fallback={<div>empty</div>} />);

    await screen.findByTestId('recent-runs-grid');
    expect(screen.getByTestId('recent-runs-grid-row-7')).toBeTruthy();
    expect(screen.getByTestId('recent-runs-grid-row-8')).toBeTruthy();

    // strategy cells are entity pivots (one per row), keyed as runs
    const links = screen.getAllByTestId('entity-link');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('data-entity-kind')).toBe('run');

    // the focused run is marked
    expect(screen.getByTestId('recent-runs-grid-row-7').getAttribute('data-active')).toBe('');
    expect(screen.getByTestId('recent-runs-grid-row-8').getAttribute('data-active')).toBeNull();
  });

  it('focuses a run on row click — the same publish the picker does', async () => {
    runsMock.mockResolvedValue([run({ jobId: 7 }), run({ jobId: 8 })]);
    render(<RecentRunsGrid focusedJob={null} fallback={<div>empty</div>} />);
    await screen.findByTestId('recent-runs-grid');

    fireEvent.click(screen.getByTestId('recent-runs-grid-row-8'));
    const focus = focusStore.getSnapshot();
    expect(focus.run?.id).toBe('8');
    expect(focus.run?.kind).toBe('backtest');
  });

  it('pivots to the tearsheet when the strategy link is clicked', async () => {
    runsMock.mockResolvedValue([run({ jobId: 7 })]);
    render(<RecentRunsGrid focusedJob={null} fallback={<div>empty</div>} />);
    await screen.findByTestId('recent-runs-grid');

    fireEvent.click(screen.getByTestId('entity-link'));
    expect(getActiveRoom()).toBe('strategy');
  });

  it('shows the fallback when the feed is empty', async () => {
    runsMock.mockResolvedValue([]);
    render(<RecentRunsGrid focusedJob={null} fallback={<div data-testid="empty-fallback">none</div>} />);
    await waitFor(() => expect(screen.getByTestId('empty-fallback')).toBeTruthy());
    expect(screen.queryByTestId('recent-runs-grid')).toBeNull();
  });
});
