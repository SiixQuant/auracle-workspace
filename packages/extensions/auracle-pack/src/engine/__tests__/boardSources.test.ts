/**
 * The Board's engine lane, as a contract.
 *
 * The routes this module calls do not exist on the engine yet — they land in a
 * parallel change, and the render harness serves them as mocks meanwhile — so
 * what is pinned here is exactly what that change has to honour: the paths, the
 * request bodies, and the two rules that outlive any of them.
 *
 *  - A REFUSAL IS NEVER A SUCCESS. An engine that is not there (status 0) and
 *    an engine that says no (4xx) are both reported as failures carrying the
 *    engine's own words, because a card that says "connected" over a route
 *    nobody answered is the one outcome worse than an error.
 *  - A SECRET GOES ONE WAY. Whatever the reply carries, this module returns a
 *    name, a boolean and a timestamp. The engine is expected to honour that;
 *    these tests prove the client does not depend on it doing so.
 *
 * The mocked seam is the main-process bridge — the client's only I/O — so the
 * real request path (client.ts) is exercised rather than replaced.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  BOARD_CREDENTIALS_PATH,
  BOARD_SOURCES_PATH,
  clearCredentialSecret,
  credentialSlotState,
  deleteBoardSource,
  isConnectorKind,
  listBoardSources,
  putCredentialSecret,
  readCredentialSlot,
  saveBoardSource,
} from '../boardSources';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Answer = { ok: boolean; status: number; body: unknown };

/** A bridge that records every call and answers from a path table. */
function installBridge(routes: Record<string, Answer>): Call[] {
  const calls: Call[] = [];
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    invoke: async (channel: string, ...args: unknown[]) => {
      if (channel !== 'auracle:engine-request') return null;
      const [method, path, body] = args as [string, string, unknown];
      calls.push({ method, path, body });
      return routes[path] ?? { ok: false, status: 404, body: null };
    },
  };
  return calls;
}

/** Nothing answers at all — an engine that is not running. */
function installDeadBridge(): void {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
}

const ok = (body: unknown): Answer => ({ ok: true, status: 200, body });

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

/* ── describing a source ─────────────────────────────────────────────────── */

