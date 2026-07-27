/**
 * What the Grid's AI actions actually DO — the engine behind the catalog.
 *
 * `gridAiActions` declares the operations and the authority each one carries;
 * this module installs the thing that carries them out. They are separate on
 * purpose: the catalog is pure and can be reasoned about (and tested) without a
 * transport, and every surface goes through the same registry, so an operation
 * with nothing behind it renders as pending wiring rather than as a success.
 *
 * ## Each class reaches for the lane its authority allows
 *  - REPAIR runs through the engine's maintenance operations, which journal the
 *    change BEFORE making it and record the one action that puts it back. The
 *    request declares itself autonomous — an agent acting on its own — and the
 *    engine accepts that class only for paper-scope targets, resolving the
 *    scope from its own record of the target. So a live-scope target comes back
 *    refused, and the refusal is shown as what it is: this one needs an
 *    approved operator, not a retry.
 *  - MUTATION goes through the engine's two-step lane for capital-affecting
 *    requests: the approval dialog is answered FIRST, and only then is the
 *    exact payload declared and sent (see `engine/confirm`). Nothing is
 *    declared before a person approves, and nothing is held afterwards.
 *  - DRAFT is a hand-off, not a write. It opens a prefilled agent session and
 *    says so: the session exists, the draft does not, and this module never
 *    claims otherwise.
 *
 * ## What it does when a target has moved on
 * Targets are resolved at EXECUTION time, from the engine, not from the reading
 * the button was drawn with. A deployment that recovered between the press and
 * the call is simply not in the set, and the outcome says nothing was sent
 * rather than reporting work on something that no longer needed it.
 *
 * ## The undo the strip offers
 * A repair that lands leaves its journal ids here, so the surface that ran it
 * can offer to put it back without re-deriving what "back" was — the engine
 * recorded that at the time. The full history stays where it lives, on the
 * Incidents page.
 */
import { getJsonDetailed } from '../../engine/client';
import { confirmedPost, LIQUIDATE_ACTION } from '../../engine/confirm';
import { availableActions, type Deployment } from '../../engine/live';
import type { Connector } from '../../engine/model';
import {
  applyRepair,
  undoEntry,
  REDEPLOY_DEPLOYMENT,
  RESTART_DATA_FEED,
  type RepairOutcome,
} from '../../engine/opsJournal';
import type { PanelHostLike } from '../aiPanel';
import { registerAiExecutor, type ActionIntent, type AiActionResult } from './gridAiActions';

/* ── the host lane, published by the panel ──────────────────────────── */

let agentHost: PanelHostLike | undefined;

/**
 * Publish the panel host so the draft action can reach the agent lane. Same
 * single-sink model the focus bridge uses: module-level stores hold no host
 * handle of their own, so the panel hands its one over when it mounts.
 */
export function registerAgentHost(host: PanelHostLike | undefined): void {
  agentHost = host;
}

/**
 * Withdraw `host`, but only while it is still the one on file. A second panel
 * mounting has already replaced it, and clearing that would leave the live
 * panel telling people their build cannot hand off to the agent — which would
 * be false.
 */
export function unregisterAgentHost(host: PanelHostLike | undefined): void {
  if (agentHost === host) agentHost = undefined;
}

/* ── the undo the last repair left behind ───────────────────────────── */

/** A repair that landed, and every journal entry that reverses it. */
export interface UndoableRepair {
  /**
   * The engine's journal ids, in the order they were created — ALL of them,
   * because a repair over three deployments made three changes and putting
   * "the repair" back means putting all three back. Keeping only the last one
   * would leave two silently in effect behind a button that said Undo.
   */
  entryIds: readonly string[];
  /** The operation it came from, so a surface offers it against the right outcome. */
  operation: string;
}

let lastRepair: UndoableRepair | null = null;
const undoListeners = new Set<() => void>();

function publishUndo(next: UndoableRepair | null): void {
  if (lastRepair === next) return;
  lastRepair = next;
  for (const listener of undoListeners) listener();
}

/**
 * The reversal on offer for the repair that just ran, shaped for
 * `useSyncExternalStore`. Null whenever there is nothing to put back — no
 * repair has landed, the engine recorded no id for it, or the last one has
 * already been reversed.
 */
export const repairUndoStore = {
  subscribe(listener: () => void): () => void {
    undoListeners.add(listener);
    return () => {
      undoListeners.delete(listener);
    };
  },
  getSnapshot(): UndoableRepair | null {
    return lastRepair;
  },
  clear(): void {
    publishUndo(null);
  },
};

/**
 * Reverse the repair that just ran, through the engine's own recorded inverses.
 *
 * Newest first, so a chain of changes comes apart in the order it went on. The
 * offer is withdrawn only when every entry came back; anything the engine
 * refused stays on offer carrying its reason, because what it would reverse is
 * still in effect.
 */
