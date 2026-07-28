/**
 * The Board's data model: one graph per workspace, references only.
 *
 * Everything here is pure — parse, serialize, and the shape-preserving graph
 * operations. {@link boardGraphStore} holds the live instance and owns the
 * settings-lane round trip; keeping the model separate is what lets the hard
 * invariants below be tested without a transport, a host, or a DOM.
 *
 * ## Two families of card, one node type
 * User-placed kinds (`source`, `research`) carry configuration the user typed.
 * Materialized kinds (`strategy`, `test`, `deploy`) are written by the system
 * when real work produces an artifact, and carry a REFERENCE to it — an id and
 * a kind, nothing else. One node type serves both because the canvas, the
 * layout and the delete rules are identical for all of them; only who writes
 * the node differs.
 *
 * ## The invariants, and where each is enforced
 *  - **References, never copies.** {@link ArtifactRef} has exactly two fields.
 *    Parsing sanitizes refs down to those two, so a payload that arrives inside
 *    a ref cannot survive a load, let alone a save. Metrics, curves and
 *    findings text stay engine-side and are fetched when a card is opened.
 *  - **No secrets, by schema.** {@link BoardSourceConfig} has no value field at
 *    all — only the vault SLOT NAME. There is no API to set one, and parsing
 *    builds the config field by field, so a secret pasted into the stored JSON
 *    by hand is dropped on load rather than re-persisted.
 *  - **Tolerant of the future.** A node whose `kind` this build does not know
 *    is preserved whole, and unrecognized top-level fields are carried in
 *    `extra` and re-emitted verbatim. An older IDE opening a newer Board must
 *    hand the graph back intact, not quietly amputate it.
 *  - **Sparse layout.** A position is stored only for a card the user actually
 *    moved. An absent position means "the Board places this one", which is what
 *    makes a materialized card able to appear without anyone choosing a spot.
 *
 * Known keys that do not apply to a node's kind are the one thing tolerance
 * does NOT cover: a `ref` on a source card, or a `source` bag on a research
 * card, is dropped. Tolerance exists for fields this build has never heard of,
 * not for known fields in the wrong place — preserving those would reopen the
 * reference-only hole from the other side.
 */

/** The kinds this build knows. Any other string is a future kind, preserved. */
export const BOARD_NODE_KINDS = ['source', 'research', 'strategy', 'test', 'deploy'] as const;

export type BoardNodeKind = (typeof BOARD_NODE_KINDS)[number];

/** The kinds a user places by hand. */
export type UserNodeKind = 'source' | 'research';

/** The kinds the system writes when work materializes an artifact. */
export type MaterializedNodeKind = 'strategy' | 'test' | 'deploy';

/** Canvas coordinates. Stored only for cards the user has moved. */
export interface BoardPosition {
  x: number;
  y: number;
}

/**
 * A source card's configuration.
 *
 * There is deliberately no field for a credential VALUE. The card names the
 * vault slot; the secret itself is written straight to the engine vault by the
 * card's editor and is never read back, so it cannot reach this graph even by
 * accident. Adding a value field here would defeat every other guard.
 */
export interface BoardSourceConfig {
  /** Display name the user gave this source. */
  name: string;
  /** Engine connector kind (`broker`, `data_provider`, `integration`, ...). */
  connectorKind: string;
  /** Where the data comes from — URL, host, or provider-specific locator. */
  endpoint: string;
  /** What arrives — `bars`, `ticks`, `news`, provider-specific. */
  payloadType: string;
  /** Vault SLOT NAME. Never a value, never a masked preview of one. */
  credentialSlot?: string;
}

/** A research card's configuration: the question, in the user's words. */
export interface BoardResearchConfig {
  hypothesis: string;
}

/**
 * A pointer at something the engine owns. Two fields, forever: anything more
 * would be a copy of engine state that could go stale on the canvas.
 */
export interface ArtifactRef {
  /** What it points at — `finding`, `strategy`, `backtest`, `deployment`, ... */
  kind: string;
  /** The engine's id for it, stringified. */
  id: string;
}

