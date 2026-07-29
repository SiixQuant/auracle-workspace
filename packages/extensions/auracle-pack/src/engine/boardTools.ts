/**
 * The Board, operated by the agent — the same moves a person makes on the
 * canvas, through the store the canvas writes to.
 *
 * ## One graph, one set of rules
 * Every operation here goes through {@link boardGraphStore}. Nothing
 * re-implements a rule: which pairings are a wire, what a delete leaves behind,
 * how a configuration is normalized and when a save is armed are all decided in
 * one place, so an agent and a person cannot put the Board into two different
 * states. A refusal is carried out verbatim — the store's sentence, not a
 * re-worded one — because the agent is going to repeat it to somebody.
 *
 * ## The credential slot is WRITE-ONLY, by schema and by refusal
 * No tool here accepts or returns a secret value. That is enforced twice:
 *  - a configuration is read key by key against a CLOSED set of field names, so
 *    a key this build does not know cannot reach the store even if the store
 *    would have dropped it anyway ({@link normalizeSourceConfig} does, which is
 *    the second wall);
 *  - a key that LOOKS like a value (`secret`, `api_key`, `token`, `password`,
 *    ...) is refused by name with the reason, rather than silently ignored. An
 *    agent that quietly had its field dropped would go on believing the key was
 *    stored; one that is told plainly will ask the person to paste it into the
 *    card, which is the only route a secret has.
 * Reads are protected by construction: everything the agent sees is built by
 * {@link ./boardEnvelope}, which names its fields rather than copying a node.
 *
 * ## Draft class, all of it
 * Placing a card, wiring two together and removing one are edits to a drawing
 * of the work. Nothing here reaches a capital verb, an order, or a deployment
 * lifecycle — those live behind the engine's declared, approved lane
 * ({@link ./confirm}) and no board tool touches it.
 *
 * ## A closed Board refuses rather than pretends
 * The store holds one workspace's graph and only saves while it is open. A
 * mutation against a closed Board would land in a snapshot nobody writes, so
 * the agent would be told it created a card that evaporates. Every mutation
 * refuses instead, naming the fix.
 */
import {
  boardGraphStore,
  type NewBoardNode,
} from './boardGraphStore';
import {
  findNode,
  normalizeSourceConfig,
  type BoardDeletePlan,
  type BoardGraph,
  type BoardPosition,
  type BoardSourceConfig,
} from './boardGraph';
import { artifactViews, boardGraphView, cardView, upstreamChain } from './boardEnvelope';
import { boardMutatedEvent, emitCapturedPanelEvent, type BoardVerb } from './panelEvents';

/** What a tool did, or why it did nothing. `data` is what the agent reads. */
export type BoardToolOutcome =
  | { ok: true; message: string; data: Record<string, unknown> }
  | { ok: false; error: string };

function fail(error: string): BoardToolOutcome {
  return { ok: false, error };
}

function done(message: string, data: Record<string, unknown>): BoardToolOutcome {
  return { ok: true, message, data };
}

/* ── reading the parameters a tool call arrived with ─────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The field names a card may carry, per kind. CLOSED sets: this is the list
 * that decides what can reach the graph from a tool call, so a field added to
 * the model later has to be added here deliberately.
 */
const SOURCE_KEYS: Record<string, keyof BoardSourceConfig> = {
  name: 'name',
  connector_kind: 'connectorKind',
  endpoint: 'endpoint',
  payload_type: 'payloadType',
  credential_slot: 'credentialSlot',
};

const RESEARCH_KEYS = new Set(['hypothesis']);

/**
 * Names a credential value hides behind. Matched only AFTER the allowed keys
 * have been taken, so `credential_slot` — which contains the word — is never
 * tested against it.
 */
const VALUE_SHAPED =
  /(secret|password|passwd|passphrase|token|api[-_ ]?key|apikey|bearer|private[-_ ]?key|access[-_ ]?key|credential|auth)/i;

