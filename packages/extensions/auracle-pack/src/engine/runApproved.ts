/**
 * Carrying out something the engine asked permission for.
 *
 * `engineConfirmation` is pure — it turns the engine's request into the shape
 * the approval dialog quotes, and knows nothing about a transport. This is the
 * other half, kept separate for the same reason `gridAiActions` and
 * `gridAiExecutors` are: the catalog can be reasoned about without a network,
 * and every surface goes through one registry.
 *
 * ## One call, because a stamp must not be held
 *
 * Approving and acting used to be two requests, which meant whoever asked kept
 * the thing that authorises it in between. `engine/confirm` forbids that
 * outright — "nothing here returns it, stores it, retries with it, or logs it"
 * — and it is not a rule this surface could keep anyway: there is no server
 * here to hold it on, so a stamp would sit in renderer memory.
 *
 * So the engine mints, spends and drops it inside `POST
 * /ui/api/ide/run-approved`. This module sends two fields and reads back what
 * happened. There is no stamp in the request, in the response, or anywhere in
 * this file — and no way to obtain one.
 *
 * ## Why the executor closes over the payload
 *
 * `ActionIntent.fields` are what a PERSON reads: values already rendered to
 * strings, with an empty one shown as an em dash. Rebuilding the payload from
 * them would send the literal "—" where the engine expects null, and the stamp
 * binds to a hash of the payload — so the round trip has to be lossless. The
 * executor therefore carries the original object rather than reading the
 * display back.
 */
import { postJson } from './client';
import type { AiActionResult, ActionIntent } from '../components/grid/gridAiActions';
import { registerAiExecutor } from '../components/grid/gridAiActions';
import type { EngineConfirmation } from './engineConfirmation';

/** Where the engine approves and acts in one step. */
export const RUN_APPROVED_PATH = '/ui/api/ide/run-approved';

/** What the engine answers. `result` is the tool's own return value. */
interface RunApprovedBody {
  ok?: boolean;
  action?: string;
  result?: { error?: string; reapprove?: boolean; plain?: string } | null;
}

/** The engine's refusals carry their own words; show those rather than a code. */
function refusalNote(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  if (status === 0) return 'The engine could not be reached. Nothing was sent.';
  if (status === 401) return 'That session is no longer valid. Sign in and try again.';
  return `The engine refused it (${status}). Nothing changed.`;
}

/**
 * Approve one thing and let the engine do it.
 *
 * Exported on its own so a caller that already holds the payload — a test, or
 * a surface that raised the request itself — does not have to go through the
 * registry to run it.
 */
export async function runApproved(
  action: string,
  payload: Record<string, unknown>,
): Promise<AiActionResult> {
  const response = await postJson(RUN_APPROVED_PATH, { action, payload });

  if (!response.ok) {
    return { kind: 'failed', note: refusalNote(response.status, response.body) };
  }

  const body = (response.body ?? {}) as RunApprovedBody;
  const result = body.result;

  // A tool refusal arrives INSIDE a successful call: the request was fine, the
  // tool declined. Reporting it as a transport failure would send someone
  // looking at the network for a decision the engine made deliberately.
  if (result && typeof result.error === 'string') {
    return { kind: 'failed', note: result.error };
  }

  // Several tools already write a `plain` sentence for exactly this moment.
  return {
    kind: 'done',
    note: typeof result?.plain === 'string' ? result.plain : 'Done.',
  };
}

/**
 * Make one engine request runnable, and return the disposer.
 *
 * The registry keys on the operation, and the operation IS the confirmation's
 * action scope — the same string the engine binds its stamp to. So registering
 * here is what turns "pending engine wiring" into something the approval
 * dialog can actually carry out.
 *
 * ★ Bound to ONE request, not to the operation in general. Two confirmations
 * for the same tool carry different payloads, and an executor registered once
 * for `mcp.add_security` would run whichever payload it happened to close over
 * first — approving one thing and doing another. Registering per request, and
 * disposing after, is what keeps the approval and the act the same event.
 */
export function registerEngineConfirmation(confirmation: EngineConfirmation): () => void {
  const payload = confirmation.payload;
  return registerAiExecutor(confirmation.action, async (_intent: ActionIntent) =>
    // The intent is deliberately unused: it holds the display of the payload,
    // and what has to go back is the payload itself. See the file header.
    runApproved(confirmation.action, payload),
  );
}
