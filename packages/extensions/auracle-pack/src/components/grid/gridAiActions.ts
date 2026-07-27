/**
 * What the assistant may DO on the Grid, and under whose authority.
 *
 * ## Authority classes
 * Every AI affordance on the plan is one of exactly four kinds, and the class
 * — not the surface it is pressed on — decides how much ceremony it costs:
 *
 *  - `repair`   puts a broken thing back the way it was. One press.
 *  - `mutation` changes live state (capital, positions, what is running). It
 *               ALWAYS goes through the approval dialog first, wherever it was
 *               pressed: the plan, a room page, or the palette.
 *  - `draft`    produces something visible that does nothing on its own — a
 *               strategy file to read, never a run and never a deployment.
 *  - `advisory` answers a question from what is already on screen. It changes
 *               nothing at all, so it needs no ceremony.
 *
 * A class is therefore a promise about consequences, and it is declared once,
 * here, beside the action it belongs to. No surface re-decides it.
 *
 * ## Availability is derived, never asserted
 * An action offers itself only when the CURRENT readings support it, and the
 * readings are {@link GridVitals} — the same table the sheet draws its dots
 * from. "Restart the errored deployments" cannot be offered while nothing is
 * errored, because the reading it would quote does not exist. That is what
 * `intent(vitals)` returning null means, and it is why an action's payload is
 * built from the vitals rather than fetched a second time: the dialog quotes
 * the exact line the plan is showing.
 *
 * ## Executors, and the honest stub
 * Nothing here talks to the engine. An intent names an OPERATION, and an
 * operation is resolved through {@link registerAiExecutor} at call time. The
 * engine-side lane installs the real executors later; until one is installed,
 * running an intent resolves — through the same interface, with the same
 * shape — to a `not-wired` result that every surface renders as "pending
 * engine wiring".
 *
 * That is the whole point of the stub being typed rather than absent: a
 * surface can never accidentally render an unimplemented repair as a success,
 * because there is no success value to render. The one class that ships
 * genuinely wired is `advisory`, whose executors are registered at the bottom
 * of this file and answer from the intent's own fields — so an advisory reply
 * cannot drift from the reading the plan is displaying.
 *
 * ## One run at a time
 * The run store below is module-level rather than per-component for the same
 * reason `gridNav` and `gridVitals` are: an action can be started from the
 * plan and settle while a room page is showing, and the approval dialog is
 * mounted above the router so a mutation raised from the palette is answered
 * on whatever view happens to be up.
 */
import type { GridVitals } from '../../engine/gridVitals';
import { HEALTH_WORD } from './districts';
// Read inside functions only, never at module scope: `rooms` pulls in every
// page component, and the page frame is what mounts this layer's action bar.
import { ROOMS, type RoomId } from './rooms';

/** How much authority an action carries — see the file header. */
export type AiActionClass = 'repair' | 'mutation' | 'draft' | 'advisory';

/** One line of an intent, as a person reads it before approving it. */
export interface IntentField {
  label: string;
  value: string;
}

/**
 * The structured payload an executor is handed — and, for a mutation, exactly
 * what the approval dialog puts in front of the user before anything runs.
 *
 * `operation` is the contract seam: the executor registry keys on it, and the
 * engine-side change binds its confirmation token to it. Everything else is
 * what that operation would be applied TO, stated in words rather than in
 * wire shapes, because the person approving it is reading it.
 */
export interface ActionIntent {
  /** The operation an executor registers against. */
  operation: string;
  /** The room whose work this is. */
  room: RoomId;
  /** One sentence: what running this would do. */
  summary: string;
  /** The exact payload, field by field. */
  fields: readonly IntentField[];
}

/**
 * How an execution ended.
 *
 * `not-wired` is the stub's honest answer and is deliberately NOT a failure:
 * nothing went wrong, the lane simply does not exist yet. Surfaces render it
 * as pending wiring, never as a success and never as an error.
 */
export type AiActionResult =
  | { kind: 'answered'; text: string }
  | { kind: 'not-wired'; operation: string; note: string }
  | { kind: 'done'; note: string }
  | { kind: 'failed'; note: string };

/**
 * How a settled result reads, in one line.
 *
 * Centralised deliberately: two surfaces state outcomes (the plan's strip and
 * the room's bar), and a `not-wired` result that reads as "pending engine
 * wiring" on one and as anything warmer on the other would be a lie told by
 * whichever one blinked. An advisory answer is returned whole — it IS the
 * result — so nothing paraphrases it.
 */
export function resultLine(result: AiActionResult): string {
  return result.kind === 'answered' ? result.text : result.note;
}

