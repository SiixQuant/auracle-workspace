/**
 * The research loop's engine lane: a question the engine keeps watching, the
 * count of what has arrived against it since, and the spend that dispatching
 * work costs.
 *
 * Written as a CONTRACT, exactly like {@link ./boardSources} was: the routes
 * land in a parallel engine change, the render harness serves them as mocks
 * meanwhile, and everything here is deliberately thin so that reconciling a
 * field name later is a one-line edit rather than a redesign. Nothing in this
 * module holds state, polls, or decides anything — the lifecycle lives in
 * {@link ./boardStandingQueries} and the verbs live with the cards.
 *
 * ## Three shapes, and why they are separate routes
 *  - A STANDING QUERY is a registration: this card, this question, watch for
 *    material about it. Idempotent on the board node id, because the card and
 *    the engine's record are the same thing seen from two sides — the same
 *    reason a source card's id is its source id.
 *  - A COUNTER is a read: how much new material has arrived for that question,
 *    and as of when. It costs nothing to accumulate, which is the whole point
 *    of the loop — a question can sit and gather for a week at zero spend.
 *  - A SYNTHESIS RECORD is a write made when work is DISPATCHED. It is what
 *    moves the budget, so it is the engine's accounting rather than ours, and
 *    the reply carries the budget back so a surface never has to guess.
 *
 * ## What never travels
 * A dispatch payload names the card, quotes the question, and lists the SOURCE
 * NAMES wired into it. It carries no credential value and no credential slot —
 * not even whether a slot is set. The engine reads its own vault; a payload
 * that mentioned a key at all would put one on a route whose whole job is to be
 * handed to an agent session.
 *
 * Conventions follow {@link ./client} and {@link ./boardSources}: everything
 * goes through the main-process bridge, a read returns null when nothing
 * answered, and a write returns the engine's own status and message.
 */
import { getJsonDetailed, postJson } from './client';
import { readRejection } from './confirm';
import type { BoardWriteResult } from './boardSources';

/** Where the Board's standing questions live on the engine. */
export const BOARD_QUESTIONS_PATH = '/ui/api/board/questions';

/** Where a dispatch is recorded — the route that moves the budget. */
export const BOARD_SYNTHESIS_PATH = '/ui/api/board/synthesis';

/** Where the monthly allowance is read. */
export const BOARD_BUDGET_PATH = '/ui/api/board/budget';

/** What a dispatch is: a first look, or a look over what has piled up since. */
export type SynthesisKind = 'scan' | 'synthesize';

/** A question the engine is asked to keep watching. */
export interface StandingQueryInput {
  /** The board node's id — see the header. */
  nodeId: string;
  /** The question in the person's own words. */
  hypothesis: string;
}

/** How much has arrived for one question, and when that was last true. */
export interface MaterialCounter {
  nodeId: string;
  /** Items the engine has matched to this question since the last reset. */
  newMaterial: number;
  /** When the engine took that count, ISO. Null when it did not say. */
  asOf: string | null;
}

/**
 * The monthly allowance, in agent-session dispatches.
 *
 * `paused` is the engine's own verdict rather than arithmetic on the other two:
 * a cap can be raised, a month can roll over, and a surface that inferred
 * "paused" from `spent >= cap` would keep saying so for a while after the
 * engine had stopped meaning it.
 */
export interface SynthesisBudget {
  /** Dispatches allowed this month. Null when the engine states no cap. */
  cap: number | null;
  /** Dispatches recorded this month. Null when the engine did not say. */
  spent: number | null;
  /** True only when the engine says automatic synthesis is stopped. */
  paused: boolean;
}

