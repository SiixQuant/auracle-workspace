/**
 * PLACEHOLDER — the Board's graph, as the shell needs to read it.
 *
 * The shell (the face, the canvas, the empty state) and the graph STORE are
 * being built at the same time, so this file is the agreed seam between them
 * and nothing more: the smallest read-only view the shell needs in order to
 * decide whether it is drawing an empty board or a populated one.
 *
 * IT HOLDS NO STATE AND NEVER WILL. `getSnapshot` answers with one frozen empty
 * graph and `subscribe` never fires. When the real store lands it replaces this
 * module wholesale — same two functions, same shape, plus everything the store
 * owns that the shell has no business knowing (create, wire, position, persist).
 * Whoever lands it should delete this note along with the stub and leave the
 * types where they are, so the shell's imports do not move.
 *
 * THE ONE INVARIANT WORTH REPEATING HERE: a node references artifacts by id and
 * never copies them, which is why nothing in this file carries a payload.
 */

/**
 * What a node is. The first two are placed by a person; the rest materialize on
 * their own as real work produces them.
 *
 * Read tolerantly: a graph written by a newer build may name a kind this one
 * has never heard of, and the shell must draw what it can rather than refuse
 * the whole board.
 */
export type BoardNodeKind = 'source' | 'research' | 'strategy' | 'test' | 'deploy';

/** One card on the board, at a position, pointing at something. */
export interface BoardNode {
  id: string;
  /** A {@link BoardNodeKind} on any graph this build wrote, and possibly a word
   *  it has never heard of on one a newer build wrote — hence the wide type. */
  kind: string;
  /** Layout position in board coordinates. */
  x: number;
  y: number;
}

/** One wire. Source-to-research is drawn by a person; the rest are written by
 *  the system when an artifact materializes. */
export interface BoardEdge {
  id: string;
  from: string;
  to: string;
}

/** One workspace's board. */
export interface BoardGraph {
  nodes: readonly BoardNode[];
  edges: readonly BoardEdge[];
}

/** The empty board — reference-stable, so a `useSyncExternalStore` read of it
 *  never reports a change that did not happen. */
const EMPTY: BoardGraph = Object.freeze({ nodes: Object.freeze([]), edges: Object.freeze([]) });

/** The read side of the graph. The shell asks for nothing else. */
export const boardGraph = {
  subscribe(_listener: () => void): () => void {
    return () => {};
  },
  getSnapshot(): BoardGraph {
    return EMPTY;
  },
};
