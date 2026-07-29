/**
 * The panel's two faces — which one opens, how it is changed, and what the
 * change must never touch.
 *
 * Four things are worth pinning here, because each of them is a claim the
 * feature makes to a person rather than an implementation detail:
 *
 *  - a workspace that has never chosen opens on the BOARD, and the Board's
 *    empty state is the three ghost slots that say what to do about it;
 *  - a face chosen once is the face that opens next time, per workspace,
 *    read back synchronously so the remembered face is the one that PAINTS;
 *  - the shortcut flips faces from wherever focus is inside the panel — and
 *    from inside a room it comes home, so the key is never dead;
 *  - the Plan is exactly what it was: same plan, same rooms, same routing, and
 *    no Board anywhere near it.
 *
 * WHAT THIS FILE CANNOT SEE: jsdom has no layout engine and no container
 * queries, so the tiers, the fit and the reduced-motion rules are asserted in a
 * real browser instead (see the PR notes) — nothing below claims a pixel.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const stub = vi.hoisted(() => ({ feeds: {} as Record<string, unknown> }));

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authState: vi.fn(async () => ({ signedIn: false })),
  engineConfig: vi.fn(async () => ({ engineUrl: '', hasKey: false })),
  getJson: vi.fn(async (path: string) => {
    for (const [prefix, body] of Object.entries(stub.feeds)) {
      if (path.startsWith(prefix)) return body;
    }
    return null;
  }),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  runBacktest: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  backtestJobStatus: vi.fn(async () => null),
  backtestJobResult: vi.fn(async () => null),
  backtestJobFactors: vi.fn(async () => null),
  resolveRunSource: vi.fn(() => undefined),
  connectCheck: vi.fn(async () => null),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import type { ExtensionStorage, PanelHostProps } from '@nimbalyst/extension-sdk';
import { GridPanel } from '../grid/GridPanel';
import { GHOSTS } from '../grid/boardCopy';
import { boardGraph } from '../../engine/boardGraphStore';
import { FACE_KEY, getFace, resetFaceStore, setFace } from '../grid/gridFaceStore';
import { getActiveRoom, openGridHome, openRoom } from '../grid/gridNav';
import { closePalette } from '../grid/gridCommands';
import { gridVitals } from '../../engine/gridVitals';

/**
 * A workspace store shaped like the host's: `get` answers from memory the same
 * instant it is asked (the host serves a cache filled at startup), `set`
 * resolves later.
 */
function workspace(seed?: Record<string, unknown>): {
  storage: ExtensionStorage;
  written: Record<string, unknown>;
  sets: number;
} {
  const written: Record<string, unknown> = { ...seed };
  const box = {
    written,
    sets: 0,
    storage: {
      get: <T,>(key: string): T | undefined => written[key] as T | undefined,
      set: async <T,>(key: string, value: T): Promise<void> => {
        box.sets += 1;
        written[key] = value;
      },
      delete: async (): Promise<void> => {},
    } as unknown as ExtensionStorage,
  };
  return box;
}

function hostProps(storage?: ExtensionStorage): PanelHostProps {
  return { host: { panelId: 'grid', extensionId: 'pack', storage } } as unknown as PanelHostProps;
}

function panel(): HTMLElement {
  return screen.getByTestId('auracle-grid');
}

/** Draws nothing; records the face on every pass React makes over it. */
function FaceRecorder({ log }: { log: string[] }): null {
  log.push(getFace());
  return null;
}

/** Flip the face the way a person does: focused panel, one press. */
function pressFlip(): void {
  act(() => panel().focus());
  fireEvent.keyDown(window, { key: 'b', metaKey: true });
}

beforeEach(() => {
  stub.feeds = {};
  gridVitals.reset();
  resetFaceStore();
});

afterEach(() => {
  cleanup();
  closePalette();
  openGridHome();
  resetFaceStore();
  vi.restoreAllMocks();
  gridVitals.reset();
});

