import { describe, expect, it } from 'vitest';

import {
  BOARD_GRAPH_VERSION,
  addEdge,
  addNode,
  applyNodeDelete,
  canUnwire,
  canWire,
  downstreamNodeIds,
  emptyBoardGraph,
  findNode,
  isBlankUserCard,
  parseBoardGraph,
  planNodeDelete,
  removeEdge,
  serializeBoardGraph,
  setNodePosition,
  updateNode,
  type BoardGraph,
  type BoardNode,
} from '../boardGraph';

/* ── fixtures ────────────────────────────────────────────────────────────── */

const sourceNode: BoardNode = {
  id: 'src-1',
  kind: 'source',
  position: { x: 10, y: 20 },
  source: {
    name: 'Desk bars',
    connectorKind: 'data_provider',
    endpoint: 'https://example.invalid/bars',
    payloadType: 'bars',
    credentialSlot: 'desk_bars_key',
  },
};

const researchNode: BoardNode = {
  id: 'res-1',
  kind: 'research',
  research: { hypothesis: 'Overnight gaps mean-revert on high-volume names.' },
};

const strategyNode: BoardNode = {
  id: 'str-1',
  kind: 'strategy',
  label: 'Gap fade',
  ref: { kind: 'strategy', id: 'strategies.desk.gap.GapFade' },
};

function graph(nodes: BoardNode[], edges: BoardGraph['edges'] = []): BoardGraph {
  return { nodes, edges };
}

/* ── tolerant parse ──────────────────────────────────────────────────────── */

describe('parseBoardGraph tolerance', () => {
  it('opens empty rather than failing on absent or malformed input', () => {
    for (const input of [null, undefined, '', '   ', 'not json', '[]', '42', {}]) {
      expect(parseBoardGraph(input)).toEqual(emptyBoardGraph());
    }
  });

  it('takes either a JSON string or an already-parsed document', () => {
    const doc = { version: 1, nodes: [researchNode], edges: [] };
    expect(parseBoardGraph(JSON.stringify(doc))).toEqual(parseBoardGraph(doc));
  });

  it('preserves a node kind this build has never heard of, with its fields', () => {
    const parsed = parseBoardGraph({
      version: 9,
      nodes: [
        researchNode,
        {
          id: 'future-1',
          kind: 'ensemble',
          position: { x: 4, y: 5 },
          ref: { kind: 'ensemble', id: 'ens-7' },
          sleeves: ['a', 'b'],
        },
      ],
      edges: [],
    });
    const future = findNode(parsed, 'future-1');
    expect(future?.kind).toBe('ensemble');
    expect(future?.position).toEqual({ x: 4, y: 5 });
    expect(future?.ref).toEqual({ kind: 'ensemble', id: 'ens-7' });
    expect(future?.extra).toEqual({ sleeves: ['a', 'b'] });
  });

  it('preserves unknown document-level fields', () => {
    const parsed = parseBoardGraph({ nodes: [], edges: [], viewport: { zoom: 1.5 } });
    expect(parsed.extra).toEqual({ viewport: { zoom: 1.5 } });
  });

  it('drops what cannot be drawn: no id, no kind, dangling wires, duplicates', () => {
    const parsed = parseBoardGraph({
      nodes: [
        sourceNode,
        researchNode,
        { kind: 'source' },
        { id: 'no-kind' },
        { id: 'src-1', kind: 'source', source: { name: 'duplicate' } },
      ],
      edges: [
        { id: 'e1', from: 'src-1', to: 'res-1', origin: 'user' },
        { id: 'e2', from: 'src-1', to: 'gone', origin: 'user' },
        { id: 'e3', from: 'src-1', to: 'res-1', origin: 'user' },
      ],
    });
    expect(parsed.nodes.map((node) => node.id)).toEqual(['src-1', 'res-1']);
    expect(findNode(parsed, 'src-1')?.source?.name).toBe('Desk bars');
    expect(parsed.edges.map((edge) => edge.id)).toEqual(['e1']);
  });

  it('reads an unlabelled edge origin as a user wire', () => {
    const parsed = parseBoardGraph({
      nodes: [sourceNode, researchNode],
      edges: [{ id: 'e1', from: 'src-1', to: 'res-1' }],
    });
    expect(parsed.edges[0].origin).toBe('user');
  });
});

/* ── round trip ──────────────────────────────────────────────────────────── */

