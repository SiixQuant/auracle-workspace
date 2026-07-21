/**
 * Panel → agent proactive-notification lane.
 *
 * `extensions:panel-notify` receives a versioned {@link PanelChangeEnvelope} a
 * pack panel emitted through `PanelAIContext.notifyChange`. The envelope is
 * re-validated here (untrusted from the renderer), then handed to the
 * {@link ProactiveNotificationService}, which asks the pure governor whether to
 * auto-drive the agent and, if so, injects a prompt into the existing session.
 *
 * Sibling to AuraclePanelAgentHandlers (the explicit hand-off lane). The
 * difference: that lane prefills a NEW session on a user click; this one is
 * unprompted, so it is opt-in, paid-gated, debounced, deduped, backed off, and
 * a no-op when no session exists — never a spawn.
 */
import { AISessionsRepository } from '@nimbalyst/runtime';
import type { PanelChangeEnvelope } from '@nimbalyst/runtime';
import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';
import { getSettingsService } from '../services/SettingsService';
import { auracleEngineRequest } from './AuracleEngineHandlers';
import {
  isPanelChangeEnvelope,
  isRoutablePanelEvent,
} from '../../shared/panelChangeEnvelope';
import {
  ProactiveNotificationService,
  isPaidTier,
  type ProactiveNotificationDeps,
} from '../services/proactiveNotificationService';
import type { AIService } from '../services/ai/AIService';

interface PanelNotifyPayload {
  workspacePath?: string;
  event?: string;
  envelope?: unknown;
}

/** Entitlement snapshot cache — one short-lived read of the install's paid
 *  status, so a burst of events does not hammer the engine. */
const ENTITLEMENTS_TTL_MS = 30_000;
let paidCache: { paid: boolean; at: number } | null = null;

/**
 * Read whether the install's plan permits auto-driving, host-side, with the
 * same auth the engine bridge uses. Fail-closed: an older/unreachable engine or
 * a missing tier yields `false` (community never auto-drives). Successful reads
 * are cached briefly; a failed read is not cached, so an upgrade is picked up
 * on the next event rather than after a stale window.
 */
async function readPaidTier(now: number): Promise<boolean> {
  if (paidCache && now - paidCache.at < ENTITLEMENTS_TTL_MS) return paidCache.paid;
  try {
    const res = await auracleEngineRequest('GET', '/ui/api/ide/entitlements');
    if (res.ok && res.body && typeof res.body === 'object') {
      const tier = (res.body as { tier?: unknown }).tier;
      const paid = isPaidTier(typeof tier === 'string' ? tier : null);
      paidCache = { paid, at: now };
      return paid;
    }
  } catch {
    // Engine down/unreachable — fall through to fail-closed.
  }
  return false;
}

let service: ProactiveNotificationService | null = null;

/**
 * Wire the production service once the AIService exists (called from startup,
 * right after MetaAgentService.start(aiService)). Until then, panel-notify
 * events are a debug-logged no-op.
 */
export function attachProactiveNotificationAIService(aiService: AIService): void {
  const deps: ProactiveNotificationDeps = {
    listSessions: (workspacePath) => AISessionsRepository.list(workspacePath),
    getOptIn: () => getSettingsService().get('ai.proactiveNotifications') === true,
    isPaid: () => readPaidTier(Date.now()),
    queuePrompt: (sessionId, prompt) => aiService.queuePromptForSession(sessionId, prompt),
    triggerProcessing: (sessionId, workspacePath) =>
      aiService.triggerQueuedPromptProcessingForSession(sessionId, workspacePath),
    now: () => Date.now(),
    log: (message) => logger.main?.debug?.(message),
  };
  service = new ProactiveNotificationService(deps);
}

export function registerAuraclePanelNotifyHandlers(): void {
  safeHandle('extensions:panel-notify', async (_event, payload: PanelNotifyPayload): Promise<{ ok: boolean }> => {
    const workspacePath = (payload?.workspacePath ?? '').trim();
    if (!workspacePath || !isPanelChangeEnvelope(payload?.envelope)) return { ok: false };

    const envelope = payload.envelope as PanelChangeEnvelope;
    // Ignore an envelope this host does not understand (unknown version) or does
    // not route (unknown type) — honoring the contract's forward-compat rule.
    if (!isRoutablePanelEvent(envelope)) return { ok: false };

    if (!service) {
      logger.main?.debug?.('[ProactiveNotifications] event before AIService ready — ignored.');
      return { ok: false };
    }

    try {
      await service.handlePanelEvent({ workspacePath, envelope });
    } catch (error) {
      logger.main?.debug?.(
        `[ProactiveNotifications] handler error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    // Fire-and-forget from the renderer's view: it never learns the verdict.
    return { ok: true };
  });
}
