/**
 * The sources a Board already has on it, and the rules that keep them from
 * multiplying.
 *
 * The bootstrap runs from an effect that re-fires whenever the connector
 * registry answers — every thirty seconds, for as long as the Board is open —
 * so "idempotent" here is not a nicety. A pass that added one card per poll
 * would fill a Board with copies of the same feed inside a minute.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { bootstrapBuiltInSources, builtInNodeId, isBuiltInNode } from '../boardBuiltins';
import { boardGraphStore } from '../boardGraphStore';
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

/** The registry as a keyless install reports it: one free feed, one simulator,
 *  and a broker that would need credentials. */
const REGISTRY: Connector[] = [
  connector('yfinance', { display_label: 'Yahoo Finance', blurb: 'Free daily bars, zero config' }),
  connector('simulator', { display_label: 'Simulator', kind: 'broker' }),
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

afterEach(() => {
  boardGraphStore.reset();
});

describe('the keyless sources on a first open', () => {
  it('lays down one card per keyless connector the engine named', async () => {
    await openBoard();

    const created = bootstrapBuiltInSources(REGISTRY);

    expect(created).toEqual([builtInNodeId('yfinance'), builtInNodeId('simulator')]);
    const nodes = boardGraphStore.getSnapshot().graph.nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[0].kind).toBe('source');
    expect(nodes[0].source?.name).toBe('Yahoo Finance');
    expect(nodes[0].source?.payloadType).toBe('Free daily bars, zero config');
    // Keyless means keyless: nothing here names a vault slot.
    expect(nodes[0].source?.credentialSlot).toBeUndefined();
    expect(nodes.every((node) => isBuiltInNode(node.id))).toBe(true);
  });

  it('never seeds a connector that needs a key', async () => {
    await openBoard();
    bootstrapBuiltInSources(REGISTRY);

    expect(boardGraphStore.getSnapshot().graph.nodes.map((node) => node.id)).not.toContain(
      builtInNodeId('ibkr')
    );
  });

  it('adds nothing on a second pass — the poll runs every thirty seconds', async () => {
    await openBoard();
    bootstrapBuiltInSources(REGISTRY);

    const again = bootstrapBuiltInSources(REGISTRY);

    expect(again).toEqual([]);
    expect(boardGraphStore.getSnapshot().graph.nodes).toHaveLength(2);
  });

  it('keeps off a Board that already has a card somebody placed', async () => {
    await openBoard();
    boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Gaps mean-revert.' } });

    expect(bootstrapBuiltInSources(REGISTRY)).toEqual([]);
    expect(boardGraphStore.getSnapshot().graph.nodes).toHaveLength(1);
  });

  it('still seeds a Board whose only cards the system wrote', async () => {
    await openBoard();
    // A strategy the engine discovered can land on a first open before the
    // registry answers. That is not somebody having worked on this Board, and
    // reading it as such would cost a fresh install its free sources for good.
    boardGraphStore.materialize({ kind: 'strategy', ref: { kind: 'strategy', id: 'desk.Atlas' } });

    expect(bootstrapBuiltInSources(REGISTRY)).toHaveLength(2);
  });

  it('does not resurrect a built-in somebody removed from a Board they kept working on', async () => {
    await openBoard();
    bootstrapBuiltInSources(REGISTRY);
    boardGraphStore.deleteNode(builtInNodeId('simulator'));

    bootstrapBuiltInSources(REGISTRY);

    expect(boardGraphStore.getSnapshot().graph.nodes.map((node) => node.id)).toEqual([
      builtInNodeId('yfinance'),
    ]);
  });

  it('invents nothing while the registry has not answered', async () => {
    await openBoard();

    expect(bootstrapBuiltInSources(null)).toEqual([]);
    expect(boardGraphStore.getSnapshot().graph.nodes).toEqual([]);
  });

  it('waits for the workspace to be open', () => {
    // Closed store: whatever the registry says, there is no Board to seed and
    // no workspace to save it to.
    expect(bootstrapBuiltInSources(REGISTRY)).toEqual([]);
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
    bootstrapBuiltInSources(REGISTRY);
    await boardGraphStore.flush();

    boardGraphStore.reset();
    await boardGraphStore.open('ws-2', { transport: shared, saveDelayMs: 1000 });

    // Two cards, and the second open must not seed two more on top of them.
    expect(bootstrapBuiltInSources(REGISTRY)).toEqual([]);
    expect(boardGraphStore.getSnapshot().graph.nodes).toHaveLength(2);
  });
});
