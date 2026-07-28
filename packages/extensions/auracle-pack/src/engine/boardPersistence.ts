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

/**
 * The engine pref that holds every workspace's Board. The engine's settings
 * DEFAULTS must carry this key for a write to be accepted; until it does,
 * saves fail honestly (the store reports the failure) rather than pretending.
 */
export const BOARD_GRAPH_PREF_KEY = 'board_graph';

const SETTINGS_PATH = '/ui/api/settings';

/** Load and save one workspace's serialized graph. */
export interface BoardGraphTransport {
  /** The stored document, or null when the workspace has no Board yet. */
  load(workspaceId: string): Promise<string | null>;
  /** True when the document reached the engine. */
  save(workspaceId: string, json: string): Promise<boolean>;
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

/** The real lane. */
export function engineSettingsTransport(): BoardGraphTransport {
  return {
    async load(workspaceId: string): Promise<string | null> {
      const body = await getJson<SettingsAggregate>(SETTINGS_PATH);
      if (!body) return null;
      return readWorkspaceEntry(body.prefs?.[BOARD_GRAPH_PREF_KEY], workspaceId);
    },

    async save(workspaceId: string, json: string): Promise<boolean> {
      // Read-modify-write: the PUT replaces the pref value wholesale, so the
      // other workspaces' entries have to be re-sent with it.
      const body = await getJson<SettingsAggregate>(SETTINGS_PATH);
      const next = writeWorkspaceEntry(body?.prefs?.[BOARD_GRAPH_PREF_KEY], workspaceId, json);
      const response = await putJson(SETTINGS_PATH, {
        prefs: { [BOARD_GRAPH_PREF_KEY]: next },
      });
      return response.ok;
    },
  };
}
