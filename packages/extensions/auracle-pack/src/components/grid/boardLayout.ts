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
 * Work reads ACROSS the board: the sources a person pointed at, the questions
 * they asked, and what came out of answering them, in that order, left to
 * right. A card with no position of its own lands in its kind's RANK — one
 * labelled column per rank, filled top to bottom in graph order — so a Board
 * nobody has arranged is already legible, two people's untouched Boards look
 * the same, and the arrangement states the pipeline rather than leaving it to
 * be inferred. A card that HAS a position is drawn exactly there: the
 * arrangement is theirs, and the ranks are only a default.
 *
 * A rank reserves {@link LABEL_BAND} above its first card for the quiet section
 * label the surface draws there. It is in the arithmetic rather than in CSS
 * because the plane is absolutely positioned: a band the layout did not know
 * about would put every label on top of a card.
 *
 * ## Wires take the Plan's bus discipline
 * Same rules as {@link ./gridWires}, for the same reason: point-to-point lines
 * between a dozen cards read as a tangle. An edge leaves its source card's
 * centreline, runs along the ONE trunk shared by every edge crossing that rank
 * gap, and arrives at the target's leading edge. Two bends, no diagonal, and
 * edges that share a gap share a line rather than fanning out beside it. Every
 * departure sits on a card's centreline, which is what makes it impossible for
 * two edges in one gap to cross.
 */
import type { BoardEdge, BoardGraph, BoardNode } from '../../engine/boardGraph';

/** Card geometry. Fixed, because a knowable box is what makes the routing
 *  computable — the card's own CSS is written to these numbers. */
export const CARD_WIDTH = 268;
export const CARD_HEIGHT = 120;
/** Between two cards in the same rank, one above the other. */
export const CARD_GAP = 26;
/** Between one rank and the next. The trunk runs in the middle of it. */
export const RANK_GAP = 88;
/** Breathing room around the whole arrangement. */
export const BOARD_PAD = 10;
/** Reserved above every rank's first card, for the section label drawn there. */
export const LABEL_BAND = 26;

/** Which column a kind belongs to when nobody has placed it. */
export type BoardRank = 0 | 1 | 2;

/** What each rank is called, in pipeline order. Drawn quiet and uppercase; the
 *  words are here so the layout and the surface cannot name a column
 *  differently. */
export const RANK_LABEL: Record<BoardRank, string> = {
  0: 'Sources',
  1: 'Questions',
  2: 'Materialized',
};

/**
 * Sources first, questions after them, and everything the system materialized
 * after both. An unknown (future) kind lands in the materialized rank rather
 * than nowhere: a card this build cannot name is still a card, and hiding it
 * would make the Board lie about what is on it.
 */
export function rankOf(kind: string): BoardRank {
  // Sources and live-quote cards are both inputs a person points the board at,
  // so they share the first rank; questions come after them, and everything the
  // system materialized after both.
  if (kind === 'source' || kind === 'quote') return 0;
  if (kind === 'research') return 1;
  return 2;
}

/**
 * The half of the graph a person PLACED — sources, questions, and the wires
 * they drew between them.
 *
 * The plane draws these; the cards the system wrote have their own layer, and
 * laying them out here as well would draw every strategy and deployment twice.
 * Wires are filtered with them: an edge whose far end is not on the plane has
 * nowhere to land, and drawing one would point at empty ground.
 */
export function userSubgraph(graph: BoardGraph): BoardGraph {
  const nodes = graph.nodes.filter(
    (node) => node.kind === 'source' || node.kind === 'research' || node.kind === 'quote'
  );
  if (nodes.length === graph.nodes.length) return graph;
  const kept = new Set(nodes.map((node) => node.id));
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  };
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
  /** The orthogonal path: leave, trunk, arrive. */
  d: string;
  /** Where an affordance on the wire belongs — the middle of its trunk run. */
  cutX: number;
  cutY: number;
}

/**
 * One rank's band on the plane — where its section label goes, and how wide the
 * column under it runs. Emitted only for ranks that actually hold a card, so a
 * Board with no questions on it does not caption an empty stretch of ground.
 */
export interface BoardColumn {
  rank: BoardRank;
  label: string;
  x: number;
  width: number;
}