describe('a workspace that has never chosen opens on the Board', () => {
  it('greets a fresh workspace with the board, not the plan', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);

    expect(panel().getAttribute('data-face')).toBe('board');
    expect(screen.getByTestId('auracle-grid-board')).toBeTruthy();
    expect(screen.queryByTestId('auracle-grid-home')).toBeNull();
  });

  it('opens on the board even where the host remembers nothing at all', () => {
    render(<GridPanel {...hostProps(undefined)} />);

    expect(panel().getAttribute('data-face')).toBe('board');
  });

  it('draws the three ghost slots on an empty graph', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);

    expect(boardGraph.getSnapshot().nodes).toHaveLength(0);
    expect(screen.getByTestId('board-ghosts')).toBeTruthy();
    // The two moves a person makes, and the promise that nothing else is
    // theirs to place.
    // The words themselves are pinned in boardOnboarding.test.tsx; what this
    // asserts is that the shell draws all three of them.
    for (const ghost of GHOSTS) {
      expect(screen.getByTestId(`board-ghost-${ghost.id}`).textContent).toContain(ghost.title);
    }
    expect(screen.getAllByTestId(/^board-ghost-/)).toHaveLength(3);
  });

  it('drops the ghosts the moment the graph has anything on it', () => {
    // A card the system materialized, with NO position: layout on the real
    // graph is sparse, so the shell has to survive a node that has never been
    // placed. Anything that read coordinates off this would throw here.
    vi.spyOn(boardGraph, 'getSnapshot').mockReturnValue({
      nodes: [{ id: 'n1', kind: 'strategy' }],
      edges: [],
    });

    render(<GridPanel {...hostProps(workspace().storage)} />);

    expect(screen.getByTestId('auracle-grid-board').getAttribute('data-nodes')).toBe('1');
    expect(screen.queryByTestId('board-ghosts')).toBeNull();
  });

  it('offers the canvas controls the plan offers, under the same name', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);

    // jsdom measures every box at zero, so the canvas is never engaged here and
    // the controls are correctly absent. What this pins is that the board asks
    // the same question — an unmeasurable stage gets no controls, on either
    // face — rather than drawing controls that would drive nothing.
    expect(screen.getByTestId('board-stage').getAttribute('data-canvas')).toBe('off');
    expect(screen.queryByTestId('board-zoom')).toBeNull();
  });
});

describe('the face a person chose is the face that opens', () => {
  it('writes the choice to workspace storage', async () => {
    const store = workspace();
    render(<GridPanel {...hostProps(store.storage)} />);

    fireEvent.click(screen.getByTestId('grid-face-plan'));

    expect(panel().getAttribute('data-face')).toBe('plan');
    expect(store.written[FACE_KEY]).toBe('plan');
    expect(store.sets).toBe(1);
  });

  it('opens on the stored face, on the FIRST render — no default flashed first', () => {
    const store = workspace({ [FACE_KEY]: 'plan' });
    const faces: string[] = [];
    // Rendered AFTER the panel, so each of its passes reads the face the panel
    // has just settled on. A face adopted from an effect would show up here as
    // 'board' and then 'plan' — two passes, and a frame of the wrong face on
    // screen between them. Adopted during the panel's own render, there is one
    // pass and it is already right.
    render(
      <>
        <GridPanel {...hostProps(store.storage)} />
        <FaceRecorder log={faces} />
      </>
    );

    expect(faces).toEqual(['plan']);
    expect(screen.getByTestId('auracle-grid-home')).toBeTruthy();
  });

  it('keeps the choice across a remount of the same workspace', () => {
    const store = workspace();
    const { unmount } = render(<GridPanel {...hostProps(store.storage)} />);
    fireEvent.click(screen.getByTestId('grid-face-plan'));
    unmount();
    // A new panel over the same workspace, with the store as cold as a restart
    // leaves it.
    resetFaceStore();
    render(<GridPanel {...hostProps(store.storage)} />);

    expect(panel().getAttribute('data-face')).toBe('plan');
  });

  it('does not carry one workspace choice into another', () => {
    const chose = workspace({ [FACE_KEY]: 'plan' });
    const fresh = workspace();
    const { unmount } = render(<GridPanel {...hostProps(chose.storage)} />);
    expect(panel().getAttribute('data-face')).toBe('plan');
    unmount();
    // The host remounts the panel when the workspace changes; the store is
    // module state, so the new workspace has to be able to overrule it.
    resetFaceStore();
    render(<GridPanel {...hostProps(fresh.storage)} />);

    expect(panel().getAttribute('data-face')).toBe('board');
  });

  it('reads a stored value it does not recognise as no choice at all', () => {
    render(<GridPanel {...hostProps(workspace({ [FACE_KEY]: 'trellis' }).storage)} />);

    expect(panel().getAttribute('data-face')).toBe('board');
  });

  it('still flips when the workspace store refuses to answer', () => {
    const angry = {
      get: () => {
        throw new Error('no backend');
      },
      set: async () => {
        throw new Error('no backend');
      },
    } as unknown as ExtensionStorage;
    render(<GridPanel {...hostProps(angry)} />);

    expect(panel().getAttribute('data-face')).toBe('board');
    expect(() => fireEvent.click(screen.getByTestId('grid-face-plan'))).not.toThrow();
    expect(panel().getAttribute('data-face')).toBe('plan');
  });
});

describe('the toggle', () => {
  it('shows both faces and marks the one showing', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);

    expect(screen.getByTestId('grid-face-plan').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('grid-face-board').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('grid-face-plan'));

    expect(screen.getByTestId('grid-face-plan').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('grid-face-board').getAttribute('aria-pressed')).toBe('false');
  });

  it('pressing the face already showing binds the choice without changing one', () => {
    const store = workspace();
    const faces: string[] = [];
    render(
      <>
        <GridPanel {...hostProps(store.storage)} />
        <FaceRecorder log={faces} />
      </>
    );

    fireEvent.click(screen.getByTestId('grid-face-board'));

    expect(panel().getAttribute('data-face')).toBe('board');
    // The press BINDS the default — "I meant this one" has to survive a restart
    // — but it is not a change, so nothing redraws for it.
    expect(store.written[FACE_KEY]).toBe('board');
    expect(store.sets).toBe(1);
    expect(faces).toEqual(['board']);
  });

  it('is not drawn over a room, which carries its own frame', async () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);
    await act(async () => {
      openRoom('backtest');
    });

    expect(screen.queryByTestId('grid-face-toggle')).toBeNull();
  });
});

