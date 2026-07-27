/**
 * Hub compatibility — the retired two-hub API, kept working over the Grid.
 *
 * The pack briefly shipped two consolidated hub panels (Strategy Lab, Live
 * Desk), each with a tab strip. Both are gone: there is one panel now, and a
 * tab is a ROOM. This module keeps the hub-era surface — `HUB_ALIASES`,
 * `resolveHubAlias`, `openHubTab`, `getActiveHubTab`, `subscribeHubTabs` —
 * exported with the same signatures, forwarding into the Grid's room store so
 * a caller written against the hubs still lands on the surface it asked for.
 *
 * It is a translation layer, nothing more: no state of its own, no second
 * source of truth. New code should call the Grid API (`openGridRoom`,
 * `getActiveRoom`) directly.
 */
import {
  PACK_PREFIX,
  getActiveRoom,
  openRoom,
  subscribeGrid,
} from './grid/gridNav';
import type { RoomId } from './grid/rooms';

export type HubId = 'strategy-lab' | 'live-desk';

/** Absorbed panel id (short form) → the hub + tab that used to own it. */
export const HUB_ALIASES: Record<string, { hub: HubId; tab: string }> = {
  research: { hub: 'strategy-lab', tab: 'research' },
  'qc-import': { hub: 'strategy-lab', tab: 'qc-import' },
  validation: { hub: 'strategy-lab', tab: 'validation' },
  'live-algorithms': { hub: 'live-desk', tab: 'deployments' },
  blotter: { hub: 'live-desk', tab: 'blotter' },
  incidents: { hub: 'live-desk', tab: 'incidents' },
  schedules: { hub: 'live-desk', tab: 'schedules' },
  runway: { hub: 'live-desk', tab: 'runway' },
};

/** Hub tab coordinate (`hub:tab`) → the Grid room that replaced it. */
export const HUB_TAB_ROOMS: Record<string, RoomId> = {
  'strategy-lab:research': 'findings',
  'strategy-lab:qc-import': 'qc',
  'strategy-lab:validation': 'validation',
  'live-desk:deployments': 'deploys',
  'live-desk:blotter': 'blotter',
  'live-desk:incidents': 'incidents',
  'live-desk:schedules': 'schedules',
  'live-desk:runway': 'runway',
};

/** Where a hub landed with no tab named — its old default tab's room. */
const HUB_DEFAULT_ROOMS: Record<HubId, RoomId> = {
  'strategy-lab': 'findings',
  'live-desk': 'deploys',
};

/** Map an old panel id (short or full) to its hub tab; null when it isn't one. */
export function resolveHubAlias(panelId: string): { hub: HubId; tab: string } | null {
  const short = panelId.startsWith(PACK_PREFIX) ? panelId.slice(PACK_PREFIX.length) : panelId;
  return HUB_ALIASES[short] ?? null;
}

/** The room a hub tab now means. Falls back to the hub's own default room. */
export function roomForHubTab(hub: HubId, tab: string): RoomId {
  return HUB_TAB_ROOMS[`${hub}:${tab}`] ?? HUB_DEFAULT_ROOMS[hub];
}

/** Select the room a hub tab became. Signature-compatible with the hub era. */
export function openHubTab(hub: HubId, tab: string): void {
  openRoom(roomForHubTab(hub, tab));
}

/**
 * The tab a hub-era caller would see: the active room's tab when that room
 * belongs to `hub`, else the caller's own fallback — the Grid may well be
 * showing a room that hub never had.
 */
export function getActiveHubTab(hub: HubId, fallback: string): string {
  const room = getActiveRoom();
  if (room === null) return fallback;
  for (const [coordinate, mapped] of Object.entries(HUB_TAB_ROOMS)) {
    const [hubId, tab] = coordinate.split(':');
    if (hubId === hub && mapped === room) return tab;
  }
  return fallback;
}

export function subscribeHubTabs(listener: () => void): () => void {
  return subscribeGrid(listener);
}
