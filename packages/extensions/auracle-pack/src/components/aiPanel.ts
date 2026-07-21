/**
 * Shared plumbing for wiring an auracle-pack panel to the Auracle Agent.
 *
 * Two lanes, both provided by the panel host and feature-detected so panels
 * still render on older builds:
 *  - **ambient context** — a panel that is `aiSupported` publishes what the
 *    user is looking at via `host.ai.setContext`, which the host surfaces to
 *    the AI chat as a live document. Use {@link useAiPanelContext}.
 *  - **explicit hand-off** — `host.launchAgentSession` prefills a new agent
 *    session with a prompt (the user reviews and presses Send). Use
 *    {@link handOffToAgent}.
 */
import { useEffect } from 'react';
import { ensureFocusAmbient, noteFocusAmbientWrite } from '../engine/focusStore';

/** The slice of `PanelAIContext` a panel actually drives. */
export interface PanelAiSlice {
  setContext(context: Record<string, unknown>): void;
  clearContext(): void;
}

/**
 * Structural slice of the PanelHost the shared helpers touch. Every field is
 * optional so the helpers no-op honestly on hosts that predate the feature
 * (older IDE) or panels that are not `aiSupported` (no `ai`).
 */
export interface PanelHostLike {
  ai?: PanelAiSlice;
  openFile?: (path: string) => void;
  launchAgentSession?: (
    prompt: string,
    opts?: { title?: string }
  ) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
}

export type AgentNote = { kind: 'ok' | 'err'; text: string } | null;

/**
 * Publish `context` to the AI chat whenever its content changes; clear it when
 * `context` is null (e.g. the panel has no active selection). No-op on hosts
 * without `ai`. Change detection is by serialized value, so callers can pass a
 * freshly-built object each render without thrashing setContext.
 *
 * This is also the single wiring point for the focus store's ambient
 * precedence: it bootstraps the focus→ambient bridge off the first host that
 * exposes an AI sink, and every real context write here is the "active panel's
 * own payload", so it cancels any pending minimal focus fallback — the panel's
 * richer document always wins while it is active (see `focusStore`).
 */
export function useAiPanelContext(
  host: PanelHostLike | undefined,
  context: Record<string, unknown> | null
): void {
  const key = context ? JSON.stringify(context) : '';
  useEffect(() => {
    const ai = host?.ai;
    if (!ai) return;
    ensureFocusAmbient(ai);
    if (context) {
      ai.setContext(context);
      noteFocusAmbientWrite();
    } else {
      ai.clearContext();
    }
    // Re-run only when the host or the serialized context value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, key]);
}

/**
 * Hand `prompt` to a new prefilled agent session and return the note to show.
 * The session is never auto-submitted — the user reviews and sends. Honest
 * fallback when the host predates `launchAgentSession`.
 */
export async function handOffToAgent(
  host: PanelHostLike | undefined,
  prompt: string,
  title: string
): Promise<AgentNote> {
  if (!host?.launchAgentSession) {
    return { kind: 'err', text: 'This build cannot hand off to the agent — update the IDE.' };
  }
  const result = await host.launchAgentSession(prompt, { title: title.slice(0, 60) });
  if (!result.ok) {
    return { kind: 'err', text: result.error ?? 'The agent hand-off failed.' };
  }
  return { kind: 'ok', text: 'Handed to the agent — review the prefilled prompt and send it.' };
}