describe('saving a source', () => {
  it('posts the card as the engine record, keyed by the card id', async () => {
    const calls = installBridge({ [BOARD_SOURCES_PATH]: ok({ ok: true, source: { id: 'n1' } }) });

    const result = await saveBoardSource({
      id: 'n1',
      name: 'Desk bars',
      connectorKind: 'http_api',
      endpoint: 'https://example.invalid/bars',
      payloadType: 'bars',
      credentialSlot: 'desk_bars_key',
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        method: 'POST',
        path: BOARD_SOURCES_PATH,
        body: {
          id: 'n1',
          name: 'Desk bars',
          connector_kind: 'http_api',
          endpoint: 'https://example.invalid/bars',
          payload_type: 'bars',
          credential_slot: 'desk_bars_key',
        },
      },
    ]);
  });

  it('sends a null slot rather than omitting it, so a cleared slot is cleared', async () => {
    const calls = installBridge({ [BOARD_SOURCES_PATH]: ok({ ok: true }) });

    await saveBoardSource({
      id: 'n1',
      name: 'Keyless feed',
      connectorKind: 'feed',
      endpoint: 'yfinance',
      payloadType: 'daily bars',
    });

    expect((calls[0].body as Record<string, unknown>).credential_slot).toBeNull();
  });

  it('reports the engine own refusal, not a status code', async () => {
    installBridge({
      [BOARD_SOURCES_PATH]: { ok: false, status: 422, body: { detail: 'endpoint is not reachable' } },
    });

    const result = await saveBoardSource({
      id: 'n1',
      name: 'Broken',
      connectorKind: 'http_api',
      endpoint: 'nope',
      payloadType: 'bars',
    });

    expect(result).toEqual({ ok: false, status: 422, message: 'endpoint is not reachable', source: null });
  });

  it('does not read an unreachable engine as a save', async () => {
    installDeadBridge();

    const result = await saveBoardSource({
      id: 'n1',
      name: 'Desk bars',
      connectorKind: 'feed',
      endpoint: 'x',
      payloadType: 'bars',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });

  it('forgets a source through its own id, escaped', async () => {
    const path = `${BOARD_SOURCES_PATH}/${encodeURIComponent('source builtin/1')}/delete`;
    const calls = installBridge({ [path]: ok({ ok: true }) });

    const result = await deleteBoardSource('source builtin/1');

    expect(result.ok).toBe(true);
    expect(calls[0].path).toBe(path);
  });
});

describe('listing sources', () => {
  it('answers with the rows the engine named', async () => {
    installBridge({ [BOARD_SOURCES_PATH]: ok({ sources: [{ id: 'n1', name: 'Desk bars' }] }) });
    await expect(listBoardSources()).resolves.toHaveLength(1);
  });

  it('reads an answer without the key as an empty list, and silence as null', async () => {
    installBridge({ [BOARD_SOURCES_PATH]: ok({}) });
    await expect(listBoardSources()).resolves.toEqual([]);

    installDeadBridge();
    await expect(listBoardSources()).resolves.toBeNull();
  });
});

/* ── the secret ──────────────────────────────────────────────────────────── */

describe('the write-only secret', () => {
  const slot = 'desk_bars_key';
  const path = `${BOARD_CREDENTIALS_PATH}/${slot}`;

  it('posts the value and returns only whether the slot now holds one', async () => {
    const calls = installBridge({
      [path]: ok({ ok: true, slot: { name: slot, set: true, updated_at: '2026-07-28T10:00:00Z' } }),
    });

    const result = await putCredentialSecret(slot, 'super-secret-token');

    expect(calls).toEqual([{ method: 'POST', path, body: { secret: 'super-secret-token' } }]);
    expect(result.ok).toBe(true);
    expect(result.slot).toEqual({ name: slot, set: true, updatedAt: '2026-07-28T10:00:00Z' });
  });

  it('drops a value an engine echoed back, so it cannot reach a screen', async () => {
    installBridge({
      [path]: ok({ slot: { name: slot, set: true, secret: 'super-secret-token', preview: 'sup•••' } }),
    });

    const result = await putCredentialSecret(slot, 'super-secret-token');

    expect(result.slot).toEqual({ name: slot, set: true, updatedAt: null });
    expect(JSON.stringify(result)).not.toContain('super-secret-token');
    expect(JSON.stringify(result)).not.toContain('sup•••');
  });

  it('refuses to post a secret with no slot to put it in, without a request', async () => {
    const calls = installBridge({});

    const result = await putCredentialSecret('', 'super-secret-token');

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('reports a rejected write rather than claiming the key is stored', async () => {
    installBridge({ [path]: { ok: false, status: 403, body: { detail: 'vault is locked' } } });

    const result = await putCredentialSecret(slot, 'x');

    expect(result).toEqual({ ok: false, status: 403, message: 'vault is locked', slot: null });
  });

  it('reads a slot as state only, and a 404 as an empty slot', async () => {
    installBridge({ [path]: ok({ name: slot, set: true, updated_at: null, value: 'leaked' }) });
    const held = await credentialSlotState(slot);
    expect(held).toEqual({ name: slot, set: true, updatedAt: null });
    expect(JSON.stringify(held)).not.toContain('leaked');

    installBridge({});
    await expect(credentialSlotState(slot)).resolves.toEqual({
      name: slot,
      set: false,
      updatedAt: null,
    });
  });

  it('separates an empty slot from an engine that never answered', async () => {
    installDeadBridge();
    // status 0, not 404: nothing said this slot is empty, so nothing claims it.
    await expect(credentialSlotState(slot)).resolves.toBeNull();
  });

  it('empties a slot through its own route', async () => {
    const calls = installBridge({ [`${path}/clear`]: ok({ ok: true }) });

    const result = await clearCredentialSecret(slot);

    expect(result.ok).toBe(true);
    expect(calls[0].path).toBe(`${path}/clear`);
  });

  it('reduces any shape to a slot, or to nothing', () => {
    expect(readCredentialSlot({ name: 'a', set: 'yes' })).toEqual({
      name: 'a',
      // Only a literal true is read as set: "probably" is not a state.
      set: false,
      updatedAt: null,
    });
    expect(readCredentialSlot(null)).toBeNull();
    expect(readCredentialSlot({}, 'fallback')).toEqual({
      name: 'fallback',
      set: false,
      updatedAt: null,
    });
  });
});

describe('connector kinds', () => {
  it('knows the four the editor offers, and nothing else', () => {
    expect(isConnectorKind('feed')).toBe(true);
    expect(isConnectorKind('http_api')).toBe(true);
    expect(isConnectorKind('file_drop')).toBe(true);
    expect(isConnectorKind('database')).toBe(true);
    expect(isConnectorKind('carrier_pigeon')).toBe(false);
  });
});
