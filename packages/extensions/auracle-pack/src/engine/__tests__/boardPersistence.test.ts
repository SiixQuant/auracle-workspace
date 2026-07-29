import { afterEach, describe, expect, it } from 'vitest';

import {
  BOARD_GRAPH_LOCAL_KEY,
  BOARD_GRAPH_PREF_KEY,
  classifySave,
  engineSettingsTransport,
  readLocalCopy,
  readWorkspaceEntry,
  writeLocalCopy,
  writeWorkspaceEntry,
} from '../boardPersistence';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/**
 * Stub the main-process engine bridge with a settings lane that remembers its
 * prefs, so the transport is exercised through the real client rather than
 * around it.
 */
function installLane(prefs: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const state = { prefs: { ...prefs }, refuse: false };
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    invoke: async (channel: string, method: string, path: string, body: unknown) => {
      if (channel !== 'auracle:engine-request') return null;
      calls.push({ method, path, body });
      if (method === 'GET') {
        return { ok: true, status: 200, body: { prefs: state.prefs, etag: 'abc' } };
      }
      if (method === 'PUT') {
        if (state.refuse) return { ok: false, status: 400, body: { detail: 'unknown setting' } };
        const next = (body as { prefs?: Record<string, unknown> }).prefs ?? {};
        state.prefs = { ...state.prefs, ...next };
        return { ok: true, status: 200, body: { changed: Object.keys(next) } };
      }
      return { ok: false, status: 405, body: null };
    },
  };
  return { calls, state };
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  window.localStorage.removeItem(BOARD_GRAPH_LOCAL_KEY);
});

/* ── the pref map ────────────────────────────────────────────────────────── */

describe('one pref key, a workspace map inside it', () => {
  it('reads the entry for the workspace asked about', () => {
    const pref = { 'ws-a': '{"nodes":[]}', 'ws-b': '{"nodes":[1]}' };
    expect(readWorkspaceEntry(pref, 'ws-a')).toBe('{"nodes":[]}');
    expect(readWorkspaceEntry(pref, 'ws-missing')).toBeNull();
  });

  it('reads a map that arrived as a JSON string, and shrugs off anything else', () => {
    expect(readWorkspaceEntry(JSON.stringify({ 'ws-a': '{}' }), 'ws-a')).toBe('{}');
    for (const junk of [null, undefined, '', 'not json', 42, ['ws-a']]) {
      expect(readWorkspaceEntry(junk, 'ws-a')).toBeNull();
    }
  });

  it('reads an entry another writer stored as an object', () => {
    expect(readWorkspaceEntry({ 'ws-a': { nodes: [], edges: [] } }, 'ws-a')).toBe(
      '{"nodes":[],"edges":[]}'
    );
  });

  it('replaces one entry and carries every other workspace through untouched', () => {
    const pref = { 'ws-a': 'old-a', 'ws-b': 'keep-b' };
    const next = writeWorkspaceEntry(pref, 'ws-a', 'new-a');
    expect(next).toEqual({ 'ws-a': 'new-a', 'ws-b': 'keep-b' });
    // The input is not mutated: the caller may still be holding it.
    expect(pref['ws-a']).toBe('old-a');
  });

  it('starts a map when there is none', () => {
    expect(writeWorkspaceEntry(undefined, 'ws-a', 'doc')).toEqual({ 'ws-a': 'doc' });
  });
});

/* ── the lane itself ─────────────────────────────────────────────────────── */

describe('the engine settings transport', () => {
  it('reads a workspace Board out of the settings aggregate', async () => {
    const { calls } = installLane({ [BOARD_GRAPH_PREF_KEY]: { 'ws-1': '{"nodes":[]}' } });
    const loaded = await engineSettingsTransport().load('ws-1');
    expect(loaded).toBe('{"nodes":[]}');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/ui/api/settings' });
  });

  it('reports no Board rather than failing when the workspace has none', async () => {
    installLane({});
    expect(await engineSettingsTransport().load('ws-1')).toBeNull();
  });

  it('writes the Board back under the one pref key, keeping other workspaces', async () => {
    const { calls, state } = installLane({
      [BOARD_GRAPH_PREF_KEY]: { 'ws-other': 'other-doc' },
    });
    const saved = await engineSettingsTransport().save('ws-1', '{"version":1}');
    expect(classifySave(saved)).toBe('synced');

    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.path).toBe('/ui/api/settings');
    expect(put?.body).toEqual({
      prefs: { [BOARD_GRAPH_PREF_KEY]: { 'ws-other': 'other-doc', 'ws-1': '{"version":1}' } },
    });
    expect(state.prefs[BOARD_GRAPH_PREF_KEY]).toEqual({
      'ws-other': 'other-doc',
      'ws-1': '{"version":1}',
    });
  });

  it('sends no etag, so an unrelated settings change cannot reject a Board save', async () => {
    const { calls } = installLane({});
    await engineSettingsTransport().save('ws-1', '{"version":1}');
    const put = calls.find((call) => call.method === 'PUT');
    expect(JSON.stringify(put?.body)).not.toContain('etag');
  });

  it('says a refused write was refused, in the engine own words', async () => {
    const { state } = installLane({});
    state.refuse = true;
    expect(await engineSettingsTransport().save('ws-1', '{"version":1}')).toEqual({
      ok: false,
      status: 400,
      message: 'unknown setting',
    });
  });

  it('says a save failed when nothing answered at all', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    const transport = engineSettingsTransport();
    expect(await transport.load('ws-1')).toBeNull();
    expect(await transport.save('ws-1', '{}')).toMatchObject({ ok: false, status: 0 });
  });
});