describe('the shortcut flips faces', () => {
  it('ignores the press until focus is inside the panel, then flips both ways', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);

    // Focus is on nothing: the press was meant for whatever the person is
    // actually looking at.
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(panel().getAttribute('data-face')).toBe('board');

    pressFlip();
    expect(panel().getAttribute('data-face')).toBe('plan');
    expect(screen.getByTestId('auracle-grid-home')).toBeTruthy();

    pressFlip();
    expect(panel().getAttribute('data-face')).toBe('board');
    expect(screen.getByTestId('auracle-grid-board')).toBeTruthy();
  });

  it('remembers the flip the way a press on the control does', () => {
    const store = workspace();
    render(<GridPanel {...hostProps(store.storage)} />);

    pressFlip();

    expect(store.written[FACE_KEY]).toBe('plan');
  });

  it('takes the combination off a later global listener, but only while focused', () => {
    const globalShortcut = vi.fn();
    render(<GridPanel {...hostProps(workspace().storage)} />);
    // Registered after the panel's own, the way the host shell's global
    // shortcut layer re-registers when a fullscreen panel becomes active.
    window.addEventListener('keydown', globalShortcut, { capture: true });

    try {
      fireEvent.keyDown(window, { key: 'b', metaKey: true });
      expect(globalShortcut).toHaveBeenCalledTimes(1);

      globalShortcut.mockClear();
      pressFlip();

      expect(globalShortcut).not.toHaveBeenCalled();
      expect(panel().getAttribute('data-face')).toBe('plan');
    } finally {
      window.removeEventListener('keydown', globalShortcut, { capture: true });
    }
  });

  it('leaves the palette combination alone', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);
    act(() => panel().focus());

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(screen.getByTestId('grid-palette')).toBeTruthy();
    expect(panel().getAttribute('data-face')).toBe('board');
  });

  it('is not a bare B, and not a modified one carrying extra modifiers', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);
    act(() => panel().focus());

    fireEvent.keyDown(window, { key: 'b' });
    fireEvent.keyDown(window, { key: 'b', metaKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'b', metaKey: true, altKey: true });

    expect(panel().getAttribute('data-face')).toBe('board');
  });

  it('comes home from a room, so the key is never dead where a room is showing', async () => {
    setFace('plan');
    render(<GridPanel {...hostProps(workspace().storage)} />);
    await act(async () => {
      openRoom('backtest');
    });
    expect(getActiveRoom()).toBe('backtest');

    pressFlip();

    expect(getActiveRoom()).toBeNull();
    expect(panel().getAttribute('data-face')).toBe('board');
    expect(screen.getByTestId('auracle-grid-board')).toBeTruthy();
  });

  it('stops listening once the panel is gone', () => {
    const { unmount } = render(<GridPanel {...hostProps(workspace().storage)} />);
    act(() => panel().focus());
    unmount();

    fireEvent.keyDown(window, { key: 'b', metaKey: true });

    expect(getFace()).toBe('board');
  });
});

describe('the Plan is what it was', () => {
  it('draws the plan, its root node and its rooms, with no board in sight', () => {
    render(<GridPanel {...hostProps(workspace({ [FACE_KEY]: 'plan' }).storage)} />);

    expect(screen.getByTestId('auracle-grid-home')).toBeTruthy();
    expect(screen.getByTestId('grid-root')).toBeTruthy();
    expect(screen.getByTestId('grid-stage')).toBeTruthy();
    expect(screen.getByTestId('grid-home-room-backtest')).toBeTruthy();
    expect(screen.queryByTestId('auracle-grid-board')).toBeNull();
    expect(screen.queryByTestId('board-ghosts')).toBeNull();
  });

  it('still routes into a room from the plan', async () => {
    render(<GridPanel {...hostProps(workspace({ [FACE_KEY]: 'plan' }).storage)} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('grid-home-room-backtest'));
    });

    expect(getActiveRoom()).toBe('backtest');
  });

  it('takes the board off screen entirely rather than hiding it', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);
    expect(screen.getByTestId('board-stage')).toBeTruthy();

    fireEvent.click(screen.getByTestId('grid-face-plan'));

    // Unmounted, not display:none — the face that is not showing must not be
    // holding subscriptions, timers or a canvas of its own.
    expect(screen.queryByTestId('board-stage')).toBeNull();
    expect(screen.getByTestId('grid-stage')).toBeTruthy();
  });
});
