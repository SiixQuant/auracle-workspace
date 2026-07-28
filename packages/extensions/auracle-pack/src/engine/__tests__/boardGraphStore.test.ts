import { afterEach, describe, expect, it, vi } from 'vitest';

import { findNode, serializeBoardGraph, type BoardSourceConfig } from '../boardGraph';
import { boardGraphStore, type BoardSnapshot } from '../boardGraphStore';
import type { BoardGraphTransport } from '../boardPersistence';

/**
 * A settings lane in memory: one stored document per workspace, with the call
 * counts the idempotency rules are about.
 */
function mockLane(seed: Record<string, string> = {}) {
  const state = {
    docs: { ...seed } as Record<string, string>,
    loads: 0,
    saves: 0,
    savedWorkspaces: [] as string[],
    accept: true,
    throwOnLoad: false,
  };
  const transport: BoardGraphTransport = {
    async load(workspaceId: string) {
      state.loads += 1;
      if (state.throwOnLoad) throw new Error('lane unreachable');
      return state.docs[workspaceId] ?? null;
    },
    async save(workspaceId: string, json: string) {
      state.saves += 1;
      state.savedWorkspaces.push(workspaceId);
      if (!state.accept) return false;
      state.docs[workspaceId] = json;
      return true;
    },
  };
  return { transport, state };
}

const SOURCE: BoardSourceConfig = {
  name: 'Desk bars',
  connectorKind: 'data_provider',
  endpoint: 'https://example.invalid/bars',
  payloadType: 'bars',
  credentialSlot: 'desk_bars_key',
};

/** open() with the debounce out of the way — every test drives saves by flush. */
async function open(transport: BoardGraphTransport, workspaceId = 'ws-1'): Promise<void> {
  await boardGraphStore.open(workspaceId, { transport, saveDelayMs: 1000 });
}

afterEach(() => {
  boardGraphStore.reset();
});

/* ── opening ─────────────────────────────────────────────────────────────── */

describe('opening a workspace', () => {
  it('starts closed and empty', () => {
    const snapshot = boardGraphStore.getSnapshot();
    expect(snapshot.status).toBe('closed');
    expect(snapshot.workspaceId).toBe('');
    expect(snapshot.graph.nodes).toEqual([]);
  });

  it('loads the workspace it is asked for and settles idle', async () => {
    const { transport, state } = mockLane();
    await open(transport, 'ws-7');
    const snapshot = boardGraphStore.getSnapshot();
    expect(snapshot.workspaceId).toBe('ws-7');
    expect(snapshot.status).toBe('idle');
    expect(snapshot.dirty).toBe(false);
    expect(state.loads).toBe(1);
  });

  it('does not re-fetch when the panel re-opens the workspace already open', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    await open(transport);
    expect(state.loads).toBe(1);
  });

  it('reports a lane that refused to answer, and still opens', async () => {
    const { transport, state } = mockLane();
    state.throwOnLoad = true;
    await open(transport);
    expect(boardGraphStore.getSnapshot().status).toBe('error');
    expect(boardGraphStore.getSnapshot().graph.nodes).toEqual([]);
  });
});

/* ── round-trip persistence ──────────────────────────────────────────────── */