/** An action as the catalog declares it. */
export interface AiActionDef {
  /** Stable across renders — what `data-testid` and the palette row carry. */
  id: string;
  class: AiActionClass;
  room: RoomId;
  /** An imperative, as the button reads: "Restart the errored deployments". */
  label: string;
  /** Material Symbols ligature, drawn with the face the host loads globally. */
  icon: string;
  /** Extra words the palette's filter matches on. */
  keywords?: string[];
  /** The payload this action would carry right now, or null when the current
   *  readings do not support offering it at all. */
  intent(vitals: GridVitals): ActionIntent | null;
}

/** An action that is available right now: its declaration, with the payload it
 *  would carry resolved from the readings that made it available. */
export type AiAction = Omit<AiActionDef, 'intent'> & { intent: ActionIntent };

/* ── executors ──────────────────────────────────────────────────────── */

/** What an operation actually does, once something can do it. */
export type AiExecutor = (intent: ActionIntent) => Promise<AiActionResult>;

const executors = new Map<string, AiExecutor>();

/**
 * Install the executor for one operation. Returns the disposer that puts back
 * whatever was there before — the same shape as the palette's provider
 * registry, so a later lane (or a test) can install over an existing executor
 * and withdraw without leaving the operation less wired than it found it.
 */
export function registerAiExecutor(operation: string, executor: AiExecutor): () => void {
  const previous = executors.get(operation);
  executors.set(operation, executor);
  return () => {
    if (executors.get(operation) !== executor) return;
    if (previous === undefined) executors.delete(operation);
    else executors.set(operation, previous);
  };
}

/** The stub's answer: shaped like every other result, and impossible to read
 *  as a success. */
function notWired(intent: ActionIntent): AiActionResult {
  return {
    kind: 'not-wired',
    operation: intent.operation,
    note: 'Pending engine wiring. Nothing was sent and nothing changed.',
  };
}

/**
 * Run an intent through whatever is registered for its operation.
 *
 * A throwing executor becomes `failed` carrying its own message: an executor
 * that blew up is a different fact from one that was never installed, and
 * collapsing the two would hide a real break behind "not wired yet".
 */
async function executeIntent(intent: ActionIntent): Promise<AiActionResult> {
  const executor = executors.get(intent.operation);
  if (!executor) return notWired(intent);
  try {
    return await executor(intent);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: 'failed', note: detail || 'The action did not complete.' };
  }
}

/* ── the catalog ────────────────────────────────────────────────────── */

/**
 * The reading fields every intent carries: what the plan currently says about
 * this room, quoted rather than recomputed.
 *
 * `subjects` is the reading's own naming of what it is about (the errored
 * deployments behind a faulted `deploys`), so an intent addresses the same
 * things the sheet drew its red dot from. A reading that names nothing simply
 * contributes no Named lines.
 */
function readingFields(room: RoomId, vitals: GridVitals): IntentField[] {
  const vital = vitals[room];
  const fields: IntentField[] = [];
  for (const subject of vital.subjects) fields.push({ label: 'Named', value: subject });
  if (vital.note) fields.push({ label: 'Reading', value: vital.note });
  fields.push({ label: 'State', value: HEALTH_WORD[vital.health] });
  return fields;
}

/** A room's title, read at call time (see the import note at the top). */
function title(room: RoomId): string {
  return ROOMS[room].title;
}

