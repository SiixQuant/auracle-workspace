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
const ORTHOGONAL = /^M [-\d.]+ [-\d.]+( V [-\d.]+)?( H [-\d.]+)?( V [-\d.]+)?$/;

describe('ranks', () => {
  it('reads down the board: sources, then questions, then what the work made', () => {
    expect(rankOf('source')).toBe(0);
    expect(rankOf('research')).toBe(1);
    expect(rankOf('strategy')).toBe(2);
    expect(rankOf('deploy')).toBe(2);
    // A kind this build has never heard of is still drawn somewhere.
    expect(rankOf('constellation')).toBe(2);
  });
});

describe('placing cards', () => {
  it('fills each rank left to right at a fixed pitch', () => {
    const cards = placeCards(graph([source('a'), source('b'), research('q')]));

    expect(cards[0]).toMatchObject({ x: 0, y: 0, placed: false });
    expect(cards[1]).toMatchObject({ x: CARD_WIDTH + CARD_GAP, y: 0 });
    expect(cards[2].y).toBeGreaterThan(CARD_HEIGHT);
    expect(cards[2].x).toBe(0);
  });

  it('draws a card somebody moved exactly where they left it', () => {
    const cards = placeCards(
      graph([{ ...source('a'), position: { x: 640, y: 220 } }, source('b')])
    );

    expect(cards[0]).toMatchObject({ x: 640, y: 220, placed: true });
    // And it does not consume a slot: the unplaced card still gets the first
    // one, rather than being pushed along by a card that is not there.
    expect(cards[1]).toMatchObject({ x: 0, y: 0, placed: false });
  });

  it('survives a card that was never placed — layout is sparse by design', () => {
    expect(() => placeCards(graph([{ id: 'm1', kind: 'strategy' }]))).not.toThrow();
  });
});

describe('wires take the bus', () => {
  it('drops, runs the trunk, and drops again — two bends, no diagonal', () => {
    const { wires } = layoutBoard(
      graph(
        [source('a'), research('q')],
        [{ id: 'w1', from: 'a', to: 'q', origin: 'user' }]
      )
    );

    expect(wires).toHaveLength(1);
    expect(wires[0].d).toMatch(ORTHOGONAL);
    // Out of the source's bottom edge, into the target's top edge.
    expect(wires[0].d.startsWith(`M ${CARD_WIDTH / 2} ${CARD_HEIGHT}`)).toBe(true);
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

    const trunks = new Set(wires.map((wire) => wire.cutY));
    // Three edges, ONE line: every horizontal run is collinear rather than
    // three near-parallel runs stacked under the rank.
    expect(trunks.size).toBe(1);
    const trunk = wires[0].cutY;
    const runs = wires.filter((wire) => wire.d.includes(' H '));
    expect(runs.length).toBeGreaterThan(0);
    for (const wire of runs) expect(wire.d).toContain(`V ${trunk} H `);
  });

  it('puts every drop on a card centreline', () => {
    const { cards, wires } = layoutBoard(
      graph(
        [source('a'), source('b'), research('q')],
        [
          { id: 'w1', from: 'a', to: 'q', origin: 'user' },
          { id: 'w2', from: 'b', to: 'q', origin: 'user' },
        ]
      )
    );

    const centres = new Set(cards.map((card) => card.x + card.width / 2));
    // Every vertical in the picture sits on a card's centreline, which is what
    // makes it impossible for a drop to pass through a neighbouring card or for
    // two edges in one gap to cross.
    for (const wire of wires) {
      const start = Number(wire.d.split(' ')[1]);
      expect(centres.has(start)).toBe(true);
      const run = wire.d.split(' H ')[1];
      if (run !== undefined) expect(centres.has(Number(run.split(' ')[0]))).toBe(true);
    }
  });

  it('drops straight when the two cards already line up', () => {
    const { wires } = layoutBoard(
      graph(
        [source('a'), research('q')],
        [{ id: 'w1', from: 'a', to: 'q', origin: 'user' }]
      )
    );

    // Same slot in both ranks: one vertical, no bends at all.
    expect(wires[0].d).not.toContain(' H ');
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
