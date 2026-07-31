/**
 * The panel's opening view — the resting state, and what remains of the faces.
 *
 * The redesign makes the opening view a CONTRACT rather than a preference:
 * the panel opens on one line of status and the standing watches, every time,
 * for every workspace. Four claims are pinned here, because each is a promise
 * to a person rather than an implementation detail:
 *
 *  - the panel opens on the resting state — a fresh workspace, a workspace
 *    that once chose a face, a host with no storage at all: home, always;
 *  - no on-screen control offers a face any more — the segmented toggle is
 *    gone, and nothing renders in its place;
 *  - the legacy faces are still REACHABLE, by keyboard only: the shortcut
 *    cycles home, Board, Plan, home. The cycle is construction scaffolding
 *    while the faces' replacements are built, and it is deleted with them;
 *  - from inside a room the same key comes HOME first, so the key is never
 *    dead where a room happens to be showing.
 *
 * WHAT THIS FILE CANNOT SEE: jsdom has no layout engine and no container
 * queries, so tiers and fit are asserted in a real browser — nothing below
 * claims a pixel.
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
import { FACE_KEY, getFace, resetFaceStore } from '../grid/gridFaceStore';
import { getActiveRoom, openGridHome, openRoom } from '../grid/gridNav';
import { closePalette } from '../grid/gridCommands';
import { gridVitals } from '../../engine/gridVitals';

/** A workspace store shaped like the host's. */
function workspace(seed?: Record<string, unknown>): {
  storage: ExtensionStorage;
  written: Record<string, unknown>;
} {
  const written: Record<string, unknown> = { ...seed };
  return {
    written,
    storage: {
      get: <T,>(key: string): T | undefined => written[key] as T | undefined,
      set: async <T,>(key: string, value: T): Promise<void> => {
        written[key] = value;
      },
      delete: async (): Promise<void> => {},
    } as unknown as ExtensionStorage,
  };
}

function hostProps(storage?: ExtensionStorage): PanelHostProps {
  return { host: { panelId: 'grid', extensionId: 'pack', storage } } as unknown as PanelHostProps;
}

function panel(): HTMLElement {
  return screen.getByTestId('auracle-grid');
}

/** Cycle the view the way a person does: focused panel, one press. */
function pressCycle(): void {
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

describe('the panel opens on the resting state', () => {
  it('greets a fresh workspace with home: status, no canvas, no plan', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);

    expect(panel().getAttribute('data-face')).toBe('home');
    expect(screen.getByTestId('grid-resting')).toBeTruthy();
    expect(screen.getByTestId('resting-status')).toBeTruthy();
    expect(screen.queryByTestId('auracle-grid-board')).toBeNull();
    expect(screen.queryByTestId('board-ghosts')).toBeNull();
    expect(screen.queryByTestId('auracle-grid-home')).toBeNull();
  });

  it('opens on home even where a face was remembered from before', () => {
    // The opening view is a contract, not a preference: a workspace that once
    // chose the Board still opens on the resting state.
    render(<GridPanel {...hostProps(workspace({ [FACE_KEY]: 'board' }).storage)} />);

    expect(panel().getAttribute('data-face')).toBe('home');
    expect(screen.getByTestId('grid-resting')).toBeTruthy();
  });

  it('opens on home where the host offers no storage at all', () => {
    render(<GridPanel {...hostProps(undefined)} />);

    expect(panel().getAttribute('data-face')).toBe('home');
  });

  it('renders no face control anywhere', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);

    expect(screen.queryByTestId('grid-face-toggle')).toBeNull();
    expect(screen.queryByTestId('grid-face-board')).toBeNull();
    expect(screen.queryByTestId('grid-face-plan')).toBeNull();
    expect(screen.queryByTestId('grid-face-hint')).toBeNull();
  });
});

describe('the keyboard cycle is the scaffolding entry to the legacy faces', () => {
  it('ignores the press until focus is inside the panel', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);

    // Focus is on nothing: the press was meant for whatever the person is
    // actually looking at.
    fireEvent.keyDown(window, { key: 'b', metaKey: true });

    expect(panel().getAttribute('data-face')).toBe('home');
  });

  it('cycles home, Board, Plan, home', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);

    expect(getFace()).toBe('home');
    pressCycle();
    expect(panel().getAttribute('data-face')).toBe('board');
    expect(screen.getByTestId('auracle-grid-board')).toBeTruthy();
    pressCycle();
    expect(panel().getAttribute('data-face')).toBe('plan');
    expect(screen.getByTestId('auracle-grid-home')).toBeTruthy();
    pressCycle();
    expect(panel().getAttribute('data-face')).toBe('home');
    expect(screen.getByTestId('grid-resting')).toBeTruthy();
  });

  it('is not a bare B, and not a combination carrying extra modifiers', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);
    act(() => panel().focus());

    fireEvent.keyDown(window, { key: 'b' });
    fireEvent.keyDown(window, { key: 'b', metaKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'b', metaKey: true, altKey: true });

    expect(panel().getAttribute('data-face')).toBe('home');
  });

  it('leaves the palette combination alone', () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);
    act(() => panel().focus());

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(screen.getByTestId('grid-palette')).toBeTruthy();
    expect(panel().getAttribute('data-face')).toBe('home');
  });

  it('comes home first from inside a room', async () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);
    await act(async () => {
      openRoom('backtest');
    });
    expect(getActiveRoom()).toBe('backtest');

    pressCycle();

    expect(getActiveRoom()).toBeNull();
    expect(panel().getAttribute('data-face')).toBe('home');
    expect(screen.getByTestId('grid-resting')).toBeTruthy();
  });

  it('still cycles when the workspace store refuses to answer', () => {
    const angry = {
      get: () => {
        throw new Error('no backend');
      },
      set: async () => {
        throw new Error('no backend');
      },
    } as unknown as ExtensionStorage;
    render(<GridPanel {...hostProps(angry)} />);

    expect(panel().getAttribute('data-face')).toBe('home');
    expect(() => pressCycle()).not.toThrow();
    expect(panel().getAttribute('data-face')).toBe('board');
  });

  it('stops listening once the panel is gone', () => {
    const { unmount } = render(<GridPanel {...hostProps(workspace().storage)} />);
    act(() => panel().focus());
    unmount();

    fireEvent.keyDown(window, { key: 'b', metaKey: true });

    expect(getFace()).toBe('home');
  });
});

describe('deep links still land where they point', () => {
  it('a room selected before mount renders that room, not home', async () => {
    await act(async () => {
      openRoom('backtest');
    });
    render(<GridPanel {...hostProps(workspace().storage)} />);

    expect(screen.queryByTestId('grid-resting')).toBeNull();
    expect(panel().getAttribute('data-room')).toBe('backtest');
  });

  it('coming home from a room lands on the resting state', async () => {
    render(<GridPanel {...hostProps(workspace().storage)} />);
    await act(async () => {
      openRoom('backtest');
    });
    await act(async () => {
      openGridHome();
    });

    expect(screen.getByTestId('grid-resting')).toBeTruthy();
  });
});
