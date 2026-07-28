/**
 * What a brand-new Board already has on it: the sources that need no key.
 *
 * The platform is keyless by default — a person can backtest on free daily bars
 * the minute the engine is up — and a Board that opened completely empty would
 * hide that. So the first open of an untouched Board lays down one card per
 * KEYLESS connector the engine reports, already usable: nothing to describe,
 * nothing to key, wired straight through to a provider that is ready now.
 *
 * ## Seeded from the engine's own list, never from a wish list
 * The cards are built from the connections feed the pack already polls, and
 * only for connectors the feed actually named. A Board must not invent a source
 * that this install does not have: if the engine has not answered, nothing is
 * seeded and the ghosts stay up until it does. That is also what keeps the
 * bootstrap out of the way in tests and on a disconnected desk.
 *
 * ## Idempotent twice over
 * Cards take a DERIVED id ({@link builtInNodeId}), so a second pass adds
 * nothing — {@link boardGraphStore.createNode} keeps the card already there.
 * And the whole pass is skipped unless the Board holds nothing a PERSON placed,
 * so seeding can never resurrect a built-in somebody deliberately removed from
 * a Board they have since built on, and never lands a card on top of their
 * work.
 *
 * The test is user-placed cards rather than cards outright, because the Board
 * also grows cards NOBODY placed: a strategy the engine discovered can appear
 * on a first open before the connections feed has answered, and reading that as
 * "this Board has been worked on" would cost a fresh install its free sources
 * for good.
 */
import { KEYLESS_IDS, type Connector } from './model';
import { boardGraphStore } from './boardGraphStore';
import type { BoardSourceConfig } from './boardGraph';

/** The node id a built-in takes, derived from the connector's engine id. */
export function builtInNodeId(connectorId: string): string {
  return `source-builtin-${connectorId}`;
}

/** True for a card this module placed — the editor says so rather than
 *  pretending the person typed it. */
export function isBuiltInNode(nodeId: string): boolean {
  return nodeId.startsWith('source-builtin-');
}

/** The two kinds a person puts on the Board by hand. */
function isUserPlaced(node: { kind: string }): boolean {
  return node.kind === 'source' || node.kind === 'research';
}

/**
 * The card for one keyless connector. A feed with no endpoint to type and no
 * slot to fill: the engine already knows how to reach it, which is the whole
 * point of it being keyless.
 */
export function builtInSourceConfig(connector: Connector): BoardSourceConfig {
  return {
    name: connector.display_label || connector.id,
    connectorKind: 'feed',
    endpoint: connector.id,
    payloadType: connector.blurb || 'market data',
  };
}

/**
 * Lay the keyless sources down, once. Returns the ids it created — empty on
 * every pass after the first, on a Board with anything a person placed on it,
 * and whenever the engine has not said what it has.
 */
export function bootstrapBuiltInSources(connectors: Connector[] | null): string[] {
  if (connectors === null) return [];
  const snapshot = boardGraphStore.getSnapshot();
  if (snapshot.status === 'closed' || snapshot.status === 'loading') return [];
  if (snapshot.graph.nodes.some(isUserPlaced)) return [];

  const created: string[] = [];
  for (const connector of connectors) {
    if (!KEYLESS_IDS.has(connector.id)) continue;
    created.push(
      boardGraphStore.createNode({
        kind: 'source',
        id: builtInNodeId(connector.id),
        source: builtInSourceConfig(connector),
      })
    );
  }
  return created;
}
