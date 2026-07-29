/**
 * The research loop's engine lane: a question the engine keeps watching, the
 * count of what has arrived against it since, and the spend that dispatching
 * work costs.
 *
 * The routes have LANDED, so this module is no longer a contract written ahead
 * of them. The engine's Board API is the source of truth for every path, every
 * request key and every field read below; where the two disagree the engine is
 * right and this file is what moves. What stays here is only the READING —
 * turning the engine's own words into the three shapes a surface can draw.
 * Nothing holds state, polls, or decides anything: the lifecycle lives in
 * {@link ./boardStandingQueries} and the verbs live with the cards.
 *
 * ## Three shapes, and where each is read from
 *  - A STANDING QUERY is a registration: this card, this question, watch for
 *    material about it. Idempotent on the board node id, because the card and
 *    the engine's record are the same thing seen from two sides — the same
 *    reason a source card's id is its source id.
 *  - A COUNTER is a read, and it comes off the QUESTION LIST rather than a
 *    counter route of its own: one `GET` answers with every registered question
 *    and how much has arrived against each, so a whole board's badges cost one
 *    request. Accumulating costs nothing, which is the point of the loop — a
 *    question can gather for a week at zero spend. Putting one counter back is
 *    the counters route's business, and that is all it is for.
 *  - A SYNTHESIS RECORD is a write made when work is DISPATCHED. It is what
 *    moves the budget, so it is the engine's accounting rather than ours, and
 *    the reply carries the budget back so a surface never has to guess —
 *    including on a REFUSAL, which is the answer that most needs believing.
 *
 * ## What never travels
 * The accounting call names the CARD, says who asked, and says which of the two
 * looks it was. It does not carry the question or the source names: a ledger
 * records that a dispatch happened and what it cost, and the engine ignores
 * anything else it is handed. The question travels in the agent-session prompt,
 * which is where it is actually read. Neither carries a credential value or a
 * credential slot — not even whether a slot is set. The engine reads its own
 * vault.
 *
 * Conventions follow {@link ./client} and {@link ./boardSources}: everything
 * goes through the main-process bridge, a read returns null when nothing
 * answered, and a write returns the engine's own status and message.
 */
import { getJsonDetailed, postJson } from './client';
import { readRejection } from './confirm';
import type { BoardWriteResult } from './boardSources';

/** Where the Board's standing questions live, and where every badge is read. */
export const BOARD_QUESTIONS_PATH = '/ui/api/board/questions';

/** Where one counter is put back. Counts are READ off the questions list. */
export const BOARD_COUNTERS_PATH = '/ui/api/board/counters';

/** Where a dispatch is recorded — the route that moves the budget. */
export const BOARD_SYNTHESIS_PATH = '/ui/api/board/synthesis';

/** Where the monthly allowance is read. */
export const BOARD_BUDGET_PATH = '/ui/api/board/budget';

/** What a dispatch is: a first look, or a look over what has piled up since. */
export type SynthesisKind = 'scan' | 'synthesize';

/**
 * Who asked for a dispatch.
 *
 * The engine reads the two differently, and the difference is product behaviour
 * rather than bookkeeping: an `auto` dispatch is REFUSED once the month is
 * spent and nothing is recorded, while a `manual` one runs anyway and is
 * recorded as over budget. A cap stops the standing loop from spending on its
 * own; it does not stand between a person and their own evidence.
 */
export type SynthesisTrigger = 'manual' | 'auto';

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
 * engine had stopped meaning it. The engine computes it; this reads it.
 */
export interface SynthesisBudget {
  /** Dispatches allowed this month. Null when the engine states NO cap. */
  cap: number | null;
  /** Dispatches recorded this month. Null when the engine did not say. */
  spent: number | null;
  /** True only when the engine says automatic synthesis is stopped. */
  paused: boolean;
}

/**
 * What a dispatch declares: which card, which of the two looks, and who asked.
 *
 * Deliberately nothing else. The question and the wired source names are not
 * here to be forgotten by the sender — they are not part of an accounting
 * record at all, and the engine ignores them. They travel in the prompt.
 */
