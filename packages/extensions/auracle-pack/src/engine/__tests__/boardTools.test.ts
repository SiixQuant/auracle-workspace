/**
 * The agent's hands on the Board, one verb at a time.
 *
 * Every case here is a ROUND TRIP: the tool writes, and what it claims is then
 * read back off the store the canvas draws from. That is the property worth
 * pinning — not that a function returned a hopeful message, but that the graph
 * a person is looking at actually changed, and changed the way the tool said.
 *
 * Three refusals get as much room as the successes, because each is a way the
 * surface could quietly become dishonest:
 *  - a credential value must be refused BY NAME, never dropped. An agent whose
 *    field was silently ignored goes on believing the key is stored;
 *  - a rule the canvas enforces must be refused in the canvas's own words, so a
 *    person hears one explanation rather than two;
 *  - a closed Board must refuse rather than accept a card into a snapshot
 *    nobody saves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findNode } from '../boardGraph';
import { boardGraphStore } from '../boardGraphStore';
import type { BoardGraphTransport } from '../boardPersistence';
import {
  boardCreateCard,
  boardDeleteCard,
  boardList,
  boardReadOutputs,
  boardUnwire,
  boardUpdateCard,
  boardWire,
} from '../boardTools';
import { registerPanelEventSink, __resetPanelEventSinkForTests } from '../panelEvents';
import { SECRET_PROBE, secretFindings } from './boardSecretProbe';

/** A settings lane in memory — the Board has to be OPEN for any of this. */
function mockLane(): BoardGraphTransport {
  const docs: Record<string, string> = {};
  return {
    async load(workspaceId: string) {
      return docs[workspaceId] ?? null;
    },
    async save(workspaceId: string, json: string) {
      docs[workspaceId] = json;
      return true;
    },
  };
}

async function openBoard(): Promise<void> {
  await boardGraphStore.open('ws-1', { transport: mockLane(), saveDelayMs: 10_000 });
}

function graph() {
  return boardGraphStore.getSnapshot().graph;
}

/** The two cards most cases start from, wired. */
async function seedLane(): Promise<{ source: string; research: string }> {
  await openBoard();
  const source = expectOk(
    boardCreateCard({
      kind: 'source',
      config: {
        name: 'Filings stream',
        connector_kind: 'http_api',
        endpoint: 'https://example.invalid/filings',
        payload_type: 'news',
        credential_slot: 'filings_key',
      },
    })
  ).data.node_id as string;
  const research = expectOk(
    boardCreateCard({ kind: 'research', config: { hypothesis: 'Do late filings predict drift?' } })
  ).data.node_id as string;
  expectOk(boardWire({ from: source, to: research }));
  return { source, research };
}

function expectOk(outcome: ReturnType<typeof boardList>): {
  message: string;
  data: Record<string, unknown>;
} {
  if (!outcome.ok) throw new Error(`expected success, got refusal: ${outcome.error}`);
  return outcome;
}

function refusal(outcome: ReturnType<typeof boardList>): string {
  if (outcome.ok) throw new Error(`expected a refusal, got: ${outcome.message}`);
  return outcome.error;
}

afterEach(() => {
  boardGraphStore.reset();
  __resetPanelEventSinkForTests();
});

/* ── a closed Board ──────────────────────────────────────────────────────── */

describe('a Board nobody has opened', () => {
  it('refuses every verb rather than writing into a snapshot nobody saves', () => {
    const calls = [
      boardList(),
      boardCreateCard({ kind: 'research', config: { hypothesis: 'x' } }),
      boardUpdateCard({ node_id: 'a', label: 'x' }),
      boardWire({ from: 'a', to: 'b' }),
      boardUnwire({ edge_id: 'w' }),
      boardDeleteCard({ node_id: 'a' }),
      boardReadOutputs({ node_id: 'a' }),
    ];
    for (const outcome of calls) expect(refusal(outcome)).toContain('The Board is not open');
    expect(graph().nodes).toEqual([]);
  });
});

/* ── placing cards ───────────────────────────────────────────────────────── */

