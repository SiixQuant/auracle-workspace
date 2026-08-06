/**
 * The Trades view of the strategy tearsheet (WS-G / FR-G1, FR-G2, AC-6).
 *
 * Two promises are pinned. FIELDS: each row shows exactly the record's real
 * fields — symbol, a long/short side chip, the hold, the entry→exit window, and
 * the position's CONTRIBUTION (labelled as such, never a return/P&L, no dollar
 * figure). HONESTY (INV-2): a row whose record carries SignalFacts expands to a
 * thesis composed from them; a row that logged NO signal shows a facts-only rest
 * — the quiet "no logged signal" note, never a fabricated sentence.
 *
 * The fetch seam is `client.tearsheetTrades`; mocking it stands in for a
 * synthetic `/trades` without a live engine. Plotly is mocked because the shared
 * StrategyPage module imports the Overview chart.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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

import {
  tearsheetFactors,
  tearsheetResult,
  tearsheetRuns,
  tearsheetTrades,
  type BacktestResultBody,
  type TradesBody,
} from '../../engine/client';
import { focusStore } from '../../engine/focusStore';
import { StrategyPage } from '../grid/pages/StrategyPage';

const host = { panelId: 'com.auracle.pack.grid', extensionId: 'com.auracle.pack' } as never;

/** A minimal Overview payload so the mount-time Overview fetch doesn't error
 *  before the test switches to the Trades view. */
const RESULT: BacktestResultBody = { status: 'succeeded', chartable: false, stats: {} };

/** Two records: a long with a logged MA-cross signal, and a short that logged
 *  none (the facts-only case). */
const TRADES: TradesBody = {
  status: 'succeeded',
  trades: [
    {
      symbol: 'QQQ',
      side: 'long',
      entry_date: '2024-02-03',
      exit_date: '2024-03-21',
      hold_days: 47,
      contribution_pct: 6.2,
      signals: [{ rule: 'ma_cross_20_50', values: { crossed: true, gap_pct: 0.031 } }],
    },
    {
      symbol: 'XLE',
      side: 'short',
      entry_date: '2024-08-12',
      exit_date: '2024-08-27',
      hold_days: 15,
      contribution_pct: -2.4,
      signals: [],
    },
  ],
};

beforeEach(() => {
  vi.mocked(tearsheetResult).mockResolvedValue(RESULT);
  vi.mocked(tearsheetFactors).mockResolvedValue(null);
  vi.mocked(tearsheetTrades).mockResolvedValue(TRADES);
  vi.mocked(tearsheetRuns).mockResolvedValue([]);
  focusStore.publish({ run: { kind: 'backtest', id: '42' } });
});

afterEach(() => {
  cleanup();
  focusStore.clear();
  vi.clearAllMocks();
});

async function openTrades(): Promise<void> {
  render(<StrategyPage host={host} />);
  fireEvent.click(screen.getByTestId('tearsheet-tab-trades'));
  await waitFor(() => expect(screen.getByTestId('tearsheet-trades-summary')).toBeTruthy());
}

