/**
 * Reading the plan without opening anything: the hover peek and the district
 * fold. Both exist to keep the Grid a plan rather than a menu, so what is
 * pinned here is the behaviour that would quietly ruin that:
 *
 *  - the peek waits, then says what the CARD says (same reading, same room) plus
 *    what the room is for — and it never lingers, never takes the pointer, and
 *    never appears where there is no hover to begin with;
 *  - a folded district collapses to a count that still reports its worst room,
 *    so a fault can never hide behind a fold;
 *  - the fold lives in a store, so a second reader (the wire overlay) is told,
 *    and a trip into a room and back does not silently re-open the plan.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const stub = vi.hoisted(() => ({ feeds: {} as Record<string, unknown> }));

vi.mock('../../engine/client', () => ({
  getJson: vi.fn(async (path: string) => {
    for (const [prefix, body] of Object.entries(stub.feeds)) {
      if (path.startsWith(prefix)) return body;
    }
    return null;
  }),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import { GridSheet } from '../grid/GridSheet';
import { PEEK_DELAY_MS } from '../grid/RoomPeek';
import { gridFoldStore } from '../grid/gridFoldStore';
import { ROOM_CONTEXT } from '../grid/roomContext';
import { openGridHome, openRoom } from '../grid/gridNav';
import { alertStore } from '../../engine/alertStore';
import { gridVitals } from '../../engine/gridVitals';

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

/**
 * Move the pointer onto (and off) a card. React synthesises `onMouseEnter` /
 * `onMouseLeave` from the native over/out pair, so both are dispatched — a
 * lone `mouseEnter` reaches no React handler.
 */
function pointerOnto(el: HTMLElement): void {
  fireEvent.mouseOver(el);
  fireEvent.mouseEnter(el);
}

function pointerOff(el: HTMLElement): void {
  fireEvent.mouseOut(el);
  fireEvent.mouseLeave(el);
}

/** Advance the clock inside act, flushing the peek's own async positioning. */
async function wait(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** Rest the pointer on a card for the peek's full delay. */
async function rest(el: HTMLElement): Promise<void> {
  pointerOnto(el);
  await wait(PEEK_DELAY_MS);
}

beforeEach(() => {
  stub.feeds = {};
  gridVitals.reset();
  gridFoldStore.reset();
  vi.useFakeTimers();
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  openGridHome();
  gridFoldStore.reset();
  stub.feeds = {};
  // Drop the module-level readings so the next test starts from quiet.
  await alertStore.refresh();
  gridVitals.reset();
});

describe('the hover peek', () => {
  it('lifts after the delay, carrying the room reading and what the room is for', async () => {
    stub.feeds['/deployments'] = [deployment(1, 'running'), deployment(2, 'running')];
    render(<GridSheet />);
    await settle();

    const card = screen.getByTestId('grid-home-room-deploys');
    pointerOnto(card);
    // A pointer merely crossing the plan must not flash cards at anyone.
    await wait(PEEK_DELAY_MS - 40);
    expect(screen.queryByTestId('grid-room-peek')).toBeNull();

    await wait(40);
    const peek = screen.getByTestId('grid-room-peek');
    expect(peek.getAttribute('data-room')).toBe('deploys');
    expect(screen.getByTestId('grid-room-peek-title').textContent).toBe('Deployments');
    // The same reading the card underneath is drawn from, not a second one.
    expect(screen.getByTestId('grid-room-peek-note').textContent).toBe('2 running of 2');
    expect(screen.getByTestId('grid-room-peek-health').textContent).toBe('nominal');
    expect(screen.getByTestId('grid-room-peek-context').textContent).toBe(ROOM_CONTEXT.deploys);
  });

  it('never takes the pointer, and clears the moment it leaves', async () => {
    render(<GridSheet />);
    await settle();

    const card = screen.getByTestId('grid-home-room-conns');
    await rest(card);
    expect(screen.getByTestId('grid-room-peek').style.pointerEvents).toBe('none');

    pointerOff(card);
    await wait(0);
    expect(screen.queryByTestId('grid-room-peek')).toBeNull();

    // And a pointer that leaves before the delay is up never raises one.
    pointerOnto(card);
    await wait(PEEK_DELAY_MS - 40);
    pointerOff(card);
    await wait(PEEK_DELAY_MS);
    expect(screen.queryByTestId('grid-room-peek')).toBeNull();
  });

  it('says nothing it cannot back when the room source has not answered', async () => {
    render(<GridSheet />);
    await settle(); // every feed absent, so this room reads quiet

    await rest(screen.getByTestId('grid-home-room-deploys'));

    expect(screen.getByTestId('grid-room-peek')).toBeTruthy();
    expect(screen.queryByTestId('grid-room-peek-note')).toBeNull();
    expect(screen.getByTestId('grid-room-peek-context').textContent).toBe(ROOM_CONTEXT.deploys);
  });

  it('does not appear under a coarse pointer', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('coarse'),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList
    );
    try {
      render(<GridSheet />);
      await settle();

      await rest(screen.getByTestId('grid-home-room-blotter'));
      expect(screen.queryByTestId('grid-room-peek')).toBeNull();
    } finally {
      matchMedia.mockRestore();
    }
  });

  it('clears when a room opens under it', async () => {
    render(<GridSheet />);
    await settle();

    await rest(screen.getByTestId('grid-home-room-runway'));
    expect(screen.getByTestId('grid-room-peek')).toBeTruthy();

    await act(async () => {
      openRoom('runway');
    });
    expect(screen.queryByTestId('grid-room-peek')).toBeNull();
  });

  it('clears when the district folds under it', async () => {
    render(<GridSheet />);
    await settle();

    await rest(screen.getByTestId('grid-home-room-schedules'));
    expect(screen.getByTestId('grid-room-peek')).toBeTruthy();

    // The card it points at is about to leave the DOM, which fires no
    // mouseleave of its own — without this the peek would be stranded.
    fireEvent.click(screen.getByTestId('grid-district-fold-operate'));
    await wait(0);
    expect(screen.queryByTestId('grid-room-peek')).toBeNull();
  });
});

