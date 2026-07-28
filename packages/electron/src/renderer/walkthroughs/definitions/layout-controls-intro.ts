/**
 * Layout Controls Introduction Walkthrough
 *
 * Explains the session layout modes in agent mode (Chat, Editor, Split).
 * Only shows when a file has been opened in the session so that the Editor
 * button is present, demonstrating the full functionality.
 */

import type { WalkthroughDefinition } from '../types';
import { getHelpContent } from '../../help';
import { isTargetValid } from '../WalkthroughService';

const layoutControlsHelp = getHelpContent('layout-controls')!;

export const layoutControlsIntro: WalkthroughDefinition = {
  id: 'layout-controls-intro',
  name: 'Layout Controls',
  version: 1,
  trigger: {
    // Only show in agent mode where layout controls exist
    screen: 'agent',
    // Only show when the Editor button is usable (meaning a file has been opened)
    condition: () => {
      // Find the layout controls container
      const controls = document.querySelector('[data-testid="layout-controls"]');
      if (!controls || !isTargetValid(controls as HTMLElement)) {
        return false;
      }

      // The Editor button (layout-maximize-editor) is only rendered once the
      // session has opened a file, which is when this tour has all three modes
      // to point at.
      const editorButton = controls.querySelector(
        '[data-testid="layout-maximize-editor"]'
      ) as HTMLButtonElement | null;
      if (!editorButton) {
        return false;
      }

      return !editorButton.disabled;
    },
    // Wait for the session to have loaded and files to be opened
    delay: 1500,
    // Lower priority - show after more fundamental features
    priority: 35,
  },
  steps: [
    {
      id: 'layout-controls',
      target: {
        testId: 'layout-controls',
      },
      title: layoutControlsHelp.title,
      body: layoutControlsHelp.body,
      placement: 'bottom',
      wide: true,
    },
  ],
};