/** One card. */
export interface BoardNode {
  readonly id: string;
  /** {@link BoardNodeKind} for cards this build understands; any string survives. */
  readonly kind: string;
  /** Present only once the card has been placed — layout is sparse. */
  readonly position?: BoardPosition;
  /** Set on `source` cards only. */
  readonly source?: BoardSourceConfig;
  /** Set on `research` cards only. */
  readonly research?: BoardResearchConfig;
  /** Set on materialized (and future) cards only — a reference, never a copy. */
  readonly ref?: ArtifactRef;
  /** Short display label for a materialized card. */
  readonly label?: string;
  /** Fields this build does not recognize, preserved for whoever wrote them. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/**
 * Who drew a wire. User edges are the source-to-research wires drawn on the
 * canvas; system edges are provenance, written when an artifact materializes.
 * The distinction is not cosmetic: a user can undo their own wire, but pulling
 * a provenance edge by hand would make the Board lie about where a strategy
 * came from, so {@link canUnwire} refuses.
 */
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
  /** Unknown document-level fields, preserved across a round trip. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** Document version written by this build. Parsing accepts any version. */
export const BOARD_GRAPH_VERSION = 1;

const EMPTY: BoardGraph = { nodes: [], edges: [] };

/** The graph a workspace opens with before anything is placed. */
export function emptyBoardGraph(): BoardGraph {
  return EMPTY;
}

/* ── parse ───────────────────────────────────────────────────────────────── */

const NODE_KEYS = new Set(['id', 'kind', 'position', 'source', 'research', 'ref', 'label']);
const DOC_KEYS = new Set(['version', 'nodes', 'edges']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function parsePosition(value: unknown): BoardPosition | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y } = value;
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

/**
 * A ref, reduced to the only two things a ref may be. Everything else the
 * stored JSON carried under a ref — a metrics blob, an equity curve, a
 * findings body — is dropped here, which is the reference-only invariant's
 * load-side enforcement.
 */
function parseRef(value: unknown): ArtifactRef | undefined {
  if (!isRecord(value)) return undefined;
  const kind = str(value.kind);
  const id = str(value.id);
  if (!kind || !id) return undefined;
  return { kind, id };
}

/**
 * Field-by-field, so nothing that is not one of these five survives — on the
 * way in from storage OR on the way in from a caller. The store runs every
 * source write through here too, so a config object that happens to carry a
 * pasted secret cannot even sit in memory, where a context envelope bound for
 * the agent might otherwise pick it up.
 */
export function normalizeSourceConfig(value: unknown): BoardSourceConfig | undefined {
  if (!isRecord(value)) return undefined;
  const config: BoardSourceConfig = {
    name: str(value.name),
    connectorKind: str(value.connectorKind),
    endpoint: str(value.endpoint),
    payloadType: str(value.payloadType),
  };
  const slot = optionalStr(value.credentialSlot);
  return slot ? { ...config, credentialSlot: slot } : config;
}

export function normalizeResearchConfig(value: unknown): BoardResearchConfig | undefined {
  if (!isRecord(value)) return undefined;
  return { hypothesis: str(value.hypothesis) };
}

function collectExtra(
  value: Record<string, unknown>,
  known: Set<string>
): Record<string, unknown> | undefined {
  let extra: Record<string, unknown> | undefined;
  for (const key of Object.keys(value)) {
    if (known.has(key)) continue;
    extra = extra ?? {};
    extra[key] = value[key];
  }
  return extra;
}

function parseNode(value: unknown): BoardNode | undefined {
  if (!isRecord(value)) return undefined;
  const id = str(value.id);
  const kind = str(value.kind);
  // A card with no id cannot be addressed, wired or deleted; a card with no
  // kind cannot be drawn. Either way there is nothing to preserve.
  if (!id || !kind) return undefined;

  const node: {
    id: string;
    kind: string;
    position?: BoardPosition;
    source?: BoardSourceConfig;
    research?: BoardResearchConfig;
    ref?: ArtifactRef;
    label?: string;
    extra?: Record<string, unknown>;
  } = { id, kind };

  const position = parsePosition(value.position);
  if (position) node.position = position;

  // Config bags are read only for the kind that owns them; a future kind keeps
  // its unknown fields through `extra` instead.
  if (kind === 'source') {
    const source = normalizeSourceConfig(value.source);
    if (source) node.source = source;
  } else if (kind === 'research') {
    const research = normalizeResearchConfig(value.research);
    if (research) node.research = research;
  }

  // Sources and research cards own no artifact, so a ref on one is dropped.
  if (kind !== 'source' && kind !== 'research') {
    const ref = parseRef(value.ref);
    if (ref) node.ref = ref;
  }

  const label = optionalStr(value.label);
  if (label) node.label = label;

  const extra = collectExtra(value, NODE_KEYS);
  if (extra) node.extra = extra;

  return node;
}

function parseEdge(value: unknown, nodeIds: Set<string>): BoardEdge | undefined {
  if (!isRecord(value)) return undefined;
  const id = str(value.id);
  const from = str(value.from);
  const to = str(value.to);
  if (!id || !from || !to) return undefined;
  // A wire to a card that is not on the Board cannot be drawn and would make
  // the delete plan lie about what stays behind.
  if (!nodeIds.has(from) || !nodeIds.has(to)) return undefined;
  return { id, from, to, origin: value.origin === 'system' ? 'system' : 'user' };
}

/**
 * Read a stored graph. Never throws and never returns null: malformed input
 * yields an empty Board, because a Board that refuses to open is worse than a
 * Board that opens empty and re-saves on the next edit.
 */
export function parseBoardGraph(input: unknown): BoardGraph {
  let doc: unknown = input;
  if (typeof doc === 'string') {
    if (doc.trim() === '') return EMPTY;
    try {
      doc = JSON.parse(doc);
    } catch {
      return EMPTY;
    }
  }
  if (!isRecord(doc)) return EMPTY;

  const nodes: BoardNode[] = [];
  const seenNodes = new Set<string>();
  const rawNodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  for (const raw of rawNodes) {
    const node = parseNode(raw);
    if (!node || seenNodes.has(node.id)) continue;
    seenNodes.add(node.id);
    nodes.push(node);
  }

  const edges: BoardEdge[] = [];
  const seenEdges = new Set<string>();
  const seenPairs = new Set<string>();
  const rawEdges = Array.isArray(doc.edges) ? doc.edges : [];
  for (const raw of rawEdges) {
    const edge = parseEdge(raw, seenNodes);
    if (!edge || seenEdges.has(edge.id)) continue;
    const pair = `${edge.from} ${edge.to}`;
    if (seenPairs.has(pair)) continue;
    seenEdges.add(edge.id);
    seenPairs.add(pair);
    edges.push(edge);
  }

  const extra = collectExtra(doc, DOC_KEYS);
  return extra ? { nodes, edges, extra } : { nodes, edges };
}

/* ── serialize ───────────────────────────────────────────────────────────── */

function serializeNode(node: BoardNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: node.id, kind: node.kind };
  if (node.position) out.position = { x: node.position.x, y: node.position.y };
  if (node.source) {
    const source: Record<string, unknown> = {
      name: node.source.name,
      connectorKind: node.source.connectorKind,
      endpoint: node.source.endpoint,
      payloadType: node.source.payloadType,
    };
    if (node.source.credentialSlot) source.credentialSlot = node.source.credentialSlot;
    out.source = source;
  }
  if (node.research) out.research = { hypothesis: node.research.hypothesis };
  if (node.ref) out.ref = { kind: node.ref.kind, id: node.ref.id };
  if (node.label) out.label = node.label;
  if (node.extra) Object.assign(out, node.extra);
  return out;
}

