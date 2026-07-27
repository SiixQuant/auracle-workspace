/**
 * Grid navigation — which room is showing, and how every retired panel id
 * still lands on the right one.
 *
 * The pack registers ONE panel. Every id it used to register (and every id
 * absorbed by the two short-lived hubs before that) is declared as a manifest
 * `alias` of that panel, so the HOST resolves an aliased toggle to the Grid.
 * This module is the pack half of the same contract: it maps the alias to a
 * ROOM and selects it, so the surface the caller asked for is the one that
 * appears. Pack-internal launchers (the editor header, the cross-panel
 * hand-offs) call {@link openGridRoom} directly, which also works when the
 * Grid is already open and no host toggle fires.
 *
 * Toggle-vs-navigate: the host reads a request addressed to a panel's OWN id
 * as a toggle (press again to close) and a request addressed to one of its
 * ALIASES as navigation (open, never close). So a hand-off addresses the
 * room's alias id — that is what keeps a second hand-off from closing the
 * Grid out from under the user, with no open/closed flag to keep in sync.
 */
import { isRoomId, type RoomId } from './rooms';

export const PACK_PREFIX = 'com.auracle.pack.';

/** The pack's one registered panel. */
export const GRID_PANEL_ID = `${PACK_PREFIX}grid`;

/**
 * Retired pack panel id (short form) → the room that now owns its surface.
 *
 * Every entry here MUST also be declared as a manifest alias of the Grid (a
 * test holds the two in lockstep) — the pack-side map alone cannot make the
 * host resolve a toggle.
 */
export const ROOM_ALIASES: Record<string, RoomId> = {
  // The panels the pack registered before the hubs.
  research: 'findings',
  'qc-import': 'qc',
  backtest: 'backtest',
  validation: 'validation',
  'live-algorithms': 'deploys',
  blotter: 'blotter',
  incidents: 'incidents',
  schedules: 'schedules',
  runway: 'runway',
  // The two hubs that briefly absorbed them: each lands on the room its own
  // default tab used to show.
  'strategy-lab': 'findings',
  'live-desk': 'deploys',
};

/**
 * The alias a hand-off addresses to reach a room, short form. Only rooms that
 * inherited a retired panel id have one; a room without an alias (`strategies`,
 * `conns` — new with the Grid) is reached through the Grid's own id, which the
 * host treats as a toggle.
 */
const ROOM_ROUTE_ALIASES: Partial<Record<RoomId, string>> = {
  findings: 'research',
  qc: 'qc-import',
  backtest: 'backtest',
  validation: 'validation',
  deploys: 'live-algorithms',
  blotter: 'blotter',
  incidents: 'incidents',
  schedules: 'schedules',
  runway: 'runway',
};

/** Strip the extension namespace, so short and full ids resolve alike. */
function shortId(panelId: string): string {
  return panelId.startsWith(PACK_PREFIX) ? panelId.slice(PACK_PREFIX.length) : panelId;
}

/**
 * The room a panel id addresses — a retired id through the alias table, a room
 * id directly. Null for the Grid's own id (that is "open the Grid", which
 * leaves the current room alone) and for anything else.
 */
export function resolveRoom(panelId: string): RoomId | null {
  const short = shortId(panelId);
  if (short === 'grid') return null;
  const aliased = ROOM_ALIASES[short];
  if (aliased) return aliased;
  return isRoomId(short) ? short : null;
}

/** The full panel id a hand-off dispatches to front `room`. */
export function routeIdForRoom(room: RoomId): string {
  return `${PACK_PREFIX}${ROOM_ROUTE_ALIASES[room] ?? 'grid'}`;
}

/* ── active-room store (session-lived) ──────────────────────────────── */

/** null = the home plan. */
let activeRoom: RoomId | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getActiveRoom(): RoomId | null {
  return activeRoom;
}

/** Select a room inside the Grid. Does not open the panel — see openGridRoom. */
export function openRoom(room: RoomId): void {
  if (activeRoom === room) return;
  activeRoom = room;
  notify();
}

/** Back to the plan. */
export function openGridHome(): void {
  if (activeRoom === null) return;
  activeRoom = null;
  notify();
}

export function subscribeGrid(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Select `room` AND ask the host to front the Grid — the one call every
 * pack-internal hand-off makes. Addressed to the room's alias id so the host
 * navigates rather than toggles (see the file header).
 */
export function openGridRoom(room: RoomId): void {
  openRoom(room);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('nimbalyst:toggle-panel', { detail: { panelId: routeIdForRoom(room) } })
  );
}

/** Window listener: an aliased toggle from anywhere also selects its room. */
function onTogglePanelEvent(event: Event): void {
  const panelId = (event as CustomEvent).detail?.panelId;
  if (typeof panelId !== 'string') return;
  const room = resolveRoom(panelId);
  if (room) openRoom(room);
}

if (typeof window !== 'undefined') {
  window.addEventListener('nimbalyst:toggle-panel', onTogglePanelEvent);
}