describe('board_create_card', () => {
  it('places a source and hands back the id the graph knows it by', async () => {
    await openBoard();
    const created = expectOk(
      boardCreateCard({
        kind: 'source',
        config: {
          name: 'Filings stream',
          connector_kind: 'http_api',
          endpoint: 'https://example.invalid/filings',
          payload_type: 'news',
          credential_slot: 'filings_key',
        },
        position: { x: 40, y: 12 },
      })
    );
    const nodeId = created.data.node_id as string;
    const node = findNode(graph(), nodeId);
    expect(node?.kind).toBe('source');
    expect(node?.source).toEqual({
      name: 'Filings stream',
      connectorKind: 'http_api',
      endpoint: 'https://example.invalid/filings',
      payloadType: 'news',
      credentialSlot: 'filings_key',
    });
    expect(node?.position).toEqual({ x: 40, y: 12 });
    expect(created.data.card).toMatchObject({ id: nodeId, kind: 'source' });
  });

  it('places a research card carrying the question as typed', async () => {
    await openBoard();
    const nodeId = expectOk(
      boardCreateCard({ kind: 'research', config: { hypothesis: 'Does drift persist?' } })
    ).data.node_id as string;
    expect(findNode(graph(), nodeId)?.research).toEqual({ hypothesis: 'Does drift persist?' });
  });

  it('refuses a credential value BY NAME rather than dropping it', async () => {
    await openBoard();
    const reason = refusal(
      boardCreateCard({
        kind: 'source',
        config: { name: 'Filings', secret: SECRET_PROBE },
      })
    );
    expect(reason).toContain('secret');
    expect(reason).toContain('credential_slot');
    expect(graph().nodes).toEqual([]);
  });

  it.each(['api_key', 'apiKey', 'token', 'password', 'access_key', 'bearer_token'])(
    'refuses %s the same way',
    async (field) => {
      await openBoard();
      const reason = refusal(
        boardCreateCard({ kind: 'source', config: { [field]: SECRET_PROBE } })
      );
      expect(reason).toContain('never travels through a board tool');
      expect(graph().nodes).toEqual([]);
    }
  );

  it('still accepts the slot NAME, which is the whole point of the field', async () => {
    await openBoard();
    const nodeId = expectOk(
      boardCreateCard({ kind: 'source', config: { credential_slot: 'filings_key' } })
    ).data.node_id as string;
    expect(findNode(graph(), nodeId)?.source?.credentialSlot).toBe('filings_key');
  });

  it('refuses a field that is not on the card at all, naming what is', async () => {
    await openBoard();
    expect(refusal(boardCreateCard({ kind: 'source', config: { region: 'us' } }))).toContain(
      'not a field on a source card'
    );
  });

  it('refuses a non-string value, so nothing nested can ride in', async () => {
    await openBoard();
    expect(
      refusal(boardCreateCard({ kind: 'source', config: { name: { deep: SECRET_PROBE } } }))
    ).toContain('must be a string');
  });

  it('refuses a kind the system writes, rather than forging provenance', async () => {
    await openBoard();
    expect(refusal(boardCreateCard({ kind: 'strategy' }))).toContain('written by the system');
  });
});

/* ── editing ─────────────────────────────────────────────────────────────── */

describe('board_update_card', () => {
  it('edits a question in place', async () => {
    const { research } = await seedLane();
    expectOk(boardUpdateCard({ node_id: research, config: { hypothesis: 'Sharpened.' } }));
    expect(findNode(graph(), research)?.research).toEqual({ hypothesis: 'Sharpened.' });
  });

  it('merges one source field without clearing the others', async () => {
    const { source } = await seedLane();
    expectOk(boardUpdateCard({ node_id: source, config: { payload_type: 'filings' } }));
    expect(findNode(graph(), source)?.source).toEqual({
      name: 'Filings stream',
      connectorKind: 'http_api',
      endpoint: 'https://example.invalid/filings',
      payloadType: 'filings',
      credentialSlot: 'filings_key',
    });
  });

  it('refuses a value-shaped field, and changes nothing', async () => {
    const { source } = await seedLane();
    const before = findNode(graph(), source)?.source;
    expect(refusal(boardUpdateCard({ node_id: source, config: { secret: SECRET_PROBE } }))).toContain(
      'never travels through a board tool'
    );
    expect(findNode(graph(), source)?.source).toEqual(before);
  });

  it('refuses a card the system wrote: its configuration is the artifact it points at', async () => {
    await openBoard();
    const materialized = boardGraphStore.materialize({
      kind: 'strategy',
      ref: { kind: 'strategy', id: 'strategies.desk.drift.Drift' },
    });
    expect(materialized.ok).toBe(true);
    const nodeId = materialized.ok ? materialized.nodeId : '';
    expect(refusal(boardUpdateCard({ node_id: nodeId, config: { name: 'x' } }))).toContain(
      'not editable'
    );
  });

  it('refuses a card that is not there', async () => {
    await openBoard();
    expect(refusal(boardUpdateCard({ node_id: 'nope', label: 'x' }))).toContain('not on the Board');
  });

  it('refuses an empty edit rather than reporting a change it did not make', async () => {
    const { research } = await seedLane();
    expect(refusal(boardUpdateCard({ node_id: research }))).toContain('Nothing to change');
  });

  it('sets and clears a label', async () => {
    const { research } = await seedLane();
    expectOk(boardUpdateCard({ node_id: research, label: 'Drift question' }));
    expect(findNode(graph(), research)?.label).toBe('Drift question');
    expectOk(boardUpdateCard({ node_id: research, label: '' }));
    expect(findNode(graph(), research)?.label).toBeUndefined();
  });
});

