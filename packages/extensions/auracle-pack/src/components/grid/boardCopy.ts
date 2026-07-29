/**
 * The Board's onboarding words, in one place.
 *
 * The Board has no tour, no tips and no documentation of its own: the words on
 * the empty canvas ARE the manual, and a person who reads them once should be
 * able to work without ever leaving the panel. That only holds if the words are
 * treated as a thing with a shape rather than as strings scattered through the
 * components that happen to draw them, so they live here, next to
 * {@link ./boardReadings} for the same reason it exists.
 *
 * ## The model, in three slots
 * CONNECT a source, ASK a question, WATCH the material gather. Each ghost slot
 * carries one step, in that order, and between them they say the whole of what
 * this face does. Nothing else has to be read first.
 *
 * ## What the words may promise
 * Three claims are load-bearing and none of them may drift:
 *  - gathering is free. Material accumulating against a standing question costs
 *    nothing at all;
 *  - a VERB costs one agent session, and only when a person presses it (or
 *    turns on the per-card switch that presses it for them);
 *  - a key is stored and never shown again. Not "hidden", not "masked": there
 *    is no way to read one back through this surface, so the copy says so
 *    plainly rather than implying a lock somebody could open.
 *
 * And one thing the copy must NOT claim: that the keyless sources are already
 * on the board. On the empty state they are precisely not there yet, because
 * the ghosts are what shows while the engine has not answered
 * ({@link ../../engine/boardBuiltins}). So the empty state promises they
 * arrive, and the first-run line, which only shows once they HAVE, introduces
 * them.
 */
import type { BoardNode } from '../../engine/boardGraph';
import { isBuiltInNode } from '../../engine/boardBuiltins';

/**
 * The three ghost slots, in the order a person meets them: connect, ask, watch.
 * The first two are buttons that lay the card down and open it; the third is a
 * label, because watching is not a thing anybody has to start.
 */
export const GHOSTS = [
  {
    id: 'source',
    icon: 'database',
    title: 'Connect data',
    body: 'Point the board at something worth reading: a paper feed, a filings stream, a broker account. The ones that need no key arrive on their own as soon as the engine answers.',
    acts: true,
  },
  {
    id: 'research',
    icon: 'help',
    title: 'Pose a question',
    body: 'Write what you think is true, and what would show it. The question stands, and everything that arrives afterwards is read against it.',
    acts: true,
  },
  {
    id: 'materialized',
    icon: 'auto_awesome',
    title: 'Watch it gather',
    body: 'Material collects against a question on its own, and that costs nothing. Pressing the verb on the card, Scan or Synthesize, spends one agent session on what has arrived. Strategies, tests and deployments appear here as that work produces them.',
    acts: false,
  },
] as const;

/** The two moves a person makes, named the same way wherever they are offered:
 *  on the ghost slots of an empty board, and on the row that replaces them. */
export const SOURCE_GHOST = GHOSTS[0];
export const RESEARCH_GHOST = GHOSTS[1];

/**
 * The line above the board. Three states, because a first-time board is three
 * different situations and one sentence for all of them would be wrong twice.
 */
export const BOARD_HINT = {
  /** Nothing at all: the ghosts are showing and they carry the model. */
  empty: 'An empty board. Two moves start it, and the rest follows from the work.',
  /** Only the sources that came with the engine. Still a first run, so the line
   *  introduces them and names the next move rather than describing work
   *  nobody has done yet. */
  firstRun:
    'These sources came with the engine and need no key. Pose a question next, and what they carry is read against it as it arrives, at no cost.',
  /** A board somebody has worked. */
  working: 'What you are working on: the sources, the questions, and what came of them.',
} as const;

/**
 * Which of the three lines this board gets.
 *
 * The middle case is the one worth stating: a board holding NOTHING but the
 * cards the bootstrap laid down has not been worked, however many cards are on
 * it, and telling that person "what you are working on" would be describing
 * their board back to them before they had one.
 */
export function boardHint(nodes: readonly BoardNode[]): string {
  if (nodes.length === 0) return BOARD_HINT.empty;
  if (nodes.every((node) => node.kind === 'source' && isBuiltInNode(node.id))) {
    return BOARD_HINT.firstRun;
  }
  return BOARD_HINT.working;
}

/**
 * What a good question looks like, shown where one is written.
 *
 * The example is deliberately a MEASURABLE claim about a statistical
 * phenomenon, with the thing that would show it in the same sentence. A list of
 * tickers or a theme ("AI stocks") is not a question this board can read
 * anything against, and an example is the shortest way to say so.
 */
export const RESEARCH_PLACEHOLDER =
  "What do you think is true, and what would show it?\n\nExample: a stock whose filing language turns more uncertain than its last one underperforms over the next month.";

/** The keyless card, introducing itself in its own editor: nothing was typed
 *  here, and nothing needs to be. */
export const BUILT_IN_SOURCE_NOTE = 'Came with the engine. No key to set, and nothing to describe.';
