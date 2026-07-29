/**
 * Where a Board is kept: the engine's synced settings lane.
 *
 * `GET /ui/api/settings` returns one aggregate of install config including a
 * `prefs` bag; `PUT /ui/api/settings` writes `{prefs: {...}}` key by key. The
 * pack already talks to that lane through the main-process bridge for every
 * other engine call, so a Board saved from one window is readable by the next
 * window that opens the workspace — which is the whole acceptance for Board
 * persistence, and the reason this is not local storage.
 *
 * ## One pref key, a map inside it
 * The engine validates pref names against a fixed list, so a key per workspace
 * is not available: {@link BOARD_GRAPH_PREF_KEY} holds a map of workspace id to
 * that workspace's serialized graph. Reading picks one entry, writing replaces
 * one entry and carries every other entry through untouched — including entries
 * this build cannot parse, which belong to a workspace it has never opened.
 * Nothing here merges graphs; a workspace's entry is an opaque string to
 * everyone but that workspace.
 *
 * ## Two ways a save can fail, and they are not the same news
 * An engine that predates {@link BOARD_GRAPH_PREF_KEY} validates the key
 * against its own defaults and ANSWERS with a client error. That is a build
 * older than this one, and updating it is the whole fix. An engine that is not
 * running answers nothing at all, and there is nothing to fix but time. The
 * lane therefore returns the engine's own status and words rather than a
 * boolean ({@link BoardSaveReply}), and {@link classifySave} reduces that to
 * the three words a person can act on. Collapsing both into "failed" is how the
 * Board once told a first-time user their work was at risk when it was not.
 *
 * ## The local copy is a floor, never a source of truth
 * Because a refused write means the engine is holding NOTHING, the last
 * document this window wrote is also kept in the renderer's own storage. It is
 * read only when the engine has no entry for the workspace, so an engine that
 * can store the Board always wins and two windows still agree; and it is what
 * lets the Board promise that a board built against an older engine is still
 * there tomorrow.
 *
 * ## Why no If-Match etag
 * The lane offers optimistic concurrency over the WHOLE config. A Board save is
 * one pref among brokers, data keys and model selection, so an etag would turn
 * an unrelated settings change in another window into a rejected Board write.
 * The PUT updates only the keys it is given, so last-writer-wins on this one
 * key is the honest behavior, and the store re-reads on refresh anyway.
 *
 * The transport is an interface, not a hard dependency: the store takes one,
 * the tests hand it a mock, and the agent bridge can later hand it something
 * else without the graph model knowing.
 */
import { getJson, putJson } from './client';
import { readRejection } from './confirm';

/**
 * The engine pref that holds every workspace's Board. The engine's settings
 * DEFAULTS must carry this key for a write to be accepted; until it does,
 * saves fail honestly (the store reports the failure) rather than pretending.
 */
export const BOARD_GRAPH_PREF_KEY = 'board_graph';

const SETTINGS_PATH = '/ui/api/settings';

/** What the lane said about one write. */
export interface BoardSaveReply {
  /** True when the document reached the engine. */
  ok: boolean;
  /** The HTTP status it answered with. 0 when nothing answered at all. */
  status: number;
  /** The engine's own words for a refusal, when it gave any. */
  message?: string | null;
}

/**
 * A save's answer: a plain yes or no from a transport that knows only whether
 * the write landed, or the lane's own reply when it knows more. Both are
 * accepted so a caller with nothing to add — a test double, an in-memory
 * mirror — does not have to invent a status.
 */
export type BoardSaveResult = boolean | BoardSaveReply;

/**
 * Why a Board is not on the engine, in the only three shapes worth telling
 * somebody apart.
 *
 * `engine-behind` is deliberately the NARROW one: it is claimed only when the
 * engine answered and refused the write on its own terms. A rejected
 * credential, a timeout, a rate limit or a server fault all say nothing about
 * which build is installed, so they read as `offline` and get the message that
 * asks for patience rather than the one that asks for an update.
 */
export type BoardSyncState = 'synced' | 'offline' | 'engine-behind';

/**
 * Client errors that are about the CALLER or the moment rather than about this
 * build's vocabulary. None of them means the engine is old.
 */
const NOT_A_BUILD_REFUSAL = new Set([401, 402, 403, 407, 408, 423, 425, 429]);

