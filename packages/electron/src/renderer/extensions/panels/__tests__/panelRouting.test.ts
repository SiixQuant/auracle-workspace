import { describe, expect, it } from 'vitest';
import { panelToggleSlot } from '../panelRouting';
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
