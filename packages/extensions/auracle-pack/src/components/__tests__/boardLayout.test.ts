/**
 * Where the Board puts its cards, and how it routes between them.
 *
 * This is the one part of the Board that CAN be asserted exactly without a
 * browser, which is why it is a module rather than CSS: the cards are placed by
 * arithmetic and the wires are routed against those numbers, so bus discipline
 * — the property that makes a wired board readable — is a property of a string
 * here rather than of a screenshot.
 */
import { describe, expect, it } from 'vitest';

import {
  CARD_GAP,
  CARD_HEIGHT,
  CARD_WIDTH,
  LABEL_BAND,
  RANK_GAP,
  RANK_LABEL,
  columnsOf,
  layoutBoard,
  placeCards,
  rankOf,
} from '../grid/boardLayout';
import type { BoardGraph } from '../../engine/boardGraph';

function graph(nodes: BoardGraph['nodes'], edges: BoardGraph['edges'] = []): BoardGraph {
  return { nodes, edges };
}

const source = (id: string) => ({ id, kind: 'source' as const });
const research = (id: string) => ({ id, kind: 'research' as const });

/** Only the three orthogonal commands may appear — a diagonal across a
 *  schematic reads as a mistake in it. */
const ORTHOGONAL = /^M [-\d.]+ [-\d.]+( H [-\d.]+)?( V [-\d.]+)?( H [-\d.]+)?$/;

describe('ranks', () => {
  it('reads across the board: sources, then questions, then what the work made', () => {
    expect(rankOf('source')).toBe(0);
    expect(rankOf('research')).toBe(1);
    expect(rankOf('strategy')).toBe(2);
    expect(rankOf('deploy')).toBe(2);
    // A kind this build has never heard of is still drawn somewhere.
    expect(rankOf('constellation')).toBe(2);
  });
});

describe('placing cards', () => {
  it('fills each rank top to bottom at a fixed pitch, one column per rank', () => {
    const cards = placeCards(graph([source('a'), source('b'), research('q')]));

    expect(cards[0]).toMatchObject({ x: 0, y: LABEL_BAND, placed: false });
    expect(cards[1]).toMatchObject({ x: 0, y: LABEL_BAND + CARD_HEIGHT + CARD_GAP });
    // The question is the NEXT column along, back at the top of it — which is
    // what makes the board read left to right as a process.
    expect(cards[2].x).toBeGreaterThan(CARD_WIDTH);
    expect(cards[2].y).toBe(LABEL_BAND);
  });

  it('leaves the label band clear above every column', () => {
    const cards = placeCards(graph([source('a'), research('q')]));

    // Nothing is ever drawn in the band the section label occupies.
    for (const card of cards) expect(card.y).toBeGreaterThanOrEqual(LABEL_BAND);
  });

  it('draws a card somebody moved exactly where they left it', () => {
    const cards = placeCards(
      graph([{ ...source('a'), position: { x: 640, y: 220 } }, source('b')])
    );

    expect(cards[0]).toMatchObject({ x: 640, y: 220, placed: true });
    // And it does not consume a slot: the unplaced card still gets the first
    // one, rather than being pushed along by a card that is not there.
    expect(cards[1]).toMatchObject({ x: 0, y: LABEL_BAND, placed: false });
  });

  it('survives a card that was never placed — layout is sparse by design', () => {
    expect(() => placeCards(graph([{ id: 'm1', kind: 'strategy' }]))).not.toThrow();
  });
});

describe('the labelled columns', () => {
  it('names one band per rank that has a card in it, in pipeline order', () => {
    const { columns } = layoutBoard(graph([research('q'), source('a')]));

    expect(columns.map((column) => column.label)).toEqual([RANK_LABEL[0], RANK_LABEL[1]]);
    expect(columns[0].x).toBe(0);
    expect(columns[1].x).toBe(CARD_WIDTH + RANK_GAP);
  });

  it('captions nothing where there is nothing — an empty rank has no band', () => {
    expect(columnsOf(placeCards(graph([source('a')])))).toHaveLength(1);
    expect(columnsOf([])).toEqual([]);
  });

  it('keeps a band at its rank when somebody drags a card out of the column', () => {
    // The caption names the group, so it must not chase one card away from it.
    const columns = columnsOf(placeCards(graph([{ ...source('a'), position: { x: 900, y: 40 } }])));

    expect(columns).toHaveLength(1);
    expect(columns[0].x).toBe(0);
  });
});

