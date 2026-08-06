/**
 * Routing is the whole compatibility contract of the consolidation: the pack
 * now registers ONE panel, so every id it ever registered has to land on a
 * room inside the Grid — through the host (manifest aliases), through the
 * toggle event, and through the hub-era API that outside callers still hold.
 *
 * A silent miss here is the expensive kind: an unknown id simply leaves the
 * Grid on whatever room it was showing, so a hand-off would "work" while
 * landing on the wrong surface. These tests pin every id to its room.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  GRID_PANEL_ID,
  PACK_PREFIX,
  ROOM_ALIASES,
  getActiveRoom,
  openGridHome,
  openGridRoom,
  openRoom,
  resolveRoom,
  routeIdForRoom,
} from '../grid/gridNav';
import { ROOMS, ROOM_IDS, type RoomId } from '../grid/rooms';
import {
  HUB_ALIASES,
  HUB_TAB_ROOMS,
  getActiveHubTab,
  openHubTab,
  resolveHubAlias,
} from '../hub';
import manifest from '../../../manifest.json';

type ManifestPanel = { id: string; aliases?: string[] };
const panels = (manifest as { contributions: { panels: ManifestPanel[] } }).contributions.panels;

/** The alias → room table this consolidation implements, as a flat list. */
const ALIAS_TABLE: Array<[string, RoomId]> = [
  ['research', 'findings'],
  ['qc-import', 'qc'],
  ['tearsheet', 'strategy'],
  ['backtest', 'backtest'],
  ['validation', 'validation'],
  ['live-algorithms', 'deploys'],
  ['blotter', 'blotter'],
  ['incidents', 'incidents'],
  ['schedules', 'schedules'],
  ['runway', 'runway'],
  ['strategy-lab', 'findings'],
  ['live-desk', 'deploys'],
];

afterEach(() => {
  openGridHome();
});

describe('every retired panel id resolves to a room', () => {
  it.each(ALIAS_TABLE)('%s → %s, in short and full form', (alias, room) => {
    expect(resolveRoom(alias)).toBe(room);
    expect(resolveRoom(`${PACK_PREFIX}${alias}`)).toBe(room);
  });

  it('the alias table covers exactly the retired ids — no more, no fewer', () => {
    expect(Object.keys(ROOM_ALIASES).sort()).toEqual(ALIAS_TABLE.map(([a]) => a).sort());
  });

  it('resolves a room id addressed directly', () => {
    for (const id of ROOM_IDS) expect(resolveRoom(`${PACK_PREFIX}${id}`)).toBe(id);
  });

  it('the Grid\'s own id and foreign ids resolve to no room', () => {
    // The panel's own id means "open the Grid", which must leave the showing
    // room alone rather than silently bouncing the user to a default.
    expect(resolveRoom(GRID_PANEL_ID)).toBeNull();
    expect(resolveRoom('grid')).toBeNull();
    expect(resolveRoom('com.other.ext.blotter')).toBeNull();
    expect(resolveRoom('com.other.ext.research-tools')).toBeNull();
  });

  it('every alias points at a room that exists', () => {
    for (const room of Object.values(ROOM_ALIASES)) expect(ROOMS[room]).toBeDefined();
  });

  it('no room is orphaned — each is reachable from the plan or an alias', () => {
    // `strategies` is new with the Grid and has no retired id; every other
    // room must be reachable by the id it inherited.
    const aliased = new Set(Object.values(ROOM_ALIASES));
    const unaliased = ROOM_IDS.filter(id => !aliased.has(id));
    expect(unaliased).toEqual(['strategies']);
  });
});

describe('manifest and the pack-side table stay in lockstep', () => {
  it('the rail declares exactly one panel: the Grid', () => {
    expect(panels.map(p => p.id)).toEqual(['grid']);
  });

  it('every manifest alias is in the room table, and every room alias is declared', () => {
    const declared = panels[0].aliases ?? [];
    expect([...declared].sort()).toEqual(Object.keys(ROOM_ALIASES).sort());
  });

  it('no alias collides with the panel id it belongs to', () => {
    expect(panels[0].aliases).not.toContain('grid');
  });
});

