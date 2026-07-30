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
import { isSecType, type ContractRef } from './liveQuotes';

/** The kinds this build knows. Any other string is a future kind, preserved. */
export const BOARD_NODE_KINDS = ['source', 'research', 'quote', 'strategy', 'test', 'deploy'] as const;

export type BoardNodeKind = (typeof BOARD_NODE_KINDS)[number];

/** The kinds a user places by hand. */
export type UserNodeKind = 'source' | 'research' | 'quote';

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

/**
 * A live-quote card's configuration: an optional name, and the SET of contracts
 * it watches (OQ2 — a card is a small watchlist, not a single symbol).
 *
 * Like {@link BoardSourceConfig}, this holds only what a person typed. There is
 * no quote data here and no engine line: a quote is live market data that lives
 * on the stream, fetched while the card is on the canvas, never stored — so a
 * saved Board carries the intent to watch, not a stale price.
 */
export interface BoardQuoteConfig {
  /** Display name the user gave the card. Optional — the symbols name it. */
  name?: string;
  /** The contracts this card watches. */
  contracts: ContractRef[];
}

/** A research card's configuration: the question, in the user's words. */
export interface BoardResearchConfig {
  hypothesis: string;
  /**
   * Whether the standing loop may dispatch synthesis for this card on its own.
   *
   * OFF unless somebody turned it on, and stored per card rather than per
   * workspace, because the thing it authorizes costs money: a dispatch is an
   * agent session against the monthly allowance. Absent means off, so a card
   * written by an older build — or by hand — can never arrive already spending.
   */
  autoSynthesize?: boolean;
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
  /** Set on `quote` cards only. */
  readonly quote?: BoardQuoteConfig;
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
  /**
   * Seeded source cards this Board has been told not to lay down again.
   *
   * Removing a card the Board placed for you is an instruction, not an
   * accident, and the bootstrap has to be able to hear it on the NEXT open as
   * well as this one — otherwise a Board whose only cards were seeded grows
   * them back every morning. Ids only, so an entry costs nothing and a build
   * that has never heard of the field carries it through as an unknown.
   */
  readonly retiredSeeds?: readonly string[];
  /** Unknown document-level fields, preserved across a round trip. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/**
 * The id prefix a card the Board seeded carries.
 *
 * Lives here rather than with the bootstrap because the DELETE has to
 * recognize one, and the delete is a pure graph operation — see
 * {@link applyNodeDelete}. {@link ../boardBuiltins} mints the ids.
 */
export const SEEDED_NODE_PREFIX = 'source-builtin-';

/** True for a card the Board laid down rather than a person. */
export function isSeededNodeId(nodeId: string): boolean {
  return nodeId.startsWith(SEEDED_NODE_PREFIX);
}

/** Document version written by this build. Parsing accepts any version. */
export const BOARD_GRAPH_VERSION = 1;

const EMPTY: BoardGraph = { nodes: [], edges: [] };

/** The graph a workspace opens with before anything is placed. */
export function emptyBoardGraph(): BoardGraph {
  return EMPTY;
}

/* ── parse ───────────────────────────────────────────────────────────────── */

const NODE_KEYS = new Set(['id', 'kind', 'position', 'source', 'research', 'quote', 'ref', 'label']);
const DOC_KEYS = new Set(['version', 'nodes', 'edges', 'retiredSeeds']);

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
  const config: BoardResearchConfig = { hypothesis: str(value.hypothesis) };
  // Only a literal true authorizes automatic spend. Anything else — absent, a
  // string, a truthy number somebody hand-edited in — is off.
  return value.autoSynthesize === true ? { ...config, autoSynthesize: true } : config;
}

function optionalNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * One contract, reduced field by field — the same rule the source config
 * follows, so nothing a caller tacked on survives. A contract keeps its slot as
 * long as its type is one this build knows: the symbol may still be empty while
 * a person is typing, and dropping a half-filled row out from under the cursor
 * is the one behaviour worse than leaving it. Symbol is stored AS TYPED (spaces
 * and case), and only upper-cased on the way to the wire, so editing does not
 * fight the keyboard.
 */
