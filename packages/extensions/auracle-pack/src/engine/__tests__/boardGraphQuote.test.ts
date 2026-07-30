/**
 * The quote card in the Board graph — that it persists like any other card, and
 * that adding it disturbed NOTHING the graph already knew (AC12 / I7).
 *
 * What is pinned here:
 *  - a quote card round-trips: parse ∘ serialize is identity, contracts and all;
 *  - a quote card owns no artifact — a ref on one is dropped, the same rule
 *    source and research cards keep;
 *  - a half-typed contract survives an edit rather than vanishing under the
 *    cursor, but a truly blank card is still blank (so it can be taken back);
 *  - and a source card serializes byte-for-byte as it did before this kind
 *    existed — the new field is written only when a quote card carries it.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_NODE_KINDS,
  isBlankUserCard,
  normalizeQuoteConfig,
  parseBoardGraph,
  serializeBoardGraph,
  updateNode,
  type BoardGraph,
  type BoardNode,
} from '../boardGraph';

const OPTION = {
  symbol: 'AAPL',
  secType: 'OPT',
  expiry: '20260117',
  strike: 200,
  right: 'C' as const,
};

function graph(nodes: BoardNode[], edges: BoardGraph['edges'] = []): BoardGraph {
  return { nodes, edges };
}

describe('the quote kind is additive (AC12 / I7)', () => {
  it('is a known kind without displacing any of the old ones', () => {
    expect(BOARD_NODE_KINDS).toContain('quote');
    for (const kind of ['source', 'research', 'strategy', 'test', 'deploy']) {
      expect(BOARD_NODE_KINDS as readonly string[]).toContain(kind);
    }
  });

  it('parses a mixed board without touching the other cards', () => {
    const doc = {
      version: 1,
      nodes: [
        { id: 'src-1', kind: 'source', source: { name: 'Yahoo', connectorKind: 'feed', endpoint: 'yfinance', payloadType: 'bars' } },
        { id: 'res-1', kind: 'research', research: { hypothesis: 'gaps mean-revert' } },
        { id: 'q-1', kind: 'quote', quote: { contracts: [OPTION] } },
        { id: 'str-1', kind: 'strategy', ref: { kind: 'strategy', id: 's.Gap' } },
      ],
      edges: [{ id: 'e1', from: 'src-1', to: 'res-1', origin: 'user' }],
    };
    const parsed = parseBoardGraph(doc);
    expect(parsed.nodes.map((node) => node.id)).toEqual(['src-1', 'res-1', 'q-1', 'str-1']);
    expect(parsed.nodes.find((node) => node.id === 'src-1')?.source?.name).toBe('Yahoo');
    expect(parsed.nodes.find((node) => node.id === 'q-1')?.quote?.contracts[0]).toMatchObject(OPTION);
  });

  it('round-trips a quote card, contracts and name and all', () => {
    const full = graph([
      {
        id: 'q-1',
        kind: 'quote',
        quote: {
          name: 'Desk watch',
          contracts: [
            { symbol: 'AAPL', secType: 'STK' },
            OPTION,
            { symbol: 'EUR', secType: 'CASH', currency: 'USD' },
          ],
        },
      },
    ]);
    expect(parseBoardGraph(serializeBoardGraph(full))).toEqual(full);
  });

  it('drops an artifact ref on a quote card, as it does on a source', () => {
    const parsed = parseBoardGraph({
      version: 1,
      nodes: [{ id: 'q-1', kind: 'quote', quote: { contracts: [] }, ref: { kind: 'strategy', id: 's' } }],
      edges: [],
    });
    expect(parsed.nodes[0].ref).toBeUndefined();
  });

  it('leaves a source card serializing byte-for-byte as before', () => {
    const written = JSON.parse(
      serializeBoardGraph(
        graph([
          { id: 's', kind: 'source', source: { name: 'Y', connectorKind: 'feed', endpoint: 'y', payloadType: 'bars' } },
        ])
      )
    ) as { nodes: Array<Record<string, unknown>> };
    expect(Object.keys(written.nodes[0]).sort()).toEqual(['id', 'kind', 'source']);
  });
});

describe('normalizing a quote config', () => {
  it('keeps valid contracts and drops one whose type it does not know', () => {
    const config = normalizeQuoteConfig({
      contracts: [
        { symbol: 'AAPL', secType: 'STK' },
        { symbol: 'X', secType: 'NONSENSE' },
        OPTION,
      ],
    });
    expect(config?.contracts).toHaveLength(2);
    expect(config?.contracts[1]).toMatchObject(OPTION);
  });

  it('keeps a half-typed contract so an edit does not drop it under the cursor', () => {
    const config = normalizeQuoteConfig({ contracts: [{ symbol: '', secType: 'STK' }] });
    expect(config?.contracts).toHaveLength(1);
    expect(config?.contracts[0].symbol).toBe('');
  });

  it('reduces field by field, so a stray field cannot ride in on a contract', () => {
    const config = normalizeQuoteConfig({
      contracts: [{ symbol: 'AAPL', secType: 'STK', secret: 'nope' }],
    });
    expect(config?.contracts[0]).toEqual({ symbol: 'AAPL', secType: 'STK' });
    expect(JSON.stringify(config)).not.toContain('nope');
  });
});

describe('a blank quote card can be taken back; a described one cannot', () => {
  const quoteNode = (quote: BoardNode['quote']): BoardNode => ({ id: 'q', kind: 'quote', quote });

  it('is blank with no name and no described contract', () => {
    expect(isBlankUserCard(quoteNode({ contracts: [] }))).toBe(true);
    expect(isBlankUserCard(quoteNode({ contracts: [{ symbol: '', secType: 'STK' }] }))).toBe(true);
  });

  it('is not blank once a symbol, a qualifier, or a name is typed', () => {
    expect(isBlankUserCard(quoteNode({ contracts: [{ symbol: 'AAPL', secType: 'STK' }] }))).toBe(false);
    expect(isBlankUserCard(quoteNode({ name: 'Watch', contracts: [] }))).toBe(false);
    expect(
      isBlankUserCard(quoteNode({ contracts: [{ symbol: '', secType: 'FUT', expiry: '202603' }] }))
    ).toBe(false);
  });
});

describe('updating a quote card', () => {
  const base = graph([{ id: 'q', kind: 'quote', quote: { name: 'W', contracts: [{ symbol: 'AAPL', secType: 'STK' }] } }]);

  it('changes the contracts while keeping the name', () => {
    const next = updateNode(base, 'q', { quote: { contracts: [{ symbol: 'MSFT', secType: 'STK' }] } });
    const quote = next.nodes[0].quote;
    expect(quote?.name).toBe('W');
    expect(quote?.contracts[0].symbol).toBe('MSFT');
  });

  it('changes the name while keeping the contracts', () => {
    const next = updateNode(base, 'q', { quote: { name: 'Renamed' } });
    expect(next.nodes[0].quote?.name).toBe('Renamed');
    expect(next.nodes[0].quote?.contracts[0].symbol).toBe('AAPL');
  });

  it('is a no-op when nothing actually changed, so no save is armed', () => {
    const next = updateNode(base, 'q', { quote: { contracts: [{ symbol: 'AAPL', secType: 'STK' }] } });
    expect(next).toBe(base);
  });
});
