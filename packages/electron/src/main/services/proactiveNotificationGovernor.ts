/**
 * ProactiveNotificationGovernor — the pure policy for auto-driving the agent
 * from a panel event.
 *
 * Lives in its own file with NO I/O (no Electron, no DB, no network) so every
 * policy line the issue mandates is provably enforced in isolation, driven by
 * an injected `now` clock. The service around it gathers the facts (is a
 * session open? is the plan paid? is the opt-in on?) and hands them in; this
 * module decides, and only this module holds the debounce / dedup / backoff
 * state.
 *
 * Decision order (first match wins; earlier gates record NO state, so flipping
 * opt-in or upgrading a plan starts clean):
 *   1. opt-out    — the feature is off (default).
 *   2. no-session — no agent session to drive (honest no-op, never a spawn).
 *                   Checked before the paid gate so the service can skip the
 *                   engine round-trip when there is nothing to drive.
 *   3. gated      — the plan is not paid (community never auto-drives).
 *   4. backoff    — this session is inside a post-failure suppression window.
 *   5. debounced  — this subject was driven within the debounce window.
 *   6. duplicate  — this exact type+subject already drove this session.
 *   7. drive.
 *
 * On a failed delivery the caller records the failure, which widens a backoff
 * window (exponential, capped) — it NEVER re-enqueues the event. A dropped
 * event is dropped; that is the deliberate defense against the wake-loop this
 * code has been bitten by before.
 */

export type GovernorReason =
  | 'opt-out'
  | 'gated'
  | 'no-session'
  | 'backoff'
  | 'debounced'
  | 'duplicate';

export type GovernorDecision = { drive: true } | { drive: false; reason: GovernorReason };

export interface GovernorInput {
  /** The agent session the event would drive; '' when none is open. */
  sessionId: string;
  /** Whether a session actually exists (kept explicit so 'no-session' is a
   *  first-class, tested outcome rather than an empty-string accident). */
  hasSession: boolean;
  /** Event type, e.g. 'backtest.finished'. */
  type: string;
  /** Stable subject id (run / deployment / strategy). */
  subject: string;
  /** The opt-in setting (default OFF). */
  optIn: boolean;
  /** Whether the plan permits auto-driving (paid tier, verified host-side). */
  paid: boolean;
  /** Wall clock in ms. */
  now: number;
}

export interface GovernorOptions {
  /** At most one drive per subject (per session) within this window. */
  debounceMs?: number;
  /** First suppression window after a delivery failure; doubles per
   *  consecutive failure, capped at {@link GovernorOptions.backoffMaxMs}. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

const DEFAULTS: Required<GovernorOptions> = {
  debounceMs: 60_000,
  backoffBaseMs: 30_000,
  backoffMaxMs: 15 * 60_000,
};

interface BackoffState {
  until: number;
  failures: number;
}

export class ProactiveNotificationGovernor {
  private readonly opts: Required<GovernorOptions>;
  /** `${sessionId}::${subject}` → last drive time (debounce, per subject). */
  private readonly lastDrivenAt = new Map<string, number>();
  /** `${sessionId}::${type}::${subject}` already driven (dedup, per session). */
  private readonly delivered = new Set<string>();
  /** `${sessionId}` → active backoff window. */
  private readonly backoff = new Map<string, BackoffState>();

  constructor(options: GovernorOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  private debounceKey(sessionId: string, subject: string): string {
    return `${sessionId}::${subject}`;
  }

  private dedupKey(sessionId: string, type: string, subject: string): string {
    return `${sessionId}::${type}::${subject}`;
  }

  /**
   * Decide whether this event may auto-drive the agent now. Records debounce +
   * dedup state ONLY when the answer is drive, so a suppressed event never
   * consumes a slot it did not use.
   */
  decide(input: GovernorInput): GovernorDecision {
    if (!input.optIn) return { drive: false, reason: 'opt-out' };
    if (!input.hasSession || !input.sessionId) return { drive: false, reason: 'no-session' };
    if (!input.paid) return { drive: false, reason: 'gated' };

    const back = this.backoff.get(input.sessionId);
    if (back && input.now < back.until) return { drive: false, reason: 'backoff' };

    const dKey = this.debounceKey(input.sessionId, input.subject);
    const last = this.lastDrivenAt.get(dKey);
    if (last !== undefined && input.now - last < this.opts.debounceMs) {
      return { drive: false, reason: 'debounced' };
    }

    const dedup = this.dedupKey(input.sessionId, input.type, input.subject);
    if (this.delivered.has(dedup)) return { drive: false, reason: 'duplicate' };

    this.lastDrivenAt.set(dKey, input.now);
    this.delivered.add(dedup);
    return { drive: true };
  }

  /** Delivery succeeded — clear any post-failure backoff for this session. */
  recordSuccess(sessionId: string): void {
    this.backoff.delete(sessionId);
  }

  /**
   * Delivery failed — widen the backoff window (exponential, capped). Does NOT
   * re-enqueue anything; the just-attempted event stays marked delivered, so
   * there is no retry loop. Backoff only suppresses SUBSEQUENT events on this
   * session until it clears.
   */
  recordFailure(sessionId: string, now: number): void {
    const prev = this.backoff.get(sessionId);
    const failures = (prev?.failures ?? 0) + 1;
    const window = Math.min(this.opts.backoffBaseMs * 2 ** (failures - 1), this.opts.backoffMaxMs);
    this.backoff.set(sessionId, { until: now + window, failures });
  }

  /** Test/hygiene seam: forget all state (e.g. between test cases). */
  reset(): void {
    this.lastDrivenAt.clear();
    this.delivered.clear();
    this.backoff.clear();
  }
}