export function normalizeContract(value: unknown): ContractRef | undefined {
  if (!isRecord(value)) return undefined;
  const secTypeRaw = str(value.secType);
  if (!isSecType(secTypeRaw)) return undefined;
  const contract: ContractRef = { symbol: str(value.symbol), secType: secTypeRaw };
  const expiry = optionalStr(value.expiry);
  if (expiry) contract.expiry = expiry;
  const strike = optionalNum(value.strike);
  if (strike !== undefined) contract.strike = strike;
  const right = str(value.right);
  if (right === 'C' || right === 'P') contract.right = right;
  const exchange = optionalStr(value.exchange);
  if (exchange) contract.exchange = exchange;
  const currency = optionalStr(value.currency);
  if (currency) contract.currency = currency;
  const multiplier = optionalStr(value.multiplier);
  if (multiplier) contract.multiplier = multiplier;
  return contract;
}

export function normalizeQuoteConfig(value: unknown): BoardQuoteConfig | undefined {
  if (!isRecord(value)) return undefined;
  const rawContracts = Array.isArray(value.contracts) ? value.contracts : [];
  const contracts = rawContracts
    .map(normalizeContract)
    .filter((contract): contract is ContractRef => contract !== undefined);
  const name = optionalStr(value.name);
  const config: BoardQuoteConfig = { contracts };
  return name ? { name, contracts } : config;
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
    quote?: BoardQuoteConfig;
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
  } else if (kind === 'quote') {
    const quote = normalizeQuoteConfig(value.quote);
    if (quote) node.quote = quote;
  }

  // The kinds a person places own no artifact, so a ref on one is dropped.
  if (kind !== 'source' && kind !== 'research' && kind !== 'quote') {
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

  const retiredSeeds = parseRetiredSeeds(doc.retiredSeeds);
  const extra = collectExtra(doc, DOC_KEYS);
  const graph: BoardGraph = { nodes, edges };
  const withRetired = retiredSeeds ? { ...graph, retiredSeeds } : graph;
  return extra ? { ...withRetired, extra } : withRetired;
}

