/**
 * The sources a Board already has on it: which ones qualify, where they come
 * from, and the rules that keep them from multiplying.
 *
 * The bootstrap runs from an effect that re-fires whenever the connector
 * registry answers — every thirty seconds, for as long as the Board is open —
 * so "idempotent" here is not a nicety. A pass that added one card per poll
 * would fill a Board with copies of the same feed inside a minute.
 *
 * The other half is WHAT lands. A source card is something a question is read
 * against, and a practice trading account is not that, however keyless it is:
 * it was on the first Board a real install ever drew, and it read as breakage.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { bootstrapBuiltInSources, builtInNodeId, isBuiltInNode } from '../boardBuiltins';
import { boardGraphStore } from '../boardGraphStore';
import { BOARD_SOURCES_PATH } from '../boardSources';
import type { BoardGraphTransport } from '../boardPersistence';
import type { Connector } from '../model';

function connector(id: string, extra: Partial<Connector> = {}): Connector {
  return {
    id,
    display_label: id,
    blurb: '',
    kind: 'data_provider',
    status: { state: 'connected', detail: null },
    fields: [],
    ...extra,
  } as Connector;
}

/** The registry as a keyless install reports it: one free feed, one practice
 *  environment, and a broker that would need credentials. */
const REGISTRY: Connector[] = [
  connector('yfinance', { display_label: 'Yahoo Finance', blurb: 'Free daily bars, zero config' }),
  connector('simulator', { display_label: 'Paper Simulator', kind: 'broker' }),
  connector('ibkr', { display_label: 'Interactive Brokers', kind: 'broker' }),
];

const lane: BoardGraphTransport = {
  async load() {
    return null;
  },
  async save() {
    return true;
  },
};

async function openBoard(): Promise<void> {
  await boardGraphStore.open('ws-1', { transport: lane, saveDelayMs: 1000 });
}

/**
 * The engine's own Board API answering. Without this stub there is no bridge at
 * all, which is exactly how an engine that does not serve the route reads — so
 * every test that does not install it is exercising the connector fallback.
 */
function serveBoardSources(sources: Array<Record<string, unknown>>): void {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    invoke: async (channel: string, method: string, path: string) => {
      if (channel !== 'auracle:engine-request') return null;
      if (method === 'GET' && path === BOARD_SOURCES_PATH) {
        return { ok: true, status: 200, body: { sources } };
      }
      return { ok: false, status: 404, body: null };
    },
  };
}

