import { describe, expect, it } from 'vitest';
import { panelToggleSlot, shouldDismissFullscreenPanel } from '../panelRouting';
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