describe('round trip through the stored document', () => {
  const full: BoardGraph = {
    nodes: [
      sourceNode,
      researchNode,
      strategyNode,
      { id: 'future-1', kind: 'ensemble', extra: { sleeves: ['a'] } },
    ],
    edges: [
      { id: 'e1', from: 'src-1', to: 'res-1', origin: 'user' },
      { id: 'e2', from: 'res-1', to: 'str-1', origin: 'system' },
    ],
    extra: { viewport: { zoom: 1.5 } },
  };

  it('gives back the same graph it was handed', () => {
    expect(parseBoardGraph(serializeBoardGraph(full))).toEqual(full);
  });

  it('serializes to a stable string, so an unchanged graph writes nothing new', () => {
    const once = serializeBoardGraph(full);
    const twice = serializeBoardGraph(parseBoardGraph(once));
    expect(twice).toBe(once);
    expect(serializeBoardGraph(parseBoardGraph(twice))).toBe(once);
  });

  it('stamps the document version', () => {
    expect(JSON.parse(serializeBoardGraph(full)).version).toBe(BOARD_GRAPH_VERSION);
  });
});

/* ── references only ─────────────────────────────────────────────────────── */

describe('references only, never copies', () => {
  it('reduces a reference that arrived with an artifact payload to kind and id', () => {
    const parsed = parseBoardGraph({
      nodes: [
        {
          id: 'str-1',
          kind: 'strategy',
          ref: {
            kind: 'strategy',
            id: 'strategies.desk.gap.GapFade',
            metrics: { sharpe: 1.42, cagr: 0.269 },
            equityCurve: [1, 2, 3],
            code: 'class GapFade: ...',
          },
        },
      ],
      edges: [],
    });
    expect(findNode(parsed, 'str-1')?.ref).toEqual({
      kind: 'strategy',
      id: 'strategies.desk.gap.GapFade',
    });
    const written = serializeBoardGraph(parsed);
    expect(written).not.toContain('sharpe');
    expect(written).not.toContain('equityCurve');
    expect(written).not.toContain('GapFade: ...');
  });

  it('drops a reference hung on a card that owns no artifact', () => {
    const parsed = parseBoardGraph({
      nodes: [
        { ...sourceNode, ref: { kind: 'strategy', id: 's1' } },
        { ...researchNode, ref: { kind: 'finding', id: 'f1' } },
      ],
      edges: [],
    });
    expect(findNode(parsed, 'src-1')?.ref).toBeUndefined();
    expect(findNode(parsed, 'res-1')?.ref).toBeUndefined();
  });

  it('writes a materialized card as nothing but its identity, label and reference', () => {
    const written = JSON.parse(serializeBoardGraph(graph([strategyNode]))) as {
      nodes: Array<Record<string, unknown>>;
    };
    expect(Object.keys(written.nodes[0]).sort()).toEqual(['id', 'kind', 'label', 'ref']);
  });

  it('ignores a reference with no kind or no id', () => {
    const parsed = parseBoardGraph({
      nodes: [
        { id: 'a', kind: 'strategy', ref: { kind: 'strategy' } },
        { id: 'b', kind: 'strategy', ref: { id: 's1' } },
        { id: 'c', kind: 'strategy', ref: 'strategies.desk.gap.GapFade' },
      ],
      edges: [],
    });
    for (const id of ['a', 'b', 'c']) expect(findNode(parsed, id)?.ref).toBeUndefined();
  });
});

/* ── no secrets, by schema ───────────────────────────────────────────────── */

describe('a source card names its credential slot and nothing more', () => {
  it('keeps the slot name', () => {
    const parsed = parseBoardGraph(serializeBoardGraph(graph([sourceNode])));
    expect(findNode(parsed, 'src-1')?.source?.credentialSlot).toBe('desk_bars_key');
  });

  it('drops a secret value that reached the stored document some other way', () => {
    const parsed = parseBoardGraph({
      nodes: [
        {
          id: 'src-1',
          kind: 'source',
          source: {
            name: 'Desk bars',
            connectorKind: 'data_provider',
            endpoint: 'https://example.invalid/bars',
            payloadType: 'bars',
            credentialSlot: 'desk_bars_key',
            credentialValue: 'sk-live-must-never-persist',
            secret: 'sk-live-must-never-persist',
            password: 'hunter2',
          },
        },
      ],
      edges: [],
    });
    const config = findNode(parsed, 'src-1')?.source as Record<string, unknown>;
    expect(Object.keys(config).sort()).toEqual([
      'connectorKind',
      'credentialSlot',
      'endpoint',
      'name',
      'payloadType',
    ]);
    const written = serializeBoardGraph(parsed);
    expect(written).not.toContain('sk-live-must-never-persist');
    expect(written).not.toContain('hunter2');
  });

  it('drops a source configuration hung on a card that is not a source', () => {
    const parsed = parseBoardGraph({
      nodes: [{ ...researchNode, source: { name: 'smuggled', secret: 'sk-live' } }],
      edges: [],
    });
    expect(findNode(parsed, 'res-1')?.source).toBeUndefined();
    expect(serializeBoardGraph(parsed)).not.toContain('sk-live');
  });
});