/**
 * The stored document. Key order is fixed and every optional field is omitted
 * when absent, so serializing an unchanged graph produces a byte-identical
 * string — which is what lets the store skip a write that would change nothing.
 */
export function serializeBoardGraph(graph: BoardGraph): string {
  const doc: Record<string, unknown> = {
    version: BOARD_GRAPH_VERSION,
    nodes: graph.nodes.map(serializeNode),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      origin: edge.origin,
    })),
  };
  if (graph.extra) Object.assign(doc, graph.extra);
  return JSON.stringify(doc);
}

/* ── lookups ─────────────────────────────────────────────────────────────── */

export function findNode(graph: BoardGraph, nodeId: string): BoardNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId);
}

export function findEdge(graph: BoardGraph, edgeId: string): BoardEdge | undefined {
  return graph.edges.find((edge) => edge.id === edgeId);
}

/** Every card downstream of `nodeId`, following wires out, transitively. */
export function downstreamNodeIds(graph: BoardGraph, nodeId: string): string[] {
  const seen = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of graph.edges) {
      if (edge.from !== current || seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push(edge.to);
    }
  }
  seen.delete(nodeId);
  return [...seen];
}

/* ── writes (pure) ───────────────────────────────────────────────────────── */

export function addNode(graph: BoardGraph, node: BoardNode): BoardGraph {
  if (findNode(graph, node.id)) return graph;
  return { ...graph, nodes: [...graph.nodes, node] };
}

