/**
 * ProactiveNotificationService — the I/O adapter around the pure
 * {@link ProactiveNotificationGovernor}.
 *
 * A panel event arrives (renderer → `extensions:panel-notify` → here). The
 * service gathers the facts the governor needs — is a session open, is the plan
 * paid, is the opt-in on — asks the governor, and only if it says drive does it
 * inject a concise prompt into the existing session via the SAME
 * queuePromptForSession path the child-session notifications use. No session
 * open is an honest no-op (a debug log, never a spawn — spawning costs tokens
 * without consent). A delivery failure records a backoff and is NOT retried.
 *
 * Every collaborator is injected so the whole decision→delivery flow is
 * unit-testable with fakes; {@link createProductionDeps} wires the real ones.
 */
import type { PanelChangeEnvelope } from '@nimbalyst/runtime';
import {
  ProactiveNotificationGovernor,
  type GovernorReason,
} from './proactiveNotificationGovernor';

/** Collaborators the service needs, injected so policy delivery is testable. */
export interface ProactiveNotificationDeps {
  /** Sessions for a workspace, most-recent first (empty when none). */
  listSessions(workspacePath: string): Promise<Array<{ id: string }>>;
  /** The opt-in setting, read fresh each event. */
  getOptIn(): boolean;
  /** Whether the plan permits auto-driving. Verified host-side, fail-closed. */
  isPaid(workspacePath: string): Promise<boolean>;
  /** Inject a prompt into an existing session. */
  queuePrompt(sessionId: string, prompt: string): Promise<unknown>;
  /** Wake the session so it processes the queued prompt. */
  triggerProcessing(sessionId: string, workspacePath: string): Promise<unknown>;
  now(): number;
  log(message: string): void;
}

/**
 * Host-side mirror of the pack's `isPaidTier`: an allow-list, so an
 * unrecognized tier ranks as community (fail-closed) rather than being
 * pre-approved. The engine's only paid ranks are pro / institutional / enterprise.
 */
export function isPaidTier(tier: string | null | undefined): boolean {
  const t = (tier ?? '').toLowerCase().trim();
  return t === 'pro' || t === 'institutional' || t === 'enterprise';
}

/**
 * A concise, factual prompt naming the event and its subject. Deliberately
 * plain — it states what happened and points the agent at the engine to look;
 * it never fabricates detail beyond the envelope.
 */
export function buildProactivePrompt(envelope: PanelChangeEnvelope): string {
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

  if (envelope.type === 'backtest.finished') {
    const strategy = str(payload.strategy) ?? 'a strategy';
    const outcome = payload.outcome === 'failed' ? 'failed' : 'succeeded';
    const lines = [
      `A backtest I started just ${outcome} for ${strategy} (run ${envelope.subject}).`,
    ];
    if (outcome === 'failed' && str(payload.detail)) {
      lines.push(`The engine reported: ${str(payload.detail)}`);
      lines.push('Look into why it failed through the Auracle engine and suggest a fix.');
    } else {
      lines.push('Read the run through the Auracle engine and summarize how it did, flagging anything that needs attention.');
    }
    return lines.join('\n');
  }

  if (envelope.type === 'deploy.failed') {
    const strategy = str(payload.strategy) ?? 'a deployment';
    const state = str(payload.state) ?? 'a failed state';
    return [
      `The live deployment ${strategy} (id ${envelope.subject}) entered ${state}.`,
      'Investigate the deployment through the Auracle engine — read its recent logs and orders, explain what went wrong, and propose next steps.',
    ].join('\n');
  }

  if (envelope.type === 'validation.completed') {
    const strategy = str(payload.strategy) ?? envelope.subject;
    const verdict = str(payload.verdict) ?? 'completed';
    const reds = Array.isArray(payload.redSignals)
      ? payload.redSignals.filter((s): s is string => typeof s === 'string')
      : [];
    const lines = [`Validation finished for ${strategy}: ${verdict}.`];
    if (reds.length > 0) lines.push(`Signals needing attention: ${reds.join(', ')}.`);
    lines.push('Explain what this means for the strategy and propose concrete, minimal changes for any red signals.');
    return lines.join('\n');
  }

  // Unreachable for routed events; a defensive default keeps the type total.
  return `A panel event (${envelope.type}) occurred for ${envelope.subject}.`;
}

export class ProactiveNotificationService {
  private readonly governor: ProactiveNotificationGovernor;

  constructor(
    private readonly deps: ProactiveNotificationDeps,
    governor?: ProactiveNotificationGovernor
  ) {
    this.governor = governor ?? new ProactiveNotificationGovernor();
  }

  /**
   * Handle one routed panel event end to end. Returns the outcome for tests
   * and logging; production callers can ignore it.
   */
  async handlePanelEvent(input: {
    workspacePath: string;
    envelope: PanelChangeEnvelope;
  }): Promise<{ drove: boolean; reason?: GovernorReason | 'delivery-failed' }> {
    const { workspacePath, envelope } = input;

    const sessions = await this.deps.listSessions(workspacePath).catch(() => []);
    const sessionId = sessions.length > 0 ? sessions[0].id : '';
    const hasSession = sessionId.length > 0;

    // Gather the governed facts. optIn is cheap; the paid check only runs when
    // opted-in AND a session exists, so a community user or an idle workspace
    // never triggers an engine round-trip.
    const optIn = this.deps.getOptIn();
    const paid = optIn && hasSession ? await this.deps.isPaid(workspacePath).catch(() => false) : false;

    const decision = this.governor.decide({
      sessionId,
      hasSession,
      type: envelope.type,
      subject: envelope.subject,
      optIn,
      paid,
      now: this.deps.now(),
    });

    if (!decision.drive) {
      this.deps.log(
        `[ProactiveNotifications] ${envelope.type} for ${envelope.subject}: not driven (${decision.reason}).`
      );
      return { drove: false, reason: decision.reason };
    }

    const prompt = buildProactivePrompt(envelope);
    try {
      await this.deps.queuePrompt(sessionId, prompt);
      await this.deps.triggerProcessing(sessionId, workspacePath);
      this.governor.recordSuccess(sessionId);
      this.deps.log(`[ProactiveNotifications] ${envelope.type} for ${envelope.subject}: drove session ${sessionId}.`);
      return { drove: true };
    } catch (error) {
      // Backoff — never a retry. The event is dropped; only the suppression
      // window widens so a run of failures cannot spin the wakeup loop.
      this.governor.recordFailure(sessionId, this.deps.now());
      this.deps.log(
        `[ProactiveNotifications] ${envelope.type} for ${envelope.subject}: delivery failed (${
          error instanceof Error ? error.message : String(error)
        }); backing off.`
      );
      return { drove: false, reason: 'delivery-failed' };
    }
  }
}