/* ── why a save did not land ─────────────────────────────────────────────── */

/**
 * The distinction the Board's message is built on. An engine that ANSWERED and
 * refused this pref key is a build older than this one, and updating it is the
 * whole fix; anything else — nothing answering, a rejected credential, a
 * timeout, a server fault — says nothing about which build is installed, and
 * telling that person to update would send them after a problem they do not
 * have. So `engine-behind` is claimed narrowly and on purpose.
 */
describe('reading why a save did not land', () => {
  it('reads an accepted write as synced, however it was reported', () => {
    expect(classifySave(true)).toBe('synced');
    expect(classifySave({ ok: true, status: 200 })).toBe('synced');
  });

  it('reads the engine refusing this pref key as an engine one build behind', () => {
    for (const status of [400, 404, 409, 422]) {
      expect(classifySave({ ok: false, status, message: 'unknown setting' }), `${status}`).toBe(
        'engine-behind'
      );
    }
  });

  it('reads nothing answering as offline, never as an old engine', () => {
    expect(classifySave(false)).toBe('offline');
    expect(classifySave({ ok: false, status: 0, message: null })).toBe('offline');
  });

  it('never blames the build for a credential, a timeout or a fault', () => {
    // Each of these is a client error too, and none of them is about what this
    // engine knows how to store.
    for (const status of [401, 402, 403, 407, 408, 423, 425, 429, 500, 502, 503]) {
      expect(classifySave({ ok: false, status }), `${status}`).toBe('offline');
    }
  });
});

/* ── the local floor ─────────────────────────────────────────────────────── */

/**
 * The Board tells a person on an older engine that nothing is lost. That is
 * only true because the document this window wrote is also kept locally, so the
 * promise and this behaviour have to be checked together.
 */
describe('the copy kept on this machine', () => {
  it('keeps one workspace document and reads it back', () => {
    writeLocalCopy('ws-1', '{"version":1}');
    writeLocalCopy('ws-2', '{"version":2}');
    expect(readLocalCopy('ws-1')).toBe('{"version":1}');
    expect(readLocalCopy('ws-2')).toBe('{"version":2}');
    expect(readLocalCopy('ws-none')).toBeNull();
  });

  it('keeps the document even when the engine refused it', async () => {
    const { state } = installLane({});
    state.refuse = true;
    await engineSettingsTransport().save('ws-1', '{"version":1,"nodes":[]}');
    expect(readLocalCopy('ws-1')).toBe('{"version":1,"nodes":[]}');
  });

  it('opens the refused Board again rather than empty', async () => {
    const { state } = installLane({});
    state.refuse = true;
    const transport = engineSettingsTransport();
    await transport.save('ws-1', '{"version":1,"nodes":[]}');

    // A second window, or the next morning: the engine still holds nothing.
    expect(await transport.load('ws-1')).toBe('{"version":1,"nodes":[]}');
  });

  it('lets the engine win whenever the engine has one', async () => {
    writeLocalCopy('ws-1', '{"stale":true}');
    installLane({ [BOARD_GRAPH_PREF_KEY]: { 'ws-1': '{"fromEngine":true}' } });
    expect(await engineSettingsTransport().load('ws-1')).toBe('{"fromEngine":true}');
  });

  it('shrugs off a store holding something that is not a map', () => {
    window.localStorage.setItem(BOARD_GRAPH_LOCAL_KEY, 'not json');
    expect(readLocalCopy('ws-1')).toBeNull();
    writeLocalCopy('ws-1', '{"version":1}');
    expect(readLocalCopy('ws-1')).toBe('{"version":1}');
  });
});
