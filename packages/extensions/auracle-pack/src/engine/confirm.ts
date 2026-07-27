/**
 * The engine's two-step lane for the operations that move capital.
 *
 * The engine will not act on a capital-affecting request that simply arrives
 * authenticated. The caller first DECLARES the exact action it means to take
 * (`POST /confirm {action, payload}`) and gets back a short-lived, single-use
 * stamp bound to that declaration; the real request is then only accepted while
 * carrying that stamp, once, and only for the same action and the same payload.
 *
 * WHY THIS IS ONE FUNCTION RATHER THAN TWO CALLS AT THE CALL SITE: the two
 * steps are only correct together. A caller that declared one payload and then
 * sent a different one, or that held a stamp across a user's next decision,
 * would satisfy neither the engine nor the person who approved it. So the pair
 * is the unit: {@link confirmedPost} declares, sends, and drops the stamp on
 * the way out. Nothing here returns it, stores it, retries with it, or logs it.
 *
 * WHY IT DECLARES EVEN WHEN IT MIGHT NOT HAVE TO: the engine decides which
 * operations need a stamp, from ITS OWN record of the target — never from
 * anything the request asserts. A client that tried to work out in advance
 * whether this particular target needs one would be guessing at a decision it
 * does not own, and would guess wrong exactly when it matters. Declaring always
 * costs one cheap call and is correct whatever the engine decides: an operation
 * that needs no stamp ignores the header.
 *
 * HONESTY: every refusal is returned with the engine's own code and message,
 * and with the one thing a surface needs to know to say something useful —
 * whether asking the person again is what would make it work ({@link
 * ConfirmedResult.reapprove}), or whether the refusal is about the operation
 * itself and a second approval would change nothing.
 */
import { postJson } from './client';

/** The header the confirmed request carries its stamp in. */
export const CONFIRMATION_HEADER = 'X-Auracle-Confirmation';

/** Where the engine's `/confirm` mint lives. */
const CONFIRM_PATH = '/confirm';

/** The action scope for flattening one deployment's book. */
export const LIQUIDATE_ACTION = 'live.liquidate';

/** How a confirmed operation ended. */
export interface ConfirmedResult {
  ok: boolean;
  /**
   * Which half refused. `declare` means the engine would not issue a stamp at
   * all (this build cannot sign them, the action is unknown, the payload is
   * incomplete); `send` means the operation itself answered.
   */
  stage: 'declare' | 'send';
  status: number;
  /** The engine's own error code, when it gave one. */
  code: string | null;
  /** The engine's own message, when it gave one. */
  message: string | null;
  /**
   * True when a FRESH approval is the thing that would make this work — the
   * stamp ran out of time, or had already been spent. False for every other
   * refusal, so a surface never invites someone to approve their way past a
   * rule that has nothing to do with approval.
   */
  reapprove: boolean;
  /** The successful response body, for a caller that reads it. */
  body: unknown;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The engine's error code and message out of a rejection body.
 *
 * FastAPI wraps a handler's detail under `detail`, and this family of
 * rejections puts a structured `{error, message}` there; other handlers put a
 * plain sentence in the same place. Both are read, so a caller always gets the
 * engine's own words rather than a status code.
 */
export function readRejection(body: unknown): { code: string | null; message: string | null } {
  if (body === null || typeof body !== 'object') {
    return { code: null, message: text(body) };
  }
  const row = body as Record<string, unknown>;
  const detail = row.detail;
  if (typeof detail === 'string') return { code: null, message: text(detail) };
  const inner = (detail && typeof detail === 'object' ? detail : row) as Record<string, unknown>;
  return {
    code: text(inner.error) ?? text(inner.code),
    message: text(inner.message) ?? text(inner.detail),
  };
}

/** The codes that mean "the stamp itself is spent or stale" — the only ones a
 *  second approval fixes. Every other refusal stands however often it is asked. */
const REAPPROVABLE = new Set(['confirmation_expired', 'confirmation_already_used']);

/**
 * Declare `action` with `payload`, then POST `path` carrying the stamp the
 * engine issued for exactly that declaration.
 *
 * `payload` is sent to the declaration AND is what the operation is expected to
 * act on; the engine binds the stamp to its own normalized form of it, so the
 * two can never drift apart. `body` is what the operation's own endpoint
 * receives — the deployment verbs take none, which is why it is optional.
 */
export async function confirmedPost(
  action: string,
  payload: Record<string, unknown>,
  path: string,
  body?: unknown
): Promise<ConfirmedResult> {
  const minted = await postJson(CONFIRM_PATH, { action, payload });
  if (!minted.ok) {
    const { code, message } = readRejection(minted.body);
    return {
      ok: false,
      stage: 'declare',
      status: minted.status,
      code,
      message,
      reapprove: false,
      body: minted.body,
    };
  }

  const issued = (minted.body ?? {}) as { token?: unknown };
  const token = text(issued.token);
  if (token === null) {
    return {
      ok: false,
      stage: 'declare',
      status: minted.status,
      code: null,
      message: 'The engine accepted the declaration without issuing anything to send with it.',
      reapprove: false,
      body: minted.body,
    };
  }

  // The stamp exists only for the length of this call: it is handed to the one
  // request it was issued for and is never held, cached, or reused.
  const sent = await postJson(path, body, { [CONFIRMATION_HEADER]: token });
  if (sent.ok) {
    return { ok: true, stage: 'send', status: sent.status, code: null, message: null, reapprove: false, body: sent.body };
  }
  const { code, message } = readRejection(sent.body);
  return {
    ok: false,
    stage: 'send',
    status: sent.status,
    code,
    message,
    reapprove: code !== null && REAPPROVABLE.has(code),
    body: sent.body,
  };
}
