/**
 * The command post: the root node, the shortcut, and the palette they open.
 *
 * What is worth pinning here is that the palette is a KEYBOARD surface owned by
 * one panel, so each test states a promise a person would notice breaking:
 *
 *  - the shortcut belongs to the Grid and only to the Grid, so a Cmd+K meant
 *    for another surface never opens this one;
 *  - any room is reachable by typing and pressing Enter, which is the issue's
 *    own acceptance line;
 *  - Escape corrects before it leaves, and leaving hands focus back;
 *  - commands come from PROVIDERS, so the AI actions that land later need no
 *    change here to appear;
 *  - a faulted room is the row already under the cursor.
 *
 * The engine client is mocked at its seam, so the one fault asserted below is
 * one the fixture actually served.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const stub = vi.hoisted(() => ({ feeds: {} as Record<string, unknown> }));

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getJson: vi.fn(async (path: string) => {
    for (const [prefix, body] of Object.entries(stub.feeds)) {
      if (path.startsWith(prefix)) return body;
    }
    return null;
  }),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
}));

import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { GridPanel } from '../grid/GridPanel';
import { closePalette, registerCommandProvider } from '../grid/gridCommands';
import { getActiveRoom, openGridHome } from '../grid/gridNav';
import { ROOMS, ROOM_IDS } from '../grid/rooms';
import { alertStore } from '../../engine/alertStore';
import { gridVitals } from '../../engine/gridVitals';
import { deploymentsBlock, summaryBody } from '../../engine/__tests__/summaryFixture';

/** The Grid uses its host props only to hand them to a room page; the plan and
 *  the palette need none of them. */
const HOST_PROPS = {} as PanelHostProps;

function renderGrid(): void {
  render(<GridPanel {...HOST_PROPS} />);
}

function panel(): HTMLElement {
  return screen.getByTestId('auracle-grid');
}

/** Press the shortcut. Dispatched on the window, which is where the panel's
 *  guard listens, and where the host's own shortcut layer listens too. */
function pressShortcut(): void {
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
}

function input(): HTMLInputElement {
  return screen.getByTestId('grid-palette-input') as HTMLInputElement;
}

function type(value: string): void {
  fireEvent.change(input(), { target: { value } });
}

/** The rows on offer, in the order the palette drew them. */
function rowIds(): string[] {
  return screen
    .getAllByRole('option')
    .map((row) => row.getAttribute('data-testid') ?? '')
    .map((id) => id.replace('grid-palette-item-', ''));
}

/** A deployment row shaped as the engine serves it. */
function deployment(id: number, state: string): Record<string, unknown> {
  return {
    id,
    name: `strategy-${id}`,
    strategy_path: `strategies.s${id}.S`,
    broker: 'paper',
    mode: 'paper',
    state,
    positions: [],
  };
}

/** Let every pending read land, inside act, so React sees one settled frame. */
async function settle(): Promise<void> {
  await act(async () => {
    await gridVitals.refresh();
  });
}

/** Open the palette the only way there is now: the panel focused, Cmd+K. The
 *  plan's command-post node is gone with the plan; the shortcut is the door. */
function openFromRoot(): void {
  act(() => panel().focus());
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
}

beforeEach(() => {
  // The panel opens on the resting state; the palette is summoned over it.
  stub.feeds = {};
  gridVitals.reset();
});

afterEach(async () => {
  cleanup();
  closePalette();
  openGridHome();
  stub.feeds = {};
  await alertStore.refresh();
  gridVitals.reset();
});

/** The engine's consolidated call, describing `rows`, plus the naming read the
 *  sheet follows it with when one of them is errored. */
function serveDeployments(rows: Array<Record<string, unknown>>): void {
  stub.feeds['/ui/api/summary'] = summaryBody({
    deployments: deploymentsBlock(rows as Array<{ state: string }>),
  });
  stub.feeds['/deployments'] = rows;
}

