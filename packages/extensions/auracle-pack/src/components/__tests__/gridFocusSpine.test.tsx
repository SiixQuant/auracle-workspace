/**
 * The Grid on the focus spine: what a room open does to focus, and what the AI
 * chat is told about the page.
 *
 * The consolidation put eleven surfaces behind one router, which is exactly the
 * arrangement in which an identity gets lost: a room reached by its retired id
 * lands blank while the same room reached from the plan lands on the run you
 * were reading, and nobody can tell why. These tests pin the identity to the
 * navigation instead — every way in publishes the same focus, a jump along a
 * wire carries it, a round trip through the plan keeps it, and the frame never
 * gets between a mounted panel and the store it already writes to.
 *
 * The AI lane is asserted both ways round. A host that has it must receive the
 * page descriptor; a host that predates it must be a silent no-op, because an
 * older IDE is the case where a missing feature detection shows up as a crash
 * rather than as a degraded panel.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../engine/client', () => ({
  authState: vi.fn(async () => ({ signedIn: true })),
  engineConfig: vi.fn(async () => ({ engineUrl: '', hasKey: false })),
  getJson: vi.fn(async () => null),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  runBacktest: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  backtestJobStatus: vi.fn(async () => null),
  backtestJobResult: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  backtestJobFactors: vi.fn(async () => null),
  resolveRunSource: vi.fn(() => undefined),
  connectCheck: vi.fn(async () => null),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import { panels } from '../../index';
import { alertStore } from '../../engine/alertStore';
import { backtestJobResult, getJson, getJsonDetailed } from '../../engine/client';
import { backtestStore } from '../../engine/backtestStore';
import { focusStore, type Focus } from '../../engine/focusStore';
import { gridVitals } from '../../engine/gridVitals';
import { focusForOpen, roomAiContext, useRoomAiContext } from '../grid/gridFocus';
import { listCommands } from '../grid/gridCommands';
import { PACK_PREFIX, getActiveRoom, openGridHome, openRoomFocused } from '../grid/gridNav';
import type { PanelHostLike } from '../aiPanel';

/** The one strategy the engine discovers in these fixtures. */
const STRATEGY = { path: 'strategies.alpha.AlphaOne', doc: 'A workspace strategy' };
/** Its workspace file, by the engine's own module→file convention. */
const STRATEGY_FILE = 'strategies/alpha.py';

const A_STRATEGY: Focus = {
  strategy: { filePath: STRATEGY_FILE, dottedPath: STRATEGY.path },
};
const A_DEPLOYMENT: Focus = { run: { kind: 'deployment', id: 'dep-7' } };

async function defaultGetJson(path: string): Promise<unknown> {
  if (path.startsWith('/deployments')) return [];
  if (path.startsWith('/ui/api/incidents')) return { incidents: [] };
  if (path.startsWith('/ui/api/backtest/strategies')) return { strategies: [STRATEGY] };
  return null;
}

async function defaultGetJsonDetailed(path: string): Promise<unknown> {
  if (path.startsWith('/ui/api/backtest/strategies')) {
    return { ok: true, status: 200, body: { strategies: [STRATEGY], excluded: [] } };
  }
  return { ok: false, status: 0, body: null };
}

/** A host with the AI lane, and the spies behind it. */
function hostWithLane(): {
  host: PanelHostLike;
  setContext: ReturnType<typeof vi.fn>;
  clearContext: ReturnType<typeof vi.fn>;
} {
  const setContext = vi.fn();
  const clearContext = vi.fn();
  return { host: { ai: { setContext, clearContext } }, setContext, clearContext };
}

function renderGrid(host: PanelHostLike) {
  const Grid = panels.grid.component;
  return render(<Grid host={host as never} />);
}

beforeEach(() => {
  vi.mocked(getJson).mockImplementation(defaultGetJson as never);
  vi.mocked(getJsonDetailed).mockImplementation(defaultGetJsonDetailed as never);
  gridVitals.reset();
  focusStore.clear();
  backtestStore.reset();
});

afterEach(async () => {
  cleanup();
  openGridHome();
  focusStore.clear();
  backtestStore.reset();
  vi.restoreAllMocks();
  vi.mocked(getJson).mockImplementation(defaultGetJson as never);
  await alertStore.refresh();
  gridVitals.reset();
});

/* ── the transition rule ────────────────────────────────────────────────── */