const WRITE_ONLY_REFUSAL =
  'A credential value never travels through a board tool. Name the vault slot with ' +
  '`credential_slot` and ask the person to paste the key into the card\'s secret input — ' +
  'the only route a secret has.';

/**
 * Read a configuration object, key by key, against the closed set for `kind`.
 *
 * The result is already in the graph's own shape, so the caller hands it
 * straight to the store — which normalizes it again. Two walls on the same
 * hole, on purpose: this one exists to REFUSE and explain, the store's exists
 * so nothing gets through even when a caller forgets to ask.
 */
export function readCardConfig(
  kind: 'source' | 'research',
  value: unknown
): { ok: true; source?: Partial<BoardSourceConfig>; research?: { hypothesis: string } } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (!isRecord(value)) return { ok: false, error: 'config must be an object of named fields.' };

  const allowed = kind === 'source' ? new Set(Object.keys(SOURCE_KEYS)) : RESEARCH_KEYS;
  const source: Partial<BoardSourceConfig> = {};
  let hypothesis: string | undefined;

  for (const [key, raw] of Object.entries(value)) {
    if (!allowed.has(key)) {
      if (VALUE_SHAPED.test(key)) return { ok: false, error: `${key}: ${WRITE_ONLY_REFUSAL}` };
      return {
        ok: false,
        error: `${key} is not a field on a ${kind} card. Allowed: ${[...allowed].join(', ')}.`,
      };
    }
    if (typeof raw !== 'string') {
      return { ok: false, error: `${key} must be a string.` };
    }
    if (kind === 'source') source[SOURCE_KEYS[key]] = raw;
    else hypothesis = raw;
  }

  return kind === 'source'
    ? { ok: true, source }
    : { ok: true, research: { hypothesis: hypothesis ?? '' } };
}

function readPosition(value: unknown): BoardPosition | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y } = value;
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

/* ── the Board has to be open ────────────────────────────────────────────── */

const CLOSED_REFUSAL =
  'The Board is not open, so nothing written to it would be saved. Open the Auracle panel ' +
  'on its Board face once, then try again.';

function graphOrNull(): BoardGraph | null {
  const snapshot = boardGraphStore.getSnapshot();
  return snapshot.status === 'closed' ? null : snapshot.graph;
}

/**
 * Open the workspace's Board if nothing has opened one yet.
 *
 * Only from CLOSED: a Board that is already open belongs to the panel, and
 * re-opening it against a different id would flush one workspace's graph and
 * load another underneath somebody's cursor.
 */
export async function ensureBoardOpen(workspaceId: string): Promise<void> {
  if (boardGraphStore.getSnapshot().status !== 'closed') return;
  await boardGraphStore.open(workspaceId);
}

/** Carry a pending edit out to the settings lane before the tool answers, so a
 *  tool that says it placed a card has placed one that survives the session. */
export async function flushBoard(): Promise<void> {
  await boardGraphStore.flush();
}

function report(verb: BoardVerb, subject: string, kind?: string): void {
  emitCapturedPanelEvent(boardMutatedEvent({ subject, verb, ...(kind ? { kind } : {}) }));
}

/* ── the operations ──────────────────────────────────────────────────────── */

/** The whole Board, reduced — cards, wires, and how the graph is doing. */
export function boardList(): BoardToolOutcome {
  const snapshot = boardGraphStore.getSnapshot();
  if (snapshot.status === 'closed') return fail(CLOSED_REFUSAL);
  const view = boardGraphView(snapshot.graph);
  return done(
    `${view.nodes.length} card${view.nodes.length === 1 ? '' : 's'} and ${view.edges.length} wire${
      view.edges.length === 1 ? '' : 's'
    } on the Board.`,
    { status: snapshot.status, ...view }
  );
}

/** Place a source or research card and return the id everything else addresses
 *  it by. */