describe('round trip through the settings lane', () => {
  it('a graph built in one window is what the next window opens', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    const sourceId = boardGraphStore.createNode({ kind: 'source', source: SOURCE });
    const researchId = boardGraphStore.createNode({
      kind: 'research',
      research: { hypothesis: 'Gaps mean-revert.' },
    });
    boardGraphStore.wire(sourceId, researchId);
    boardGraphStore.position(researchId, { x: 120, y: 40 });
    await boardGraphStore.flush();

    const written = serializeBoardGraph(boardGraphStore.getSnapshot().graph);

    // A second window: same lane, nothing shared but the stored document.
    boardGraphStore.reset();
    await open(transport);

    const reopened = boardGraphStore.getSnapshot();
    expect(serializeBoardGraph(reopened.graph)).toBe(written);
    expect(findNode(reopened.graph, sourceId)?.source).toEqual(SOURCE);
    expect(findNode(reopened.graph, researchId)?.position).toEqual({ x: 120, y: 40 });
    expect(reopened.graph.edges).toHaveLength(1);
    expect(state.saves).toBe(1);
  });

  it('keeps one workspace graph out of another', async () => {
    const { transport, state } = mockLane();
    await open(transport, 'ws-a');
    boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'A' } });
    await boardGraphStore.flush();

    await boardGraphStore.open('ws-b', { transport, saveDelayMs: 1000 });
    expect(boardGraphStore.getSnapshot().graph.nodes).toEqual([]);
    boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'B' } });
    await boardGraphStore.flush();

    expect(state.savedWorkspaces).toEqual(['ws-a', 'ws-b']);
    expect(state.docs['ws-a']).toContain('"A"');
    expect(state.docs['ws-a']).not.toContain('"B"');
  });

  it('carries an unsaved edit out before switching workspaces', async () => {
    const { transport, state } = mockLane();
    await open(transport, 'ws-a');
    boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'A' } });
    await boardGraphStore.open('ws-b', { transport, saveDelayMs: 1000 });
    expect(state.docs['ws-a']).toContain('"A"');
  });

  it('opens a stored graph that carries a kind this build does not know', async () => {
    const stored = JSON.stringify({
      version: 2,
      nodes: [{ id: 'ens-1', kind: 'ensemble', sleeves: ['a', 'b'] }],
      edges: [],
      viewport: { zoom: 2 },
    });
    const { transport, state } = mockLane({ 'ws-1': stored });
    await open(transport);
    expect(findNode(boardGraphStore.getSnapshot().graph, 'ens-1')?.extra).toEqual({
      sleeves: ['a', 'b'],
    });

    // Editing something else must not cost the unknown card its fields.
    boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Q' } });
    await boardGraphStore.flush();
    expect(state.docs['ws-1']).toContain('sleeves');
    expect(state.docs['ws-1']).toContain('viewport');
  });
});

/* ── idempotent writes ───────────────────────────────────────────────────── */

describe('a write only happens when something changed', () => {
  it('opening and closing an untouched Board writes nothing', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    await boardGraphStore.flush();
    await boardGraphStore.flush();
    expect(state.saves).toBe(0);
  });

  it('re-opening a stored Board writes nothing, so two windows cannot loop', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Q' } });
    await boardGraphStore.flush();
    expect(state.saves).toBe(1);

    boardGraphStore.reset();
    await open(transport);
    await boardGraphStore.flush();
    await boardGraphStore.refresh();
    await boardGraphStore.flush();
    expect(state.saves).toBe(1);
  });

  it('writes once for a batch of edits and not again for a repeat flush', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    const id = boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Q' } });
    boardGraphStore.position(id, { x: 1, y: 2 });
    await boardGraphStore.flush();
    await boardGraphStore.flush();
    expect(state.saves).toBe(1);
    expect(boardGraphStore.getSnapshot().dirty).toBe(false);
  });

  it('an edit undone before the save writes nothing', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    const id = boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Q' } });
    await boardGraphStore.flush();
    expect(state.saves).toBe(1);

    boardGraphStore.position(id, { x: 5, y: 5 });
    boardGraphStore.position(id, null);
    await boardGraphStore.flush();
    expect(state.saves).toBe(1);
  });

  it('typing the same value back is not an edit', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    const id = boardGraphStore.createNode({ kind: 'source', source: SOURCE });
    await boardGraphStore.flush();
    const listener = vi.fn();
    const unsubscribe = boardGraphStore.subscribe(listener);
    boardGraphStore.updateNode(id, { source: { endpoint: SOURCE.endpoint } });
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
    await boardGraphStore.flush();
    expect(state.saves).toBe(1);
  });

  it('reports a refused write instead of pretending it landed', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    state.accept = false;
    boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Q' } });
    await boardGraphStore.flush();
    expect(boardGraphStore.getSnapshot().status).toBe('error');
    expect(boardGraphStore.getSnapshot().dirty).toBe(true);

    state.accept = true;
    await boardGraphStore.flush();
    expect(boardGraphStore.getSnapshot().status).toBe('idle');
    expect(boardGraphStore.getSnapshot().dirty).toBe(false);
    expect(state.saves).toBe(2);
  });
});