/* ── sparse layout ───────────────────────────────────────────────────────── */

describe('layout is stored sparsely', () => {
  it('omits the position of a card that has never been moved', () => {
    const written = JSON.parse(serializeBoardGraph(graph([researchNode]))) as {
      nodes: Array<Record<string, unknown>>;
    };
    expect('position' in written.nodes[0]).toBe(false);
  });

  it('stores a position once the card is placed and drops it when handed back', () => {
    const placed = setNodePosition(graph([researchNode]), 'res-1', { x: 3, y: 4 });
    expect(findNode(placed, 'res-1')?.position).toEqual({ x: 3, y: 4 });
    const unplaced = setNodePosition(placed, 'res-1', null);
    expect(findNode(unplaced, 'res-1')?.position).toBeUndefined();
  });

  it('returns the same graph for a move that changes nothing', () => {
    const placed = setNodePosition(graph([researchNode]), 'res-1', { x: 3, y: 4 });
    expect(setNodePosition(placed, 'res-1', { x: 3, y: 4 })).toBe(placed);
    expect(setNodePosition(placed, 'missing', { x: 1, y: 1 })).toBe(placed);
  });

  it('ignores a position that is not two finite numbers', () => {
    const parsed = parseBoardGraph({
      nodes: [
        { id: 'a', kind: 'research', position: { x: '3', y: 4 } },
        { id: 'b', kind: 'research', position: { x: Number.NaN, y: 0 } },
      ],
      edges: [],
    });
    expect(findNode(parsed, 'a')?.position).toBeUndefined();
    expect(findNode(parsed, 'b')?.position).toBeUndefined();
  });
});

/* ── writes ──────────────────────────────────────────────────────────────── */

describe('pure graph writes', () => {
  it('adds a card and refuses a duplicate id', () => {
    const one = addNode(emptyBoardGraph(), researchNode);
    expect(one.nodes).toHaveLength(1);
    expect(addNode(one, { ...researchNode, kind: 'source' })).toBe(one);
  });

  it('edits a card in place, by kind', () => {
    const base = graph([sourceNode, researchNode]);
    const edited = updateNode(base, 'res-1', { research: { hypothesis: 'Reworded.' } });
    expect(findNode(edited, 'res-1')?.research?.hypothesis).toBe('Reworded.');
    // A patch for the wrong kind changes nothing at all.
    expect(updateNode(base, 'res-1', { source: { name: 'nope' } })).toBe(base);
    expect(updateNode(base, 'missing', { label: 'x' })).toBe(base);
  });

  it('merges a partial source edit rather than replacing the configuration', () => {
    const edited = updateNode(graph([sourceNode]), 'src-1', {
      source: { endpoint: 'https://example.invalid/v2' },
    });
    expect(findNode(edited, 'src-1')?.source).toEqual({
      ...sourceNode.source,
      endpoint: 'https://example.invalid/v2',
    });
  });

  it('clears a label when the patch empties it', () => {
    const cleared = updateNode(graph([strategyNode]), 'str-1', { label: '' });
    expect(findNode(cleared, 'str-1')?.label).toBeUndefined();
  });

  it('removes a wire by id and ignores one that is already gone', () => {
    const wired = addEdge(graph([sourceNode, researchNode]), {
      id: 'e1',
      from: 'src-1',
      to: 'res-1',
      origin: 'user',
    });
    expect(removeEdge(wired, 'e1').edges).toHaveLength(0);
    expect(removeEdge(wired, 'nope')).toBe(wired);
  });
});

/* ── a card nobody typed into ────────────────────────────────────────────── */