/** Read a save's answer as one of the three states. */
export function classifySave(result: BoardSaveResult): BoardSyncState {
  if (typeof result === 'boolean') return result ? 'synced' : 'offline';
  if (result.ok) return 'synced';
  const { status } = result;
  return status >= 400 && status < 500 && !NOT_A_BUILD_REFUSAL.has(status)
    ? 'engine-behind'
    : 'offline';
}

/** Load and save one workspace's serialized graph. */
export interface BoardGraphTransport {
  /** The stored document, or null when the workspace has no Board yet. */
  load(workspaceId: string): Promise<string | null>;
  /** Whether the document reached the engine, and what it said if not. */
  save(workspaceId: string, json: string): Promise<BoardSaveResult>;
}

interface SettingsAggregate {
  prefs?: Record<string, unknown>;
}

function asMap(pref: unknown): Record<string, unknown> {
  // The pref may arrive as an object or, from an older writer, as a JSON
  // string of one. Both are read; neither is rejected.
  let value = pref;
  if (typeof value === 'string') {
    if (value.trim() === '') return {};
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** One workspace's entry out of the pref map, or null when it has none. */
export function readWorkspaceEntry(pref: unknown, workspaceId: string): string | null {
  const entry = asMap(pref)[workspaceId];
  if (typeof entry === 'string') return entry;
  // An entry stored as an object (a future writer's shape) is still readable —
  // the graph parser takes either.
  if (entry && typeof entry === 'object') return JSON.stringify(entry);
  return null;
}

/**
 * The pref map with one workspace's entry replaced. Every other workspace's
 * entry is carried through byte for byte: a Board save must never be able to
 * damage a Board the user is not looking at.
 */
export function writeWorkspaceEntry(
  pref: unknown,
  workspaceId: string,
  json: string
): Record<string, unknown> {
  return { ...asMap(pref), [workspaceId]: json };
}

/* ── the local floor ─────────────────────────────────────────────────────── */

/** Where this window's last written document is kept. Same map shape as the
 *  pref, so one pair of readers serves both. */
export const BOARD_GRAPH_LOCAL_KEY = 'auracle.board_graph';

/** The renderer's storage, or null wherever there is none to have. */
function localStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null);
  } catch {
    // A renderer with storage disabled throws on the property itself.
    return null;
  }
}

/** The document this window last wrote for `workspaceId`, if any. */
export function readLocalCopy(workspaceId: string): string | null {
  const store = localStore();
  if (!store) return null;
  try {
    return readWorkspaceEntry(store.getItem(BOARD_GRAPH_LOCAL_KEY), workspaceId);
  } catch {
    return null;
  }
}

/**
 * Keep the document locally as well. Called on every write attempt, accepted
 * or not: the refused one is exactly the case the copy exists for.
 */
export function writeLocalCopy(workspaceId: string, json: string): void {
  const store = localStore();
  if (!store) return;
  try {
    const held = store.getItem(BOARD_GRAPH_LOCAL_KEY);
    store.setItem(BOARD_GRAPH_LOCAL_KEY, JSON.stringify(writeWorkspaceEntry(held, workspaceId, json)));
  } catch {
    // A full or disabled store is not a reason to fail a write the engine took.
  }
}

/* ── the real lane ───────────────────────────────────────────────────────── */

export function engineSettingsTransport(): BoardGraphTransport {
  return {
    async load(workspaceId: string): Promise<string | null> {
      const body = await getJson<SettingsAggregate>(SETTINGS_PATH);
      const stored = body
        ? readWorkspaceEntry(body.prefs?.[BOARD_GRAPH_PREF_KEY], workspaceId)
        : null;
      // The engine wins whenever it HAS something: the local copy is a floor
      // under an engine that cannot hold a Board, never an override of one
      // that can.
      return stored ?? readLocalCopy(workspaceId);
    },

    async save(workspaceId: string, json: string): Promise<BoardSaveResult> {
      // Read-modify-write: the PUT replaces the pref value wholesale, so the
      // other workspaces' entries have to be re-sent with it.
      const body = await getJson<SettingsAggregate>(SETTINGS_PATH);
      const next = writeWorkspaceEntry(body?.prefs?.[BOARD_GRAPH_PREF_KEY], workspaceId, json);
      const response = await putJson(SETTINGS_PATH, {
        prefs: { [BOARD_GRAPH_PREF_KEY]: next },
      });
      writeLocalCopy(workspaceId, json);
      if (response.ok) return { ok: true, status: response.status };
      return { ok: false, status: response.status, message: readRejection(response.body).message };
    },
  };
}