function replaceNode(graph: BoardGraph, next: BoardNode): BoardGraph {
  return { ...graph, nodes: graph.nodes.map((node) => (node.id === next.id ? next : node)) };
}

function sameSource(a: BoardSourceConfig, b: BoardSourceConfig): boolean {
  return (
    a.name === b.name &&
    a.connectorKind === b.connectorKind &&
    a.endpoint === b.endpoint &&
    a.payloadType === b.payloadType &&
    a.credentialSlot === b.credentialSlot
  );
}

/** What a card's editor may change. Applied by kind; the rest is ignored. */
export interface BoardNodePatch {
  source?: Partial<BoardSourceConfig>;
  research?: Partial<BoardResearchConfig>;
  label?: string;
}

export function updateNode(graph: BoardGraph, nodeId: string, patch: BoardNodePatch): BoardGraph {
  const node = findNode(graph, nodeId);
  if (!node) return graph;

  let next: BoardNode = node;
  if (patch.source && node.kind === 'source' && node.source) {
    // Merged, then normalized: a caller's extra field is dropped on the way in
    // exactly as it would be on the way out of storage.
    const merged = normalizeSourceConfig({ ...node.source, ...patch.source });
    // An edit that types the same value back is not a change: it must not
    // redraw the canvas or arm a save.
    if (merged && !sameSource(node.source, merged)) next = { ...next, source: merged };
  }
  if (patch.research && node.kind === 'research' && node.research) {
    const merged = normalizeResearchConfig({ ...node.research, ...patch.research });
    if (merged && merged.hypothesis !== node.research.hypothesis) {
      next = { ...next, research: merged };
    }
  }
  if (patch.label !== undefined) {
    next = patch.label ? { ...next, label: patch.label } : stripLabel(next);
  }
  if (next === node) return graph;
  return replaceNode(graph, next);
}

function stripLabel(node: BoardNode): BoardNode {
  if (node.label === undefined) return node;
  const { label: _label, ...rest } = node;
  return rest;
}

/** Move a card, or (with `null`) hand it back to the Board's own placement. */
export function setNodePosition(
  graph: BoardGraph,
  nodeId: string,
  position: BoardPosition | null
): BoardGraph {
  const node = findNode(graph, nodeId);
  if (!node) return graph;
  if (position === null) {
    if (!node.position) return graph;
    const { position: _dropped, ...rest } = node;
    return replaceNode(graph, rest);
  }
  if (node.position && node.position.x === position.x && node.position.y === position.y) {
    return graph;
  }
  return replaceNode(graph, { ...node, position: { x: position.x, y: position.y } });
}

export function addEdge(graph: BoardGraph, edge: BoardEdge): BoardGraph {
  if (findEdge(graph, edge.id)) return graph;
  return { ...graph, edges: [...graph.edges, edge] };
}

export function removeEdge(graph: BoardGraph, edgeId: string): BoardGraph {
  if (!findEdge(graph, edgeId)) return graph;
  return { ...graph, edges: graph.edges.filter((edge) => edge.id !== edgeId) };
}

