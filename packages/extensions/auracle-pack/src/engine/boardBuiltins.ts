/**
 * What a brand-new Board already has on it: the material it can read today.
 *
 * The platform is keyless by default — a person can research and backtest the
 * minute the engine is up — and a Board that opened completely empty would hide
 * that. So the first open of an untouched Board lays down one card per source
 * that is ready now: nothing to describe, nothing to key.
 *
 * ## Research material, and only research material
 * A source card is something the Board READS. A broker connection is not: a
 * practice account is a place to rehearse trading, and a card offering to have
 * a question read against it promises something no part of this pack can do.
 * The engine's Board API is asked first, because its built-ins are research
 * sources by construction ({@link ./boardSources}); the connector registry is
 * the fallback for an engine that does not serve that route yet, and there the
 * data-carrying connectors are the only ones taken.
 *
 * ## Seeded from what the install HAS, never from a wish list
 * A Board must not invent a source this install does not have: if neither the
 * Board API nor the registry has answered, nothing is seeded and the ghosts
 * stay up until one does. That is also what keeps the bootstrap out of the way
 * in tests and on a disconnected desk.
 *
 * ## Idempotent three times over
 * Cards take a DERIVED id ({@link builtInNodeId}), so a second pass adds
 * nothing. The whole pass is skipped unless the Board holds nothing a PERSON
 * placed, so seeding never lands a card on top of somebody's work. And a card
 * somebody REMOVED is retired in the graph document itself
 * ({@link BoardGraph.retiredSeeds}), so the next open of the workspace — in
 * this window or the next one — does not put it back.
 *
 * The user-placed test is user-placed cards rather than cards outright, because
 * the Board also grows cards NOBODY placed: a strategy the engine discovered
 * can appear on a first open before anything else has answered, and reading
 * that as "this Board has been worked on" would cost a fresh install its free
 * sources for good.
 */
import { KEYLESS_IDS, type Connector } from './model';
import { boardGraphStore } from './boardGraphStore';
import { isSeededNodeId, SEEDED_NODE_PREFIX, type BoardSourceConfig } from './boardGraph';
import { listBoardSources, type BoardSourceRecord } from './boardSources';

/** The node id a built-in takes, derived from the source's engine id. */
export function builtInNodeId(sourceId: string): string {
  return `${SEEDED_NODE_PREFIX}${sourceId}`;
}

/** True for a card this module placed — the editor says so rather than
 *  pretending the person typed it. */
export function isBuiltInNode(nodeId: string): boolean {
  return isSeededNodeId(nodeId);
}

/** The two kinds a person puts on the Board by hand. */
function isUserPlaced(node: { kind: string }): boolean {
  return node.kind === 'source' || node.kind === 'research';
}

/**
 * Connector kinds that carry something to READ. A broker moves orders; an
 * integration wires another tool up. Neither is material a question can be read
 * against, so neither becomes a source card.
 */
const DATA_KINDS = new Set(['data_provider']);

/**
 * Practice environments, whatever kind they report themselves as. A simulator
 * or paper account is where trading is rehearsed, and it was the one card on a
 * first-run Board that made no sense next to a question.
 */
const PRACTICE_ID = /simulator|paper|sandbox|demo/i;

/**
 * Whether this connector may become a card on an untouched Board: ready
 * without a key, carrying data, and not a place to rehearse trading. All three
 * matter — the empty state promises the cards that arrive need no key, and a
 * card offering a practice account as reading material keeps neither half of
 * that promise.
 */
export function isResearchConnector(connector: Connector): boolean {
  if (!KEYLESS_IDS.has(connector.id)) return false;
  if (PRACTICE_ID.test(connector.id)) return false;
  return DATA_KINDS.has(connector.kind);
}

/** A card to lay down: the id it takes, and what it says. */
interface Seed {
  id: string;
  source: BoardSourceConfig;
}

/**
 * The card for one connector the engine is already able to reach. No endpoint
 * to type and no slot to fill: that is the whole point of it being keyless.
 */
export function builtInSourceConfig(connector: Connector): BoardSourceConfig {
  return {
    name: connector.display_label || connector.id,
    connectorKind: 'feed',
    endpoint: connector.id,
    payloadType: connector.blurb || 'market data',
  };
}

/** The card for one source the engine's own Board API named. */
function seedFromEngineSource(record: BoardSourceRecord): Seed | null {
  const sourceId = typeof record?.id === 'string' ? record.id : '';
  if (sourceId === '') return null;
  return {
    // An engine that already speaks in seeded ids keeps its own; anything else
    // is derived, so a second pass recognizes the card it laid down.
    id: isSeededNodeId(sourceId) ? sourceId : builtInNodeId(sourceId),
    source: {
      name: record.name || sourceId,
      connectorKind: record.connector_kind || 'feed',
      endpoint: record.endpoint || sourceId,
      payloadType: record.payload_type || 'research material',
    },
  };
}

/** Whether there is a Board to seed and nothing of anybody's on it. */
function seedable(): boolean {
  const snapshot = boardGraphStore.getSnapshot();
  if (snapshot.status === 'closed' || snapshot.status === 'loading') return false;
  return !snapshot.graph.nodes.some(isUserPlaced);
}

/** Lay the cards down, skipping every id the Board already holds or has been
 *  told not to hold again. */
function place(seeds: readonly Seed[]): string[] {
  const { graph } = boardGraphStore.getSnapshot();
  const retired = new Set(graph.retiredSeeds ?? []);
  const held = new Set(graph.nodes.map((node) => node.id));
  const created: string[] = [];
  for (const seed of seeds) {
    if (retired.has(seed.id) || held.has(seed.id)) continue;
    held.add(seed.id);
    created.push(boardGraphStore.createNode({ kind: 'source', id: seed.id, source: seed.source }));
  }
  return created;
}

/** One pass at a time: the caller re-fires on every registry poll, and two
 *  overlapping passes would both read an empty Board and both seed it. */
let inFlight = false;

/**
 * Lay the ready-made sources down, once. Returns the ids it created — empty on
 * every pass after the first, on a Board with anything a person placed on it,
 * and whenever nothing has said what this install has.
 */
export async function bootstrapBuiltInSources(connectors: Connector[] | null): Promise<string[]> {
  if (inFlight || !seedable()) return [];
  inFlight = true;
  try {
    const engineSources = await listBoardSources();
    // The read took time; a person may have placed a card during it, and the
    // Board they are looking at now is the one that decides.
    if (!seedable()) return [];
    if (engineSources !== null) {
      // The engine named its sources. They are the research ones, so the
      // connector registry is not consulted at all.
      return place(engineSources.map(seedFromEngineSource).filter((seed): seed is Seed => !!seed));
    }
    if (connectors === null) return [];
    return place(
      connectors
        .filter(isResearchConnector)
        .map((connector) => ({ id: builtInNodeId(connector.id), source: builtInSourceConfig(connector) }))
    );
  } finally {
    inFlight = false;
  }
}