/** What a dispatch declares. No secrets — see the header. */
export interface SynthesisRecordInput {
  nodeId: string;
  kind: SynthesisKind;
  hypothesis: string;
  /** The NAMES of the sources wired into this card. Never their keys. */
  sources: readonly string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A figure the engine actually stated. An absent field is never read as zero:
 *  "none" and "not reported" are different answers. */
function figure(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function refusal(status: number, body: unknown): BoardWriteResult {
  const { message } = readRejection(body);
  return { ok: false, status, message };
}

/**
 * One counter row, or null when the engine sent something that is not one.
 *
 * A row is only a counter when it names a card AND states a count: a badge
 * drawn from a row that stated neither would be a number nobody measured.
 */
export function readMaterialCounter(value: unknown): MaterialCounter | null {
  const row = record(value);
  if (!row) return null;
  const nodeId = str(row.node_id);
  const count = figure(row.new_material);
  if (nodeId === '' || count === null) return null;
  const asOf = str(row.as_of);
  return { nodeId, newMaterial: Math.max(0, Math.trunc(count)), asOf: asOf === '' ? null : asOf };
}

/** The budget, reduced to the three fields a budget has. */
export function readSynthesisBudgetBody(value: unknown): SynthesisBudget | null {
  const row = record(value);
  if (!row) return null;
  const inner = record(row.budget) ?? row;
  return {
    cap: figure(inner.cap),
    spent: figure(inner.spent),
    // Only a literal true stops anything. A reply that omitted the field is
    // read as running, because a loop halted by an ambiguous answer is a
    // silent stall — the one outcome this feature exists to avoid.
    paused: inner.paused === true,
  };
}

/**
 * Register (or re-register) a question the engine should keep watching.
 *
 * An UPSERT on the node id, so editing a card and registering again re-states
 * one question rather than accumulating a second. The caller debounces; this
 * function is the single request.
 */
export async function registerStandingQuery(input: StandingQueryInput): Promise<BoardWriteResult> {
  const res = await postJson(BOARD_QUESTIONS_PATH, {
    node_id: input.nodeId,
    hypothesis: input.hypothesis,
  });
  return res.ok ? { ok: true, status: res.status, message: null } : refusal(res.status, res.body);
}

/** Stop watching. The card's own removal is the store's business, and nothing
 *  the question produced is destroyed by this. */
export async function deregisterStandingQuery(nodeId: string): Promise<BoardWriteResult> {
  if (nodeId === '') return { ok: false, status: 0, message: 'There is no question to withdraw.' };
  const res = await postJson(`${BOARD_QUESTIONS_PATH}/${encodeURIComponent(nodeId)}/delete`);
  return res.ok ? { ok: true, status: res.status, message: null } : refusal(res.status, res.body);
}

/**
 * Every counter the engine holds, or null when nothing answered. A body that
 * answered without the key is an EMPTY list: the engine spoke, and it counted
 * nothing.
 */
export async function readMaterialCounters(): Promise<MaterialCounter[] | null> {
  const res = await getJsonDetailed<{ counters?: unknown[] }>(`${BOARD_QUESTIONS_PATH}/counters`);
  if (!res.ok) return null;
  const rows = Array.isArray(res.body?.counters) ? res.body.counters : [];
  return rows
    .map((row) => readMaterialCounter(row))
    .filter((row): row is MaterialCounter => row !== null);
}

/** Put one question's counter back to nothing — what a dispatch has consumed. */
export async function resetMaterialCounter(nodeId: string): Promise<BoardWriteResult> {
  if (nodeId === '') return { ok: false, status: 0, message: 'There is no counter to reset.' };
  const res = await postJson(`${BOARD_QUESTIONS_PATH}/${encodeURIComponent(nodeId)}/counter/reset`);
  return res.ok ? { ok: true, status: res.status, message: null } : refusal(res.status, res.body);
}

/**
 * Record that work was dispatched for a card. This is the call that spends the
 * budget, so it is made once per dispatch and the engine's own reply is what
 * the surface then believes about the allowance.
 */
export async function recordSynthesis(
  input: SynthesisRecordInput
): Promise<BoardWriteResult & { budget: SynthesisBudget | null }> {
  const res = await postJson(BOARD_SYNTHESIS_PATH, {
    node_id: input.nodeId,
    kind: input.kind,
    hypothesis: input.hypothesis,
    sources: [...input.sources],
  });
  if (!res.ok) return { ...refusal(res.status, res.body), budget: null };
  return {
    ok: true,
    status: res.status,
    message: null,
    budget: readSynthesisBudgetBody(res.body),
  };
}

/** The allowance as it stands, or null when nothing answered. */
export async function readSynthesisBudget(): Promise<SynthesisBudget | null> {
  const res = await getJsonDetailed<unknown>(BOARD_BUDGET_PATH);
  if (!res.ok) return null;
  return readSynthesisBudgetBody(res.body);
}
