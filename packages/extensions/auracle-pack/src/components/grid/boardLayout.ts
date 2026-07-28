/**
 * Where the Board's cards sit, and how the wires between them are routed —
 * arithmetic only, so both can be asserted without a layout engine.
 *
 * The Plan measures its own DOM because its cards are laid out by CSS. The
 * Board cannot: a card may carry a position somebody dragged it to, or no
 * position at all (layout is sparse, and a materialized card appears without
 * anyone choosing a spot). So the Board computes its own boxes and hands the
 * components absolute coordinates. That is what lets the wires be tested.
 *
 * ## Ranks, not a free plane
 * Work reads down the board: the sources a person pointed at, the questions
 * they asked, and what came out of answering them. A card with no position of
 * its own lands in its kind's RANK, left to right in graph order, so a Board
 * nobody has arranged is already legible and two people's untouched Boards look
 * the same. A card that HAS a position is drawn exactly there — the arrangement
 * is theirs, and the ranks are only a default.
 *
 * ## Wires take the Plan's bus discipline
 * Same rules as {@link ./gridWires}, for the same reason: point-to-point lines
 * between a dozen cards read as a tangle. An edge drops out of its source
 * card's centreline, runs along the ONE trunk shared by every edge crossing
 * that rank gap, and drops into the target's top edge. Two bends, no diagonal,
 * and edges that share a gap share a line rather than fanning out beside it.
 * Every drop sits on a card's centreline, which is what makes it impossible for
 * two edges in one gap to cross.
 */
import type { BoardEdge, BoardGraph, BoardNode } from '../../engine/boardGraph';

/** Card geometry. Fixed, because a knowable box is what makes the routing
 *  computable — the card's own CSS is written to these numbers. */
export const CARD_WIDTH = 268;
export const CARD_HEIGHT = 104;
/** Between two cards in the same rank. */
export const CARD_GAP = 26;
/** Between one rank and the next. The trunk runs in the middle of it. */
export const RANK_GAP = 88;
/** Breathing room around the whole arrangement. */
export const BOARD_PAD = 10;

/** Which row a kind belongs to when nobody has placed it. */
export type BoardRank = 0 | 1 | 2;

/**
 * Sources on top, questions under them, and everything the system materialized
 * below both. An unknown (future) kind lands in the materialized rank rather
 * than nowhere: a card this build cannot name is still a card, and hiding it
 * would make the Board lie about what is on it.
 */
export function rankOf(kind: string): BoardRank {
  if (kind === 'source') return 0;
  if (kind === 'research') return 1;
  return 2;
}

export interface PlacedCard {
  id: string;
  kind: string;
  rank: BoardRank;
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the card is where somebody put it rather than where the rank
   *  would have put it. */
  placed: boolean;
}

export interface BoardWirePath {
  id: string;
  from: string;
  to: string;
  origin: BoardEdge['origin'];
  /** The orthogonal path: drop, trunk, drop. */
  d: string;
  /** Where an affordance on the wire belongs — the middle of its trunk run. */
  cutX: number;
  cutY: number;
}

export interface BoardLayoutResult {
  cards: PlacedCard[];
  wires: BoardWirePath[];
  /** The arrangement's own extent, which the canvas fit-scales. */
  width: number;
  height: number;
}

function rankTop(rank: BoardRank): number {
  return rank * (CARD_HEIGHT + RANK_GAP);
}

/** Every card's box, in graph order, ranks filled left to right. */
export function placeCards(graph: BoardGraph): PlacedCard[] {
  const filled: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
  return graph.nodes.map((node: BoardNode) => {
    const rank = rankOf(node.kind);
    const placed = node.position !== undefined;
    const slot = filled[rank];
    if (!placed) filled[rank] = slot + 1;
    return {
      id: node.id,
      kind: node.kind,
      rank,
      x: placed ? (node.position as { x: number }).x : slot * (CARD_WIDTH + CARD_GAP),
      y: placed ? (node.position as { y: number }).y : rankTop(rank),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      placed,
    };
  });
}

/**
 * The trunk every edge crossing one rank gap shares: halfway between the
 * lowest card above the gap and the highest card below it. Derived from the
 * BOXES rather than from the rank grid, so a card somebody dragged still has
 * its wires meet the same line as its neighbours' — the sharing is the point,
 * and a per-edge midpoint would quietly give it up.
 */
function trunkFor(above: PlacedCard[], below: PlacedCard[]): number {
  const bottom = Math.max(...above.map((card) => card.y + card.height));
  const top = Math.min(...below.map((card) => card.y));
  return top > bottom ? bottom + (top - bottom) / 2 : bottom + RANK_GAP / 2;
}

function pathOf(x1: number, y1: number, x2: number, y2: number, trunk: number): string {
  // A drop straight down onto the target needs no run and no bends: drawing
  // the trunk hop anyway would put two right angles on a straight line.
  if (x1 === x2) return `M ${x1} ${y1} V ${y2}`;
  return `M ${x1} ${y1} V ${trunk} H ${x2} V ${y2}`;
}

/** Cards and wires together — one pass, because the wires need the boxes. */
export function layoutBoard(graph: BoardGraph): BoardLayoutResult {
  const cards = placeCards(graph);
  const byId = new Map(cards.map((card) => [card.id, card]));

  // One trunk per (from-card, to-card) rank pair, computed from every card
  // involved in that pair so all its edges land on the same line.
  const groups = new Map<string, { above: PlacedCard[]; below: PlacedCard[] }>();
  const drawable: Array<{ edge: BoardEdge; from: PlacedCard; to: PlacedCard; group: string }> = [];
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const group = `${from.rank}-${to.rank}`;
    const bucket = groups.get(group) ?? { above: [], below: [] };
    if (!bucket.above.includes(from)) bucket.above.push(from);
    if (!bucket.below.includes(to)) bucket.below.push(to);
    groups.set(group, bucket);
    drawable.push({ edge, from, to, group });
  }

  const trunks = new Map<string, number>();
  for (const [group, bucket] of groups) trunks.set(group, trunkFor(bucket.above, bucket.below));

  const wires: BoardWirePath[] = drawable.map(({ edge, from, to, group }) => {
    const x1 = from.x + from.width / 2;
    const y1 = from.y + from.height;
    const x2 = to.x + to.width / 2;
    const y2 = to.y;
    const trunk = trunks.get(group) ?? y1 + RANK_GAP / 2;
    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      origin: edge.origin,
      d: pathOf(x1, y1, x2, y2, trunk),
      cutX: (x1 + x2) / 2,
      cutY: trunk,
    };
  });

  const width = cards.reduce((max, card) => Math.max(max, card.x + card.width), 0) + BOARD_PAD;
  const height = cards.reduce((max, card) => Math.max(max, card.y + card.height), 0) + BOARD_PAD;
  return { cards, wires, width: cards.length === 0 ? 0 : width, height: cards.length === 0 ? 0 : height };
}
