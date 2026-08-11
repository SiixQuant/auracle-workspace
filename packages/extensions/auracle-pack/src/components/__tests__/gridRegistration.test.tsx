/**
 * The pack contributes ONE button. That is the point of the consolidation and
 * it is the one thing a manifest edit can quietly undo, so it is asserted from
 * both sides: the manifest the host reads, and the module exports the host
 * mounts. A mismatch between them registers a panel with no component (or
 * ships a component nothing can open).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { panels } from '../../index';
import { ROOM_IDS, ROOM_LIST } from '../grid/rooms';
import { openGridHome, openRoom } from '../grid/gridNav';
import manifest from '../../../manifest.json';

// The rooms with a built page mount their REAL surface, so the seam has to
// cover everything those surfaces reach for on open. Every call answers
// "nothing / unreachable", which is what this file asserts against: the route
// lands on the room whatever the engine is doing.
vi.mock('../../engine/client', () => ({
  authState: vi.fn(async () => ({ signedIn: false })),
  engineConfig: vi.fn(async () => ({ engineUrl: '', hasKey: false })),
  getJson: vi.fn(async () => null),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  dataCatalog: vi.fn(async () => null),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  runBacktest: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  backtestJobStatus: vi.fn(async () => null),
  backtestJobResult: vi.fn(async () => null),
  backtestJobFactors: vi.fn(async () => null),
  resolveRunSource: vi.fn(() => undefined),
  connectCheck: vi.fn(async () => null),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

type ManifestPanel = { id: string; placement: string; aliases?: string[] };
const contributed = (manifest as { contributions: { panels: ManifestPanel[] } }).contributions
  .panels;

const host = { panelId: 'com.auracle.pack.grid', extensionId: 'com.auracle.pack' };

beforeEach(() => {
  // The panel opens on the BOARD in a workspace that has not chosen a face.
  // These are the PLAN's tests, so they say so.
});

afterEach(() => {
  cleanup();
  openGridHome();
});

describe('exactly one panel contribution', () => {
  it('the manifest declares one fullscreen panel', () => {
    expect(contributed).toHaveLength(1);
    expect(contributed[0].id).toBe('grid');
    expect(contributed[0].placement).toBe('fullscreen');
  });

  it('the module exports exactly that panel, with a component', () => {
    expect(Object.keys(panels)).toEqual(['grid']);
    expect(panels.grid.component).toBeTypeOf('function');
  });

  it('the panel carries its own gutter button, which is how it can badge', () => {
    expect(panels.grid.gutterButton).toBeTypeOf('function');
  });

  it('no retired panel is registered — each is an alias instead', () => {
    const registered = Object.keys(panels);
    for (const retired of ['backtest', 'strategy-lab', 'live-desk', 'research']) {
      expect(registered).not.toContain(retired);
      expect(contributed[0].aliases).toContain(retired);
    }
  });
});

describe('the Grid opens on the resting state and routes to a room', () => {
  it('opens on the resting state, not a room', () => {
    const Grid = panels.grid.component;
    render(<Grid host={host as never} />);

    // The panel opens on the stage; rooms are reached on purpose (the palette),
    // not laid out as a plan of tiles.
    expect(screen.getByTestId('grid-resting')).toBeTruthy();
    for (const room of ROOM_LIST) {
      expect(screen.queryByTestId(`grid-room-${room.id}`)).toBeNull();
    }
  });

  it.each(ROOM_IDS)('shows the %s room when it is selected', (roomId) => {
    openRoom(roomId);
    const Grid = panels.grid.component;
    render(<Grid host={host as never} />);

    expect(screen.getByTestId(`grid-room-${roomId}`)).toBeTruthy();
    expect(screen.queryByTestId('grid-resting')).toBeNull();
    // And the way back to the stage is always present.
    expect(screen.getByTestId('grid-back')).toBeTruthy();
  });
});
