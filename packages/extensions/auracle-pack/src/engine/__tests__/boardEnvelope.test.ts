/**
 * What the agent is told about a card — and, more to the point, what it is not.
 *
 * The envelope is the one place a Board's contents cross into a conversation,
 * so these tests are written from the leak's point of view rather than the
 * feature's. Every case that could carry a secret across is planted with a
 * probe value: a config object fattened with a `secret` field the way a careless
 * caller would fatten it, an `extra` bag holding one the way a foreign build
 * might, and a slot that has a name. None of them may come out the other side,
 * and neither may the fact of whether the slot holds anything.
 *
 * The other half is the chain. An envelope that named a card without naming
 * what feeds it would make the agent ask the person to re-explain their own
 * Board, so the ordering (sources, then the question, then what came out of it)
 * is pinned from graph fixtures rather than assumed.
 */
import { describe, expect, it } from 'vitest';

import type { BoardGraph, BoardNode, BoardSourceConfig } from '../boardGraph';
import {
  artifactViews,
  boardGraphView,
  boardNodeContext,
  cardView,
  upstreamChain,
} from '../boardEnvelope';
import { SECRET_PROBE, SECRET_PROBE_ALT, secretFindings } from './boardSecretProbe';

/* ── fixtures ────────────────────────────────────────────────────────────── */

const FILINGS: BoardSourceConfig = {
  name: 'Filings stream',
  connectorKind: 'http_api',
  endpoint: 'https://example.invalid/filings',
  payloadType: 'news',
  credentialSlot: 'filings_key',
};

const BARS: BoardSourceConfig = {
  name: 'Daily bars',
  connectorKind: 'feed',
  endpoint: 'https://example.invalid/bars',
  payloadType: 'bars',
};

/**
 * The Board these tests read: two sources into one question, a strategy that
 * came out of it, and a run of that strategy — every hop the chain has to be
 * able to walk.
 */
const GRAPH: BoardGraph = {
  nodes: [
    { id: 'src-1', kind: 'source', source: FILINGS },
    { id: 'src-2', kind: 'source', source: BARS },
    { id: 'q-1', kind: 'research', research: { hypothesis: 'Do late filings predict drift?' } },
    {
      id: 's-1',
      kind: 'strategy',
      ref: { kind: 'strategy', id: 'strategies.desk.drift.Drift' },
      label: 'Drift',
    },
    { id: 't-1', kind: 'test', ref: { kind: 'backtest', id: '913' }, label: 'Drift' },
  ],
  edges: [
    { id: 'w-1', from: 'src-1', to: 'q-1', origin: 'user' },
    { id: 'w-2', from: 'src-2', to: 'q-1', origin: 'user' },
    { id: 'p-1', from: 'q-1', to: 's-1', origin: 'system' },
    { id: 'p-2', from: 's-1', to: 't-1', origin: 'system' },
  ],
};

/** A source card as a careless caller would leave it: the schema's fields, plus
 *  a pasted secret and a flag saying the slot is filled. */
const FATTENED: BoardNode = {
  id: 'src-3',
  kind: 'source',
  source: {
    ...FILINGS,
    secret: SECRET_PROBE,
    apiKey: SECRET_PROBE_ALT,
    credentialSet: true,
  } as unknown as BoardSourceConfig,
  extra: { drafted: 'strategies.desk.drift', secret: SECRET_PROBE },
};

/* ── one card, reduced ───────────────────────────────────────────────────── */

describe('a card, as the agent may see it', () => {
  it('states a source by its description and the NAME of its slot', () => {
    expect(cardView(GRAPH.nodes[0])).toEqual({
      id: 'src-1',
      kind: 'source',
      config: {
        name: 'Filings stream',
        connector_kind: 'http_api',
        endpoint: 'https://example.invalid/filings',
        payload_type: 'news',
        credential_slot: 'filings_key',
      },
    });
  });

  it('omits the slot entirely when the source needs no key', () => {
    expect(cardView(GRAPH.nodes[1]).config).not.toHaveProperty('credential_slot');
  });

  it('states a research card by its question', () => {
    expect(cardView(GRAPH.nodes[2])).toEqual({
      id: 'q-1',
      kind: 'research',
      config: { hypothesis: 'Do late filings predict drift?' },
    });
  });

  it('states a materialized card by reference, never by copy', () => {
    const view = cardView(GRAPH.nodes[3]);
    expect(view.artifact).toEqual({ kind: 'strategy', id: 'strategies.desk.drift.Drift' });
    expect(view.config).toBeUndefined();
  });

  it('drops a pasted secret, a lookalike field and the slot state', () => {
    const view = cardView(FATTENED);
    expect(secretFindings('card view', view)).toEqual([]);
    expect(view.config).toEqual({
      name: 'Filings stream',
      connector_kind: 'http_api',
      endpoint: 'https://example.invalid/filings',
      payload_type: 'news',
      credential_slot: 'filings_key',
    });
  });

  it('never emits the extra bag, whose contents this build has not inspected', () => {
    expect(cardView(FATTENED)).not.toHaveProperty('extra');
    expect(JSON.stringify(cardView(FATTENED))).not.toContain('drafted');
  });

  it('keeps a future kind addressable without inventing a configuration for it', () => {
    const view = cardView({ id: 'x-1', kind: 'sketch', label: 'From a newer build' });
    expect(view).toEqual({ id: 'x-1', kind: 'sketch', label: 'From a newer build' });
  });
});

