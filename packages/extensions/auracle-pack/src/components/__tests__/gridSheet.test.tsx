/**
 * The Grid sheet is the home a person lands on, so what it claims has to be
 * true the moment it paints and true again the moment a source moves. These
 * pin the four things that make it a plan rather than a picture:
 *
 *  - the whole floor is present on the FIRST frame, with no fetch awaited;
 *  - a room's dot and note follow its source, and say nothing before it answers;
 *  - a district flags itself the moment any room inside it faults — which is
 *    what makes the failing state identifiable with zero clicks;
 *  - pressing a room routes through the existing gridNav.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const stub = vi.hoisted(() => ({ feeds: {} as Record<string, unknown> }));

vi.mock('../../engine/client', () => ({
  getJson: vi.fn(async (path: string) => {
    for (const [prefix, body] of Object.entries(stub.feeds)) {
      if (path.startsWith(prefix)) return body;
    }
    return null;
  }),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import { GridSheet } from '../grid/GridSheet';
import { DISTRICTS } from '../grid/districts';
import { ROOM_IDS } from '../grid/rooms';
import { getActiveRoom, openGridHome } from '../grid/gridNav';
import { alertStore } from '../../engine/alertStore';
import { gridVitals } from '../../engine/gridVitals';
import { deploymentsBlock, summaryBody } from '../../engine/__tests__/summaryFixture';

/** A deployment row shaped as the engine serves it. */
function deployment(id: number, state: string): Record<string, unknown> {
  return {
    id,
    name: `strategy-${id}`,
    strategy_path: `strategies.s${id}.S`,
    broker: 'paper',
    mode: 'paper',
    state,
    positions: [],
  };
}

/** The engine's consolidated call, describing `rows`, plus the naming read the
 *  sheet follows it with when one of them is errored. */
function serveDeployments(rows: Array<Record<string, unknown>>): void {
  stub.feeds['/ui/api/summary'] = summaryBody({
    deployments: deploymentsBlock(rows as Array<{ state: string }>),
  });
  stub.feeds['/deployments'] = rows;
}

/** Let every pending read land, inside act, so React sees one settled frame. */
async function settle(): Promise<void> {
  await act(async () => {
    await gridVitals.refresh();
  });
}

beforeEach(() => {
  stub.feeds = {};
  gridVitals.reset();
});

afterEach(async () => {
  cleanup();
  openGridHome();
  stub.feeds = {};
  // Drop the module-level readings so the next test starts from quiet.
  await alertStore.refresh();
  gridVitals.reset();
});

