// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDismissFullscreenPanelOnModeChange } from '../useDismissFullscreenPanelOnModeChange';
import type { ContentMode } from '../../types/WindowModeTypes';

type Props = { activeMode: ContentMode; isFullscreenPanelActive: boolean };

function mount(initialProps: Props, onDismiss: () => void) {
  return renderHook(
    ({ activeMode, isFullscreenPanelActive }: Props) =>
      useDismissFullscreenPanelOnModeChange(activeMode, isFullscreenPanelActive, onDismiss),
    { initialProps },
  );
}

describe('useDismissFullscreenPanelOnModeChange', () => {
  it('does not dismiss on mount, even with a panel already restored', () => {
    const onDismiss = vi.fn();
    mount({ activeMode: 'agent', isFullscreenPanelActive: true }, onDismiss);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  // The eclipse bug: a panel opens a file, the host switches to files mode, and
  // the panel stays up covering the file that was just opened.
  it('dismisses when a mode change happens under an open fullscreen panel', () => {
    const onDismiss = vi.fn();
    const { rerender } = mount({ activeMode: 'agent', isFullscreenPanelActive: true }, onDismiss);

    rerender({ activeMode: 'files', isFullscreenPanelActive: true });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss a panel that was just opened over an unchanged mode', () => {
    const onDismiss = vi.fn();
    const { rerender } = mount({ activeMode: 'agent', isFullscreenPanelActive: false }, onDismiss);

    rerender({ activeMode: 'agent', isFullscreenPanelActive: true });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('leaves sidebar-placement panels alone, since they never set the fullscreen flag', () => {
    const onDismiss = vi.fn();
    const { rerender } = mount({ activeMode: 'agent', isFullscreenPanelActive: false }, onDismiss);

    rerender({ activeMode: 'files', isFullscreenPanelActive: false });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses once per mode change, not once per re-render', () => {
    const onDismiss = vi.fn();
    const { rerender } = mount({ activeMode: 'agent', isFullscreenPanelActive: true }, onDismiss);

    rerender({ activeMode: 'files', isFullscreenPanelActive: true });
    rerender({ activeMode: 'files', isFullscreenPanelActive: true });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
