/**
 * The engine's "ask first" answer, turned into something the approval dialog
 * can quote.
 *
 * WHAT ARRIVES. Every state-mutating MCP tool now answers a call with no stamp
 * by DESCRIBING what it would do rather than doing it:
 *
 *   {confirmation_required, action, payload, summary, confirm_path}
 *
 * WHY IT IS ADAPTED RATHER THAN RENDERED. `AiApprovalDialog` already exists and
 * already holds the ceremony this needs — it quotes rather than summarises, the
 * safe control takes focus, Escape means decline. Building a second dialog for
 * engine-raised approvals would mean two places where the wording of a consent
 * prompt could drift apart, on the one screen where drift is indistinguishable
 * from a bug. So this maps one shape onto the other and nothing draws twice.
 *
 * ★ THE SUMMARY IS NOT REWRITTEN. It is the engine's sentence, and the browser
 * shows the same one. That is the whole reason the two surfaces share a
 * contract instead of a component: layout may differ between a dense dialog
 * and a roomy chat card, but "this will submit 1,777 practice orders" has to
 * read identically wherever it appears.
 */
import type { ActionIntent, IntentField } from '../components/grid/gridAiActions';
import type { RoomId } from '../components/grid/rooms';

/** The engine's contract. Mirrors `auracle/mcp/confirm.py`; there is no
 *  generator, and the field names are the whole agreement. */
export interface EngineConfirmation {
  confirmation_required: true;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
  confirm_path: string;
}

/**
 * Recognise one, structurally.
 *
 * A result counts only if it carries the flag AND everything needed to act on
 * it. A partial shape is treated as ordinary data, so a malformed response
 * renders as a result rather than as a prompt nobody can approve.
 */
export function isEngineConfirmation(value: unknown): value is EngineConfirmation {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.confirmation_required === true &&
    typeof v.action === 'string' &&
    typeof v.summary === 'string' &&
    typeof v.payload === 'object' &&
    v.payload !== null
  );
}

/**
 * Which room's work an operation belongs to.
 *
 * Only the dialog's provenance line depends on this, so an unknown tool is
 * placed in `ops` rather than refused — a new engine tool must not become
 * unapprovable in the IDE just because this table has not caught up. The
 * mapping is by the verb the tool name starts with, because that is stable in
 * a way an exhaustive list of tool names is not.
 *
 * ★ Longest prefix first where two overlap: `run_manifest_backtest` must be
 * tested before `run_backtest`, or the more specific tool lands in the more
 * general room.
 */
const ROOM_BY_PREFIX: readonly (readonly [string, RoomId])[] = [
  ['create_strategy', 'strategies'],
  ['clone_example', 'strategies'],
  ['read_strategy', 'strategies'],
  ['run_manifest_backtest', 'backtest'],
  ['run_backtest', 'backtest'],
  ['run_walkforward', 'validation'],
  ['run_basket', 'validation'],
  ['run_manifest_paper', 'deploys'],
  ['draft_manifest', 'deploys'],
  ['add_schedule', 'schedules'],
  ['set_schedule', 'schedules'],
  // Loading a security and its history is progress toward being able to test
  // anything, which is the runway's subject. This pack has no data room.
  ['add_security', 'runway'],
  ['ingest_historical', 'runway'],
  ['research_', 'findings'],
  ['idea_', 'findings'],
  ['board_', 'findings'],
  ['remember', 'findings'],
];

export function roomForAction(action: string): RoomId {
  const tool = action.startsWith('mcp.') ? action.slice(4) : action;
  for (const [prefix, room] of ROOM_BY_PREFIX) {
    if (tool.startsWith(prefix)) return room;
  }
  return 'runway';
}

/**
 * Turn a payload into the lines a person reads.
 *
 * Values are rendered, never dropped: the stamp the engine mints binds to a
 * hash of this exact payload, so a field hidden here is a field somebody
 * approved without seeing. An empty value shows as an em dash rather than
 * vanishing, because "name: —" and no `name` line at all mean different things
 * to the person deciding.
 */
export function fieldsFromPayload(payload: Record<string, unknown>): IntentField[] {
  return Object.entries(payload).map(([label, value]) => ({
    label,
    value:
      value === null || value === undefined || value === ''
        ? '—'
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value),
  }));
}

/** The engine's request, as the dialog's intent. */
export function intentFromConfirmation(confirmation: EngineConfirmation): ActionIntent {
  return {
    // The operation IS the confirmation scope. The executor registry keys on
    // it and the engine binds its stamp to it, so they must be one string.
    operation: confirmation.action,
    room: roomForAction(confirmation.action),
    summary: confirmation.summary,
    fields: fieldsFromPayload(confirmation.payload),
  };
}
