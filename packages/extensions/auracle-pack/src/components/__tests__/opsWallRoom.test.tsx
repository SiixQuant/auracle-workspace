/**
 * Ops wall (Frontier #20): the control-room overview. Pins the two pure rules
 * (worst-health headline, stale-data count) and that the room renders its
 * operate rows + live tiles.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/client')>();
  return { ...actual, dataCatalog: vi.fn() };
});

import { dataCatalog } from '../../engine/client';
import { openGridHome } from '../grid/gridNav';
import { OpsWallPage, staleCount, worst } from '../grid/pages/OpsWallPage';

const catalogMock = dataCatalog as unknown as Mock;
const Page = OpsWallPage as unknown as () => JSX.Element;

afterEach(() => {
  cleanup();
  openGridHome();
  vi.clearAllMocks();
});

describe('worst', () => {
  it('reads the worst of a set of healths', () => {
    expect(worst(['nominal', 'degraded', 'fault'])).toBe('fault');
    expect(worst(['nominal', 'degraded'])).toBe('degraded');
    expect(worst(['nominal', 'nominal'])).toBe('nominal');
  });
});

describe('staleCount', () => {
  it('counts symbols whose last bar is old, skipping the empty ones', () => {
    const fresh = new Date().toISOString().slice(0, 10);
    const cat = {
      enriched: true,
      summary: {} as never,
      symbols: [
        { symbol: 'A', barCount: 100, lastBar: '2000-01-01', exchange: '', assetClass: '', name: null, firstBar: '2000-01-01', gaps: null, source: null, keyed: null },
        { symbol: 'B', barCount: 100, lastBar: fresh, exchange: '', assetClass: '', name: null, firstBar: '2000-01-01', gaps: null, source: null, keyed: null },
        { symbol: 'C', barCount: 0, lastBar: null, exchange: '', assetClass: '', name: null, firstBar: null, gaps: null, source: null, keyed: null },
      ],
    } as never;
    expect(staleCount(cat)).toEqual({ stale: 1, total: 2 }); // A stale, B fresh, C no data
    expect(staleCount(null)).toEqual({ stale: 0, total: 0 });
  });
});

describe('OpsWallPage', () => {
  it('renders the operate rooms and the live tiles', async () => {
    catalogMock.mockResolvedValue(null);
    render(<Page />);
    await waitFor(() => expect(screen.getByTestId('ops-tiles')).toBeTruthy());
    for (const r of ['deploys', 'blotter', 'incidents', 'schedules']) {
      expect(screen.getByTestId(`ops-room-${r}`)).toBeTruthy();
    }
  });
});
