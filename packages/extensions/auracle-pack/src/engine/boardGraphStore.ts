/**
 * The live Board — one workspace's graph, plus its trip through the settings
 * lane.
 *
 * The pack's `subscribe`/`getSnapshot` store pattern again (alongside
 * `backtestStore`, `deployStore`, `focusStore` and `gridFoldStore`), so the
 * canvas, a card's editor and — later — the agent bridge all read one graph
 * with `useSyncExternalStore` and none of them has to know about the others.
 * The snapshot object is REPLACED on every change and never mutated, so a
 * reference comparison is enough to re-render.
 *
 * The graph model and its rules live in {@link ./boardGraph}; the transport
 * lives in {@link ./boardPersistence}. What is left here is exactly the part
 * that needs a single instance: which workspace is open, what has been saved,
 * and when to save next.
 *
 * ## Writes are idempotent by construction
 * Every save compares the serialized graph against the last string the engine
 * accepted and returns without a request when they match. Loading sets that
 * baseline to the CANONICAL serialization of what was parsed — not to the bytes
 * that arrived — so opening a Board saves nothing, even when parsing tidied the
 * document (dropping a dangling wire, say). The tidied form reaches the engine
 * with the next real edit, which is the one write that was going to happen
 * anyway. Without this rule, two windows watching one workspace would take
 * turns rewriting each other's identical state forever.
 *
 * ## Local edits win over a refresh
 * {@link boardGraphStore.refresh} adopts what the engine has, but never while
 * an edit is unsaved or in flight — the alternative is a card snapping back
 * under the user's cursor. The save that is already queued will carry the local
 * state out, and the next refresh sees it.
 */
import {
  addEdge,
  addNode,
  applyNodeDelete,
  canUnwire,
  canWire,
  emptyBoardGraph,
  findNode,
  normalizeResearchConfig,
  normalizeSourceConfig,
  parseBoardGraph,
  planNodeDelete,
  removeEdge,
  serializeBoardGraph,
  setNodePosition,
  updateNode,
  type ArtifactRef,
  type BoardCheck,
  type BoardDeletePlan,
  type BoardGraph,
  type BoardNode,
  type BoardNodePatch,
  type BoardPosition,
  type BoardResearchConfig,
  type BoardSourceConfig,
  type MaterializedNodeKind,
} from './boardGraph';
import { engineSettingsTransport, type BoardGraphTransport } from './boardPersistence';

/**
 * `closed` before a workspace is opened, `error` when the lane refused — the
 * Board says "not synced" rather than dropping the edits or pretending.
 */
export type BoardStatus = 'closed' | 'loading' | 'idle' | 'saving' | 'error';

export interface BoardSnapshot {
  /** The workspace this graph belongs to. Empty while closed. */
  readonly workspaceId: string;
  readonly graph: BoardGraph;
  readonly status: BoardStatus;
  /** Local edits that have not reached the settings lane yet. */
  readonly dirty: boolean;
}

/** A card the user places. Materialized cards arrive through {@link materialize}. */
export type NewBoardNode =
  | {
      kind: 'source';
      source: BoardSourceConfig;
      position?: BoardPosition;
      /** Supply an id to make a test deterministic; otherwise one is minted. */
      id?: string;
    }
  | {
      kind: 'research';
      research: BoardResearchConfig;
      position?: BoardPosition;
      id?: string;
    };

/** A card the system writes when real work produces an artifact. */
export interface MaterializeInput {
  kind: MaterializedNodeKind;
  /** The artifact this card points at. Copied down to kind and id. */
  ref: ArtifactRef;
  /** The card the work came from — the provenance wire is drawn from here. */
  from: string;
  label?: string;
  position?: BoardPosition;
  id?: string;
}

export type WireResult = { ok: true; edgeId: string } | { ok: false; reason: string };

export type MaterializeResult = { ok: true; nodeId: string } | { ok: false; reason: string };

export interface OpenOptions {
  /** Defaults to the engine settings lane. Tests hand in a mock. */
  transport?: BoardGraphTransport;
  /** How long an edit rests before it is written. */
  saveDelayMs?: number;
}

const DEFAULT_SAVE_DELAY_MS = 400;

const BLANK_SOURCE: BoardSourceConfig = {
  name: '',
  connectorKind: '',
  endpoint: '',
  payloadType: '',
};

const CLOSED: BoardSnapshot = {
  workspaceId: '',
  graph: emptyBoardGraph(),
  status: 'closed',
  dirty: false,
};

let snapshot: BoardSnapshot = CLOSED;
let transport: BoardGraphTransport | null = null;
let lastSavedJson: string | null = null;
let saveDelayMs = DEFAULT_SAVE_DELAY_MS;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveChain: Promise<void> = Promise.resolve();
/** Bumped on every open/reset so a load or save in flight cannot land late. */
let generation = 0;
let sequence = 0;

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function set(patch: Partial<BoardSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  notify();
}

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function cancelTimer(): void {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
}

