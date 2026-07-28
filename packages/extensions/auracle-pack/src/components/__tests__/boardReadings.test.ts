/**
 * What a Board card says, as arithmetic over the graph and the registry.
 *
 * The component test drives these through a real panel; this pins the edges
 * that are awkward to reach that way — a provider named one way and registered
 * another, a registry that has not answered, and the exact accounting a delete
 * confirm is allowed to claim.
 */
import { describe, expect, it } from 'vitest';

import {
  cardNote,
  cardTitle,
  deleteSentence,
  keptSentence,
  matchConnector,
  oneLine,
  sourceReading,
} from '../grid/boardReadings';
import type { BoardDeletePlan, BoardSourceConfig } from '../../engine/boardGraph';
import type { Connector } from '../../engine/model';

function connector(id: string, label: string, state: string, detail: string | null = null): Connector {
  return {
    id,
    display_label: label,
    blurb: '',
    kind: 'data_provider',
    status: { state, detail },
    fields: [],
  } as unknown as Connector;
}

function source(overrides: Partial<BoardSourceConfig> = {}): BoardSourceConfig {
  return { name: '', connectorKind: '', endpoint: '', payloadType: '', ...overrides };
}

const REGISTRY = [
  connector('yfinance', 'Yahoo Finance', 'connected'),
  connector('polygon', 'Polygon.io', 'error', 'token expired'),
  connector('alpaca', 'Alpaca', 'not_configured'),
  connector('ibkr', 'Interactive Brokers', 'reconnecting', 'gateway restarting'),
];

describe('matching a described source to a live connector', () => {
  it('matches on the name a person typed, however they punctuated it', () => {
    expect(matchConnector(source({ name: 'Yahoo Finance' }), REGISTRY)?.id).toBe('yfinance');
    expect(matchConnector(source({ name: 'polygon.io' }), REGISTRY)?.id).toBe('polygon');
    // Spacing and punctuation are not part of the answer: the same provider
    // written two ways is the same provider.
    expect(matchConnector(source({ name: 'Y finance' }), REGISTRY)?.id).toBe('yfinance');
    expect(matchConnector(source({ name: 'Desk drop' }), REGISTRY)).toBeNull();
  });

  it('matches on the endpoint when the name is somebody own word for it', () => {
    expect(matchConnector(source({ name: 'Free bars', endpoint: 'yfinance' }), REGISTRY)?.id).toBe(
      'yfinance'
    );
  });

  it('never matches on the shape of the data — that is not which provider it is', () => {
    expect(matchConnector(source({ payloadType: 'yfinance', connectorKind: 'feed' }), REGISTRY)).toBeNull();
  });

  it('matches nothing against a registry that has said nothing', () => {
    expect(matchConnector(source({ name: 'Yahoo Finance' }), null)).toBeNull();
  });
});

describe('a source reading', () => {
  it('separates a healthy source from one nobody has heard of', () => {
    expect(sourceReading(source({ name: 'Yahoo Finance' }), REGISTRY)).toEqual({
      health: 'nominal',
      word: 'connected',
    });
    expect(sourceReading(source({ name: 'Desk drop' }), REGISTRY)).toEqual({
      health: 'unknown',
      word: 'not linked to a connector',
    });
  });

  it('faults and degrades in the engine own words', () => {
    expect(sourceReading(source({ name: 'Polygon.io' }), REGISTRY)).toEqual({
      health: 'fault',
      word: 'token expired',
    });
    expect(sourceReading(source({ name: 'Interactive Brokers' }), REGISTRY)).toEqual({
      health: 'degraded',
      word: 'gateway restarting',
    });
  });

  it('reads an unconfigured connector as unknown, not as trouble', () => {
    // Keyless by default: not configuring something is a choice, and a red dot
    // for a choice would send somebody hunting for a fault that is not there.
    expect(sourceReading(source({ name: 'Alpaca' }), REGISTRY)).toEqual({
      health: 'unknown',
      word: 'not configured',
    });
  });

  it('says it has no reading rather than inventing one, before the registry answers', () => {
    expect(sourceReading(source({ name: 'Yahoo Finance' }), null)).toEqual({
      health: 'unknown',
      word: 'no reading yet',
    });
  });
});

describe('what a card writes on itself', () => {
  it('never leaves a card nameless', () => {
    expect(cardTitle({ id: 'a', kind: 'source', source: source() })).toBe('Unnamed source');
    expect(cardTitle({ id: 'b', kind: 'research', research: { hypothesis: '   ' } })).toBe(
      'A question, unwritten'
    );
  });

  it('cuts a long line rather than wrapping a card out of shape', () => {
    const long = 'a'.repeat(200);
    expect(oneLine(long, 20)).toHaveLength(20);
    expect(oneLine(long, 20).endsWith('…')).toBe(true);
    expect(oneLine('  two   words \n here ')).toBe('two words here');
  });

  it('does not say the same thing twice on one card', () => {
    // Title and note come from one short hypothesis: the note stays away.
    expect(cardNote({ id: 'b', kind: 'research', research: { hypothesis: 'Gaps revert.' } })).toBeNull();
  });
});

function plan(overrides: Partial<BoardDeletePlan> = {}): BoardDeletePlan {
  return {
    nodeId: 'n1',
    removedNodeIds: ['n1'],
    removedEdgeIds: [],
    retainedNodeIds: [],
    retainedRefs: [],
    ...overrides,
  };
}

describe('the sentence a delete has to be able to say', () => {
  it('counts the wires it takes and the work it does not', () => {
    expect(
      deleteSentence(
        plan({
          removedEdgeIds: ['e1', 'e2'],
          retainedNodeIds: ['s1', 's2'],
          retainedRefs: [
            { kind: 'strategy', id: '7' },
            { kind: 'backtest', id: '9' },
          ],
        }),
        'Question'
      )
    ).toBe(
      'Removing this question takes the card and 2 wires off the Board. 2 cards downstream stay where they are, still pointing at 2 saved results.'
    );
  });

  it('says plainly when nothing depends on it', () => {
    expect(deleteSentence(plan(), 'Source')).toBe(
      'Removing this source takes the card off the Board. Nothing else on the Board depends on it.'
    );
  });

  it('reports the same accounting afterwards', () => {
    expect(keptSentence(plan())).toBe('Card removed.');
    expect(keptSentence(plan({ retainedNodeIds: ['s1'] }))).toBe('Card removed. 1 card downstream stayed.');
    expect(keptSentence(plan({ removedNodeIds: [] }))).toBe('That card was already gone.');
  });
});