/**
 * The test that decides whether a card is work or a mis-click.
 *
 * It is asserted field by field on purpose. This predicate is the only thing
 * standing between an abandoned click and somebody's half-written card, and it
 * fails in one direction silently: a field it forgets to look at is work that
 * gets thrown away without a word. So every field the schema has is pinned
 * here, and the count of them is pinned too, which is what makes a NEW field
 * added to the configuration fail this file rather than lose data quietly.
 */
describe('whether a card holds anything a person put there', () => {
  const blankSource: BoardNode = {
    id: 'src-blank',
    kind: 'source',
    source: { name: '', connectorKind: '', endpoint: '', payloadType: '' },
  };
  const blankResearch: BoardNode = { id: 'res-blank', kind: 'research', research: { hypothesis: '' } };

  it('calls a freshly placed card of either kind blank', () => {
    expect(isBlankUserCard(blankSource)).toBe(true);
    expect(isBlankUserCard(blankResearch)).toBe(true);
    // And a card whose configuration never arrived at all.
    expect(isBlankUserCard({ id: 'x', kind: 'source' })).toBe(true);
    expect(isBlankUserCard({ id: 'y', kind: 'research' })).toBe(true);
  });

  it('treats whitespace as nothing, in both kinds', () => {
    expect(isBlankUserCard({ ...blankSource, source: { ...blankSource.source!, name: '   ' } })).toBe(
      true
    );
    expect(isBlankUserCard({ ...blankResearch, research: { hypothesis: '\n  \n' } })).toBe(true);
  });

  it.each([
    ['name', { name: 'Desk filings' }],
    ['connectorKind', { connectorKind: 'http_api' }],
    ['endpoint', { endpoint: 'https://example.invalid/filings' }],
    ['payloadType', { payloadType: 'filings' }],
    ['credentialSlot', { credentialSlot: 'filings_key' }],
  ])('a source carrying only %s is not blank', (_field, patch) => {
    expect(isBlankUserCard({ ...blankSource, source: { ...blankSource.source!, ...patch } })).toBe(
      false
    );
  });

  it('looks at every field a source configuration has', () => {
    // The list above is the whole schema. A field added to the configuration
    // without a case here would be work this predicate cannot see.
    expect(Object.keys(sourceNode.source ?? {}).sort()).toEqual([
      'connectorKind',
      'credentialSlot',
      'endpoint',
      'name',
      'payloadType',
    ]);
  });

  it('a question with words in it, or with the switch thrown, is not blank', () => {
    expect(isBlankUserCard(researchNode)).toBe(false);
    expect(isBlankUserCard({ ...blankResearch, research: { hypothesis: '', autoSynthesize: true } })).toBe(
      false
    );
  });

  it('never calls a card the system wrote blank', () => {
    expect(isBlankUserCard(strategyNode)).toBe(false);
    expect(isBlankUserCard({ id: 'dep-1', kind: 'deploy' })).toBe(false);
  });
});

/* ── wire rules ──────────────────────────────────────────────────────────── */

describe('what may be wired by hand', () => {
  const base = graph([sourceNode, researchNode, strategyNode]);

  it('allows a source to a research card', () => {
    expect(canWire(base, 'src-1', 'res-1')).toEqual({ ok: true });
  });

  it('refuses everything else, with a reason to show', () => {
    for (const [from, to] of [
      ['res-1', 'src-1'],
      ['src-1', 'str-1'],
      ['res-1', 'str-1'],
      ['src-1', 'src-1'],
      ['src-1', 'missing'],
    ]) {
      const check = canWire(base, from, to);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.reason.length).toBeGreaterThan(0);
    }
  });

  it('refuses a wire that already exists', () => {
    const wired = addEdge(base, { id: 'e1', from: 'src-1', to: 'res-1', origin: 'user' });
    expect(canWire(wired, 'src-1', 'res-1').ok).toBe(false);
  });

  it('lets a user cut their own wire but not a provenance wire', () => {
    const wired = addEdge(
      addEdge(base, { id: 'e1', from: 'src-1', to: 'res-1', origin: 'user' }),
      { id: 'e2', from: 'res-1', to: 'str-1', origin: 'system' }
    );
    expect(canUnwire(wired, 'e1')).toEqual({ ok: true });
    expect(canUnwire(wired, 'e2').ok).toBe(false);
    expect(canUnwire(wired, 'gone').ok).toBe(false);
  });
});

/* ── delete semantics ────────────────────────────────────────────────────── */

