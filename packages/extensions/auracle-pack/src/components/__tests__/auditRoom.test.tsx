/**
 * Audit room (Frontier #17): the browsable surface over the owner-only audit
 * ledger. Pins the column shape and the four states — rows, owner-only,
 * engine-down, and empty.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/client')>();
  return { ...actual, auditLog: vi.fn() };
});

import { auditLog, type AuditEntry } from '../../engine/client';
import { openGridHome } from '../grid/gridNav';
import { AuditPage, auditColumns } from '../grid/pages/AuditPage';

const auditMock = auditLog as unknown as Mock;
const Page = AuditPage as unknown as () => JSX.Element;

afterEach(() => {
  cleanup();
  openGridHome();
  vi.clearAllMocks();
});

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 1,
  ts: '2026-08-11T09:30:00Z',
  event: 'backtest.run',
  detail: 'strategies.x.X · repro a1b2c3d4 · job 42',
  userEmail: 'owner@x.com',
  ...over,
});

describe('auditColumns', () => {
  it('is the four-column ledger shape', () => {
    expect(auditColumns().map((c) => c.key)).toEqual(['when', 'event', 'detail', 'user']);
  });
});

describe('AuditPage', () => {
  it('renders the ledger rows', async () => {
    auditMock.mockResolvedValue({
      kind: 'ok',
      total: 2,
      rows: [entry({ id: 1 }), entry({ id: 2, event: 'login.success' })],
    });
    render(<Page />);
    await screen.findByTestId('audit-grid');
    expect(screen.getByTestId('audit-grid-row-1')).toBeTruthy();
    expect(screen.getByText('backtest.run')).toBeTruthy();
  });

  it('states owner-only when the read is forbidden', async () => {
    auditMock.mockResolvedValue({ kind: 'forbidden' });
    render(<Page />);
    await waitFor(() => expect(screen.getByText('Owner only')).toBeTruthy());
    expect(screen.queryByTestId('audit-grid')).toBeNull();
  });

  it('states engine-down when unavailable', async () => {
    auditMock.mockResolvedValue({ kind: 'unavailable' });
    render(<Page />);
    await waitFor(() => expect(screen.getByText("The engine didn't respond")).toBeTruthy());
  });

  it('shows an empty state with no activity', async () => {
    auditMock.mockResolvedValue({ kind: 'ok', total: 0, rows: [] });
    render(<Page />);
    await waitFor(() => expect(screen.getByText('No activity yet')).toBeTruthy());
  });
});
