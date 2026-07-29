/**
 * What the agent is allowed to know about the Board — one reduction, shared by
 * the ambient context envelope and every board tool.
 *
 * The graph model ({@link ./boardGraph}) is already reference-only and already
 * has no field for a credential value. This module is the SECOND wall, and it
 * is built field by field for the same reason the parser is: a reduction that
 * copied a node and deleted the parts it did not like would let the next field
 * anybody adds to a card reach the agent by default. Nothing leaves here that
 * was not named here.
 *
 * ## The three things a card may say
 *  - its KIND and id, which are how the agent addresses it;
 *  - its CONFIGURATION, which for a source is the description a person typed
 *    and the vault SLOT NAME, and for a research card is the question;
 *  - the ARTIFACT it points at, by kind and id — never the artifact itself.
 *
 * ## Two things a card never says
 *  - a credential VALUE. There is no field for one, here or in the graph.
 *  - whether the slot HOLDS one. Set/unset is a fact about the person's vault,
 *    it is read from a route this module never calls ({@link ./boardSources}),
 *    and it is not needed to operate a card: an agent that knows a slot is
 *    empty learns nothing it can act on and gains a hint about the user's
 *    credentials that the Board had no business volunteering. So the envelope
 *    carries the slot NAME and stops there.
 *
 * `extra` — the bag of unrecognized fields the graph preserves verbatim so an
 * older IDE cannot amputate a newer Board — is never emitted either. It is by
 * definition content this build has not inspected, and an envelope is exactly
 * where uninspected content must not go.
 *
 * Everything here is pure: no store, no transport, no host. The envelope's
 * content is therefore testable from a graph fixture alone.
 */
import { downstreamNodeIds, findNode, type BoardGraph, type BoardNode } from './boardGraph';

/** One card, as the agent may see it. Keys are wire-style (snake_case), the
 *  same shape the tools take back in. */
export interface BoardCardView {
  id: string;
  /** `source`, `research`, `strategy`, `test`, `deploy`, or a future kind. */
  kind: string;
  label?: string;
  /** Named fields only — see the header. Absent on a card that has none. */
  config?: Record<string, string>;
  /** The engine artifact a materialized card points at. Two fields, forever. */
  artifact?: { kind: string; id: string };
  /** Present only for a card the user has moved; layout is sparse. */
  position?: { x: number; y: number };
}

/** An artifact a card produced, said by reference and by the card holding it. */
export interface BoardArtifactView {
  /** The card on the Board that points at this artifact. */
  node_id: string;
  kind: string;
  id: string;
  label?: string;
}

/** The whole Board, reduced. What `board_list` answers with. */
export interface BoardGraphView {
  nodes: BoardCardView[];
  edges: { id: string; from: string; to: string; origin: string }[];
}

/* ── the reduction ───────────────────────────────────────────────────────── */

/** The source fields a card may state, in the order a person filled them in. */
const SOURCE_FIELDS: ReadonlyArray<'name' | 'connectorKind' | 'endpoint' | 'payloadType'> = [
  'name',
  'connectorKind',
  'endpoint',
  'payloadType',
];

/** Wire name for each. The tools take these back in, so one spelling serves
 *  both directions and an agent never has to translate. */
const SOURCE_FIELD_KEYS: Record<string, string> = {
  name: 'name',
  connectorKind: 'connector_kind',
  endpoint: 'endpoint',
  payloadType: 'payload_type',
};

function sourceConfig(node: BoardNode): Record<string, string> | undefined {
  const source = node.source;
  if (!source) return undefined;
  const config: Record<string, string> = {};
  for (const field of SOURCE_FIELDS) config[SOURCE_FIELD_KEYS[field]] = source[field];
  // The NAME of the slot, and nothing about what is in it. See the header.
  if (source.credentialSlot) config.credential_slot = source.credentialSlot;
  return config;
}

/**
 * One card, reduced to what may be said about it. Built key by key: a node
 * carrying a field this build has never heard of contributes nothing.
 */
