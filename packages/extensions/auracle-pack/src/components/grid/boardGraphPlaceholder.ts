/**
 * PLACEHOLDER — the Board's graph, as the shell reads it, until the real store
 * is merged.
 *
 * The shell (the face, the canvas, the empty state) and the graph store were
 * built at the same time, so this file stands in for the store's READ side and
 * nothing else. It holds no state and never will: `getSnapshot` answers with
 * one frozen empty graph and `subscribe` never fires.
 *
 * ## Deleting it
 * The real store exposes the same read-only view under the same name, so the
 * swap is one import path and one deletion:
 *
 *   - `import { boardGraph } from './boardGraphPlaceholder'`
 *   → `import { boardGraph } from '../../engine/boardGraphStore'`
 *   - delete this file.
 *
 * The types below are copied from the real ones (`engine/boardGraph.ts`) rather
 * than invented, and only as far as the shell reads them — the real
 * {@link BoardNode} also carries its source/research configuration, its
 * artifact reference, and any fields a newer build wrote. Nothing here should
 * grow: a placeholder that starts answering questions stops being one.
 *
 * ## The two invariants the shell must respect
 * A node references artifacts by id and never copies them, which is why nothing
 * in this file carries a payload. And LAYOUT IS SPARSE: `position` is optional,
 * because a card the system materialized can exist before anyone has chosen a
 * spot for it. Nothing that draws the board may assume coordinates.
 */

/** The kinds this build knows. Any other string is a future kind, preserved. */
export type BoardNodeKind = 'source' | 'research' | 'strategy' | 'test' | 'deploy';

/** Canvas coordinates. Stored only for cards that have been placed. */
export interface BoardPosition {
  x: number;
  y: number;
}

/** One card. */
export interface BoardNode {
  readonly id: string;
  /** {@link BoardNodeKind} for cards this build understands; any string survives. */
  readonly kind: string;
  /** Present only once the card has been placed — layout is sparse. */
  readonly position?: BoardPosition;
}

/** Who drew a wire: a person, or the system recording provenance. */
export type BoardEdgeOrigin = 'user' | 'system';

export interface BoardEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly origin: BoardEdgeOrigin;
}

/** One workspace's Board. */
export interface BoardGraph {
  readonly nodes: readonly BoardNode[];
  readonly edges: readonly BoardEdge[];
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