export interface BoardLayoutResult {
  cards: PlacedCard[];
  wires: BoardWirePath[];
  /** The labelled bands, in pipeline order. */
  columns: BoardColumn[];
  /** The arrangement's own extent, which the canvas fit-scales. */
  width: number;
  height: number;
}

function rankLeft(rank: BoardRank): number {
  return rank * (CARD_WIDTH + RANK_GAP);
}

/** Every card's box, in graph order, ranks filled top to bottom. */
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
      x: placed ? (node.position as { x: number }).x : rankLeft(rank),
      y: placed ? (node.position as { y: number }).y : LABEL_BAND + slot * (CARD_HEIGHT + CARD_GAP),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      placed,
    };
  });
}

/**
 * The label bands, one per rank with a card in it.
 *
 * The band sits at the RANK's own x rather than at the leftmost card's: a card
 * somebody dragged out of its column has not renamed the column, and a caption
 * that chased it would slide the heading off the group it names.
 */
export function columnsOf(cards: readonly PlacedCard[]): BoardColumn[] {
  const ranks = new Set(cards.map((card) => card.rank));
  return ([0, 1, 2] as BoardRank[])
    .filter((rank) => ranks.has(rank))
    .map((rank) => ({
      rank,
      label: RANK_LABEL[rank],
      x: rankLeft(rank),
      width: CARD_WIDTH,
    }));
}

/**
 * The trunk every edge crossing one rank gap shares: halfway between the
 * trailing edge of the column before the gap and the leading edge of the one
 * after it. Derived from the BOXES rather than from the rank grid, so a card
 * somebody dragged still has its wires meet the same line as its neighbours' —
 * the sharing is the point, and a per-edge midpoint would quietly give it up.
 */
function trunkFor(before: PlacedCard[], after: PlacedCard[]): number {
  const right = Math.max(...before.map((card) => card.x + card.width));
  const left = Math.min(...after.map((card) => card.x));
  return left > right ? right + (left - right) / 2 : right + RANK_GAP / 2;
}

function pathOf(x1: number, y1: number, x2: number, y2: number, trunk: number): string {
  // A run straight across to the target needs no hop and no bends: drawing the
  // trunk hop anyway would put two right angles on a straight line.
  if (y1 === y2) return `M ${x1} ${y1} H ${x2}`;
  return `M ${x1} ${y1} H ${trunk} V ${y2} H ${x2}`;
}

/** Cards and wires together — one pass, because the wires need the boxes. */
export function layoutBoard(graph: BoardGraph): BoardLayoutResult {
  const cards = placeCards(graph);
  const byId = new Map(cards.map((card) => [card.id, card]));

  // One trunk per (from-card, to-card) rank pair, computed from every card
  // involved in that pair so all its edges land on the same line.
  const groups = new Map<string, { before: PlacedCard[]; after: PlacedCard[] }>();
  const drawable: Array<{ edge: BoardEdge; from: PlacedCard; to: PlacedCard; group: string }> = [];
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const group = `${from.rank}-${to.rank}`;
    const bucket = groups.get(group) ?? { before: [], after: [] };
    if (!bucket.before.includes(from)) bucket.before.push(from);
    if (!bucket.after.includes(to)) bucket.after.push(to);
    groups.set(group, bucket);
    drawable.push({ edge, from, to, group });
  }

  const trunks = new Map<string, number>();
  for (const [group, bucket] of groups) trunks.set(group, trunkFor(bucket.before, bucket.after));

  const wires: BoardWirePath[] = drawable.map(({ edge, from, to, group }) => {
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const trunk = trunks.get(group) ?? x1 + RANK_GAP / 2;
    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      origin: edge.origin,
      d: pathOf(x1, y1, x2, y2, trunk),
      cutX: trunk,
      cutY: (y1 + y2) / 2,
    };
  });

  const width = cards.reduce((max, card) => Math.max(max, card.x + card.width), 0) + BOARD_PAD;
  const height = cards.reduce((max, card) => Math.max(max, card.y + card.height), 0) + BOARD_PAD;
  return {
    cards,
    wires,
    columns: columnsOf(cards),
    width: cards.length === 0 ? 0 : width,
    height: cards.length === 0 ? 0 : height,
  };
}
