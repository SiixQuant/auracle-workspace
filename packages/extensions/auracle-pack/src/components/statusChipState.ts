/**
 * The engine status chip's state machine, split out so the classification is a
 * pure, unit-tested function rather than logic buried in the component.
 *
 * Honesty contract (ported from the native client): "connected" is claimed only
 * after a completed engine round-trip. A rejected credential (HTTP 401/403) is
 * NOT the same failure as an engine that never answered — the chip keeps them
 * distinct so it can point a user at re-provisioning instead of at the stack.
 */
import type { ConnectCheck } from '../engine/model';

export type ChipState =
  | { kind: 'not-configured' }
  | { kind: 'checking' }
  | { kind: 'connected'; check: ConnectCheck }
  | { kind: 'key-rejected' }
  | { kind: 'unreachable' };

/** The terminal states the classifier resolves from a completed probe. */
export type ClassifiedKind = 'not-configured' | 'connected' | 'key-rejected' | 'unreachable';

/**
 * Map one engine probe outcome to a chip state.
 *
 * - a genuine connected round-trip (`ok`) wins first;
 * - with no key there is nothing to reject, so it reads `not-configured`;
 * - a 401/403 while a key exists means the credential was rejected (re-auth),
 *   not a dead engine — this is the fix for the chip that used to cry
 *   "unreachable" at a merely-rejected key;
 * - every other failure (status 0, 404, 5xx, …) is `unreachable`.
 */
export function classifyChipState({
  hasKey,
  status,
  ok,
}: {
  hasKey: boolean;
  status: number;
  ok: boolean;
}): ClassifiedKind {
  if (ok) return 'connected';
  if (!hasKey) return 'not-configured';
  if (status === 401 || status === 403) return 'key-rejected';
  return 'unreachable';
}
