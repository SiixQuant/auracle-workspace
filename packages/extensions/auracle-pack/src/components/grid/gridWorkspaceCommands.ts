/**
 * gridWorkspaceCommands — saved views in the ⌘K palette (Frontier #3).
 *
 * A palette provider over {@link workspaceStore}. It offers three things:
 *   - Save this view — captures the current room + focus as a named workspace.
 *   - Open · <name> — one row per saved workspace, reopens it (room + focus).
 *   - Remove workspace · <name> — one per saved workspace, but only once the
 *     query mentions remove/delete/forget, so the resting palette stays the
 *     save row + the reopen rows (the same query-gating #1's grammar uses).
 *
 * The capture/restore mapping is the palette's existing navigation
 * ({@link getActiveRoom} + {@link openRoomFocused}); this only turns it into
 * saveable rows. {@link workspaceFromView} — how a view becomes a labelled,
 * de-dupable workspace — is pure and unit-tested.
 */
import { focusStore, type Focus } from '../../engine/focusStore';
import { prettifyPath } from '../../engine/humanize';
import { workspaceStore, type Workspace } from '../../engine/workspaceStore';
import { ROOM_ICONS } from './districts';
import { registerCommandProvider, type GridCommand, type GridCommandProvider } from './gridCommands';
import { getActiveRoom, openRoomFocused } from './gridNav';
import { ROOMS, type RoomId } from './rooms';

/** The heading these rows file under in the palette. */
export const WORKSPACE_SECTION = 'Workspaces';

/** A DOM-id-safe token — no dots/colons, so a command id is a usable `#id`. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * A view (room + focus) as a labelled, de-dupable {@link Workspace}. Pure. The
 * label reads "Room · Strategy" (plus the run when a specific backtest is
 * focused); the id folds the same coordinates so re-saving one view upserts
 * rather than piling duplicates.
 */
export function workspaceFromView(room: RoomId, focus: Focus): Workspace {
  const path = focus.strategy?.dottedPath ?? focus.strategy?.filePath;
  const name = path ? (prettifyPath(path) ?? path) : null;
  const runId = focus.run?.kind === 'backtest' ? focus.run.id : undefined;
  const label =
    [ROOMS[room].title, name].filter(Boolean).join(' · ') + (runId ? ` (run ${runId})` : '');
  return { id: `${room}:${path ?? ''}:${runId ?? ''}`, label, room, focus };
}

/** True when the typed query is asking to delete something. */
function wantsRemove(query: string | undefined): boolean {
  const q = (query ?? '').toLowerCase();
  return q.includes('remove') || q.includes('delete') || q.includes('forget');
}

/**
 * The workspace rows for the current state — PURE, so the save/restore/remove
 * offering is unit-tested without the store or the palette. `room` is the active
 * room (null when on the plan itself, where there is no single view to save).
 */
export function buildWorkspaceCommands(
  saved: Workspace[],
  room: RoomId | null,
  focus: Focus,
  query: string | undefined
): GridCommand[] {
  const commands: GridCommand[] = [];

  if (room) {
    const ws = workspaceFromView(room, focus);
    commands.push({
      id: 'workspace-save',
      label: `Save this view · ${ws.label}`,
      icon: 'bookmark_add',
      section: WORKSPACE_SECTION,
      keywords: ['save', 'workspace', 'bookmark', 'view', ws.label],
      run: () => workspaceStore.save(ws),
    });
  }

  for (const ws of saved) {
    commands.push({
      id: `workspace-open-${slug(ws.id)}`,
      label: `Open · ${ws.label}`,
      icon: ROOM_ICONS[ws.room] ?? 'bookmark',
      section: WORKSPACE_SECTION,
      keywords: ['workspace', 'open', 'restore', 'saved', ws.label],
      run: () => openRoomFocused(ws.room, ws.focus),
    });
  }

  if (wantsRemove(query)) {
    for (const ws of saved) {
      commands.push({
        id: `workspace-remove-${slug(ws.id)}`,
        label: `Remove workspace · ${ws.label}`,
        icon: 'bookmark_remove',
        section: WORKSPACE_SECTION,
        badge: 'delete',
        keywords: ['workspace', 'remove', 'delete', 'forget', ws.label],
        run: () => workspaceStore.remove(ws.id),
      });
    }
  }

  return commands;
}

const workspaceProvider: GridCommandProvider = {
  id: 'workspaces',
  list: (context) =>
    buildWorkspaceCommands(workspaceStore.list(), getActiveRoom(), focusStore.getSnapshot(), context.query),
};

registerCommandProvider(workspaceProvider);