describe('the toggle-panel event selects the room it addresses', () => {
  function toggle(panelId: string): void {
    window.dispatchEvent(new CustomEvent('nimbalyst:toggle-panel', { detail: { panelId } }));
  }

  it.each(ALIAS_TABLE)('a toggle of %s shows the %s room', (alias, room) => {
    toggle(`${PACK_PREFIX}${alias}`);
    expect(getActiveRoom()).toBe(room);
  });

  it('a toggle of the Grid itself leaves the showing room alone', () => {
    openRoom('incidents');
    toggle(GRID_PANEL_ID);
    expect(getActiveRoom()).toBe('incidents');
  });

  it('ignores a malformed event', () => {
    openRoom('blotter');
    window.dispatchEvent(new CustomEvent('nimbalyst:toggle-panel', { detail: {} }));
    expect(getActiveRoom()).toBe('blotter');
  });
});

describe('openGridRoom addresses an id the host will navigate, not toggle', () => {
  it('dispatches the room\'s alias id, which round-trips back to the room', () => {
    const seen: string[] = [];
    const listener = (e: Event) => {
      const id = (e as CustomEvent).detail?.panelId;
      if (typeof id === 'string') seen.push(id);
    };
    window.addEventListener('nimbalyst:toggle-panel', listener);
    try {
      openGridRoom('deploys');
      openGridRoom('backtest');
    } finally {
      window.removeEventListener('nimbalyst:toggle-panel', listener);
    }

    // An ALIAS id, never the Grid's own id: the host reads a request addressed
    // to a panel's own id as a toggle, which would close the Grid on the second
    // hand-off.
    expect(seen).toEqual([`${PACK_PREFIX}live-algorithms`, `${PACK_PREFIX}backtest`]);
    for (const id of seen) expect(id).not.toBe(GRID_PANEL_ID);
    expect(getActiveRoom()).toBe('backtest');
  });

  it('every room that inherited an id routes through that id', () => {
    for (const id of ROOM_IDS) {
      const routeId = routeIdForRoom(id);
      if (routeId === GRID_PANEL_ID) continue; // a room with no retired id
      expect(resolveRoom(routeId)).toBe(id);
    }
  });
});

describe('the hub-era API keeps working over the Grid', () => {
  it('resolveHubAlias still answers with the hub coordinate it always did', () => {
    expect(resolveHubAlias('blotter')).toEqual({ hub: 'live-desk', tab: 'blotter' });
    expect(resolveHubAlias(`${PACK_PREFIX}research`)).toEqual({
      hub: 'strategy-lab',
      tab: 'research',
    });
    expect(resolveHubAlias('com.other.ext.blotter')).toBeNull();
  });

  it.each(Object.entries(HUB_ALIASES))(
    'openHubTab for the %s tab lands on its room',
    (alias, target) => {
      openHubTab(target.hub, target.tab);
      expect(getActiveRoom()).toBe(ROOM_ALIASES[alias]);
    }
  );

  it('every hub tab — including ones no alias points at — maps to a room', () => {
    for (const [coordinate, room] of Object.entries(HUB_TAB_ROOMS)) {
      const [hub, tab] = coordinate.split(':');
      openGridHome();
      openHubTab(hub as 'strategy-lab' | 'live-desk', tab);
      expect(getActiveRoom()).toBe(room);
    }
  });

  it('an unknown tab falls back to the hub\'s own default room', () => {
    openHubTab('live-desk', 'no-such-tab');
    expect(getActiveRoom()).toBe('deploys');
    openHubTab('strategy-lab', 'no-such-tab');
    expect(getActiveRoom()).toBe('findings');
  });

  it('getActiveHubTab reports the showing room as its hub tab, else the fallback', () => {
    openRoom('blotter');
    expect(getActiveHubTab('live-desk', 'deployments')).toBe('blotter');
    // The Grid is showing a room that hub never had — the caller's fallback
    // is the only honest answer.
    expect(getActiveHubTab('strategy-lab', 'research')).toBe('research');
    openGridHome();
    expect(getActiveHubTab('live-desk', 'deployments')).toBe('deployments');
  });
});