export interface SynthesisRecordInput {
  nodeId: string;
  kind: SynthesisKind;
  trigger: SynthesisTrigger;
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
 *
 * The two routes that carry a count date it differently — a question row says
 * when it was last SCORED, the counter routes say `as_of` outright — and both
 * mean the same thing to a badge: when this count was last true.
 */
export function readMaterialCounter(value: unknown): MaterialCounter | null {
  const row = record(value);
  if (!row) return null;
  const nodeId = str(row.node_id);
  const count = figure(row.new_material);
  if (nodeId === '' || count === null) return null;
  const asOf = str(row.as_of) || str(row.last_scored_at);
  return { nodeId, newMaterial: Math.max(0, Math.trunc(count)), asOf: asOf === '' ? null : asOf };
}

/**
 * The cap as a number a surface can put in a sentence, or null for NO cap.
 *
 * The engine says "no cap" twice over — `unlimited: true`, and a cap of zero or
 * less beside it — and both are the same answer. Reading either as a figure
 * would draw "17 of 0 dispatches used", which is a sentence about a limit that
 * does not exist.
 */
function readCap(row: Record<string, unknown>): number | null {
  if (row.unlimited === true) return null;
  const cap = figure(row.cap);
  return cap === null || cap <= 0 ? null : cap;
}

/** The budget, reduced to the three fields a surface draws. */
export function readSynthesisBudgetBody(value: unknown): SynthesisBudget | null {
  const row = record(value);
  if (!row) return null;
  const inner = record(row.budget) ?? row;
  return {
    cap: readCap(inner),
    // The engine names the month's dispatches `used`. `spent` is read only when
    // `used` is absent altogether, which keeps an older fixture legible without
    // letting it outrank the engine's own word.
    spent: inner.used === undefined ? figure(inner.spent) : figure(inner.used),
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
 * Every counter the engine holds, or null when nothing answered.
 *
 * Read off the QUESTION LIST, which is where the engine keeps the count: one
 * request for the whole board, and a badge that cannot disagree with the
 * registration it is drawn beside. A body that answered without the key is an
 * EMPTY list — the engine spoke, and it counted nothing.
 */
export async function readMaterialCounters(): Promise<MaterialCounter[] | null> {
  const res = await getJsonDetailed<{ questions?: unknown[] }>(BOARD_QUESTIONS_PATH);
  if (!res.ok) return null;
  const rows = Array.isArray(res.body?.questions) ? res.body.questions : [];
  return rows
    .map((row) => readMaterialCounter(row))
    .filter((row): row is MaterialCounter => row !== null);
}

/** Put one question's counter back to nothing — what a dispatch has consumed. */
export async function resetMaterialCounter(nodeId: string): Promise<BoardWriteResult> {
  if (nodeId === '') return { ok: false, status: 0, message: 'There is no counter to reset.' };
  const res = await postJson(`${BOARD_COUNTERS_PATH}/${encodeURIComponent(nodeId)}/reset`);
  return res.ok ? { ok: true, status: res.status, message: null } : refusal(res.status, res.body);
}

/**
 * Record that work was dispatched for a card. This is the call that spends the
 * budget, so it is made once per dispatch and the engine's own reply is what
 * the surface then believes about the allowance.
 *
 * The budget is taken off a REFUSAL as readily as off a success. An automatic
 * dispatch turned away for a spent month is refused WITH the figures that
 * refused it, and a surface that threw those away would have to go and ask
 * again for the answer it was just given.
 */
export async function recordSynthesis(
  input: SynthesisRecordInput
): Promise<BoardWriteResult & { budget: SynthesisBudget | null }> {
  const res = await postJson(BOARD_SYNTHESIS_PATH, {
    node_id: input.nodeId,
    trigger: input.trigger,
    detail: input.kind,
  });
  const budget = readSynthesisBudgetBody(res.body);
  if (!res.ok) return { ...refusal(res.status, res.body), budget };
  return { ok: true, status: res.status, message: null, budget };
}

/** The allowance as it stands, or null when nothing answered. */
export async function readSynthesisBudget(): Promise<SynthesisBudget | null> {
  const res = await getJsonDetailed<unknown>(BOARD_BUDGET_PATH);
  if (!res.ok) return null;
  return readSynthesisBudgetBody(res.body);
}