const CATALOG: readonly AiActionDef[] = [
  {
    id: 'findings-draft',
    class: 'draft',
    room: 'findings',
    label: 'Draft a strategy from the top finding',
    icon: 'edit_note',
    keywords: ['draft', 'strategy', 'research', 'finding'],
    // The feed states a fact only once it has ranked something, so this is
    // offered exactly when there is a top finding to draft from.
    intent: (vitals) =>
      vitals.findings.fact === null
        ? null
        : {
            operation: 'strategy.draft-from-finding',
            room: 'findings',
            summary:
              'Write a draft strategy from the highest-ranked finding. A draft only: nothing runs, nothing deploys.',
            fields: [
              { label: 'Source', value: 'the highest-ranked finding in the feed' },
              ...readingFields('findings', vitals),
              { label: 'Produces', value: 'one draft strategy file, left unrun' },
            ],
          },
  },
  {
    id: 'validation-explain',
    class: 'advisory',
    room: 'validation',
    label: 'Explain the gate reading',
    icon: 'psychology',
    keywords: ['explain', 'why', 'gates', 'overfit'],
    intent: (vitals) =>
      vitals.validation.health === 'nominal'
        ? null
        : {
            operation: 'validation.explain',
            room: 'validation',
            summary: 'Say what the current gate reading means. Changes nothing.',
            fields: readingFields('validation', vitals),
          },
  },
  {
    id: 'deploys-repair',
    class: 'repair',
    room: 'deploys',
    label: 'Restart the errored deployments',
    icon: 'auto_fix_high',
    keywords: ['repair', 'fix', 'restart', 'errored', 'deployment'],
    intent: (vitals) =>
      vitals.deploys.health !== 'fault'
        ? null
        : {
            operation: 'deploy.restart-errored',
            room: 'deploys',
            summary:
              'Restart every deployment the engine reports as errored, then re-read their state.',
            fields: [
              ...readingFields('deploys', vitals),
              { label: 'Scope', value: 'only the deployments reported as errored' },
            ],
          },
  },
  {
    id: 'deploys-liquidate',
    class: 'mutation',
    room: 'deploys',
    label: 'Liquidate every open position',
    icon: 'bolt',
    keywords: ['liquidate', 'flatten', 'close', 'positions', 'capital'],
    // Offered whenever the room has deployments at all, faulted or not:
    // flattening is what a person reaches for when a restart will not fix it,
    // and equally when nothing is wrong and they simply want to be flat.
    intent: (vitals) =>
      vitals.deploys.fact === null
        ? null
        : {
            operation: 'deploy.liquidate-all',
            room: 'deploys',
            summary:
              'Flatten every open position on every deployment the engine will flatten, at market.',
            fields: [
              // Stated as the executor actually resolves it: the engine's
              // lifecycle refuses the verb from some states, and those
              // deployments are never addressed. Approving this is approving
              // the set the engine accepts, not a set it would reject half of.
              { label: 'Scope', value: 'every deployment the engine will accept the verb for' },
              ...readingFields('deploys', vitals),
              { label: 'Affects capital', value: 'yes' },
              { label: 'Reversible', value: 'no, a flattened position cannot be restored' },
            ],
          },
  },
  {
    id: 'incidents-explain',
    class: 'advisory',
    room: 'incidents',
    label: 'Explain what is open',
    icon: 'psychology',
    keywords: ['explain', 'why', 'incident', 'alert'],
    intent: (vitals) =>
      vitals.incidents.health === 'nominal'
        ? null
        : {
            operation: 'incidents.explain',
            room: 'incidents',
            summary: 'Say what the open incidents amount to. Changes nothing.',
            fields: readingFields('incidents', vitals),
          },
  },
  {
    id: 'conns-repair',
    class: 'repair',
    room: 'conns',
    label: 'Reconnect the failing connections',
    icon: 'auto_fix_high',
    keywords: ['repair', 'fix', 'reconnect', 'connection', 'broker'],
    intent: (vitals) =>
      vitals.conns.health !== 'fault'
        ? null
        : {
            operation: 'connection.reconnect-errored',
            room: 'conns',
            summary: 'Ask the engine to reconnect every connection it reports in error.',
            fields: [
              ...readingFields('conns', vitals),
              { label: 'Scope', value: 'only the connections reported in error' },
            ],
          },
  },
  {
    id: 'conns-explain',
    class: 'advisory',
    room: 'conns',
    label: 'Explain the connection state',
    icon: 'psychology',
    keywords: ['explain', 'why', 'connection', 'broker', 'data'],
    intent: (vitals) =>
      vitals.conns.note === null
        ? null
        : {
            operation: 'conns.explain',
            room: 'conns',
            summary: 'Say what the connection registry currently reports. Changes nothing.',
            fields: readingFields('conns', vitals),
          },
  },
];

/** Every action the current readings support, in catalog order. */
export function availableActions(vitals: GridVitals): AiAction[] {
  const out: AiAction[] = [];
  for (const def of CATALOG) {
    const intent = def.intent(vitals);
    if (intent === null) continue;
    const { intent: _declared, ...rest } = def;
    out.push({ ...rest, intent });
  }
  return out;
}

/** The actions one room can offer right now. Empty is the common case, and
 *  the surfaces render nothing at all for it rather than empty chrome. */
export function actionsForRoom(room: RoomId, vitals: GridVitals): AiAction[] {
  return availableActions(vitals).filter((action) => action.room === room);
}

/** The repair a room can offer right now, if it has one. */
export function repairForRoom(room: RoomId, vitals: GridVitals): AiAction | null {
  return actionsForRoom(room, vitals).find((action) => action.class === 'repair') ?? null;
}

/** How each class is named where a surface has to say it out loud. */
export const CLASS_WORD: Record<AiActionClass, string> = {
  repair: 'Repair',
  mutation: 'Mutation',
  draft: 'Draft',
  advisory: 'Advisory',
};

/** The one line each class promises about consequences. */
export const CLASS_PROMISE: Record<AiActionClass, string> = {
  repair: 'Puts a broken thing back. One press.',
  mutation: 'Changes live state. Needs your approval first.',
  draft: 'Writes something for you to read. Runs nothing.',
  advisory: 'Answers from what is on screen. Changes nothing.',
};