/* ── wiring ──────────────────────────────────────────────────────────────── */

describe('board_wire and board_unwire', () => {
  it('draws a source into a question and reports the wire id', async () => {
    const { source, research } = await seedLane();
    const edge = graph().edges.find((row) => row.from === source && row.to === research);
    expect(edge?.origin).toBe('user');
    expectOk(boardUnwire({ edge_id: edge?.id ?? '' }));
    expect(graph().edges).toEqual([]);
  });

  it('carries the canvas rule out in the canvas words', async () => {
    const { source, research } = await seedLane();
    expect(refusal(boardWire({ from: research, to: source }))).toBe('Wires start at a source card.');
    expect(refusal(boardWire({ from: source, to: research }))).toBe(
      'These cards are already wired.'
    );
    expect(refusal(boardWire({ from: source, to: source }))).toBe('A card cannot wire to itself.');
  });

  it('refuses to cut a provenance wire, which records where work came from', async () => {
    const { research } = await seedLane();
    const materialized = boardGraphStore.materialize({
      kind: 'strategy',
      ref: { kind: 'strategy', id: 'strategies.desk.drift.Drift' },
      from: research,
    });
    expect(materialized.ok).toBe(true);
    const provenance = graph().edges.find((edge) => edge.origin === 'system');
    expect(refusal(boardUnwire({ edge_id: provenance?.id ?? '' }))).toContain('cannot be cut');
    expect(graph().edges.some((edge) => edge.id === provenance?.id)).toBe(true);
  });

  it('refuses a wire id that is already gone', async () => {
    await openBoard();
    expect(refusal(boardUnwire({ edge_id: 'w-nope' }))).toBe('That wire is already gone.');
  });
});

/* ── removing ────────────────────────────────────────────────────────────── */

describe('board_delete_card', () => {
  /** A question with a strategy and a run hanging off it. */
  async function seedWithOutputs(): Promise<{ research: string; strategy: string }> {
    const { research } = await seedLane();
    const strategy = boardGraphStore.materialize({
      kind: 'strategy',
      ref: { kind: 'strategy', id: 'strategies.desk.drift.Drift' },
      from: research,
    });
    const strategyId = strategy.ok ? strategy.nodeId : '';
    boardGraphStore.materialize({
      kind: 'test',
      ref: { kind: 'backtest', id: '913' },
      from: strategyId,
    });
    return { research, strategy: strategyId };
  }

  it('previews without removing, and states what stays', async () => {
    const { research } = await seedWithOutputs();
    const preview = expectOk(boardDeleteCard({ node_id: research, preview: true }));
    expect(preview.data.previewed).toBe(true);
    expect(preview.data.retained_node_ids).toHaveLength(2);
    expect(preview.data.retained_artifacts).toEqual([
      { kind: 'strategy', id: 'strategies.desk.drift.Drift' },
      { kind: 'backtest', id: '913' },
    ]);
    expect(preview.message).toContain('2 cards downstream stay');
    expect(preview.message).toContain('2 saved results');
    expect(findNode(graph(), research)).toBeDefined();
  });

  it('removes only the card and its own wires, and says the same thing afterwards', async () => {
    const { research, strategy } = await seedWithOutputs();
    const removed = expectOk(boardDeleteCard({ node_id: research }));
    expect(removed.data.previewed).toBe(false);
    expect(removed.data.removed_node_ids).toEqual([research]);
    expect(removed.message).toContain('2 cards downstream stayed');
    expect(findNode(graph(), research)).toBeUndefined();
    // The strategy and the run are still there, still pointing at engine
    // artifacts no board action can destroy.
    expect(findNode(graph(), strategy)?.ref).toEqual({
      kind: 'strategy',
      id: 'strategies.desk.drift.Drift',
    });
    expect(graph().nodes).toHaveLength(3);
  });

  it('states plainly when nothing depends on the card', async () => {
    const { source } = await seedLane();
    expect(expectOk(boardDeleteCard({ node_id: source, preview: true })).message).toContain(
      '1 card downstream stays'
    );
    const alone = expectOk(boardCreateCard({ kind: 'research', config: { hypothesis: 'Alone?' } }));
    expect(
      expectOk(boardDeleteCard({ node_id: alone.data.node_id as string, preview: true })).message
    ).toContain('Nothing downstream depends on it');
  });

  it('refuses a card that is not there rather than reporting an empty plan', async () => {
    await openBoard();
    expect(refusal(boardDeleteCard({ node_id: 'nope' }))).toContain('not on the Board');
  });
});