describe('the sheet lays out the whole floor', () => {
  it('renders four districts and eleven rooms on the first frame', () => {
    // No await: everything below is asserted against the synchronous first
    // paint, which is the point — the plan is never gated on a round-trip.
    render(<GridSheet />);

    expect(DISTRICTS).toHaveLength(4);
    for (const district of DISTRICTS) {
      expect(screen.getByTestId(`grid-district-${district.id}`)).toBeTruthy();
      expect(screen.getByTestId(`grid-district-summary-${district.id}`)).toBeTruthy();
    }

    expect(ROOM_IDS).toHaveLength(11);
    for (const id of ROOM_IDS) {
      expect(screen.getByTestId(`grid-home-room-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`grid-home-dot-${id}`)).toBeTruthy();
    }
    expect(screen.getByTestId('grid-root')).toBeTruthy();
  });

  it('houses every registered room in exactly one district', () => {
    const housed = DISTRICTS.flatMap((district) => district.rooms);
    expect([...housed].sort()).toEqual([...ROOM_IDS].sort());
    expect(new Set(housed).size).toBe(housed.length);
  });

  it('says nothing it cannot back before a source answers', async () => {
    render(<GridSheet />);
    await settle(); // every feed is absent, so every reading stays quiet

    for (const id of ROOM_IDS) {
      expect(screen.getByTestId(`grid-home-dot-${id}`).getAttribute('data-health')).toBe('nominal');
    }
    // Rooms fed only by an unanswered route carry no note at all.
    expect(screen.queryByTestId('grid-home-note-deploys')).toBeNull();
    expect(screen.queryByTestId('grid-home-note-conns')).toBeNull();
    expect(screen.getByTestId('grid-district-summary-research').textContent).toBe('no readings yet');
  });
});

describe('a room follows its source', () => {
  it('takes its dot and note from the deployments feed when it lands', async () => {
    render(<GridSheet />);
    await settle();
    expect(screen.queryByTestId('grid-home-note-deploys')).toBeNull();

    serveDeployments([deployment(1, 'running'), deployment(2, 'running')]);
    await settle();

    expect(screen.getByTestId('grid-home-dot-deploys').getAttribute('data-health')).toBe('nominal');
    expect(screen.getByTestId('grid-home-note-deploys').textContent).toBe('2 running of 2');
  });

  it('turns the dot red and re-reads the note when a deployment errors', async () => {
    serveDeployments([deployment(1, 'running'), deployment(2, 'running')]);
    render(<GridSheet />);
    await settle();
    expect(screen.getByTestId('grid-home-dot-deploys').getAttribute('data-health')).toBe('nominal');

    serveDeployments([deployment(1, 'running'), deployment(2, 'errored')]);
    await settle();

    expect(screen.getByTestId('grid-home-dot-deploys').getAttribute('data-health')).toBe('fault');
    expect(screen.getByTestId('grid-home-note-deploys').textContent).toBe('1 running · 1 errored');
  });

  it('reads open incidents from the same figure the rail badge badges', async () => {
    stub.feeds['/ui/api/summary'] = summaryBody();
    render(<GridSheet />);
    await settle();
    expect(screen.getByTestId('grid-home-note-incidents').textContent).toBe('none open');

    stub.feeds['/ui/api/summary'] = summaryBody({ open_alerts: 2 });
    await settle();

    expect(screen.getByTestId('grid-home-dot-incidents').getAttribute('data-health')).toBe('fault');
    expect(screen.getByTestId('grid-home-note-incidents').textContent).toBe('2 open');
    // The badge reads the very same figure, so the two cannot disagree.
    await alertStore.refresh();
    expect(alertStore.getSnapshot()).toBe(2);
  });

  it('drops a reading back to quiet when its source stops answering', async () => {
    stub.feeds['/ui/api/summary'] = summaryBody({ schedules: { total: 2, active: 1 } });
    render(<GridSheet />);
    await settle();
    expect(screen.getByTestId('grid-home-note-schedules').textContent).toBe('1 enabled of 2');

    // The engine goes away: the sheet must not keep showing the last number.
    stub.feeds = {};
    await settle();
    expect(screen.queryByTestId('grid-home-note-schedules')).toBeNull();
  });

  it('goes quiet for a district the engine itself could not read', async () => {
    stub.feeds['/ui/api/summary'] = summaryBody({ schedules: { total: 2, active: 1 } });
    render(<GridSheet />);
    await settle();
    expect(screen.getByTestId('grid-home-note-schedules').textContent).toBe('1 enabled of 2');

    // The engine answered, but that one district's own read failed. A null
    // block is quiet, never a zero dressed up as news.
    stub.feeds['/ui/api/summary'] = summaryBody({ schedules: null, degraded: ['schedules'] });
    await settle();
    expect(screen.queryByTestId('grid-home-note-schedules')).toBeNull();
    expect(screen.getByTestId('grid-home-dot-schedules').getAttribute('data-health')).toBe('nominal');
  });
});

describe('a district reports the worst room it contains', () => {
  it('raises a flag when a contained room faults, and only on that district', async () => {
    render(<GridSheet />);
    await settle();
    expect(screen.queryByTestId('grid-district-flag-operate')).toBeNull();

    serveDeployments([deployment(1, 'errored')]);
    await settle();

    const flag = screen.getByTestId('grid-district-flag-operate');
    expect(flag.getAttribute('data-health')).toBe('fault');
    expect(screen.getByTestId('grid-district-operate').getAttribute('data-health')).toBe('fault');
    // The districts that own no failing room stay unflagged.
    for (const quiet of ['research', 'build-test', 'system']) {
      expect(screen.queryByTestId(`grid-district-flag-${quiet}`)).toBeNull();
    }
  });

  it('composes its summary from the rooms that actually answered', async () => {
    serveDeployments([deployment(1, 'running')]);
    stub.feeds['/ui/api/orders'] = { orders: [{ symbol: 'AAPL' }, { symbol: 'MSFT' }] };
    render(<GridSheet />);
    await settle();

    const summary = screen.getByTestId('grid-district-summary-operate').textContent ?? '';
    expect(summary).toContain('1 running');
    expect(summary).toContain('2 orders');
    // Nothing scheduled and no open incidents contribute no figure — the line
    // carries readings, not zeros.
    expect(summary).not.toContain('0 ');
  });

  it('counts the rooms needing attention on the root node', async () => {
    serveDeployments([deployment(1, 'errored')]);
    render(<GridSheet />);
    await settle();

    expect(screen.getByTestId('grid-root').getAttribute('data-attention')).toBe('1');
    expect(screen.getByTestId('grid-root').textContent).toContain('1 needs attention');
  });
});

describe('pressing a room routes through gridNav', () => {
  it.each(ROOM_IDS)('opens the %s room', (id) => {
    render(<GridSheet />);
    fireEvent.click(screen.getByTestId(`grid-home-room-${id}`));
    expect(getActiveRoom()).toBe(id);
  });
});
