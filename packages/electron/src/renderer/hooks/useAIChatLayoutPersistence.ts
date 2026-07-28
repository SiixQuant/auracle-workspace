import { useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import {
  aiChatWidthAtomFamily,
  aiChatCollapsedAtomFamily,
} from '../store/atoms/workspaceLayout';

/** Trailing delay so a resize drag persists once, not once per mousemove. */
const SAVE_DEBOUNCE_MS = 300;

/** Same floor as ChatSidebar's drag clamp, so a persisted value cannot load unusably narrow. */
const MIN_AI_CHAT_WIDTH = 280;

/**
 * Keeps the AI chat pane's layout atoms in sync with the workspace's persisted
 * `aiPanel` state.
 *
 * The rendered pane reads only `aiChatWidthAtomFamily` /
 * `aiChatCollapsedAtomFamily`; this hook seeds those atoms from
 * `workspace:get-state` when a workspace loads and writes user changes back
 * through `workspace:update-state`. Only `width` and `collapsed` are owned
 * here — the same `aiPanel` key also carries session and planning-mode fields
 * saved elsewhere, which the main process preserves via deep merge.
 *
 * Writes are gated until the seed for the current workspace path has landed,
 * so a mount can never clobber the persisted layout with atom defaults.
 */
export function useAIChatLayoutPersistence(workspacePath: string): void {
  const [width, setWidth] = useAtom(aiChatWidthAtomFamily(workspacePath));
  const [collapsed, setCollapsed] = useAtom(aiChatCollapsedAtomFamily(workspacePath));
  const seededPathRef = useRef<string | null>(null);

  // Seed the atoms from persisted state whenever the workspace changes
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.invoke) return;

    let cancelled = false;
    const seedFromWorkspaceState = async () => {
      try {
        const workspaceState = await window.electronAPI.invoke('workspace:get-state', workspacePath);
        if (cancelled) return;
        const aiPanel = workspaceState?.aiPanel;
        if (typeof aiPanel?.width === 'number') {
          setWidth(Math.max(MIN_AI_CHAT_WIDTH, aiPanel.width));
        }
        if (typeof aiPanel?.collapsed === 'boolean') {
          setCollapsed(aiPanel.collapsed);
        }
      } catch (error) {
        console.error('[AIChatLayout] Failed to restore AI chat layout:', error);
      } finally {
        // Fail open (like the session/planning restore) so later resizes still persist
        if (!cancelled) seededPathRef.current = workspacePath;
      }
    };

    seedFromWorkspaceState();
    return () => {
      cancelled = true;
    };
  }, [workspacePath, setWidth, setCollapsed]);

  // Persist changes back once the seed for this workspace has landed
  useEffect(() => {
    if (!workspacePath || seededPathRef.current !== workspacePath) return;
    if (!window.electronAPI?.invoke) return;

    const timer = setTimeout(() => {
      window.electronAPI
        .invoke('workspace:update-state', workspacePath, {
          aiPanel: { collapsed, width },
        })
        .catch((error: unknown) => {
          console.error('[AIChatLayout] Failed to save AI chat layout:', error);
        });
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [width, collapsed, workspacePath]);
}