/* ── refresh ─────────────────────────────────────────────────────────────── */

describe('following another window', () => {
  it('adopts what the other window saved', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    state.docs['ws-1'] = JSON.stringify({
      version: 1,
      nodes: [{ id: 'res-9', kind: 'research', research: { hypothesis: 'From next door.' } }],
      edges: [],
    });
    await boardGraphStore.refresh();
    expect(findNode(boardGraphStore.getSnapshot().graph, 'res-9')?.research?.hypothesis).toBe(
      'From next door.'
    );
  });

  it('leaves an unsaved local edit alone rather than snapping it back', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    const mine = boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Mine' } });
    state.docs['ws-1'] = JSON.stringify({ version: 1, nodes: [], edges: [] });
    await boardGraphStore.refresh();
    expect(findNode(boardGraphStore.getSnapshot().graph, mine)).toBeDefined();
    expect(boardGraphStore.getSnapshot().dirty).toBe(true);
  });

  it('does nothing at all before a workspace is open', async () => {
    const { state } = mockLane();
    await boardGraphStore.refresh();
    expect(state.loads).toBe(0);
    expect(boardGraphStore.getSnapshot().status).toBe('closed');
  });
});

/* ── subscribe ───────────────────────────────────────────────────────────── */

describe('subscribe and snapshots', () => {
  it('hands out a new snapshot per change and the same one between changes', async () => {
    const { transport } = mockLane();
    await open(transport);
    const seen: BoardSnapshot[] = [];
    const unsubscribe = boardGraphStore.subscribe(() =>
      seen.push(boardGraphStore.getSnapshot())
    );

    const first = boardGraphStore.getSnapshot();
    expect(boardGraphStore.getSnapshot()).toBe(first);

    const id = boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Q' } });
    const afterCreate = boardGraphStore.getSnapshot();
    boardGraphStore.position(id, { x: 1, y: 1 });

    unsubscribe();
    expect(seen).toHaveLength(2);
    expect(afterCreate).not.toBe(first);
    expect(boardGraphStore.getSnapshot()).not.toBe(afterCreate);
    expect(first.graph.nodes).toHaveLength(0);
  });

  it('stops delivering after unsubscribe', async () => {
    const { transport } = mockLane();
    await open(transport);
    const listener = vi.fn();
    boardGraphStore.subscribe(listener)();
    boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Q' } });
    expect(listener).not.toHaveBeenCalled();
  });

  it('says nothing changed when a write finds no card', async () => {
    const { transport } = mockLane();
    await open(transport);
    const listener = vi.fn();
    const unsubscribe = boardGraphStore.subscribe(listener);
    boardGraphStore.updateNode('gone', { label: 'x' });
    boardGraphStore.position('gone', { x: 1, y: 1 });
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});

/* ── the store's own invariants ──────────────────────────────────────────── */

describe('what the store refuses to store', () => {
  it('keeps only the source schema when the caller hands over more', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    const fat = {
      ...SOURCE,
      credentialValue: 'sk-live-must-never-persist',
      apiSecret: 'sk-live-must-never-persist',
    } as BoardSourceConfig;
    const id = boardGraphStore.createNode({ kind: 'source', source: fat });
    expect(findNode(boardGraphStore.getSnapshot().graph, id)?.source).toEqual(SOURCE);

    boardGraphStore.updateNode(id, {
      source: { name: 'Renamed', secret: 'sk-live-must-never-persist' } as Partial<BoardSourceConfig>,
    });
    await boardGraphStore.flush();
    expect(state.docs['ws-1']).not.toContain('sk-live-must-never-persist');
    expect(state.docs['ws-1']).toContain('Renamed');
  });

  it('stores a materialized card as a reference even when handed the artifact', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    const researchId = boardGraphStore.createNode({
      kind: 'research',
      research: { hypothesis: 'Q' },
    });
    const result = boardGraphStore.materialize({
      kind: 'strategy',
      from: researchId,
      label: 'Gap fade',
      ref: {
        kind: 'strategy',
        id: 'strategies.desk.gap.GapFade',
        metrics: { sharpe: 1.42 },
      } as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findNode(boardGraphStore.getSnapshot().graph, result.nodeId)?.ref).toEqual({
      kind: 'strategy',
      id: 'strategies.desk.gap.GapFade',
    });
    await boardGraphStore.flush();
    expect(state.docs['ws-1']).not.toContain('sharpe');
  });
});

/* ── wiring ──────────────────────────────────────────────────────────────── */

describe('wiring cards together', () => {
  it('draws a source-to-research wire and cuts it again', async () => {
    const { transport } = mockLane();
    await open(transport);
    const sourceId = boardGraphStore.createNode({ kind: 'source', source: SOURCE });
    const researchId = boardGraphStore.createNode({
      kind: 'research',
      research: { hypothesis: 'Q' },
    });
    const wired = boardGraphStore.wire(sourceId, researchId);
    expect(wired.ok).toBe(true);
    if (!wired.ok) return;
    expect(boardGraphStore.getSnapshot().graph.edges).toHaveLength(1);
    expect(boardGraphStore.unwire(wired.edgeId)).toEqual({ ok: true });
    expect(boardGraphStore.getSnapshot().graph.edges).toHaveLength(0);
  });

  it('refuses a wire the Board cannot draw, with the sentence to show', async () => {
    const { transport } = mockLane();
    await open(transport);
    const researchId = boardGraphStore.createNode({
      kind: 'research',
      research: { hypothesis: 'Q' },
    });
    const refused = boardGraphStore.wire(researchId, 'nobody');
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason.length).toBeGreaterThan(0);
    expect(boardGraphStore.getSnapshot().graph.edges).toHaveLength(0);
  });

  it('will not let a provenance wire be cut by hand', async () => {
    const { transport } = mockLane();
    await open(transport);
    const researchId = boardGraphStore.createNode({
      kind: 'research',
      research: { hypothesis: 'Q' },
    });
    boardGraphStore.materialize({
      kind: 'strategy',
      from: researchId,
      ref: { kind: 'strategy', id: 's1' },
    });
    const [provenance] = boardGraphStore.getSnapshot().graph.edges;
    expect(provenance.origin).toBe('system');
    expect(boardGraphStore.unwire(provenance.id).ok).toBe(false);
    expect(boardGraphStore.getSnapshot().graph.edges).toHaveLength(1);
  });
});