afterEach(() => {
  boardGraphStore.reset();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

/* ── what qualifies ──────────────────────────────────────────────────────── */

describe('only research material becomes a source card', () => {
  it('lays down the data feeds the engine named', async () => {
    await openBoard();

    const created = await bootstrapBuiltInSources(REGISTRY);

    expect(created).toEqual([builtInNodeId('yfinance')]);
    const nodes = boardGraphStore.getSnapshot().graph.nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe('source');
    expect(nodes[0].source?.name).toBe('Yahoo Finance');
    expect(nodes[0].source?.payloadType).toBe('Free daily bars, zero config');
    // Keyless means keyless: nothing here names a vault slot.
    expect(nodes[0].source?.credentialSlot).toBeUndefined();
    expect(nodes.every((node) => isBuiltInNode(node.id))).toBe(true);
  });

  it('never seeds a practice trading account, whatever kind it reports', async () => {
    await openBoard();
    // The registry a real install returned: the simulator arrives as a broker,
    // but a build that renamed its kind must not put it back on the Board.
    await bootstrapBuiltInSources([
      ...REGISTRY,
      connector('simulator', { display_label: 'Paper Simulator', kind: 'data_provider' }),
    ]);

    const ids = boardGraphStore.getSnapshot().graph.nodes.map((node) => node.id);
    expect(ids).not.toContain(builtInNodeId('simulator'));
    expect(ids).toEqual([builtInNodeId('yfinance')]);
  });

  it('never seeds a connector that needs a key', async () => {
    await openBoard();
    await bootstrapBuiltInSources(REGISTRY);

    expect(boardGraphStore.getSnapshot().graph.nodes.map((node) => node.id)).not.toContain(
      builtInNodeId('ibkr')
    );
  });
});

/* ── where they come from ────────────────────────────────────────────────── */

describe('the engine own list is preferred to the connector registry', () => {
  it('seeds what the Board API named', async () => {
    serveBoardSources([
      {
        id: 'arxiv-q-fin',
        name: 'Quantitative finance papers',
        connector_kind: 'feed',
        endpoint: 'https://example.invalid/q-fin',
        payload_type: 'papers',
      },
      { id: 'sec-filings', name: 'Company filings', connector_kind: 'feed', endpoint: 'edgar', payload_type: 'filings' },
    ]);
    await openBoard();

    const created = await bootstrapBuiltInSources(REGISTRY);

    expect(created).toEqual([builtInNodeId('arxiv-q-fin'), builtInNodeId('sec-filings')]);
    const nodes = boardGraphStore.getSnapshot().graph.nodes;
    expect(nodes[0].source?.name).toBe('Quantitative finance papers');
    expect(nodes[0].source?.payloadType).toBe('papers');
  });

  it('does not fall back to connectors when the engine answered', async () => {
    // The engine has a list and it is empty: that is an ANSWER, and a Board
    // that then seeded connectors would be putting cards on it the engine did
    // not offer.
    serveBoardSources([]);
    await openBoard();

    expect(await bootstrapBuiltInSources(REGISTRY)).toEqual([]);
    expect(boardGraphStore.getSnapshot().graph.nodes).toEqual([]);
  });

  it('falls back to the registry only on an engine without the route', async () => {
    await openBoard();

    expect(await bootstrapBuiltInSources(REGISTRY)).toEqual([builtInNodeId('yfinance')]);
  });

  it('invents nothing while neither has answered', async () => {
    await openBoard();

    expect(await bootstrapBuiltInSources(null)).toEqual([]);
    expect(boardGraphStore.getSnapshot().graph.nodes).toEqual([]);
  });
});

/* ── never twice, never back ─────────────────────────────────────────────── */

describe('the rules that keep the seeded cards from multiplying', () => {
  it('adds nothing on a second pass — the poll runs every thirty seconds', async () => {
    await openBoard();
    await bootstrapBuiltInSources(REGISTRY);

    const again = await bootstrapBuiltInSources(REGISTRY);

    expect(again).toEqual([]);
    expect(boardGraphStore.getSnapshot().graph.nodes).toHaveLength(1);
  });

  it('keeps off a Board that already has a card somebody placed', async () => {
    await openBoard();
    boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Gaps mean-revert.' } });

    expect(await bootstrapBuiltInSources(REGISTRY)).toEqual([]);
    expect(boardGraphStore.getSnapshot().graph.nodes).toHaveLength(1);
  });

  it('still seeds a Board whose only cards the system wrote', async () => {
    await openBoard();
    // A strategy the engine discovered can land on a first open before the
    // registry answers. That is not somebody having worked on this Board, and
    // reading it as such would cost a fresh install its free sources for good.
    boardGraphStore.materialize({ kind: 'strategy', ref: { kind: 'strategy', id: 'desk.Atlas' } });

    expect(await bootstrapBuiltInSources(REGISTRY)).toHaveLength(1);
  });

  it('waits for the workspace to be open', async () => {
    // Closed store: whatever the registry says, there is no Board to seed and
    // no workspace to save it to.
    expect(await bootstrapBuiltInSources(REGISTRY)).toEqual([]);
    expect(boardGraphStore.getSnapshot().graph.nodes).toEqual([]);
  });

  it('a seeded Board is what the next window opens', async () => {
    const docs: Record<string, string> = {};
    const shared: BoardGraphTransport = {
      async load(workspaceId) {
        return docs[workspaceId] ?? null;
      },
      async save(workspaceId, json) {
        docs[workspaceId] = json;
        return true;
      },
    };
    await boardGraphStore.open('ws-2', { transport: shared, saveDelayMs: 1000 });
    await bootstrapBuiltInSources(REGISTRY);
    await boardGraphStore.flush();

    boardGraphStore.reset();
    await boardGraphStore.open('ws-2', { transport: shared, saveDelayMs: 1000 });

    // One card, and the second open must not seed another on top of it.
    expect(await bootstrapBuiltInSources(REGISTRY)).toEqual([]);
    expect(boardGraphStore.getSnapshot().graph.nodes).toHaveLength(1);
  });

  it('does not resurrect a card somebody removed, in this window or the next', async () => {
    const docs: Record<string, string> = {};
    const shared: BoardGraphTransport = {
      async load(workspaceId) {
        return docs[workspaceId] ?? null;
      },
      async save(workspaceId, json) {
        docs[workspaceId] = json;
        return true;
      },
    };
    await boardGraphStore.open('ws-3', { transport: shared, saveDelayMs: 1000 });
    await bootstrapBuiltInSources(REGISTRY);
    boardGraphStore.deleteNode(builtInNodeId('yfinance'));
    await boardGraphStore.flush();

    // The Board is empty again, which used to be indistinguishable from a Board
    // nobody had opened.
    expect(boardGraphStore.getSnapshot().graph.nodes).toEqual([]);
    expect(await bootstrapBuiltInSources(REGISTRY)).toEqual([]);

    boardGraphStore.reset();
    await boardGraphStore.open('ws-3', { transport: shared, saveDelayMs: 1000 });

    expect(await bootstrapBuiltInSources(REGISTRY)).toEqual([]);
    expect(boardGraphStore.getSnapshot().graph.nodes).toEqual([]);
  });

  it('keeps the removal even when the engine list is the one being seeded from', async () => {
    serveBoardSources([{ id: 'sec-filings', name: 'Company filings', connector_kind: 'feed', endpoint: 'edgar', payload_type: 'filings' }]);
    await openBoard();
    await bootstrapBuiltInSources(null);
    boardGraphStore.deleteNode(builtInNodeId('sec-filings'));

    expect(await bootstrapBuiltInSources(null)).toEqual([]);
    expect(boardGraphStore.getSnapshot().graph.nodes).toEqual([]);
  });
});