describe('the Trades table lists the real per-trade fields (FR-G1)', () => {
  it('fetches the focused run and renders symbol, side, hold and contribution per row', async () => {
    await openTrades();
    expect(vi.mocked(tearsheetTrades)).toHaveBeenCalledWith(42);

    expect(screen.getByTestId('tearsheet-trade-symbol-0').textContent).toBe('QQQ');
    expect(screen.getByTestId('tearsheet-trade-side-0').textContent).toBe('long');
    expect(screen.getByTestId('tearsheet-trade-0').getAttribute('data-side')).toBe('long');
    expect(screen.getByTestId('tearsheet-trade-hold-0').textContent).toBe('47 days');
    expect(screen.getByTestId('tearsheet-trade-range-0').textContent).toBe('Feb 3 → Mar 21 ’24');
    // Contribution, not a return/P&L — signed percent, no dollar figure.
    expect(screen.getByTestId('tearsheet-trade-contribution-0').textContent).toBe('+6.20%');

    expect(screen.getByTestId('tearsheet-trade-symbol-1').textContent).toBe('XLE');
    expect(screen.getByTestId('tearsheet-trade-side-1').textContent).toBe('short');
    expect(screen.getByTestId('tearsheet-trade-contribution-1').textContent).toBe('-2.40%');
  });

  it('summarizes only honestly-computable stats: count, long/short, avg hold, positive share', async () => {
    await openTrades();
    const summary = screen.getByTestId('tearsheet-trades-summary');
    const text = summary.textContent ?? '';
    expect(text).toContain('2 trades');
    expect(text).toContain('50% long');
    expect(text).toContain('50% short');
    expect(text).toContain('avg hold 31d'); // (47 + 15) / 2
    expect(text).toContain('50% positive'); // 1 of 2 contributed positively
    // No "win rate" / profit factor — those need a per-trade P&L the record lacks.
    expect(text.toLowerCase()).not.toContain('win rate');
    expect(text.toLowerCase()).not.toContain('profit factor');
  });

  it('does not fetch trades until the Trades view is opened (lazy)', async () => {
    render(<StrategyPage host={host} />);
    await waitFor(() => expect(vi.mocked(tearsheetResult)).toHaveBeenCalled());
    expect(vi.mocked(tearsheetTrades)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('tearsheet-tab-trades'));
    await waitFor(() => expect(vi.mocked(tearsheetTrades)).toHaveBeenCalledWith(42));
  });
});

describe('a row expands to its thesis, composed from SignalFacts (FR-G2, INV-2)', () => {
  it('renders the composed clause for a row that logged a signal', async () => {
    await openTrades();
    expect(screen.queryByTestId('tearsheet-trade-thesis-0')).toBeNull();

    fireEvent.click(screen.getByTestId('tearsheet-trade-0'));
    const thesis = await screen.findByTestId('tearsheet-trade-thesis-0');
    expect(screen.getByTestId('tearsheet-trade-clause-0-0').textContent).toBe(
      '20/50 MA cross · gap +3.1%'
    );
    // No fabricated narrative — only the composed clause, and no "no signal" note.
    expect(within(thesis).queryByTestId('tearsheet-trade-nosignal-0')).toBeNull();
    expect(screen.getByTestId('tearsheet-trade-0').getAttribute('aria-expanded')).toBe('true');
  });

  it('shows a facts-only note (no fabricated thesis) for a row with signals:[]', async () => {
    await openTrades();
    fireEvent.click(screen.getByTestId('tearsheet-trade-1'));

    const thesis = await screen.findByTestId('tearsheet-trade-thesis-1');
    expect(screen.getByTestId('tearsheet-trade-nosignal-1').textContent).toBe(
      'No logged signal for this entry.'
    );
    // Crucially: no composed clause was invented for the unannotated entry.
    expect(within(thesis).queryByTestId('tearsheet-trade-clause-1-0')).toBeNull();
  });

  it('toggles a row shut again', async () => {
    await openTrades();
    fireEvent.click(screen.getByTestId('tearsheet-trade-0'));
    await screen.findByTestId('tearsheet-trade-thesis-0');
    fireEvent.click(screen.getByTestId('tearsheet-trade-0'));
    await waitFor(() => expect(screen.queryByTestId('tearsheet-trade-thesis-0')).toBeNull());
  });
});

describe('honest rests', () => {
  it('shows a load-failure rest when the engine does not answer', async () => {
    vi.mocked(tearsheetTrades).mockResolvedValue(null);
    render(<StrategyPage host={host} />);
    fireEvent.click(screen.getByTestId('tearsheet-tab-trades'));
    await waitFor(() => expect(screen.getByText('Trades could not be loaded')).toBeTruthy());
    expect(screen.queryByTestId('tearsheet-trades-summary')).toBeNull();
  });

  it('shows an empty rest for a run that closed no positions', async () => {
    vi.mocked(tearsheetTrades).mockResolvedValue({ status: 'succeeded', trades: [] });
    render(<StrategyPage host={host} />);
    fireEvent.click(screen.getByTestId('tearsheet-tab-trades'));
    await waitFor(() => expect(screen.getByTestId('tearsheet-trades-empty')).toBeTruthy());
  });
});