/* ── materialize ─────────────────────────────────────────────────────────── */

describe('cards that appear from real work', () => {
  it('writes the card and the wire that says where it came from', async () => {
    const { transport } = mockLane();
    await open(transport);
    const researchId = boardGraphStore.createNode({
      kind: 'research',
      research: { hypothesis: 'Q' },
    });
    const result = boardGraphStore.materialize({
      kind: 'strategy',
      from: researchId,
      ref: { kind: 'strategy', id: 's1' },
      label: 'Gap fade',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const graph = boardGraphStore.getSnapshot().graph;
    expect(findNode(graph, result.nodeId)?.label).toBe('Gap fade');
    expect(graph.edges[0]).toMatchObject({ from: researchId, to: result.nodeId, origin: 'system' });
  });

  it('is idempotent per artifact, so a re-announcement grows nothing', async () => {
    const { transport, state } = mockLane();
    await open(transport);
    const researchId = boardGraphStore.createNode({
      kind: 'research',
      research: { hypothesis: 'Q' },
    });
    const first = boardGraphStore.materialize({
      kind: 'strategy',
      from: researchId,
      ref: { kind: 'strategy', id: 's1' },
    });
    await boardGraphStore.flush();
    const second = boardGraphStore.materialize({
      kind: 'strategy',
      from: researchId,
      ref: { kind: 'strategy', id: 's1' },
    });
    await boardGraphStore.flush();

    expect(first).toEqual(second);
    const graph = boardGraphStore.getSnapshot().graph;
    expect(graph.nodes.filter((node) => node.kind === 'strategy')).toHaveLength(1);
    expect(graph.edges).toHaveLength(1);
    // The second announcement changed nothing, so it wrote nothing.
    expect(state.saves).toBe(1);
  });

  it('refuses a card with no parent or no reference', async () => {
    const { transport } = mockLane();
    await open(transport);
    const researchId = boardGraphStore.createNode({
      kind: 'research',
      research: { hypothesis: 'Q' },
    });
    expect(
      boardGraphStore.materialize({
        kind: 'test',
        from: 'gone',
        ref: { kind: 'backtest', id: '1' },
      }).ok
    ).toBe(false);
    expect(
      boardGraphStore.materialize({
        kind: 'test',
        from: researchId,
        ref: { kind: 'backtest', id: '' },
      }).ok
    ).toBe(false);
    expect(boardGraphStore.getSnapshot().graph.nodes).toHaveLength(1);
  });
});

/* ── delete ──────────────────────────────────────────────────────────────── */

describe('deleting a research card', () => {
  async function boardWithLineage() {
    const { transport, state } = mockLane();
    await open(transport);
    const sourceId = boardGraphStore.createNode({ kind: 'source', source: SOURCE });
    const researchId = boardGraphStore.createNode({
      kind: 'research',
      research: { hypothesis: 'Q' },
    });
    boardGraphStore.wire(sourceId, researchId);
    const strategy = boardGraphStore.materialize({
      kind: 'strategy',
      from: researchId,
      ref: { kind: 'strategy', id: 'strategies.desk.gap.GapFade' },
    });
    if (!strategy.ok) throw new Error('materialize failed');
    const test = boardGraphStore.materialize({
      kind: 'test',
      from: strategy.nodeId,
      ref: { kind: 'backtest', id: '4211' },
    });
    if (!test.ok) throw new Error('materialize failed');
    await boardGraphStore.flush();
    return { state, sourceId, researchId, strategyId: strategy.nodeId, testId: test.nodeId };
  }

  it('says in advance what stays behind, without changing anything', async () => {
    const { researchId, strategyId, testId } = await boardWithLineage();
    const before = boardGraphStore.getSnapshot();
    const plan = boardGraphStore.previewDelete(researchId);
    expect(plan.removedNodeIds).toEqual([researchId]);
    expect([...plan.retainedNodeIds].sort()).toEqual([strategyId, testId].sort());
    expect(plan.retainedRefs).toHaveLength(2);
    expect(boardGraphStore.getSnapshot()).toBe(before);
  });

  it('removes the question and keeps every artifact it produced', async () => {
    const { researchId, sourceId, strategyId, testId } = await boardWithLineage();
    const plan = boardGraphStore.deleteNode(researchId);
    const graph = boardGraphStore.getSnapshot().graph;

    expect(findNode(graph, researchId)).toBeUndefined();
    expect(findNode(graph, sourceId)).toBeDefined();
    expect(findNode(graph, strategyId)?.ref).toEqual({
      kind: 'strategy',
      id: 'strategies.desk.gap.GapFade',
    });
    expect(findNode(graph, testId)?.ref).toEqual({ kind: 'backtest', id: '4211' });
    expect(plan.retainedRefs).toHaveLength(2);
    // The strategy-to-test wire is untouched; only the ones that met the
    // deleted card went with it.
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: strategyId, to: testId });
  });

  it('persists the delete', async () => {
    const { researchId, state } = await boardWithLineage();
    boardGraphStore.deleteNode(researchId);
    await boardGraphStore.flush();
    expect(state.docs['ws-1']).not.toContain(researchId);
    expect(state.docs['ws-1']).toContain('4211');
  });

  it('plans nothing for a card that is already gone', async () => {
    const { transport } = mockLane();
    await open(transport);
    const plan = boardGraphStore.deleteNode('never-existed');
    expect(plan.removedNodeIds).toEqual([]);
    expect(plan.retainedRefs).toEqual([]);
  });
});