/* ── wire rules ──────────────────────────────────────────────────────────── */

/** A refusal carries the sentence the Board shows, not an error code. */
export type BoardCheck = { ok: true } | { ok: false; reason: string };

/**
 * Only source-to-research wires are drawable. Downstream edges exist too, but
 * they are provenance the system writes when an artifact appears — offering
 * them as a gesture would let the canvas assert a lineage that never happened.
 */
export function canWire(graph: BoardGraph, fromId: string, toId: string): BoardCheck {
  if (fromId === toId) return { ok: false, reason: 'A card cannot wire to itself.' };
  const from = findNode(graph, fromId);
  const to = findNode(graph, toId);
  if (!from || !to) return { ok: false, reason: 'That card is no longer on the Board.' };
  if (from.kind !== 'source') return { ok: false, reason: 'Wires start at a source card.' };
  if (to.kind !== 'research') return { ok: false, reason: 'Wires end at a research card.' };
  if (graph.edges.some((edge) => edge.from === fromId && edge.to === toId)) {
    return { ok: false, reason: 'These cards are already wired.' };
  }
  return { ok: true };
}

/** Provenance is not the user's to redraw; their own wires are. */
export function canUnwire(graph: BoardGraph, edgeId: string): BoardCheck {
  const edge = findEdge(graph, edgeId);
  if (!edge) return { ok: false, reason: 'That wire is already gone.' };
  if (edge.origin === 'system') {
    return { ok: false, reason: 'This wire records where the work came from and cannot be cut.' };
  }
  return { ok: true };
}

/* ── delete semantics ────────────────────────────────────────────────────── */

/**
 * What a delete would actually do — computed before the confirm is shown, and
 * returned again by the delete itself so the UI can report the same thing
 * afterwards. `retained*` is the load-bearing half: deleting a research card
 * removes the question, never the findings and strategies it produced, and the
 * confirm has to be able to say so with real numbers.
 */
export interface BoardDeletePlan {
  /** The card asked about. Present even when it is not on the Board. */
  nodeId: string;
  /** Cards this delete removes — the one asked about, or none. */
  removedNodeIds: readonly string[];
  /** Wires that go with it. */
  removedEdgeIds: readonly string[];
  /** Cards that stay on the Board, downstream of the one being removed. */
  retainedNodeIds: readonly string[];
  /** Artifact references those cards keep. Nothing engine-side is touched. */
  retainedRefs: readonly ArtifactRef[];
}

export function planNodeDelete(graph: BoardGraph, nodeId: string): BoardDeletePlan {
  const node = findNode(graph, nodeId);
  if (!node) {
    return {
      nodeId,
      removedNodeIds: [],
      removedEdgeIds: [],
      retainedNodeIds: [],
      retainedRefs: [],
    };
  }
  const retainedNodeIds = downstreamNodeIds(graph, nodeId);
  const retainedRefs: ArtifactRef[] = [];
  for (const id of retainedNodeIds) {
    const ref = findNode(graph, id)?.ref;
    if (ref) retainedRefs.push(ref);
  }
  const removedEdgeIds = graph.edges
    .filter((edge) => edge.from === nodeId || edge.to === nodeId)
    .map((edge) => edge.id);
  return {
    nodeId,
    removedNodeIds: [nodeId],
    removedEdgeIds,
    retainedNodeIds,
    retainedRefs,
  };
}

/**
 * Apply a plan. Only the named card and its own wires go; everything
 * downstream stays where it is, still pointing at engine artifacts that were
 * never this Board's to destroy.
 */
export function applyNodeDelete(graph: BoardGraph, plan: BoardDeletePlan): BoardGraph {
  if (plan.removedNodeIds.length === 0) return graph;
  const removedNodes = new Set(plan.removedNodeIds);
  const removedEdges = new Set(plan.removedEdgeIds);
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !removedNodes.has(node.id)),
    edges: graph.edges.filter((edge) => !removedEdges.has(edge.id)),
  };
}