describe('a room open settles the focus it lands on', () => {
  it('writes the hinted object, and leaves what the hint does not name', () => {
    focusStore.publish(A_STRATEGY);
    openRoomFocused('backtest', { run: { kind: 'backtest', id: '42' } });

    expect(getActiveRoom()).toBe('backtest');
    // The run is now focused AND the strategy it belongs to survived: half an
    // identity would leave the chat unable to say what the run was of.
    expect(focusStore.getSnapshot()).toEqual({
      strategy: A_STRATEGY.strategy,
      run: { kind: 'backtest', id: '42' },
    });
  });

  it('carries the whole focus when the caller has no hint', () => {
    focusStore.publish(A_DEPLOYMENT);
    openRoomFocused('incidents');

    expect(getActiveRoom()).toBe('incidents');
    expect(focusStore.getSnapshot()).toEqual(A_DEPLOYMENT);
  });

  it('focusForOpen is the merge, and an absent hint is the identity', () => {
    focusStore.publish({ ...A_STRATEGY, ...A_DEPLOYMENT });
    expect(focusForOpen()).toEqual({ ...A_STRATEGY, ...A_DEPLOYMENT });
    expect(focusForOpen({ run: { kind: 'validation', id: STRATEGY.path } })).toEqual({
      strategy: A_STRATEGY.strategy,
      run: { kind: 'validation', id: STRATEGY.path },
    });
  });

  it('does not notify subscribers for a jump that changes nothing', () => {
    focusStore.publish(A_DEPLOYMENT);
    const listener = vi.fn();
    const unsubscribe = focusStore.subscribe(listener);
    openRoomFocused('blotter');
    openRoomFocused('incidents');
    unsubscribe();

    expect(listener).not.toHaveBeenCalled();
  });
});

/* ── wired-to jumps ─────────────────────────────────────────────────────── */

describe('a jump along a wire keeps the object in focus', () => {
  it('deploys to incidents keeps the deployment', async () => {
    focusStore.publish(A_DEPLOYMENT);
    const { host, setContext } = hostWithLane();
    openRoomFocused('deploys');
    renderGrid(host);

    fireEvent.click(screen.getByTestId('room-wired-incidents'));

    expect(screen.getByTestId('grid-room-incidents')).toBeTruthy();
    expect(focusStore.getSnapshot()).toEqual(A_DEPLOYMENT);
    // And the chat is told it moved, still holding the same deployment.
    expect(setContext).toHaveBeenCalledWith({
      panel: 'grid',
      room: 'incidents',
      room_title: 'Incidents',
      run: { kind: 'deployment', id: 'dep-7' },
    });
  });

  it('findings to strategies keeps the drafted strategy file, and the page says so', async () => {
    // What the research surface publishes when a draft lands.
    focusStore.publish(A_STRATEGY);
    const { host } = hostWithLane();
    openRoomFocused('findings');
    renderGrid(host);

    fireEvent.click(screen.getByTestId('room-wired-strategies'));

    expect(focusStore.getSnapshot()).toEqual(A_STRATEGY);
    // The page reads the focus it landed with rather than merely holding it.
    const row = await screen.findByTestId(`strategy-row-${STRATEGY.path}`);
    expect(row.textContent).toContain('Focused');
  });
});

/* ── deep links ─────────────────────────────────────────────────────────── */

describe('a room opened from outside the panel lands focused', () => {
  it('a retired panel id keeps the focus the caller arrived with', () => {
    focusStore.publish(A_DEPLOYMENT);
    window.dispatchEvent(
      new CustomEvent('nimbalyst:toggle-panel', {
        detail: { panelId: `${PACK_PREFIX}live-algorithms` },
      })
    );

    expect(getActiveRoom()).toBe('deploys');
    expect(focusStore.getSnapshot()).toEqual(A_DEPLOYMENT);
  });

  it('a palette command lands on the same focus as any other entry', () => {
    focusStore.publish(A_STRATEGY);
    const command = listCommands({ vitals: gridVitals.getSnapshot() }).find(
      (c) => c.id === 'room-validation'
    );
    command?.run();

    expect(getActiveRoom()).toBe('validation');
    expect(focusStore.getSnapshot()).toEqual(A_STRATEGY);
  });

  it('a hinted deep link mounts the page already showing that run', async () => {
    vi.mocked(backtestJobResult).mockImplementation(
      (async () => ({ ok: true, status: 200, body: { stats: {}, n_bars: 0 } })) as never
    );
    const { host } = hostWithLane();

    // Nothing focused, nothing loaded: the hint is the only thing that can put
    // this run on screen.
    openRoomFocused('backtest', { run: { kind: 'backtest', id: '42' } });
    renderGrid(host);

    await waitFor(() => expect(vi.mocked(backtestJobResult)).toHaveBeenCalledWith(42));
  });
});