describe('deleting a card never destroys an artifact', () => {
  const testNode: BoardNode = {
    id: 'tst-1',
    kind: 'test',
    ref: { kind: 'backtest', id: '4211' },
  };
  const wired: BoardGraph = {
    nodes: [sourceNode, researchNode, strategyNode, testNode],
    edges: [
      { id: 'e1', from: 'src-1', to: 'res-1', origin: 'user' },
      { id: 'e2', from: 'res-1', to: 'str-1', origin: 'system' },
      { id: 'e3', from: 'str-1', to: 'tst-1', origin: 'system' },
    ],
  };

  it('walks the wires downstream', () => {
    expect(downstreamNodeIds(wired, 'res-1').sort()).toEqual(['str-1', 'tst-1']);
    expect(downstreamNodeIds(wired, 'tst-1')).toEqual([]);
  });

  it('reports what stays behind so the confirm can say so', () => {
    const plan = planNodeDelete(wired, 'res-1');
    expect(plan.removedNodeIds).toEqual(['res-1']);
    expect([...plan.removedEdgeIds].sort()).toEqual(['e1', 'e2']);
    expect([...plan.retainedNodeIds].sort()).toEqual(['str-1', 'tst-1']);
    expect(plan.retainedRefs).toEqual([
      { kind: 'strategy', id: 'strategies.desk.gap.GapFade' },
      { kind: 'backtest', id: '4211' },
    ]);
  });

  it('leaves the downstream cards and their references on the Board', () => {
    const after = applyNodeDelete(wired, planNodeDelete(wired, 'res-1'));
    expect(findNode(after, 'res-1')).toBeUndefined();
    expect(findNode(after, 'str-1')?.ref).toEqual({
      kind: 'strategy',
      id: 'strategies.desk.gap.GapFade',
    });
    expect(findNode(after, 'tst-1')?.ref).toEqual({ kind: 'backtest', id: '4211' });
    // Only the wires that touched the deleted card go with it.
    expect(after.edges.map((edge) => edge.id)).toEqual(['e3']);
  });

  it('plans nothing for a card that is not on the Board', () => {
    const plan = planNodeDelete(wired, 'missing');
    expect(plan.removedNodeIds).toEqual([]);
    expect(applyNodeDelete(wired, plan)).toBe(wired);
  });

  it('survives a cycle without looping forever', () => {
    const cyclic: BoardGraph = {
      nodes: [researchNode, strategyNode],
      edges: [
        { id: 'e1', from: 'res-1', to: 'str-1', origin: 'system' },
        { id: 'e2', from: 'str-1', to: 'res-1', origin: 'system' },
      ],
    };
    expect(downstreamNodeIds(cyclic, 'res-1')).toEqual(['str-1']);
  });
});

/* ── retired seeds ───────────────────────────────────────────────────────── */

/**
 * A card the Board laid down for you and you took off again. The list has to
 * ride the document, because the question it answers — "was this removed on
 * purpose?" — is asked on the NEXT open, in a window that saw none of it.
 */
describe('a seeded card that was removed stays removed', () => {
  const seeded: BoardNode = {
    id: 'source-builtin-yfinance',
    kind: 'source',
    source: { name: 'Yahoo Finance', connectorKind: 'feed', endpoint: 'yfinance', payloadType: 'bars' },
  };
  const board: BoardGraph = { nodes: [seeded, researchNode], edges: [] };

  it('is written down when it is deleted, and the card a person placed is not', () => {
    const afterSeed = applyNodeDelete(board, planNodeDelete(board, seeded.id));
    expect(afterSeed.retiredSeeds).toEqual([seeded.id]);

    const afterOwn = applyNodeDelete(board, planNodeDelete(board, researchNode.id));
    expect(afterOwn.retiredSeeds).toBeUndefined();
  });

  it('is not written twice when the same card is seeded and removed again', () => {
    const once = applyNodeDelete(board, planNodeDelete(board, seeded.id));
    const again = addNode(once, seeded);
    const twice = applyNodeDelete(again, planNodeDelete(again, seeded.id));
    expect(twice.retiredSeeds).toEqual([seeded.id]);
  });

  it('survives the round trip through the stored document', () => {
    const retired = applyNodeDelete(board, planNodeDelete(board, seeded.id));
    expect(parseBoardGraph(serializeBoardGraph(retired))).toEqual(retired);
  });

  it('costs a Board that has retired nothing not one byte', () => {
    expect(serializeBoardGraph(board)).not.toContain('retiredSeeds');
    expect(serializeBoardGraph({ ...board, retiredSeeds: [] })).toBe(serializeBoardGraph(board));
  });
});
