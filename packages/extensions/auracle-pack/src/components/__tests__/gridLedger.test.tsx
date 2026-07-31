/**
 * The activity ledger — a read-only record of what was done and what it cost.
 *
 *  - it renders stores that already exist: the rows are the operations
 *    journal, the header count is the synthesis budget's month spend. It keeps
 *    no log of its own;
 *  - it is read only. Reversing an action is the Operate room's job; a test
 *    asserts the ledger offers no undo or mutate control, only the disclosure;
 *  - it is closed by default and fetches nothing until opened;
 *  - a row's cost tag is derived: an action that moved capital is flagged, the
 *    rest read free.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  getJson: vi.fn(async () => null),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
}));

import { getJsonDetailed } from '../../engine/client';
import { GridLedger, toRows } from '../grid/GridLedger';
import { engineFeeds, gridVitals } from '../../engine/gridVitals';
import type { OpsEntry } from '../../engine/opsJournal';

function entry(over: Partial<OpsEntry> = {}): OpsEntry {
  return {
    id: '1',
    actor: 'auracle-ai',
    action: 'restart_data_feed',
    target: 'ibkr',
    preState: null,
    inverse: null,
    status: 'applied',
    at: '2026-07-27T09:12:04Z',
    undoneAt: null,
    ...over,
  };
}

function journalBody(entries: Array<Record<string, unknown>>): unknown {
  return { entries };
}

function seedSpend(spent: number | null): void {
  vi.spyOn(engineFeeds, 'getSnapshot').mockReturnValue({
    ...engineFeeds.getSnapshot(),
    budget: spent === null ? null : { cap: 100, spent, paused: false },
  });
}

beforeEach(() => {
  gridVitals.reset();
  vi.mocked(getJsonDetailed).mockResolvedValue({ ok: false, status: 0, body: null } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  gridVitals.reset();
});

describe('toRows', () => {
  it('marks a capital-moving action, and leaves an operational one free', () => {
    const rows = toRows([
      entry({ id: 'a', action: 'redeploy_deployment', target: 'atlas' }),
      entry({ id: 'b', action: 'restart_data_feed', target: 'ibkr' }),
    ]);
    expect(rows.find((r) => r.id === 'a')?.cost).toBe('capital');
    expect(rows.find((r) => r.id === 'b')?.cost).toBe('free');
  });

  it('states time locale-free, what, and undone', () => {
    const [row] = toRows([
      entry({ action: 're_arm_schedule', target: 'eod', undoneAt: '2026-07-27T10:00:00Z' }),
    ]);
    expect(row.at).toBe('2026-07-27 09:12');
    expect(row.what).toBe('re_arm_schedule: eod');
    expect(row.undone).toBe(true);
  });
});

describe('the ledger', () => {
  it('is closed by default and fetches nothing until opened', () => {
    seedSpend(3);
    render(<GridLedger />);
    expect(screen.getByTestId('grid-ledger').getAttribute('data-open')).toBe('closed');
    expect(screen.queryByTestId('grid-ledger-rows')).toBeNull();
    expect(getJsonDetailed).not.toHaveBeenCalled();
  });

  it('shows the month spend from the budget in the header', () => {
    seedSpend(3);
    render(<GridLedger />);
    expect(screen.getByTestId('grid-ledger-toggle').textContent).toContain('3 agent sessions');
  });

  it('reads one session in the singular', () => {
    seedSpend(1);
    render(<GridLedger />);
    expect(screen.getByTestId('grid-ledger-toggle').textContent).toContain('1 agent session this month');
  });

  it('fetches and renders the journal on open, with cost tags', async () => {
    seedSpend(2);
    vi.mocked(getJsonDetailed).mockResolvedValue({
      ok: true,
      status: 200,
      body: journalBody([
        { id: 'a', actor: 'auracle-ai', action: 'redeploy_deployment', target: 'atlas', created_at: '2026-07-27T09:12:04Z', status: 'applied' },
        { id: 'b', actor: 'operator', action: 'restart_data_feed', target: 'ibkr', created_at: '2026-07-26T16:20:00Z', status: 'applied' },
      ]),
    } as never);

    render(<GridLedger />);
    fireEvent.click(screen.getByTestId('grid-ledger-toggle'));

    await waitFor(() => expect(screen.getByTestId('grid-ledger-rows')).toBeTruthy());
    expect(screen.getByTestId('grid-ledger-cost-a').getAttribute('data-cost')).toBe('capital');
    expect(screen.getByTestId('grid-ledger-cost-b').getAttribute('data-cost')).toBe('free');
    expect(getJsonDetailed).toHaveBeenCalledTimes(1);
  });

  it('offers no undo or mutate control — only the disclosure', async () => {
    seedSpend(0);
    vi.mocked(getJsonDetailed).mockResolvedValue({
      ok: true,
      status: 200,
      body: journalBody([
        { id: 'a', actor: 'auracle-ai', action: 'redeploy_deployment', target: 'atlas', created_at: '2026-07-27T09:12:04Z', status: 'applied' },
      ]),
    } as never);

    render(<GridLedger />);
    fireEvent.click(screen.getByTestId('grid-ledger-toggle'));
    await waitFor(() => expect(screen.getByTestId('grid-ledger-rows')).toBeTruthy());

    // The only button in the whole ledger is the open/close toggle.
    const buttons = screen.getByTestId('grid-ledger').querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('data-testid')).toBe('grid-ledger-toggle');
    expect(
      screen.getByTestId('grid-ledger').querySelectorAll('input, select, textarea')
    ).toHaveLength(0);
  });

  it('says plainly when the engine keeps no log', async () => {
    seedSpend(null);
    vi.mocked(getJsonDetailed).mockResolvedValue({ ok: false, status: 404, body: null } as never);
    render(<GridLedger />);
    fireEvent.click(screen.getByTestId('grid-ledger-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('grid-ledger-empty').textContent).toContain('keeps no activity log')
    );
  });
});