describe('the shortcut belongs to the focused panel', () => {
  it('ignores the shortcut until focus is inside the Grid, then toggles', () => {
    renderGrid();

    // Focus is on nothing: this press was meant for whatever the person is
    // actually looking at, not for a Grid sitting in the background.
    pressShortcut();
    expect(screen.queryByTestId('grid-palette')).toBeNull();

    act(() => panel().focus());
    pressShortcut();
    expect(screen.getByTestId('grid-palette')).toBeTruthy();

    pressShortcut();
    expect(screen.queryByTestId('grid-palette')).toBeNull();
  });

  it('takes the combination off a later global listener, but only while focused', () => {
    const globalShortcut = vi.fn();
    renderGrid();
    // Registered after the panel's own, the way the host shell's global
    // shortcut layer re-registers when a fullscreen panel becomes active.
    window.addEventListener('keydown', globalShortcut, { capture: true });

    try {
      // Nothing focused: the press is not the Grid's to take.
      pressShortcut();
      expect(globalShortcut).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('grid-palette')).toBeNull();

      globalShortcut.mockClear();
      act(() => panel().focus());
      pressShortcut();

      expect(globalShortcut).not.toHaveBeenCalled();
      expect(screen.getByTestId('grid-palette')).toBeTruthy();
    } finally {
      window.removeEventListener('keydown', globalShortcut, { capture: true });
    }
  });

  it('stops listening once the panel is gone', () => {
    renderGrid();
    act(() => panel().focus());
    cleanup();

    pressShortcut();
    expect(screen.queryByTestId('grid-palette')).toBeNull();
  });
});

describe('the root node is the way in', () => {
  it('opens the palette and puts the caret in the field', () => {
    renderGrid();
    expect(screen.queryByTestId('grid-palette')).toBeNull();

    openFromRoot();

    expect(screen.getByTestId('grid-palette')).toBeTruthy();
    expect(document.activeElement).toBe(input());
    expect(panel().getAttribute('data-palette')).toBe('open');
  });

  it('offers every room as a command', () => {
    renderGrid();
    openFromRoot();

    expect(rowIds()).toHaveLength(12);
    expect(screen.getByTestId('grid-palette-item-room-backtest').textContent).toContain(
      'Open Backtest'
    );
  });
});

describe('typing narrows, Enter routes', () => {
  it('keeps only the rows that match what was typed', () => {
    renderGrid();
    openFromRoot();

    type('valid');

    expect(rowIds()).toEqual(['room-validation']);
    expect(screen.queryByTestId('grid-palette-item-room-backtest')).toBeNull();
  });

  it('says so, rather than nothing, when a query matches no command', () => {
    renderGrid();
    openFromRoot();

    type('zzzz');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByTestId('grid-palette-empty')).toBeTruthy();
  });

  it('opens the room the highlight is on and closes behind itself', () => {
    renderGrid();
    openFromRoot();

    type('valid');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(getActiveRoom()).toBe('validation');
    expect(screen.queryByTestId('grid-palette')).toBeNull();
  });

  // The issue's own acceptance line: EVERY room is reachable from the keyboard
  // alone. A title can narrow to more than one row (a room's blurb may name
  // another room's subject), so the walk to the target is part of the flow.
  it.each(ROOM_IDS)('reaches the %s room by typing its name', (id) => {
    renderGrid();
    openFromRoot();

    type(ROOMS[id].title);
    const target = rowIds().indexOf(`room-${id}`);
    expect(target).toBeGreaterThanOrEqual(0);
    for (let step = 0; step < target; step += 1) {
      fireEvent.keyDown(input(), { key: 'ArrowDown' });
    }
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(getActiveRoom()).toBe(id);
  });

  it('walks the highlight with the arrows and runs the row it lands on', () => {
    renderGrid();
    openFromRoot();

    const first = rowIds()[0];
    const second = rowIds()[1];
    expect(screen.getByTestId(`grid-palette-item-${first}`).getAttribute('aria-selected')).toBe(
      'true'
    );

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getByTestId(`grid-palette-item-${second}`).getAttribute('aria-selected')).toBe(
      'true'
    );

    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(screen.getByTestId(`grid-palette-item-${first}`).getAttribute('aria-selected')).toBe(
      'true'
    );

    // Tab has nowhere to go behind a modal, so it walks the list too.
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(screen.getByTestId(`grid-palette-item-${second}`).getAttribute('aria-selected')).toBe(
      'true'
    );
    fireEvent.keyDown(input(), { key: 'Tab', shiftKey: true });
    expect(screen.getByTestId(`grid-palette-item-${first}`).getAttribute('aria-selected')).toBe(
      'true'
    );

    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(getActiveRoom()).toBe(first.replace('room-', ''));
  });
});

