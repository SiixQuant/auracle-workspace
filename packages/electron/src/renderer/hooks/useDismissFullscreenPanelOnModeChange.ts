import { useEffect, useRef } from 'react';
import type { ContentMode } from '../types/WindowModeTypes';
import { shouldDismissFullscreenPanel } from '../extensions/panels/panelRouting';

/**
 * Closes an open fullscreen extension panel whenever the window mode changes.
 *
 * A fullscreen panel is drawn over every mode, so a mode switch made while one
 * is up is eclipsed by it and reads as "nothing happened": a panel that opens a
 * file, or hands a prompt to the agent, leaves the user looking at the panel
 * they started from. The navigation gutter and the keyboard shortcuts already
 * clear the panel as they switch; the many programmatic `setActiveMode` calls
 * in App.tsx do not, and this closes that gap for all of them at once.
 *
 * Only a real change dismisses, which is why the previous mode is tracked in a
 * ref: mounting, re-asserting the current mode, and opening the panel itself
 * (which does not move the mode) must all leave the panel up. Sidebar panels
 * are not fullscreen and are never touched -- they are meant to sit alongside
 * files mode.
 */
export function useDismissFullscreenPanelOnModeChange(
  activeMode: ContentMode,
  isFullscreenPanelActive: boolean,
  onDismiss: () => void,
): void {
  const previousModeRef = useRef<ContentMode>(activeMode);

  useEffect(() => {
    const previousMode = previousModeRef.current;
    previousModeRef.current = activeMode;

    if (shouldDismissFullscreenPanel(previousMode, activeMode, isFullscreenPanelActive)) {
      onDismiss();
    }
  }, [activeMode, isFullscreenPanelActive, onDismiss]);
}
