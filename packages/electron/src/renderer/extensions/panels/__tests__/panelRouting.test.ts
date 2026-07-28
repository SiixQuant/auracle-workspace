import { describe, expect, it } from 'vitest';
import {
  MIN_AI_CHAT_WIDTH,
  fullscreenChatPaneWidth,
  panelToggleSlot,
  shouldDismissFullscreenPanel,
} from '../panelRouting';
import type { RegisteredPanel } from '../PanelRegistry';

/** A registered panel with only the field the router reads. */
function panel(placement: RegisteredPanel['placement'] | undefined): Pick<RegisteredPanel, 'placement'> {
  return { placement: placement as RegisteredPanel['placement'] };
}

describe('panelToggleSlot routes a toggle by declared placement', () => {
  it('sends fullscreen panels to the main panel slot (the Deploy-button fix)', () => {
    expect(panelToggleSlot(panel('fullscreen'))).toBe('panel');
  });

  it('sends sidebar panels to the main panel slot too — both render from activeExtensionPanel', () => {
    expect(panelToggleSlot(panel('sidebar'))).toBe('panel');
  });

  it('sends bottom panels to the bottom dock slot', () => {
    expect(panelToggleSlot(panel('bottom'))).toBe('bottomPanel');
  });

  it('defaults an unspecified placement to the bottom dock', () => {
    expect(panelToggleSlot(panel(undefined))).toBe('bottomPanel');
  });

  it('returns null for an unresolved panel id so the caller no-ops', () => {
    expect(panelToggleSlot(undefined)).toBeNull();
  });
});

describe('shouldDismissFullscreenPanel keeps a mode switch from landing behind a panel', () => {
  it('dismisses when a panel opens a file and the host switches to files mode', () => {
    expect(shouldDismissFullscreenPanel('agent', 'files', true)).toBe(true);
  });

  it('dismisses when a panel hands a prompt to the agent', () => {
    expect(shouldDismissFullscreenPanel('files', 'agent', true)).toBe(true);
  });

  it('leaves the panel up when the mode is merely re-asserted', () => {
    expect(shouldDismissFullscreenPanel('files', 'files', true)).toBe(false);
  });

  it('leaves the panel up when it was just opened over an unchanged mode', () => {
    // The gutter opens a fullscreen panel without moving the window mode, so
    // the flag flips true on its own -- that must not close what just opened.
    expect(shouldDismissFullscreenPanel('agent', 'agent', true)).toBe(false);
  });

  it('does nothing for mode changes with no fullscreen panel up (sidebar panels included)', () => {
    expect(shouldDismissFullscreenPanel('files', 'agent', false)).toBe(false);
    expect(shouldDismissFullscreenPanel('agent', 'files', false)).toBe(false);
  });
});

describe('fullscreenChatPaneWidth leaves the panel only the width the chat pane does not take', () => {
  it('gives the pane the width the workspace layout holds', () => {
    // The panel slot is the rest of the row, so this number IS the strip the
    // panel must not be drawn under.
    expect(fullscreenChatPaneWidth(true, false, 420)).toBe(420);
  });

  it('hands the whole row back when the pane is collapsed', () => {
    expect(fullscreenChatPaneWidth(true, true, 420)).toBeNull();
  });

  it('hands the whole row back for a panel with no AI lane', () => {
    expect(fullscreenChatPaneWidth(false, false, 420)).toBeNull();
  });

  it('follows the pane as it is dragged, so the panel resizes with it', () => {
    expect(fullscreenChatPaneWidth(true, false, 320)).toBe(320);
    expect(fullscreenChatPaneWidth(true, false, 640)).toBe(640);
  });

  it('never draws the pane narrower than its own drag floor', () => {
    expect(fullscreenChatPaneWidth(true, false, 120)).toBe(MIN_AI_CHAT_WIDTH);
    expect(fullscreenChatPaneWidth(true, false, 0)).toBe(MIN_AI_CHAT_WIDTH);
  });

  it('falls back to the floor rather than an unusable width', () => {
    expect(fullscreenChatPaneWidth(true, false, Number.NaN)).toBe(MIN_AI_CHAT_WIDTH);
    expect(fullscreenChatPaneWidth(true, false, Number.POSITIVE_INFINITY)).toBe(MIN_AI_CHAT_WIDTH);
  });

  it('rounds to whole pixels so the panel is never left a fractional sliver', () => {
    expect(fullscreenChatPaneWidth(true, false, 412.4)).toBe(412);
  });
});