export function cardView(node: BoardNode): BoardCardView {
  const view: BoardCardView = { id: node.id, kind: node.kind };
  if (node.label) view.label = node.label;

  const config =
    node.kind === 'source'
      ? sourceConfig(node)
      : node.kind === 'research' && node.research
        ? { hypothesis: node.research.hypothesis }
        : undefined;
  if (config) view.config = config;

  if (node.ref) view.artifact = { kind: node.ref.kind, id: node.ref.id };
  if (node.position) view.position = { x: node.position.x, y: node.position.y };
  return view;
}

/** The whole graph, card by card and wire by wire. */
export function boardGraphView(graph: BoardGraph): BoardGraphView {
  return {
    nodes: graph.nodes.map(cardView),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      origin: edge.origin,
    })),
  };
}

/* ── the chain a card sits at the end of ─────────────────────────────────── */

/**
 * Every card upstream of `nodeId`, transitively, ordered FURTHEST FIRST — so
 * the array reads as the chain that leads into the card: the sources, then the
 * question they feed, then whatever came out of it.
 *
 * That ordering is the whole point of returning a chain rather than a set. A
 * research card's upstream is its wired sources; a strategy card's is the
 * research card that claimed it AND that card's sources, because a strategy is
 * only intelligible against the question and the data behind it. Cards at the
 * same distance keep the graph's own order, so the result is stable.
 *
 * Wires are followed, never inferred: a materialized card with no provenance
 * wire (nothing on the Board recorded where it came from) has an empty chain,
 * and the envelope says so rather than guessing at a plausible parent.
 */
export function upstreamChain(graph: BoardGraph, nodeId: string): BoardNode[] {
  const depth = new Map<string, number>();
  let frontier = [nodeId];
  let distance = 0;
  while (frontier.length > 0) {
    distance += 1;
    const next: string[] = [];
    for (const current of frontier) {
      for (const edge of graph.edges) {
        if (edge.to !== current || edge.from === nodeId || depth.has(edge.from)) continue;
        depth.set(edge.from, distance);
        next.push(edge.from);
      }
    }
    frontier = next;
  }
  return graph.nodes
    .filter((node) => depth.has(node.id))
    .sort((a, b) => (depth.get(b.id) as number) - (depth.get(a.id) as number));
}

/**
 * The artifacts this card is answerable for: its own, plus every one held by a
 * card downstream of it. A research card owns no artifact itself, so this is
 * how "what came out of that question" is asked and answered — by reference,
 * as ids the agent can then read through the engine's own lanes.
 */
export function artifactViews(graph: BoardGraph, nodeId: string): BoardArtifactView[] {
  const views: BoardArtifactView[] = [];
  const push = (node: BoardNode | undefined): void => {
    if (!node?.ref) return;
    const view: BoardArtifactView = { node_id: node.id, kind: node.ref.kind, id: node.ref.id };
    views.push(node.label ? { ...view, label: node.label } : view);
  };
  push(findNode(graph, nodeId));
  for (const id of downstreamNodeIds(graph, nodeId)) push(findNode(graph, id));
  return views;
}

/* ── the envelope ────────────────────────────────────────────────────────── */

/**
 * The ambient document a selected card publishes: what it is, what feeds it,
 * and what came out of it — so a conversation about the card can start without
 * the person re-explaining their own Board.
 *
 * `panel`/`face` follow the pack's existing ambient descriptors (`focusContext`,
 * `roomAiContext`), so the chat reads a Board selection the same way it reads a
 * room open. Null when the id is not on the Board, which is what a caller turns
 * into a cleared document rather than a lie.
 */
export function boardNodeContext(
  graph: BoardGraph,
  nodeId: string
): Record<string, unknown> | null {
  const node = findNode(graph, nodeId);
  if (!node) return null;
  return {
    panel: 'grid',
    face: 'board',
    card: cardView(node),
    upstream: upstreamChain(graph, nodeId).map(cardView),
    artifacts: artifactViews(graph, nodeId),
  };
}