export function boardCreateCard(params: Record<string, unknown>): BoardToolOutcome {
  if (graphOrNull() === null) return fail(CLOSED_REFUSAL);
  const kind = readString(params, 'kind');
  if (kind !== 'source' && kind !== 'research') {
    return fail('kind must be "source" or "research". The rest are written by the system.');
  }

  const config = readCardConfig(kind, params.config);
  if (!config.ok) return fail(config.error);

  const position = readPosition(params.position);
  const input: NewBoardNode =
    kind === 'source'
      ? {
          kind: 'source',
          // Normalized here as well as in the store: the tool's own answer is
          // built from what was stored, never from what was asked for.
          source:
            normalizeSourceConfig({
              name: '',
              connectorKind: '',
              endpoint: '',
              payloadType: '',
              ...config.source,
            }) ?? { name: '', connectorKind: '', endpoint: '', payloadType: '' },
          ...(position ? { position } : {}),
        }
      : {
          kind: 'research',
          research: config.research ?? { hypothesis: '' },
          ...(position ? { position } : {}),
        };

  const nodeId = boardGraphStore.createNode(input);
  report('create', nodeId, kind);
  const node = findNode(boardGraphStore.getSnapshot().graph, nodeId);
  return done(`Placed a ${kind} card on the Board.`, {
    node_id: nodeId,
    card: node ? cardView(node) : { id: nodeId, kind },
  });
}

/**
 * Edit a card in place. Fields that do not belong to its kind are refused
 * rather than ignored, so an agent editing the wrong card learns that it did.
 */
export function boardUpdateCard(params: Record<string, unknown>): BoardToolOutcome {
  const graph = graphOrNull();
  if (graph === null) return fail(CLOSED_REFUSAL);
  const nodeId = readString(params, 'node_id');
  const node = findNode(graph, nodeId);
  if (!node) return fail('That card is not on the Board.');
  if (node.kind !== 'source' && node.kind !== 'research') {
    return fail(
      `A ${node.kind} card is written by the system from the artifact it points at, so its ` +
        'configuration is not editable. Only its label is.'
    );
  }

  const config = readCardConfig(node.kind, params.config);
  if (!config.ok) return fail(config.error);

  const label = params.label;
  if (label !== undefined && typeof label !== 'string') return fail('label must be a string.');

  if (config.source === undefined && config.research === undefined && label === undefined) {
    return fail('Nothing to change: pass config, label, or both.');
  }

  boardGraphStore.updateNode(nodeId, {
    ...(config.source ? { source: config.source } : {}),
    ...(config.research ? { research: config.research } : {}),
    ...(typeof label === 'string' ? { label } : {}),
  });
  report('update', nodeId, node.kind);
  const updated = findNode(boardGraphStore.getSnapshot().graph, nodeId);
  return done('Card updated.', { card: updated ? cardView(updated) : null });
}

/** Draw a source-to-research wire. The store owns the rule; its refusal is
 *  carried out word for word. */
export function boardWire(params: Record<string, unknown>): BoardToolOutcome {
  if (graphOrNull() === null) return fail(CLOSED_REFUSAL);
  const from = readString(params, 'from');
  const to = readString(params, 'to');
  if (!from || !to) return fail('from and to are both required — the two card ids to wire.');

  const result = boardGraphStore.wire(from, to);
  if (!result.ok) return fail(result.reason);
  report('wire', result.edgeId);
  return done('Wired.', { edge_id: result.edgeId, from, to });
}

/** Cut a wire. A provenance wire refuses, with the reason it exists. */
export function boardUnwire(params: Record<string, unknown>): BoardToolOutcome {
  if (graphOrNull() === null) return fail(CLOSED_REFUSAL);
  const edgeId = readString(params, 'edge_id');
  if (!edgeId) return fail('edge_id is required — board_list lists them.');

  const result = boardGraphStore.unwire(edgeId);
  if (!result.ok) return fail(result.reason);
  report('unwire', edgeId);
  return done('Wire cut.', { edge_id: edgeId });
}

