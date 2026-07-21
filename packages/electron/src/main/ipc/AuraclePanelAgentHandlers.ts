/**
 * Panel → agent hand-off.
 *
 * `extensions:launch-agent-session` lets an extension panel (e.g. the
 * Auracle Research panel's "Draft strategy" action) hand a prompt to a new
 * agent session without knowing anything about the session tree. The new
 * session is spawned as a sibling of the workspace's most recent session —
 * the same shape a launcher action produces — and the prompt is PREFILLED,
 * never auto-submitted: the user reviews the command and presses Send.
 *
 * Reuses the `action-prompts:launched` broadcast so the existing renderer
 * listener (store/listeners/actionPromptListeners.ts) does the draft
 * prefill + focus work; no new renderer wiring.
 */

import { BrowserWindow } from 'electron';
import { AISessionsRepository } from '@nimbalyst/runtime';
import { safeHandle } from '../utils/ipcRegistry';
import { MetaAgentService } from '../services/MetaAgentService';
import { agentHasUsableCredential } from '../utils/store';

interface LaunchPayload {
  workspacePath?: string;
  prompt?: string;
  title?: string;
}

interface KeyStatePayload {
  workspacePath?: string;
}

export function registerAuraclePanelAgentHandlers(): void {
  // Whether the Auracle Agent has a model connected for this workspace. Lets a
  // panel show a connect-a-key gate instead of handing off a prompt the agent
  // has no LLM to run. Resolution is read-only and defaults to configured on
  // any doubt, so this can only gate an agent that is genuinely unconfigured.
  safeHandle(
    'extensions:agent-key-state',
    async (_event, payload: KeyStatePayload): Promise<{ configured: boolean }> => {
      const workspacePath = (payload?.workspacePath ?? '').trim() || undefined;
      try {
        return { configured: agentHasUsableCredential(workspacePath) };
      } catch {
        return { configured: true };
      }
    }
  );

  safeHandle(
    'extensions:launch-agent-session',
    async (event, payload: LaunchPayload): Promise<{ ok: boolean; sessionId?: string; error?: string }> => {
      const workspacePath = (payload?.workspacePath ?? '').trim();
      const prompt = (payload?.prompt ?? '').trim();
      if (!workspacePath || !prompt) {
        return { ok: false, error: 'workspacePath and prompt are required' };
      }

      let parentId: string | null = null;
      try {
        const sessions = await AISessionsRepository.list(workspacePath);
        // list() is recency-ordered; anchor on the newest session so the
        // hand-off lands next to what the user is already doing.
        parentId = sessions.length > 0 ? sessions[0].id : null;
      } catch (error) {
        return {
          ok: false,
          error: `could not read sessions: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (!parentId) {
        return {
          ok: false,
          error: 'No agent session yet — open the agent panel and start one first.',
        };
      }

      try {
        const meta = MetaAgentService.getInstance();
        const launch = await meta.launchActionSession(parentId, workspacePath, {
          prompt,
          title: payload?.title,
          autoSubmit: false,
        });

        const window = BrowserWindow.fromWebContents(event.sender);
        if (window && !window.isDestroyed()) {
          window.webContents.send('action-prompts:launched', {
            workspacePath,
            parentSessionId: parentId,
            sessionId: launch.sessionId,
            workstreamId: launch.workstreamId,
            worktreeId: launch.worktreeId,
            draftInput: prompt,
            focus: true,
          });
        }
        return { ok: true, sessionId: launch.sessionId };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
}