/* ── the chain a card sits at the end of ─────────────────────────────────── */

describe('the upstream chain', () => {
  it('is empty for a source: nothing feeds it', () => {
    expect(upstreamChain(GRAPH, 'src-1')).toEqual([]);
  });

  it('is the wired sources for a research card', () => {
    expect(upstreamChain(GRAPH, 'q-1').map((node) => node.id)).toEqual(['src-1', 'src-2']);
  });

  it('is the research card AND its sources for a strategy, furthest first', () => {
    expect(upstreamChain(GRAPH, 's-1').map((node) => node.id)).toEqual(['src-1', 'src-2', 'q-1']);
  });

  it('walks every hop for a run, so the data behind it is still named', () => {
    expect(upstreamChain(GRAPH, 't-1').map((node) => node.id)).toEqual([
      'src-1',
      'src-2',
      'q-1',
      's-1',
    ]);
  });

  it('is empty for a materialized card with no provenance wire, rather than guessed', () => {
    const orphan: BoardGraph = {
      nodes: [...GRAPH.nodes, { id: 's-2', kind: 'strategy', ref: { kind: 'strategy', id: 'x' } }],
      edges: GRAPH.edges,
    };
    expect(upstreamChain(orphan, 's-2')).toEqual([]);
  });
});

/* ── what came out of a card ─────────────────────────────────────────────── */

describe('the artifacts a card is answerable for', () => {
  it('are the downstream references for a question that owns none itself', () => {
    expect(artifactViews(GRAPH, 'q-1')).toEqual([
      { node_id: 's-1', kind: 'strategy', id: 'strategies.desk.drift.Drift', label: 'Drift' },
      { node_id: 't-1', kind: 'backtest', id: '913', label: 'Drift' },
    ]);
  });

  it('include the reference the card itself holds, when it holds one', () => {
    expect(artifactViews(GRAPH, 's-1').map((ref) => ref.node_id)).toEqual(['s-1', 't-1']);
  });

  it('are empty for a card nothing has come out of yet', () => {
    const fresh: BoardGraph = {
      nodes: [...GRAPH.nodes, { id: 'src-9', kind: 'source', source: BARS }],
      edges: GRAPH.edges,
    };
    expect(artifactViews(fresh, 'src-9')).toEqual([]);
  });

  it('follow the whole chain from a wired source, which is what its data fed', () => {
    expect(artifactViews(GRAPH, 'src-2').map((ref) => ref.node_id)).toEqual(['s-1', 't-1']);
  });
});

/* ── the envelope ────────────────────────────────────────────────────────── */

describe('the envelope a selected card publishes', () => {
  it('names the surface, the card, its chain and its artifacts', () => {
    expect(boardNodeContext(GRAPH, 'q-1')).toEqual({
      panel: 'grid',
      face: 'board',
      card: { id: 'q-1', kind: 'research', config: { hypothesis: 'Do late filings predict drift?' } },
      upstream: [cardView(GRAPH.nodes[0]), cardView(GRAPH.nodes[1])],
      artifacts: artifactViews(GRAPH, 'q-1'),
    });
  });

  it('is null for a card that is not on the Board', () => {
    expect(boardNodeContext(GRAPH, 'nope')).toBeNull();
  });

  it('carries no credential value and no slot state, on any card', () => {
    const fattened: BoardGraph = { nodes: [...GRAPH.nodes, FATTENED], edges: GRAPH.edges };
    const findings = fattened.nodes.flatMap((node) =>
      secretFindings(`envelope ${node.id}`, boardNodeContext(fattened, node.id))
    );
    expect(findings).toEqual([]);
  });
});

/* ── the whole Board ─────────────────────────────────────────────────────── */

describe('the graph snapshot', () => {
  it('reduces every card and reports every wire with its origin', () => {
    const view = boardGraphView(GRAPH);
    expect(view.nodes.map((node) => node.id)).toEqual(['src-1', 'src-2', 'q-1', 's-1', 't-1']);
    expect(view.edges).toEqual([
      { id: 'w-1', from: 'src-1', to: 'q-1', origin: 'user' },
      { id: 'w-2', from: 'src-2', to: 'q-1', origin: 'user' },
      { id: 'p-1', from: 'q-1', to: 's-1', origin: 'system' },
      { id: 'p-2', from: 's-1', to: 't-1', origin: 'system' },
    ]);
  });

  it('carries no credential value even when a stored card was fattened with one', () => {
    const fattened: BoardGraph = { nodes: [...GRAPH.nodes, FATTENED], edges: GRAPH.edges };
    expect(secretFindings('board_list', boardGraphView(fattened))).toEqual([]);
  });
});