describe('leaving the palette', () => {
  it('clears a typed query on the first Escape and closes on the second', () => {
    renderGrid();
    openFromRoot();

    type('back');
    expect(input().value).toBe('back');

    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().value).toBe('');
    expect(screen.getByTestId('grid-palette')).toBeTruthy();

    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByTestId('grid-palette')).toBeNull();
  });

  it('closes on a press outside it', () => {
    renderGrid();
    openFromRoot();

    fireEvent.mouseDown(screen.getByTestId('grid-palette'));

    expect(screen.queryByTestId('grid-palette')).toBeNull();
  });

  it('hands focus back to the panel', () => {
    renderGrid();
    openFromRoot();

    fireEvent.keyDown(input(), { key: 'Escape' });

    expect(screen.queryByTestId('grid-palette')).toBeNull();
    // The plan's root node is gone; the panel itself is the focus fallback,
    // so the keyboard is never left pointing at nothing.
    expect(document.activeElement).toBe(panel());
  });
});

describe('commands come from providers', () => {
  it('shows and runs a command a later surface registers', () => {
    const run = vi.fn();
    const dispose = registerCommandProvider({
      id: 'test-provider',
      list: () => [
        {
          id: 'test-fix',
          label: 'Fix the failing deployment',
          icon: 'auto_fix',
          keywords: ['repair'],
          section: 'Actions',
          run,
        },
      ],
    });

    try {
      renderGrid();
      openFromRoot();

      expect(screen.getByTestId('grid-palette-item-test-fix')).toBeTruthy();
      // Found by a word only the provider knows, so the filter is reading the
      // provider's own keywords rather than a hard-coded room table.
      type('repair');
      expect(rowIds()).toEqual(['test-fix']);

      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(run).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('grid-palette')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('drops a disposed provider from the list', () => {
    const dispose = registerCommandProvider({
      id: 'test-provider',
      list: () => [
        { id: 'test-gone', label: 'Temporary action', icon: 'bolt', section: 'Actions', run: () => {} },
      ],
    });
    dispose();

    renderGrid();
    openFromRoot();

    expect(screen.queryByTestId('grid-palette-item-test-gone')).toBeNull();
  });
});

describe('the palette reads the system state', () => {
  it('floats a faulted room to the top and marks it', async () => {
    serveDeployments([deployment(1, 'errored')]);
    renderGrid();
    await settle();

    openFromRoot();

    expect(rowIds()[0]).toBe('room-deploys');
    const dot = screen.getByTestId('grid-palette-dot-room-deploys');
    expect(dot.getAttribute('data-health')).toBe('fault');
    // A healthy room stays quiet: the dot marks trouble, not membership.
    expect(screen.queryByTestId('grid-palette-dot-room-schedules')).toBeNull();
  });

  it('leaves the rooms in plan order when nothing is wrong', async () => {
    renderGrid();
    await settle();

    openFromRoot();

    expect(rowIds()[0]).toBe('room-findings');
    expect(screen.queryAllByTestId(/grid-palette-dot-/)).toHaveLength(0);
  });
});
