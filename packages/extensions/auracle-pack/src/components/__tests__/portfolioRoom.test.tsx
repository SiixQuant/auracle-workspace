/**
 * The Portfolio room (Frontier #8).
 *
 * Pins the room's promise: it lists recent backtests, rests until two are
 * picked, and on Compose sends the chosen ids + weights to the engine and
 * renders the blended book it returns — combined stats, the strategy
 * correlation matrix, and each strategy's contribution. The compose call is the
 * `client.composePortfolio` seam; Plotly is mocked (jsdom paints nothing) so the
 * figure is not asserted here, only that the book's data surfaces.
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
  return { ...actual, tearsheetRuns: vi.fn(), composePortfolio: vi.fn() };
});

import { composePortfolio, tearsheetRuns, type PortfolioBody, type RecentRun } from '../../engine/client';
import { PortfolioPage } from '../grid/pages/PortfolioPage';

const RUNS: RecentRun[] = [
  { jobId: 1, strategyPath: 'strategies.a.Alpha', asOf: '2026-01-01', nBars: 250, finishedAt: '2026-01-01T00:00:00Z', totalReturn: 0.5, sharpe: 1.2, maxDrawdown: -0.1 },
  { jobId: 2, strategyPath: 'strategies.b.Beta', asOf: '2026-01-01', nBars: 250, finishedAt: '2026-01-01T00:00:00Z', totalReturn: 0.3, sharpe: 0.9, maxDrawdown: -0.15 },
  { jobId: 3, strategyPath: 'strategies.c.Gamma', asOf: '2026-01-01', nBars: 250, finishedAt: '2026-01-01T00:00:00Z', totalReturn: 0.2, sharpe: 0.7, maxDrawdown: -0.2 },
];

const BOOK: PortfolioBody = {
  stats: { total_return: 0.83, annualized_return: 0.2, sharpe: 1.4, sortino: 1.9, calmar: 0.8, annualized_vol: 0.18, max_drawdown: -0.25 },
  chart: { labels: ['2020-01-01', '2020-01-02', '2020-01-03'], points: [1.0, 1.05, 1.1] },
  correlation: { '1': { '1': 1, '2': 0.3 }, '2': { '1': 0.3, '2': 1 } },
  contribution: { '1': 0.6, '2': 0.4 },
  weights: { '1': 0.5, '2': 0.5 },
  members: [{ id: '1', label: 'Alpha' }, { id: '2', label: 'Beta' }],
  window: { start: '2020-01-01', end: '2020-12-31' },
  n_days: 250,
};

const host = { panelId: 'com.auracle.pack.grid', extensionId: 'com.auracle.pack' } as never;

beforeEach(() => {
  vi.mocked(tearsheetRuns).mockResolvedValue(RUNS);
  vi.mocked(composePortfolio).mockResolvedValue(BOOK);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the Portfolio room', () => {
  it('lists recent runs and keeps Compose disabled until two are picked', async () => {
    render(<PortfolioPage host={host} />);
    await waitFor(() => expect(screen.getByTestId('portfolio-run-1')).toBeTruthy());
    expect((screen.getByTestId('portfolio-compose') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('portfolio-check-1'));
    expect((screen.getByTestId('portfolio-compose') as HTMLButtonElement).disabled).toBe(true); // still one
    fireEvent.click(screen.getByTestId('portfolio-check-2'));
    expect((screen.getByTestId('portfolio-compose') as HTMLButtonElement).disabled).toBe(false);
  });

  it('blends the picked runs and renders the combined stats, correlation and contribution', async () => {
    render(<PortfolioPage host={host} />);
    await waitFor(() => expect(screen.getByTestId('portfolio-check-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('portfolio-check-1'));
    fireEvent.click(screen.getByTestId('portfolio-check-2'));
    fireEvent.click(screen.getByTestId('portfolio-compose'));

    await waitFor(() => expect(screen.getByTestId('portfolio-stats')).toBeTruthy());
    // The chosen ids and their (default equal) weights reach the engine seam.
    expect(vi.mocked(composePortfolio)).toHaveBeenCalledWith([1, 2], { '1': 1, '2': 1 });
    expect(screen.getByTestId('portfolio-correlation')).toBeTruthy();
    expect(screen.getByTestId('portfolio-contribution')).toBeTruthy();
    // The combined stats and window read the returned book.
    expect(screen.getByTestId('portfolio-stat-total-return').textContent).toContain('83.00%');
    expect(screen.getByTestId('portfolio-window').textContent).toContain('2020-01-01');
  });
});