function schedule(): void {
  if (saveTimer !== undefined) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void enqueueSave();
  }, saveDelayMs);
}

function enqueueSave(): Promise<void> {
  saveChain = saveChain.then(performSave, performSave);
  return saveChain;
}

async function performSave(): Promise<void> {
  const active = transport;
  if (!active || snapshot.status === 'closed') return;

  const json = serializeBoardGraph(snapshot.graph);
  if (json === lastSavedJson) {
    // Nothing changed since the engine last accepted this graph. This is the
    // guard that keeps two windows from writing to each other forever.
    if (snapshot.dirty || snapshot.status === 'saving') set({ dirty: false, status: 'idle' });
    return;
  }

  const gen = generation;
  const workspaceId = snapshot.workspaceId;
  set({ status: 'saving' });

  let ok = false;
  try {
    ok = await active.save(workspaceId, json);
  } catch {
    ok = false;
  }
  // A different workspace opened while this write was in flight — its state is
  // the one on screen now, and this result says nothing about it.
  if (gen !== generation) return;

  if (!ok) {
    set({ status: 'error', dirty: true });
    return;
  }
  lastSavedJson = json;
  const dirty = serializeBoardGraph(snapshot.graph) !== json;
  set({ status: 'idle', dirty });
  // Edits landed during the write — carry them out too.
  if (dirty) schedule();
}

/** Apply a pure graph write and arm the save. A no-op change writes nothing. */
function mutate(next: BoardGraph): void {
  if (next === snapshot.graph) return;
  const json = serializeBoardGraph(next);
  const dirty = json !== lastSavedJson;
  snapshot = { ...snapshot, graph: next, dirty };
  notify();
  if (dirty) schedule();
}