describe('folding a district', () => {
  it('collapses its rooms into a count chip, and says so', async () => {
    render(<GridSheet />);
    await settle();

    const toggle = screen.getByTestId('grid-district-fold-operate');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('grid-home-room-deploys')).toBeTruthy();
    expect(screen.queryByTestId('grid-district-count-operate')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const chip = screen.getByTestId('grid-district-count-operate');
    expect(chip.textContent).toContain('4 rooms');
    for (const room of ['deploys', 'blotter', 'incidents', 'schedules']) {
      expect(screen.queryByTestId(`grid-home-room-${room}`)).toBeNull();
    }
    // The districts nobody folded are untouched.
    expect(screen.getByTestId('grid-home-room-findings')).toBeTruthy();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('grid-district-count-operate')).toBeNull();
    expect(screen.getByTestId('grid-home-room-deploys')).toBeTruthy();
  });

  it('keeps reporting the worst room it contains while folded', async () => {
    stub.feeds['/deployments'] = [deployment(1, 'errored')];
    render(<GridSheet />);
    await settle();

    fireEvent.click(screen.getByTestId('grid-district-fold-operate'));

    expect(screen.getByTestId('grid-district-count-operate').getAttribute('data-health')).toBe(
      'fault'
    );
    expect(screen.getByTestId('grid-district-countdot-operate').getAttribute('data-health')).toBe(
      'fault'
    );
    // The flag on the label is still up: a fold hides rooms, never trouble.
    expect(screen.getByTestId('grid-district-flag-operate')).toBeTruthy();
  });

  it('survives a trip into a room and back', async () => {
    const view = render(<GridSheet />);
    await settle();
    fireEvent.click(screen.getByTestId('grid-district-fold-research'));
    expect(screen.queryByTestId('grid-home-room-findings')).toBeNull();

    // The router swaps the plan out for the room page, and back again.
    await act(async () => {
      openRoom('findings');
    });
    view.unmount();
    await act(async () => {
      openGridHome();
    });
    render(<GridSheet />);

    expect(screen.getByTestId('grid-district-fold-research').getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(screen.getByTestId('grid-district-count-research').textContent).toContain('2 rooms');
    expect(screen.queryByTestId('grid-home-room-findings')).toBeNull();
  });
});

describe('the fold store', () => {
  it('tells its subscribers about a real change, and stays quiet on a no-op', () => {
    const listener = vi.fn();
    const unsubscribe = gridFoldStore.subscribe(listener);

    gridFoldStore.set('operate', true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(gridFoldStore.isFolded('operate')).toBe(true);
    expect(gridFoldStore.getSnapshot().has('operate')).toBe(true);

    // Folding what is already folded redraws nothing.
    gridFoldStore.set('operate', true);
    expect(listener).toHaveBeenCalledTimes(1);

    gridFoldStore.toggle('operate');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(gridFoldStore.isFolded('operate')).toBe(false);

    unsubscribe();
    gridFoldStore.set('research', true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('hands out a reference that only changes when the folds do', () => {
    const before = gridFoldStore.getSnapshot();
    expect(gridFoldStore.getSnapshot()).toBe(before);

    gridFoldStore.set('system', true);
    const after = gridFoldStore.getSnapshot();
    expect(after).not.toBe(before);
    expect(gridFoldStore.getSnapshot()).toBe(after);
  });
});