/** Whether this class must be approved before anything is executed. */
export function needsApproval(action: AiAction): boolean {
  return action.class === 'mutation';
}

/* ── the run store ──────────────────────────────────────────────────── */

/** What the AI layer is doing, across every Grid surface at once. */
export interface AiRunState {
  /** A mutation waiting on the approval dialog. Nothing has executed. */
  pending: AiAction | null;
  /** The action currently executing. */
  running: AiAction | null;
  /** The step line shown while `running`. */
  step: string | null;
  /** The last settled execution, kept so the surface that can render it
   *  (an advisory reply belongs in its own room) still has it when it opens. */
  outcome: { action: AiAction; result: AiActionResult } | null;
}

const IDLE: AiRunState = { pending: null, running: null, step: null, outcome: null };

let state: AiRunState = IDLE;
const listeners = new Set<() => void>();

function publish(next: AiRunState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** What the working line says while an intent is out. Honest about the stage
 *  it is actually at: the intent has been handed to its executor, and that is
 *  all anything knows until the executor answers. */
function stepFor(action: AiAction): string {
  return `Sending the intent for ${action.intent.operation}`;
}

async function start(action: AiAction): Promise<AiActionResult> {
  publish({ pending: null, running: action, step: stepFor(action), outcome: null });
  const result = await executeIntent(action.intent);
  publish({ pending: null, running: null, step: null, outcome: { action, result } });
  return result;
}

/**
 * Ask for an action to happen. A mutation is PARKED for approval and nothing
 * else moves; every other class runs straight away, which is the whole
 * difference the classes exist to express.
 *
 * A request that arrives while something is already running is dropped rather
 * than queued: two engine operations racing off one plan is exactly the kind
 * of thing a person cannot reason about afterwards.
 */
export function requestAiAction(action: AiAction): Promise<AiActionResult | null> {
  if (state.running !== null || state.pending !== null) return Promise.resolve(null);
  if (needsApproval(action)) {
    publish({ ...state, pending: action });
    return Promise.resolve(null);
  }
  return start(action);
}

/** Approve the parked mutation and run it with the intent that was shown. */
export function approveAiAction(): Promise<AiActionResult | null> {
  const action = state.pending;
  if (action === null) return Promise.resolve(null);
  return start(action);
}

/**
 * Decline the parked mutation. Nothing executes, and nothing else in the store
 * moves — a decline is not an event, it is the absence of one, so the last
 * outcome (whatever it was) is left exactly where it was.
 */
export function declineAiAction(): void {
  if (state.pending === null) return;
  publish({ ...state, pending: null });
}

/** Put the last outcome away without running anything. */
export function dismissAiOutcome(): void {
  if (state.outcome === null) return;
  publish({ ...state, outcome: null });
}

export const aiRunStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): AiRunState {
    return state;
  },
  /** Back to idle. Tests use it for isolation; nothing in the product does. */
  reset(): void {
    publish(IDLE);
  },
};

/* ── advisory executors (the one class that ships wired) ────────────── */

/** A field's value by label, so an answer quotes the payload it was given
 *  rather than reaching back to the store for a second reading. */
function fieldValue(intent: ActionIntent, label: string): string | null {
  return intent.fields.find((field) => field.label === label)?.value ?? null;
}

/**
 * An advisory answer: the live half comes from the intent's own fields, the
 * static half is the thing that is true about this room whatever it reads.
 * Nothing is fetched, nothing is inferred, and the first clause is quoting the
 * exact line the plan is showing.
 */
function explainer(roomOf: RoomId, tail: string): AiExecutor {
  return async (intent) => {
    const reading = fieldValue(intent, 'Reading');
    const health = fieldValue(intent, 'State');
    const named = intent.fields.filter((field) => field.label === 'Named').map((f) => f.value);
    const opening = reading
      ? `${title(roomOf)} reads "${reading}"${health ? `, which the plan draws as ${health}` : ''}.`
      : `${title(roomOf)} has not reported a reading yet.`;
    const naming = named.length > 0 ? ` It names ${named.join(', ')}.` : '';
    return { kind: 'answered', text: `${opening}${naming} ${tail}` };
  };
}

registerAiExecutor(
  'validation.explain',
  explainer(
    'validation',
    'Every signal here was computed by the engine on a real backtest and walk-forward, so a red one is a measurement, not an opinion. Open the room to see which check produced it.'
  )
);

registerAiExecutor(
  'incidents.explain',
  explainer(
    'incidents',
    'Incidents are raised by the engine against a deployment, so each one names the thing that raised it. Open the room to see what each is about.'
  )
);

registerAiExecutor(
  'conns.explain',
  explainer(
    'conns',
    'The platform is keyless by default, so an unconfigured connection is a choice rather than a fault; only a connection that was wired and then failed reads as an error.'
  )
);