export const boardGraphStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): BoardSnapshot {
    return snapshot;
  },

  /**
   * Open a workspace's Board, loading it from the lane. Re-opening the one
   * already open is a no-op, so a remounting panel does not re-fetch. Switching
   * workspaces flushes any unsaved edit to the one being left behind first.
   */
  async open(workspaceId: string, options: OpenOptions = {}): Promise<void> {
    const nextTransport = options.transport ?? transport ?? engineSettingsTransport();
    if (options.saveDelayMs !== undefined) saveDelayMs = options.saveDelayMs;
    if (
      snapshot.status !== 'closed' &&
      snapshot.workspaceId === workspaceId &&
      nextTransport === transport
    ) {
      return;
    }
    if (snapshot.status !== 'closed' && snapshot.dirty) await boardGraphStore.flush();

    const gen = ++generation;
    cancelTimer();
    transport = nextTransport;
    lastSavedJson = null;
    snapshot = { workspaceId, graph: emptyBoardGraph(), status: 'loading', dirty: false };
    notify();

    let loaded: string | null = null;
    let failed = false;
    try {
      loaded = await nextTransport.load(workspaceId);
    } catch {
      failed = true;
    }
    if (gen !== generation) return;

    const graph = parseBoardGraph(loaded);
    // The baseline is what WE would write, not what arrived — see the header.
    lastSavedJson = serializeBoardGraph(graph);
    snapshot = { workspaceId, graph, status: failed ? 'error' : 'idle', dirty: false };
    notify();
  },

  /**
   * Re-read the open workspace and adopt what another window saved. Skipped
   * while an edit is unsaved or in flight; the queued save carries the local
   * state out instead.
   */
  async refresh(): Promise<void> {
    const active = transport;
    if (!active || snapshot.status === 'closed') return;
    if (snapshot.dirty || snapshot.status === 'saving') return;

    const gen = generation;
    const workspaceId = snapshot.workspaceId;
    let loaded: string | null = null;
    try {
      loaded = await active.load(workspaceId);
    } catch {
      if (gen === generation) set({ status: 'error' });
      return;
    }
    if (gen !== generation || snapshot.dirty) return;

    const graph = parseBoardGraph(loaded);
    const json = serializeBoardGraph(graph);
    if (json === lastSavedJson) {
      if (snapshot.status !== 'idle') set({ status: 'idle' });
      return;
    }
    lastSavedJson = json;
    snapshot = { ...snapshot, graph, status: 'idle', dirty: false };
    notify();
  },

  /**
   * Place a source or research card. Returns its id. The configuration is
   * normalized on the way in, so a caller handing over a fatter object than the
   * schema (a connector record with a secret in it, say) stores the schema.
   */
  createNode(input: NewBoardNode): string {
    const id = input.id ?? nextId(input.kind);
    const node: BoardNode =
      input.kind === 'source'
        ? { id, kind: 'source', source: normalizeSourceConfig(input.source) ?? BLANK_SOURCE }
        : {
            id,
            kind: 'research',
            research: normalizeResearchConfig(input.research) ?? { hypothesis: '' },
          };
    const placed = input.position ? { ...node, position: { ...input.position } } : node;
    mutate(addNode(snapshot.graph, placed));
    return id;
  },

  /** Edit a card in place. Fields that do not belong to its kind are ignored. */
  updateNode(nodeId: string, patch: BoardNodePatch): void {
    mutate(updateNode(snapshot.graph, nodeId, patch));
  },

  /**
   * What deleting this card would do, without doing it — the numbers the
   * confirm needs to say that findings and strategies stay behind.
   */
  previewDelete(nodeId: string): BoardDeletePlan {
    return planNodeDelete(snapshot.graph, nodeId);
  },

  /**
   * Delete a card. Only that card and its own wires go: everything downstream
   * stays on the Board, still referencing artifacts this store never owned and
   * cannot destroy. The plan comes back so the UI can report what it kept.
   */
  deleteNode(nodeId: string): BoardDeletePlan {
    const plan = planNodeDelete(snapshot.graph, nodeId);
    mutate(applyNodeDelete(snapshot.graph, plan));
    return plan;
  },

  /** Draw a source-to-research wire. Refusals carry the sentence to show. */
  wire(fromId: string, toId: string): WireResult {
    const check = canWire(snapshot.graph, fromId, toId);
    if (!check.ok) return check;
    const edgeId = nextId('wire');
    mutate(addEdge(snapshot.graph, { id: edgeId, from: fromId, to: toId, origin: 'user' }));
    return { ok: true, edgeId };
  },

  /** Cut a wire the user drew. Provenance wires refuse, with a reason. */
  unwire(edgeId: string): BoardCheck {
    const check = canUnwire(snapshot.graph, edgeId);
    if (!check.ok) return check;
    mutate(removeEdge(snapshot.graph, edgeId));
    return { ok: true };
  },

  /** Move a card, or (with `null`) hand its placement back to the Board. */
  position(nodeId: string, position: BoardPosition | null): void {
    mutate(setNodePosition(snapshot.graph, nodeId, position));
  },

  /**
   * Record that work produced an artifact: a materialized card plus the
   * system-written wire from whatever it came out of.
   *
   * Idempotent on (kind, ref) — the engine re-announces artifacts on every
   * poll, and a second announcement must return the card that already exists
   * rather than growing a duplicate every few seconds. The ref is copied down
   * to kind and id, so a caller handing over a whole artifact still stores a
   * reference.
   */
  materialize(input: MaterializeInput): MaterializeResult {
    if (!input.ref || !input.ref.kind || !input.ref.id) {
      return { ok: false, reason: 'A materialized card needs an artifact reference.' };
    }
    const parent = findNode(snapshot.graph, input.from);
    if (!parent) return { ok: false, reason: 'That card is no longer on the Board.' };

    const ref: ArtifactRef = { kind: input.ref.kind, id: input.ref.id };
    const existing = snapshot.graph.nodes.find(
      (node) => node.kind === input.kind && node.ref?.kind === ref.kind && node.ref.id === ref.id
    );
    const nodeId = existing?.id ?? input.id ?? nextId(input.kind);

    let next = snapshot.graph;
    if (!existing) {
      const node: BoardNode = { id: nodeId, kind: input.kind, ref };
      const labelled = input.label ? { ...node, label: input.label } : node;
      next = addNode(next, input.position ? { ...labelled, position: { ...input.position } } : labelled);
    }
    if (!next.edges.some((edge) => edge.from === input.from && edge.to === nodeId)) {
      next = addEdge(next, { id: nextId('trace'), from: input.from, to: nodeId, origin: 'system' });
    }
    mutate(next);
    return { ok: true, nodeId };
  },

  /**
   * Write any pending edit now and wait for it. The panel calls this when the
   * Board closes; tests call it instead of waiting out the debounce.
   */
  async flush(): Promise<void> {
    cancelTimer();
    await enqueueSave();
  },

  /** Back to closed. Subscribers stay subscribed. */
  reset(): void {
    generation += 1;
    cancelTimer();
    transport = null;
    lastSavedJson = null;
    saveDelayMs = DEFAULT_SAVE_DELAY_MS;
    saveChain = Promise.resolve();
    snapshot = CLOSED;
    notify();
  },
};

/**
 * The read side, and nothing else — what the Board's shell binds to.
 *
 * The canvas draws the graph; it has no business with the workspace id, the
 * save state or any of the writes, and a component that only reads should not
 * re-render when a save finishes. `getSnapshot` hands back the graph itself,
 * whose reference changes only when the graph does, so it is a
 * `useSyncExternalStore` source as it stands.
 */
export const boardGraph = {
  subscribe(listener: () => void): () => void {
    return boardGraphStore.subscribe(listener);
  },
  getSnapshot(): BoardGraph {
    return snapshot.graph;
  },
};