/* ── round trip through the plan ────────────────────────────────────────── */

describe('focus survives a sheet-page round trip', () => {
  it('page to plan and back shows the same focused object', async () => {
    focusStore.publish(A_STRATEGY);
    const { host } = hostWithLane();
    openRoomFocused('strategies');
    renderGrid(host);

    expect((await screen.findByTestId(`strategy-row-${STRATEGY.path}`)).textContent).toContain(
      'Focused'
    );

    fireEvent.click(screen.getByTestId('grid-back'));
    expect(screen.getByTestId('auracle-grid-home')).toBeTruthy();
    // Stepping out to the plan is not a decision to stop looking at something.
    expect(focusStore.getSnapshot()).toEqual(A_STRATEGY);

    fireEvent.click(screen.getByTestId('grid-home-room-strategies'));
    expect((await screen.findByTestId(`strategy-row-${STRATEGY.path}`)).textContent).toContain(
      'Focused'
    );
  });

  it('a panel write from inside a room still reaches the store', async () => {
    const { host } = hostWithLane();
    openRoomFocused('strategies');
    renderGrid(host);

    const row = await screen.findByTestId(`strategy-row-${STRATEGY.path}`);
    fireEvent.click(control(row, 'Open'));

    // The frame sits around the page; it must not sit between the page and the
    // spine it already publishes to.
    expect(focusStore.getSnapshot()).toEqual(A_STRATEGY);
  });
});

/** The one control in `row` whose text is `label`. */
function control(row: HTMLElement, label: string): HTMLElement {
  const match = Array.from(row.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label
  );
  if (!match) throw new Error(`no ${label} control in the row`);
  return match;
}

/* ── the page descriptor on the AI lane ─────────────────────────────────── */

function Probe({
  host,
  room,
  title,
}: {
  host: PanelHostLike | undefined;
  room: Parameters<typeof useRoomAiContext>[1];
  title: string | null;
}): null {
  useRoomAiContext(host, room, title);
  return null;
}

describe('the page context reaches the AI chat', () => {
  it('publishes room, title and the focused object on open', () => {
    focusStore.publish({ ...A_STRATEGY, run: { kind: 'backtest', id: '42' } });
    const { host, setContext } = hostWithLane();

    render(<Probe host={host} room="backtest" title="Backtest" />);

    expect(setContext).toHaveBeenCalledTimes(1);
    expect(setContext).toHaveBeenCalledWith({
      panel: 'grid',
      room: 'backtest',
      room_title: 'Backtest',
      strategy: { file_path: STRATEGY_FILE, dotted_path: STRATEGY.path },
      run: { kind: 'backtest', id: '42' },
    });
  });

  it('never touches a host that predates the AI lane', () => {
    const { setContext, clearContext } = hostWithLane();

    render(<Probe host={{}} room="incidents" title="Incidents" />);
    render(<Probe host={undefined} room="incidents" title="Incidents" />);

    expect(setContext).not.toHaveBeenCalled();
    expect(clearContext).not.toHaveBeenCalled();
  });

  it('says nothing on the home plan rather than claiming a page', () => {
    const { host, setContext, clearContext } = hostWithLane();
    render(<Probe host={host} room={null} title={null} />);

    expect(setContext).not.toHaveBeenCalled();
    expect(clearContext).not.toHaveBeenCalled();
  });

  it('states the room even when nothing is focused', () => {
    expect(roomAiContext('conns', 'Connections', {})).toEqual({
      panel: 'grid',
      room: 'conns',
      room_title: 'Connections',
    });
  });

  it('reaches the lane through the real router, once per room open', async () => {
    focusStore.publish(A_DEPLOYMENT);
    const { host, setContext } = hostWithLane();
    openRoomFocused('blotter');
    renderGrid(host);

    const descriptor = {
      panel: 'grid',
      room: 'blotter',
      room_title: 'Blotter',
      run: { kind: 'deployment', id: 'dep-7' },
    };
    expect(setContext).toHaveBeenCalledWith(descriptor);
    expect(setContext.mock.calls.filter(([c]) => c && (c as { room?: string }).room === 'blotter'))
      .toHaveLength(1);
  });
});