export async function undoLastRepair(): Promise<{ ok: boolean; message: string | null }> {
  const pending = lastRepair;
  if (pending === null) return { ok: false, message: 'There is nothing recorded to put back.' };

  const stuck: string[] = [];
  const refusals: string[] = [];
  for (const entryId of [...pending.entryIds].reverse()) {
    const result = await undoEntry(entryId);
    if (result.ok) continue;
    stuck.push(entryId);
    if (result.message !== null) refusals.push(result.message);
  }
  if (stuck.length === 0) {
    publishUndo(null);
    return { ok: true, message: null };
  }
  // Only what is still in effect stays on offer.
  publishUndo({ entryIds: stuck.reverse(), operation: pending.operation });
  return { ok: false, message: refusals.join(' ') || 'The undo did not go through.' };
}

/* ── shared phrasing ────────────────────────────────────────────────── */

/**
 * One refusal, in the engine's own words wherever it gave any.
 *
 * The scope reading is added ONLY where the engine said scope. Its 403 also
 * carries plan-cap and licence-state refusals, and labelling one of those
 * "requires approval" would send someone looking for a permission that was
 * never the problem.
 */
function refusalLine(target: string, outcome: RepairOutcome): string {
  if (outcome.needsApproval) {
    return `${target}: requires approval on live scope — ${outcome.message}`;
  }
  if (outcome.status === 0) return `${target}: the engine did not answer.`;
  return `${target}: ${outcome.message ?? `the engine refused it (${outcome.status}).`}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ── repair: the engine's maintenance operations ────────────────────── */

/**
 * Run one maintenance operation over every target, and report exactly what
 * happened to each.
 *
 * Every target is attempted even after one is refused: the operations are
 * independent, and stopping at the first refusal would leave the rest in the
 * state the press was meant to fix while reporting a single failure. Every
 * entry the engine journalled becomes part of the reversal on offer.
 */
async function runRepair(
  operation: string,
  action: string,
  targets: readonly string[],
  noun: string
): Promise<AiActionResult> {
  if (targets.length === 0) {
    return {
      kind: 'done',
      note: `The engine reports no ${noun} in that state now, so nothing was sent.`,
    };
  }

  const refused: string[] = [];
  const entryIds: string[] = [];
  let applied = 0;

  for (const target of targets) {
    const outcome = await applyRepair(action, target);
    if (outcome.ok) {
      applied += 1;
      if (outcome.entryId !== null) entryIds.push(outcome.entryId);
      continue;
    }
    refused.push(refusalLine(target, outcome));
  }

  publishUndo(entryIds.length === 0 ? null : { entryIds, operation });

  if (refused.length === 0) {
    return { kind: 'done', note: `The engine ran the repair on ${plural(applied, noun)}.` };
  }
  const ran = applied > 0 ? `Ran on ${plural(applied, noun)}. ` : '';
  return { kind: 'failed', note: `${ran}${refused.join(' ')}` };
}

/**
 * A read that could not be taken, said as what it was.
 *
 * An engine that never answered and an engine that REFUSED are different facts,
 * and the plain client erases the difference by collapsing every failure to
 * null. The targets an operation acts on are worth the detailed read: reporting
 * a rejected credential as network trouble sends someone to the wrong place.
 */
function readFailure(status: number, what: string): AiActionResult {
  return {
    kind: 'failed',
    note:
      status === 0
        ? 'The engine did not answer, so nothing was sent.'
        : `The engine would not list ${what} (${status}), so nothing was sent.`,
  };
}

/** Every deployment the engine currently lists. */
async function listDeployments(): Promise<
  { ok: true; rows: Deployment[] } | { ok: false; status: number }
> {
  const result = await getJsonDetailed<Deployment[]>('/deployments');
  if (!result.ok) return { ok: false, status: result.status };
  return { ok: true, rows: Array.isArray(result.body) ? result.body : [] };
}

/**
 * The connector kinds the engine's data-feed operation can resolve: it looks a
 * target up in the broker and provider registries, and an INTEGRATION is in
 * neither. Sending one would be asking for a repair the engine cannot perform,
 * and reporting its 404 as a failed repair.
 */
const RECYCLABLE_KINDS = new Set(['broker', 'data_provider']);

registerAiExecutor('deploy.restart-errored', async (intent) => {
  const listed = await listDeployments();
  if (!listed.ok) return readFailure(listed.status, 'the deployments');
  const targets = listed.rows
    .filter((row) => row.state === 'errored')
    .map((row) => String(row.id));
  return runRepair(intent.operation, REDEPLOY_DEPLOYMENT, targets, 'deployment');
});

registerAiExecutor('connection.reconnect-errored', async (intent) => {
  const result = await getJsonDetailed<{ connections?: Connector[] }>(
    '/ui/api/connections?kind=all'
  );
  if (!result.ok) return readFailure(result.status, 'the connections');
  const rows = Array.isArray(result.body?.connections) ? result.body.connections : [];
  const errored = rows.filter((row) => row.status?.state === 'error');
  const targets = errored.filter((row) => RECYCLABLE_KINDS.has(row.kind)).map((row) => row.id);

  const outcome = await runRepair(intent.operation, RESTART_DATA_FEED, targets, 'connection');
  // An errored integration is a real fault the reading counted, and this
  // operation is not the thing that fixes it. Said once, rather than sent and
  // reported as a repair that failed.
  const skipped = errored.length - targets.length;
  if (skipped === 0) return outcome;
  const aside = ` ${plural(skipped, 'connection')} the engine cannot recycle ${
    skipped === 1 ? 'was' : 'were'
  } left alone.`;
  return outcome.kind === 'done'
    ? { kind: 'done', note: `${outcome.note}${aside}` }
    : outcome.kind === 'failed'
      ? { kind: 'failed', note: `${outcome.note}${aside}` }
      : outcome;
});

/* ── mutation: the approved, declared, capital-affecting call ────────── */

/**
 * Flatten every deployment the engine will flatten, one at a time, each with
 * its own declaration bound to that one deployment.
 *
 * PER DEPLOYMENT, NOT IN BULK: the engine has no bulk verb, and it binds an
 * approval to the exact thing it authorizes — one deployment id. So a run over
 * three deployments is three declared, single-use calls, and a refusal on one
 * says which one rather than voiding the others.
 *
 * Only deployments whose CURRENT state the engine's lifecycle accepts the verb
 * from are addressed, so this never fires a call the engine would refuse on
 * state alone.
 */
async function liquidateAll(): Promise<AiActionResult> {
  const listed = await listDeployments();
  if (!listed.ok) return readFailure(listed.status, 'the deployments');

  const targets = listed.rows.filter((row) => availableActions(row.state).includes('liquidate'));
  if (targets.length === 0) {
    return {
      kind: 'done',
      note: 'No deployment is in a state the engine will flatten, so nothing was sent.',
    };
  }

  const refused: string[] = [];
  let sent = 0;
  let reapprove = false;

  for (const row of targets) {
    const name = row.name || `deployment ${row.id}`;
    const outcome = await confirmedPost(
      LIQUIDATE_ACTION,
      { deployment_id: row.id },
      `/deployments/${row.id}/liquidate`
    );
    if (outcome.ok) {
      sent += 1;
      continue;
    }
    reapprove = reapprove || outcome.reapprove;
    // "We never sent it" and "the engine refused it" are different facts, and
    // only one of them means anything happened. The stage says which.
    const stage =
      outcome.stage === 'declare' ? 'it was never sent' : 'the engine refused it';
    if (outcome.status === 0) {
      refused.push(`${name}: the engine did not answer, so ${stage}.`);
    } else {
      refused.push(
        `${name}: ${stage} — ${outcome.message ?? `the engine answered ${outcome.status}.`}`
      );
    }
  }

  if (refused.length === 0) {
    return {
      kind: 'done',
      note: `The engine is flattening ${plural(sent, 'deployment')}.`,
    };
  }
  const ran = sent > 0 ? `Flattening ${plural(sent, 'deployment')}. ` : '';
  // Only offered where it is actually the fix: the approval ran out of time or
  // had already been spent. Every other refusal stands however often it is asked.
  const again = reapprove ? ' Approve it again to retry.' : '';
  return { kind: 'failed', note: `${ran}${refused.join(' ')}${again}` };
}

registerAiExecutor('deploy.liquidate-all', liquidateAll);

/* ── draft: the hand-off to the agent ───────────────────────────────── */

/** A field's value by label — the intent's own words, not a second reading. */
function fieldValue(intent: ActionIntent, label: string): string | null {
  return intent.fields.find((field) => field.label === label)?.value ?? null;
}

/**
 * The session prompt, composed from the intent the person saw. It quotes the
 * reading the plan is showing so the session opens on the same finding the
 * button was drawn from.
 */
export function draftPrompt(intent: ActionIntent): string {
  const reading = fieldValue(intent, 'Reading');
  const source = fieldValue(intent, 'Source') ?? 'the highest-ranked finding in the research feed';
  const named = intent.fields.filter((field) => field.label === 'Named').map((f) => f.value);
  const lines = [
    `Draft a strategy from ${source}, in the Auracle workspace.`,
    reading ? `The research room currently reads "${reading}".` : null,
    named.length > 0 ? `It names ${named.join(', ')}.` : null,
    '',
    'Read the finding through the Auracle engine, then write ONE draft strategy file ' +
      'for me to read. Do not run it, do not deploy it, and state plainly which parts ' +
      'of the finding you could verify and which you could not.',
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

registerAiExecutor('strategy.draft-from-finding', async (intent) => {
  // Feature-detected: an older host has no agent lane at all, and that is a
  // different fact from a hand-off that failed. It reads as pending wiring —
  // never as a draft that exists.
  if (!agentHost?.launchAgentSession) {
    return {
      kind: 'not-wired',
      operation: intent.operation,
      note: 'This build cannot hand off to the agent — update the IDE. Nothing was sent.',
    };
  }
  const result = await agentHost.launchAgentSession(draftPrompt(intent), {
    title: 'Draft from the top finding',
  });
  if (!result.ok) {
    return { kind: 'failed', note: result.error ?? 'The agent hand-off failed.' };
  }
  // Dispatch, not delivery: a session is open with the prompt in it. The draft
  // does not exist until the agent is sent and writes one.
  return {
    kind: 'done',
    note: 'Agent session started with the draft prompt. Review it and send it — no strategy has been written yet.',
  };
});