/** The plan's own numbers, as the tool states them. */
function planData(plan: BoardDeletePlan, graph: BoardGraph): Record<string, unknown> {
  return {
    node_id: plan.nodeId,
    removed_node_ids: [...plan.removedNodeIds],
    removed_edge_ids: [...plan.removedEdgeIds],
    retained_node_ids: [...plan.retainedNodeIds],
    retained_artifacts: plan.retainedRefs.map((ref) => ({ kind: ref.kind, id: ref.id })),
    retained_cards: plan.retainedNodeIds
      .map((id) => findNode(graph, id))
      .filter((node): node is NonNullable<typeof node> => node !== undefined)
      .map(cardView),
  };
}

/** The sentence the plan supports, and no more than it supports. */
function planSentence(plan: BoardDeletePlan, tense: 'would' | 'did'): string {
  if (plan.removedNodeIds.length === 0) return 'That card is not on the Board.';
  const wires = plan.removedEdgeIds.length;
  const wireClause = wires === 0 ? '' : ` and ${wires} wire${wires === 1 ? '' : 's'}`;
  const head =
    tense === 'would'
      ? `Removing this card takes it${wireClause} off the Board.`
      : `Removed the card${wireClause}.`;
  const kept = plan.retainedNodeIds.length;
  if (kept === 0) return `${head} Nothing downstream depends on it.`;
  const refs = plan.retainedRefs.length;
  const artifacts =
    refs === 0 ? '' : `, still pointing at ${refs} saved result${refs === 1 ? '' : 's'}`;
  return `${head} ${kept} card${kept === 1 ? '' : 's'} downstream ${
    tense === 'would' ? 'stay' : 'stayed'
  } where ${kept === 1 ? 'it is' : 'they are'}${artifacts}.`;
}

/**
 * Remove a card — or, with `preview`, say what removing it would do without
 * doing it. Both answers carry the same accounting, because the load-bearing
 * half is what STAYS: deleting a question never deletes the findings and
 * strategies that came out of it, and an agent about to press this needs that
 * in numbers rather than in reassurance.
 */
export function boardDeleteCard(params: Record<string, unknown>): BoardToolOutcome {
  const graph = graphOrNull();
  if (graph === null) return fail(CLOSED_REFUSAL);
  const nodeId = readString(params, 'node_id');
  if (!nodeId) return fail('node_id is required.');
  if (!findNode(graph, nodeId)) return fail('That card is not on the Board.');

  if (params.preview === true) {
    const plan = boardGraphStore.previewDelete(nodeId);
    return done(planSentence(plan, 'would'), { previewed: true, ...planData(plan, graph) });
  }

  const kind = findNode(graph, nodeId)?.kind;
  const plan = boardGraphStore.deleteNode(nodeId);
  report('delete', nodeId, kind);
  // Read against the graph the plan was drawn from: the retained cards are
  // still on the Board, but naming them from the pre-delete graph is what makes
  // the receipt and the preview state the same thing.
  return done(planSentence(plan, 'did'), { previewed: false, ...planData(plan, graph) });
}

/**
 * What a card is answerable for: the artifacts it or anything downstream of it
 * points at, plus the chain that fed it.
 *
 * References, never bodies. A finding's text, a run's numbers and a
 * deployment's state live on the engine and are read through the engine's own
 * lanes; putting them here would put a copy of engine state into a tool result
 * that could already be stale by the time it is read.
 */
export function boardReadOutputs(params: Record<string, unknown>): BoardToolOutcome {
  const graph = graphOrNull();
  if (graph === null) return fail(CLOSED_REFUSAL);
  const nodeId = readString(params, 'node_id');
  const node = findNode(graph, nodeId);
  if (!node) return fail('That card is not on the Board.');

  const artifacts = artifactViews(graph, nodeId);
  return done(
    artifacts.length === 0
      ? 'Nothing has come out of that card yet.'
      : `That card and what is downstream of it reference ${artifacts.length} artifact${
          artifacts.length === 1 ? '' : 's'
        }.`,
    {
      card: cardView(node),
      upstream: upstreamChain(graph, nodeId).map(cardView),
      artifacts,
    }
  );
}
