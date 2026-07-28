// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { useAIChatLayoutPersistence } from '../useAIChatLayoutPersistence';
import {
  aiChatWidthAtomFamily,
  aiChatCollapsedAtomFamily,
} from '../../store/atoms/workspaceLayout';

const PATH_A = '/ws/a';
const PATH_B = '/ws/b';

type InvokeMock = ReturnType<typeof vi.fn>;

function updateStateCalls(invoke: InvokeMock) {
  return invoke.mock.calls.filter(([channel]) => channel === 'workspace:update-state');
}

describe('useAIChatLayoutPersistence', () => {
  let jotaiStore: ReturnType<typeof createStore>;
  let invoke: InvokeMock;
  /** Per-path state returned by the workspace:get-state mock. */
  let persisted: Record<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    jotaiStore = createStore();
    persisted = {};
    invoke = vi.fn(async (channel: string, workspacePath: string) => {
      if (channel === 'workspace:get-state') return persisted[workspacePath];
      return undefined;
    });
    (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={jotaiStore}>{children}</Provider>
  );

  function mount(initialPath: string = PATH_A) {
    return renderHook(({ path }: { path: string }) => useAIChatLayoutPersistence(path), {
      initialProps: { path: initialPath },
      wrapper,
    });
  }

  /** Flush the async seed (microtasks only; no timers advance). */
  async function flushSeed() {
    await act(async () => {});
  }

  it('seeds the layout atoms from the persisted aiPanel state', async () => {
    persisted[PATH_A] = { aiPanel: { width: 512, collapsed: true, currentSessionId: 's1' } };

    mount();
    await flushSeed();

    expect(jotaiStore.get(aiChatWidthAtomFamily(PATH_A))).toBe(512);
    expect(jotaiStore.get(aiChatCollapsedAtomFamily(PATH_A))).toBe(true);
  });

  it('clamps a persisted width below the drag floor', async () => {
    persisted[PATH_A] = { aiPanel: { width: 100, collapsed: false } };

    mount();
    await flushSeed();

    expect(jotaiStore.get(aiChatWidthAtomFamily(PATH_A))).toBe(280);
  });

  it('keeps atom defaults and ignores malformed persisted values', async () => {
    persisted[PATH_A] = { aiPanel: { width: 'wide', collapsed: 'yes' } };

    mount();
    await flushSeed();

    expect(jotaiStore.get(aiChatWidthAtomFamily(PATH_A))).toBe(350);
    expect(jotaiStore.get(aiChatCollapsedAtomFamily(PATH_A))).toBe(false);
  });

  it('never writes defaults back before the seed has landed', async () => {
    persisted[PATH_A] = { aiPanel: { width: 640, collapsed: true } };

    mount();
    // No microtask flush: the seed is still in flight
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(updateStateCalls(invoke)).toHaveLength(0);
  });

  it('does not write at all when nothing changes after the seed', async () => {
    persisted[PATH_A] = {};

    mount();
    await flushSeed();
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(updateStateCalls(invoke)).toHaveLength(0);
  });

  it('persists a width change after the seed, debounced to the final value', async () => {
    persisted[PATH_A] = { aiPanel: { width: 400, collapsed: false } };

    mount();
    await flushSeed();
    invoke.mockClear();

    act(() => {
      jotaiStore.set(aiChatWidthAtomFamily(PATH_A), 500);
    });
    act(() => {
      jotaiStore.set(aiChatWidthAtomFamily(PATH_A), 555);
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    const writes = updateStateCalls(invoke);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual([
      'workspace:update-state',
      PATH_A,
      { aiPanel: { collapsed: false, width: 555 } },
    ]);
  });

  it('persists a collapse toggle', async () => {
    persisted[PATH_A] = { aiPanel: { width: 400, collapsed: false } };

    mount();
    await flushSeed();
    invoke.mockClear();

    act(() => {
      jotaiStore.set(aiChatCollapsedAtomFamily(PATH_A), true);
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    const writes = updateStateCalls(invoke);
    expect(writes).toHaveLength(1);
    expect(writes[0][2]).toEqual({ aiPanel: { collapsed: true, width: 400 } });
  });

  it('re-seeds on workspace switch without writing to the new path first', async () => {
    persisted[PATH_A] = { aiPanel: { width: 400, collapsed: false } };
    persisted[PATH_B] = { aiPanel: { width: 600, collapsed: true } };

    const { rerender } = mount(PATH_A);
    await flushSeed();
    invoke.mockClear();

    rerender({ path: PATH_B });
    // Before B's seed lands, nothing may be written for B
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(updateStateCalls(invoke)).toHaveLength(0);

    await flushSeed();
    expect(jotaiStore.get(aiChatWidthAtomFamily(PATH_B))).toBe(600);
    expect(jotaiStore.get(aiChatCollapsedAtomFamily(PATH_B))).toBe(true);
    // A's slot keeps its own value
    expect(jotaiStore.get(aiChatWidthAtomFamily(PATH_A))).toBe(400);
  });

  it('no-ops without crashing when electronAPI is unavailable', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;

    mount();
    await flushSeed();

    expect(jotaiStore.get(aiChatWidthAtomFamily(PATH_A))).toBe(350);
  });
});