/* ── reading ─────────────────────────────────────────────────────────────── */

describe('board_list and board_read_outputs', () => {
  it('lists every card and wire, with no credential value anywhere in the answer', async () => {
    const { source, research } = await seedLane();
    const listed = expectOk(boardList());
    expect(listed.data.status).toBe('idle');
    expect((listed.data.nodes as unknown[]).map((node) => (node as { id: string }).id)).toEqual([
      source,
      research,
    ]);
    expect((listed.data.edges as unknown[])).toHaveLength(1);
    expect(secretFindings('board_list', listed.data)).toEqual([]);
  });

  it('answers a question card with the artifacts downstream of it, by reference', async () => {
    const { source, research } = await seedLane();
    const strategy = boardGraphStore.materialize({
      kind: 'strategy',
      ref: { kind: 'strategy', id: 'strategies.desk.drift.Drift' },
      from: research,
    });
    expect(strategy.ok).toBe(true);
    const outputs = expectOk(boardReadOutputs({ node_id: research }));
    expect(outputs.data.artifacts).toEqual([
      {
        node_id: strategy.ok ? strategy.nodeId : '',
        kind: 'strategy',
        id: 'strategies.desk.drift.Drift',
      },
    ]);
    expect((outputs.data.upstream as { id: string }[]).map((card) => card.id)).toEqual([source]);
    expect(secretFindings('board_read_outputs', outputs.data)).toEqual([]);
  });

  it('says plainly when nothing has come out of a card', async () => {
    const { research } = await seedLane();
    expect(expectOk(boardReadOutputs({ node_id: research })).message).toContain('Nothing has come out');
  });
});

/* ── what the mutation reports ───────────────────────────────────────────── */

describe('the report a mutation leaves behind', () => {
  it('names the verb and the card, and carries no configuration with it', async () => {
    const notifyChange = vi.fn();
    registerPanelEventSink({ notifyChange });
    const { source, research } = await seedLane();
    expectOk(boardUpdateCard({ node_id: source, config: { name: 'Renamed' } }));
    expectOk(boardDeleteCard({ node_id: research }));

    const verbs = notifyChange.mock.calls.map(
      ([, envelope]) => (envelope as { payload: { verb: string } }).payload.verb
    );
    expect(verbs).toEqual(['create', 'create', 'wire', 'update', 'delete']);
    for (const [event, envelope] of notifyChange.mock.calls) {
      expect(event).toBe('board.mutated');
      expect(envelope).toMatchObject({ v: 1, type: 'board.mutated' });
      expect((envelope as { payload: { actor: string } }).payload.actor).toBe('agent');
      expect(secretFindings('board.mutated', envelope)).toEqual([]);
      expect(JSON.stringify(envelope)).not.toContain('filings_key');
    }
  });

  it('is a silent no-op on a host with no proactive lane', async () => {
    registerPanelEventSink({});
    await expect(seedLane()).resolves.toBeDefined();
  });
});