/** The retired list, reduced to non-empty strings with no repeats. */
function parseRetiredSeeds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids: string[] = [];
  for (const raw of value) {
    const id = str(raw);
    if (id === '' || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids.length > 0 ? ids : undefined;
}

/* ── serialize ───────────────────────────────────────────────────────────── */

/** One contract, key order fixed and empty qualifiers omitted, so an unchanged
 *  quote card serializes byte for byte and writes nothing new. */
function serializeContract(contract: ContractRef): Record<string, unknown> {
  const out: Record<string, unknown> = { symbol: contract.symbol, secType: contract.secType };
  if (contract.expiry) out.expiry = contract.expiry;
  if (typeof contract.strike === 'number') out.strike = contract.strike;
  if (contract.right) out.right = contract.right;
  if (contract.exchange) out.exchange = contract.exchange;
  if (contract.currency) out.currency = contract.currency;
  if (contract.multiplier) out.multiplier = contract.multiplier;
  return out;
}

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
  if (node.research) {
    const research: Record<string, unknown> = { hypothesis: node.research.hypothesis };
    // Written only when on, so a Board nobody has armed serializes byte for
    // byte as it did before this field existed.
    if (node.research.autoSynthesize) research.autoSynthesize = true;
    out.research = research;
  }
  if (node.quote) {
    const quote: Record<string, unknown> = { contracts: node.quote.contracts.map(serializeContract) };
    if (node.quote.name) quote.name = node.quote.name;
    out.quote = quote;
  }
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
  // Omitted when empty, so a Board nobody has retired a seed on serializes byte
  // for byte as it did before this field existed.
  if (graph.retiredSeeds && graph.retiredSeeds.length > 0) {
    doc.retiredSeeds = [...graph.retiredSeeds];
  }
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

/**
 * Whether a card a person placed still holds nothing a person put there.
 *
 * The Board lays a card down BEFORE anything has been typed into it — the add
 * row's whole point is that the editor opens on a real card rather than on a
 * form that might become one — which means a card can exist for a moment
 * carrying no work at all. This is the test for that moment, and the reason it
 * is a pure function on the node rather than a flag on the UI: what counts as
 * work is a property of the card's schema, so a field added to
 * {@link BoardSourceConfig} later has exactly one place to be accounted for.
 *
 * ANY user-entered value makes a card real, including one that looks
 * incidental: a slot name with no secret behind it yet, a connector kind chosen
 * but not pointed anywhere. Erring the other way would silently discard
 * somebody's half-finished card, which is the one outcome worse than leaving an
 * empty one on the board.
 *
 * Cards the SYSTEM wrote are never blank in this sense: they carry a reference
 * to real work and nobody typed them, so there is nothing here to judge.
 */
export function isBlankUserCard(node: BoardNode): boolean {
  if (node.kind === 'source') {
    const source = node.source;
    if (!source) return true;
    return [
      source.name,
      source.connectorKind,
      source.endpoint,
      source.payloadType,
      source.credentialSlot ?? '',
    ].every((field) => field.trim() === '');
  }
  if (node.kind === 'research') {
    const research = node.research;
    if (!research) return true;
    return (research.hypothesis ?? '').trim() === '' && research.autoSynthesize !== true;
  }
  if (node.kind === 'quote') {
    const quote = node.quote;
    if (!quote) return true;
    // A name, or ANY contract carrying a typed field, is work. A row a person
    // added but never filled (a bare default sec_type, nothing else) is not.
    if ((quote.name ?? '').trim() !== '') return false;
    return !quote.contracts.some(
      (contract) =>
        contract.symbol.trim() !== '' ||
        !!contract.expiry ||
        typeof contract.strike === 'number' ||
        !!contract.right ||
        !!contract.currency ||
        !!contract.exchange ||
        !!contract.multiplier
    );
  }
  return false;
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

function sameResearch(a: BoardResearchConfig, b: BoardResearchConfig): boolean {
  return a.hypothesis === b.hypothesis && (a.autoSynthesize ?? false) === (b.autoSynthesize ?? false);
}

function sameContract(a: ContractRef, b: ContractRef): boolean {
  return (
    a.symbol === b.symbol &&
    a.secType === b.secType &&
    a.expiry === b.expiry &&
    a.strike === b.strike &&
    a.right === b.right &&
    a.exchange === b.exchange &&
    a.currency === b.currency &&
    a.multiplier === b.multiplier
  );
}

function sameQuote(a: BoardQuoteConfig, b: BoardQuoteConfig): boolean {
  return (
    (a.name ?? '') === (b.name ?? '') &&
    a.contracts.length === b.contracts.length &&
    a.contracts.every((contract, index) => sameContract(contract, b.contracts[index]))
  );
}

/** What a card's editor may change. Applied by kind; the rest is ignored. */
export interface BoardNodePatch {
  source?: Partial<BoardSourceConfig>;
  research?: Partial<BoardResearchConfig>;
  quote?: Partial<BoardQuoteConfig>;
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
    if (merged && !sameResearch(node.research, merged)) {
      next = { ...next, research: merged };
    }
  }
  if (patch.quote && node.kind === 'quote' && node.quote) {
    const merged = normalizeQuoteConfig({ ...node.quote, ...patch.quote });
    if (merged && !sameQuote(node.quote, merged)) next = { ...next, quote: merged };
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
 *
 * A card the Board SEEDED is also written into {@link BoardGraph.retiredSeeds}
 * on the way out. Removing one is a decision, and the bootstrap reads the list
 * before it lays anything down, so the decision survives the workspace being
 * closed and opened again.
 */
export function applyNodeDelete(graph: BoardGraph, plan: BoardDeletePlan): BoardGraph {
  if (plan.removedNodeIds.length === 0) return graph;
  const removedNodes = new Set(plan.removedNodeIds);
  const removedEdges = new Set(plan.removedEdgeIds);
  const next: BoardGraph = {
    ...graph,
    nodes: graph.nodes.filter((node) => !removedNodes.has(node.id)),
    edges: graph.edges.filter((edge) => !removedEdges.has(edge.id)),
  };
  const retiredSeeds = retireSeeded(graph.retiredSeeds, plan.removedNodeIds);
  return retiredSeeds ? { ...next, retiredSeeds } : next;
}

/** The retired list with every seeded id in `removed` on it, or the list
 *  unchanged when none of them was seeded. */
function retireSeeded(
  retired: readonly string[] | undefined,
  removed: readonly string[]
): readonly string[] | undefined {
  const held = retired ?? [];
  const added = removed.filter((id) => isSeededNodeId(id) && !held.includes(id));
  return added.length === 0 ? retired : [...held, ...added];
}