describe('wires take the bus', () => {
  it('leaves, runs the trunk, and arrives — two bends, no diagonal', () => {
    const { wires } = layoutBoard(
      graph(
        [source('a'), research('r'), research('q')],
        [{ id: 'w1', from: 'a', to: 'q', origin: 'user' }]
      )
    );

    expect(wires).toHaveLength(1);
    expect(wires[0].d).toMatch(ORTHOGONAL);
    // Out of the source's trailing edge, into the target's leading edge.
    expect(wires[0].d.startsWith(`M ${CARD_WIDTH} ${LABEL_BAND + CARD_HEIGHT / 2}`)).toBe(true);
  });

  it('shares one trunk between every edge crossing the same gap', () => {
    const { wires } = layoutBoard(
      graph(
        [source('a'), source('b'), research('q'), research('r')],
        [
          { id: 'w1', from: 'a', to: 'q', origin: 'user' },
          { id: 'w2', from: 'b', to: 'r', origin: 'user' },
          { id: 'w3', from: 'b', to: 'q', origin: 'user' },
        ]
      )
    );

    const trunks = new Set(wires.map((wire) => wire.cutX));
    // Three edges, ONE line: every vertical run is collinear rather than three
    // near-parallel runs stacked beside the rank gap.
    expect(trunks.size).toBe(1);
    const trunk = wires[0].cutX;
    const runs = wires.filter((wire) => wire.d.includes(' V '));
    expect(runs.length).toBeGreaterThan(0);
    for (const wire of runs) expect(wire.d).toContain(`H ${trunk} V `);
  });

  it('puts every departure and arrival on a card centreline', () => {
    const { cards, wires } = layoutBoard(
      graph(
        [source('a'), source('b'), research('q')],
        [
          { id: 'w1', from: 'a', to: 'q', origin: 'user' },
          { id: 'w2', from: 'b', to: 'q', origin: 'user' },
        ]
      )
    );

    const centres = new Set(cards.map((card) => card.y + card.height / 2));
    // Every horizontal in the picture sits on a card's centreline, which is
    // what makes it impossible for a run to pass through a neighbouring card or
    // for two edges in one gap to cross.
    for (const wire of wires) {
      const start = Number(wire.d.split(' ')[2]);
      expect(centres.has(start)).toBe(true);
      const arrival = wire.d.split(' V ')[1];
      if (arrival !== undefined) expect(centres.has(Number(arrival.split(' ')[0]))).toBe(true);
    }
  });

  it('runs straight across when the two cards already line up', () => {
    const { wires } = layoutBoard(
      graph(
        [source('a'), research('q')],
        [{ id: 'w1', from: 'a', to: 'q', origin: 'user' }]
      )
    );

    // Same slot in both ranks: one horizontal, no bends at all.
    expect(wires[0].d).not.toContain(' V ');
  });

  it('carries who drew each wire, so the overlay can tell data from provenance', () => {
    const { wires } = layoutBoard(
      graph(
        [research('q'), { id: 's1', kind: 'strategy' }],
        [{ id: 't1', from: 'q', to: 's1', origin: 'system' }]
      )
    );

    expect(wires[0].origin).toBe('system');
  });

  it('skips a wire whose far end is not on the Board', () => {
    const { wires } = layoutBoard(
      graph([source('a')], [{ id: 'w1', from: 'a', to: 'ghost', origin: 'user' }])
    );

    expect(wires).toEqual([]);
  });
});

describe('the extent the canvas fits', () => {
  it('covers the furthest card, and is nothing at all when the board is empty', () => {
    const { width, height } = layoutBoard(
      graph([{ ...source('a'), position: { x: 900, y: 400 } }])
    );

    expect(width).toBeGreaterThan(900 + CARD_WIDTH);
    expect(height).toBeGreaterThan(400 + CARD_HEIGHT);

    const empty = layoutBoard(graph([]));
    expect(empty).toMatchObject({ width: 0, height: 0, cards: [], wires: [] });
  });
});
