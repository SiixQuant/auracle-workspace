/**
 * The sheet's wires and its pinned alert.
 *
 * Two things are worth pinning, and they are different kinds of claim:
 *
 *  - the ROUTING is a pure function of measured boxes, so it is asserted
 *    directly — the lane a wire runs in, the tap offsets that keep verticals
 *    from colliding, the corner it refuses to round when there is no room, and
 *    the right angles every line (the annotation's leader included) is made of;
 *  - what is DRAWN is a separate claim from what is routed: a quiet edge is
 *    withheld until somebody rests on a wired card or on the chip, and an edge
 *    that is warning or failing is never withheld at all;
 *  - the LIVE reading is the whole point of the overlay, so the fault edge, the
 *    travelling pulse and the annotation are driven through the real
 *    `gridVitals` store off a stubbed deployments feed, never by handing the
 *    component a fault directly. If the sheet's red dot and the red wire could
 *    ever disagree, that is the test that catches it. The fold is driven the
 *    same way, through `gridFoldStore`.
 *
 * Geometry comes from a stubbed `getBoundingClientRect`: jsdom lays nothing
 * out, so the tree tier is described here explicitly — one room rank, a plan
 * wide enough to clear the tier gate, and a chip pinned top-right.
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
import { getActiveRoom, openGridHome } from '../grid/gridNav';
import { gridFoldStore } from '../grid/gridFoldStore';
import {
  LANES,
  TREE_MIN_WIDTH,
  WIRE_DEFS,
  layoutWires,
  leaderPath,
  orthoPath,
  sheetAlert,
  wireVisible,
  type RoomBox,
} from '../grid/gridWires';
import { ROOM_IDS, type RoomId } from '../grid/rooms';
import { alertStore } from '../../engine/alertStore';
import type { BacktestSnapshot } from '../../engine/backtestStore';
import type { Deployment } from '../../engine/live';
import { deriveRooms, erroredNames, gridVitals, type VitalSources } from '../../engine/gridVitals';
import { deploymentsBlock, summaryBody } from '../../engine/__tests__/summaryFixture';

/* ── a tree-tier layout, described because jsdom lays nothing out ───── */

const ROOM_W = 120;
const ROOM_GAP = 6;
const RANK_TOP = 300;
const RANK_BOTTOM = 360;
const PLAN_H = 520;
const WIDE = TREE_MIN_WIDTH + 120;
/** Narrower than the tier gate — the stacked sheet, where nothing is drawn. */
const NARROW = TREE_MIN_WIDTH - 380;

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Rooms sit in one rank, in registry order. `shift` stands in for a
 *  rearrangement the plan's own box does not reveal — a folded district. */
function roomLeft(id: RoomId, shift = 0): number {
  return 20 + shift + ROOM_IDS.indexOf(id) * (ROOM_W + ROOM_GAP);
}

/** Where the routing believes a card's centre is, given the layout above. */
function boxFor(id: RoomId): RoomBox {
  return { cx: roomLeft(id) + ROOM_W / 2, top: RANK_TOP, bottom: RANK_BOTTOM };
}

let restoreRects: (() => void) | null = null;

function installLayout(planWidth: number, shift = 0): void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function measured(this: Element): DOMRect {
    const el = this as HTMLElement;
    if (el.classList?.contains('agrid__plan')) return rect(0, 0, planWidth, PLAN_H);
    if (el.classList?.contains('agrid__annot')) return rect(planWidth - 220, 16, 200, 24);
    const room = el.getAttribute?.('data-room');
    if (room && el.classList?.contains('agrid__room') && ROOM_IDS.includes(room as RoomId)) {
      return rect(roomLeft(room as RoomId, shift), RANK_TOP, ROOM_W, RANK_BOTTOM - RANK_TOP);
    }
    return rect(0, 0, 0, 0);
  };
  restoreRects = () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

/** A deployment row as the engine serves it. */
function deployment(id: number, state: string): Deployment {
  return {
    id,
    name: `gap_fade_r${id}`,
    strategy_path: `strategies.s${id}.S`,
    broker: 'paper',
    mode: 'paper',
    state,
    positions: [],
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await gridVitals.refresh();
  });
}

function wireElements(): HTMLElement[] {
  return screen.queryAllByTestId('grid-wire');
}

function wiresOfKind(kind: string): HTMLElement[] {
  return wireElements().filter((el) => el.getAttribute('data-kind') === kind);
}

/** The edges actually being drawn — the quiet ones are rendered but withheld. */
function drawnWires(): HTMLElement[] {
  return wireElements().filter((el) => el.getAttribute('data-visible') === 'true');
}

/** Rest the pointer on an element. React synthesises enter/leave from the
 *  native over/out pair, so both are dispatched. */
function pointerOnto(el: HTMLElement): void {
  fireEvent.mouseOver(el);
  fireEvent.mouseEnter(el);
}

function pointerOff(el: HTMLElement): void {
  fireEvent.mouseOut(el);
  fireEvent.mouseLeave(el);
}

beforeEach(() => {
  stub.feeds = {};
  gridVitals.reset();
  gridFoldStore.reset();
  installLayout(WIDE);
});

afterEach(async () => {
  cleanup();
  restoreRects?.();
  restoreRects = null;
  openGridHome();
  gridFoldStore.reset();
  stub.feeds = {};
  await alertStore.refresh();
  gridVitals.reset();
});

/* ── routing (pure) ─────────────────────────────────────────────────── */

/** Every "x y" pair in a path, in order. */
function points(d: string): Array<[number, number]> {
  return [...d.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map(
    (m) => [Number(m[1]), Number(m[2])] as [number, number]
  );
}

/**
 * Whether a path is drawn entirely of horizontal and vertical runs. Every
 * consecutive pair of points — the quadratic corners' control points included —
 * has to share an x or a y; a diagonal shares neither.
 */
function isOrthogonal(d: string): boolean {
  const pts = points(d);
  return pts.every((point, i) => i === 0 || point[0] === pts[i - 1][0] || point[1] === pts[i - 1][1]);
}

const ALL_BOXES: Partial<Record<RoomId, RoomBox>> = Object.fromEntries(
  ROOM_IDS.map((id) => [id, boxFor(id)])
);

/** Vitals with every room quiet — the routing's baseline. */
function quietVitals() {
  return deriveRooms(sources());
}

const IDLE_RUN: BacktestSnapshot = {
  file: null,
  strategyPath: null,
  cls: null,
  phase: 'idle',
  options: [],
  excluded: [],
  jobId: null,
  detail: null,
  outdated: false,
  result: null,
  origin: 'live',
  validation: { phase: 'idle' },
};

function sources(patch: Partial<VitalSources> = {}): VitalSources {
  return {
    summary: null,
    errored: null,
    qc: null,
    strategies: null,
    orders: null,
    connections: null,
    run: IDLE_RUN,
    ...patch,
  } as VitalSources;
}

/** The readings an engine reporting `rows` produces: the consolidated counts
 *  plus the names behind whichever of them are errored. */
function deployed(rows: Deployment[], patch: Parameters<typeof summaryBody>[0] = {}): Partial<VitalSources> {
  return {
    summary: summaryBody({ deployments: deploymentsBlock(rows), ...patch }),
    errored: erroredNames(rows),
  };
}

/** The same deployments, served over the wire the store actually reads. */
function serveDeployments(rows: Deployment[]): void {
  stub.feeds['/ui/api/summary'] = summaryBody({ deployments: deploymentsBlock(rows) });
  stub.feeds['/deployments'] = rows;
}

describe('the routing keeps its lanes', () => {
  it('runs every edge in its declared lane, below the room rank', () => {
    const { wires } = layoutWires(ALL_BOXES, quietVitals());
    expect(wires).toHaveLength(WIRE_DEFS.length);

    for (const def of WIRE_DEFS) {
      const wire = wires.find((w) => w.key === `${def.from}-${def.to}`);
      expect(wire).toBeTruthy();
      const ys = points(wire!.d).map(([, y]) => y);
      // The lane hangs below the LOWEST card, never through the rank.
      expect(Math.max(...ys)).toBe(RANK_BOTTOM + LANES[def.lane]);
      expect(Math.max(...ys)).toBeGreaterThan(RANK_BOTTOM);
    }
  });

  it('taps each endpoint at its own offset, so verticals never collide', () => {
    const { wires } = layoutWires(ALL_BOXES, quietVitals());
    for (const def of WIRE_DEFS) {
      const wire = wires.find((w) => w.key === `${def.from}-${def.to}`)!;
      const pts = points(wire.d);
      expect(pts[0]).toEqual([boxFor(def.from).cx + def.fromOffset, RANK_BOTTOM + 2]);
      expect(pts[pts.length - 1]).toEqual([boxFor(def.to).cx + def.toOffset, RANK_BOTTOM + 3]);
    }

    // Two edges leaving the same room leave from two different columns.
    const outOfDeploys = WIRE_DEFS.filter((d) => d.from === 'deploys').map((d) => d.fromOffset);
    expect(new Set(outOfDeploys).size).toBe(outOfDeploys.length);
  });

  it('rounds its corners, and drops the radius when there is no room to turn', () => {
    // A normal turn is drawn with quadratic corners.
    expect(orthoPath(0, 0, 200, 0, 40)).toContain('Q');
    // Endpoints a pixel apart cannot hold a 6px corner — a straight run is
    // honest where a rounded one would bulge past both taps.
    expect(orthoPath(100, 0, 101, 0, 40)).toBe('M 100 0 L 101 0');
  });

  it('draws only right angles, whichever side of the lane the target is on', () => {
    // Both ends above the lane — the wires' own shape.
    expect(isOrthogonal(orthoPath(0, 0, 200, 10, 90))).toBe(true);
    // The target BELOW the lane — the leader's shape, and the one the old
    // single-direction routing could only draw as a straight diagonal.
    const down = orthoPath(600, 40, 200, 300, 280);
    expect(isOrthogonal(down)).toBe(true);
    expect(down).toContain('Q');
    // It leaves the lane going down, not back up the way it came.
    const ys = points(down).map(([, y]) => y);
    expect(ys[ys.length - 1]).toBe(300);
    expect(Math.max(...ys)).toBe(300);
  });

  it('routes nothing for a room the plan did not lay out', () => {
    const partial = { ...ALL_BOXES };
    delete partial.blotter;
    const { wires } = layoutWires(partial, quietVitals());
    expect(wires.map((w) => w.key)).not.toContain('deploys-blotter');
    expect(wires).toHaveLength(WIRE_DEFS.length - 1);
  });
});

describe('the alert leader keeps to the lanes', () => {
  /** The pinned chip's lower-left, top-right of a tree-tier plan. */
  const CHIP = { x: WIDE - 208, y: 42 };

  it('turns at right angles rather than cutting across the sheet', () => {
    // The whole point of the rewrite: the old leader was one long diagonal
    // from the chip to the card, and on a real pane it was the loudest line
    // on the plan.
    const room = boxFor('deploys');
    const d = leaderPath(CHIP, room);
    expect(isOrthogonal(d)).toBe(true);
    expect(d).toContain('Q');
  });

  it('leaves the chip and lands on the card it names, from above', () => {
    const room = boxFor('deploys');
    const pts = points(leaderPath(CHIP, room));
    expect(pts[0]).toEqual([CHIP.x, CHIP.y]);

    const [x, y] = pts[pts.length - 1];
    // Right of the card's centre, clear of the title it would otherwise cross.
    expect(x).toBeGreaterThan(room.cx);
    // Stopping ON the top edge, having come down to it — never through the card.
    expect(y).toBeLessThan(room.top);
    expect(y).toBeGreaterThan(CHIP.y);
    expect(Math.max(...pts.map(([, py]) => py))).toBe(y);
  });

  it('says nothing when either end has no box to point at', () => {
    expect(leaderPath(null, boxFor('deploys'))).toBe('');
    expect(leaderPath(CHIP, null)).toBe('');
  });
});

describe('a quiet wire is not drawn until it is asked for', () => {
  it('withholds the nominal edges and never the rest', () => {
    expect(wireVisible('norm', false)).toBe(false);
    expect(wireVisible('norm', true)).toBe(true);
    for (const kind of ['warn', 'err'] as const) {
      expect(wireVisible(kind, false)).toBe(true);
      expect(wireVisible(kind, true)).toBe(true);
    }
  });
});

describe('an edge speaks as loudly as the room it watches', () => {
  it('ambers the certification edge when validation is degraded', () => {
    const degraded = deriveRooms(
      sources({
        run: {
          ...IDLE_RUN,
          validation: { phase: 'error', detail: 'the engine could not measure this strategy' },
        },
      })
    );
    expect(degraded.validation.health).toBe('degraded');

    const { wires, faultPath } = layoutWires(ALL_BOXES, degraded);
    const edge = wires.find((w) => w.key === 'backtest-validation')!;
    expect(edge.kind).toBe('warn');
    // Amber is not an alarm: no pulse rides a degraded edge.
    expect(faultPath).toBe('');
    // And nothing else changed colour.
    expect(wires.filter((w) => w.kind !== 'norm')).toHaveLength(1);
  });

  it('leaves every unwatched edge quiet whatever the readings say', () => {
    const faulted = deriveRooms(
      sources({ ...deployed([deployment(1, 'errored')]), summary: summaryBody({ deployments: deploymentsBlock([deployment(1, 'errored')]), open_alerts: 4 }) })
    );
    const { wires } = layoutWires(ALL_BOXES, faulted);
    for (const wire of wires) {
      if (wire.key === 'deploys-incidents') continue;
      expect(wire.kind).toBe('norm');
    }
  });
});

describe('the alert line quotes the reading', () => {
  it('names the errored deployment, and counts them', () => {
    const one = deriveRooms(sources(deployed([deployment(7, 'errored')])));
    expect(sheetAlert(one)).toEqual({
      active: true,
      text: '1 alert — gap_fade_r7 → Deployments',
      room: 'deploys',
      roomTitle: 'Deployments',
    });

    const several = deriveRooms(
      sources(deployed([deployment(7, 'errored'), deployment(8, 'errored')]))
    );
    expect(sheetAlert(several).text).toBe('2 alerts — gap_fade_r7 and 1 more → Deployments');
  });

  it('goes quiet, not green-by-assumption, when nothing has answered', () => {
    expect(sheetAlert(quietVitals())).toEqual({
      active: false,
      text: 'no open alerts',
      room: null,
      roomTitle: null,
    });
  });

  it('points at the first faulted room in plan order, not only deployments', () => {
    // Open incidents fault their room while every deployment runs clean: the
    // chip must not read green while the sheet shows a red dot.
    const vitals = deriveRooms(
      sources(deployed([deployment(7, 'running')], { open_alerts: 3 }))
    );
    const alert = sheetAlert(vitals);
    expect(alert.active).toBe(true);
    expect(alert.room).toBe('incidents');
    expect(alert.roomTitle).toBe('Incidents');
    expect(alert.text).toContain('Incidents needs attention');
  });
});

/* ── the overlay on the sheet ───────────────────────────────────────── */

describe('the overlay draws on the full tree only', () => {
  it('renders all eight wires when the plan is wide enough', () => {
    render(<GridSheet />);

    expect(screen.getByTestId('grid-wires')).toBeTruthy();
    const wires = wireElements();
    expect(wires).toHaveLength(8);
    expect(wires.map((el) => el.getAttribute('data-edge'))).toEqual([
      'findings-strategies',
      'strategies-backtest',
      'backtest-validation',
      'validation-deploys',
      'deploys-blotter',
      'qc-backtest',
      'deploys-incidents',
      'schedules-deploys',
    ]);
    // Quiet by default: no reading has landed, so nothing is claimed.
    expect(wiresOfKind('norm')).toHaveLength(8);
    for (const wire of wires) {
      expect(wire.getAttribute('marker-end')).toBe('url(#agrid-arrow-norm)');
    }
    // Routed, but not drawn: eight quiet edges say nothing worth eight lines.
    expect(drawnWires()).toHaveLength(0);
  });

  it('draws nothing below the tier the tree needs', () => {
    restoreRects?.();
    installLayout(NARROW);
    render(<GridSheet />);

    expect(screen.queryByTestId('grid-wires')).toBeNull();
    expect(wireElements()).toHaveLength(0);
    // The room cards themselves are untouched — the stacked tiers still carry
    // every reading on the dot, the flag and the root count.
    expect(screen.getByTestId('grid-home-room-deploys')).toBeTruthy();
  });

  it('drops the edges of a folded district, and brings them back', async () => {
    render(<GridSheet />);
    expect(wireElements()).toHaveLength(8);

    // Folding Research takes its two cards out of the DOM. The two edges that
    // touched them have nothing left to point at, and every other edge stands.
    await act(async () => {
      gridFoldStore.set('research', true);
    });

    const edges = wireElements().map((el) => el.getAttribute('data-edge'));
    expect(edges).not.toContain('findings-strategies');
    expect(edges).not.toContain('qc-backtest');
    expect(edges).toContain('strategies-backtest');
    expect(edges).toHaveLength(6);

    await act(async () => {
      gridFoldStore.set('research', false);
    });
    expect(wireElements()).toHaveLength(8);
  });

  it('re-measures against where a fold left the cards', async () => {
    render(<GridSheet />);
    const before = screen.getAllByTestId('grid-wire')[0].getAttribute('d');

    // A fold slides the rank sideways while leaving the plan's own box the
    // same size — the case a ResizeObserver on the plan cannot see.
    restoreRects?.();
    installLayout(WIDE, -60);
    await act(async () => {
      gridFoldStore.set('system', true);
    });

    expect(screen.getAllByTestId('grid-wire')[0].getAttribute('d')).not.toBe(before);
    // District 04 owns no wired room, so nothing dropped out.
    expect(wireElements()).toHaveLength(8);
  });
});

describe('the flow is revealed on request, and put away again', () => {
  it('draws the whole flow while a wired room is rested on', () => {
    render(<GridSheet />);
    expect(drawnWires()).toHaveLength(0);

    const card = screen.getByTestId('grid-home-room-deploys');
    expect(card.getAttribute('data-wired')).toBe('true');
    pointerOnto(card);
    expect(drawnWires()).toHaveLength(8);

    pointerOff(card);
    expect(drawnWires()).toHaveLength(0);
  });

  it('stays quiet for a room no edge touches', () => {
    render(<GridSheet />);
    const card = screen.getByTestId('grid-home-room-runway');
    expect(card.getAttribute('data-wired')).toBe('false');

    pointerOnto(card);
    expect(drawnWires()).toHaveLength(0);
  });

  it('reveals from the pinned chip too, since the chip points into the flow', async () => {
    serveDeployments([deployment(1, 'errored')]);
    render(<GridSheet />);
    await settle();
    expect(drawnWires()).toHaveLength(1);

    const chip = screen.getByTestId('grid-alert');
    pointerOnto(chip);
    expect(drawnWires()).toHaveLength(8);

    pointerOff(chip);
    expect(drawnWires()).toHaveLength(1);
  });

  it('keeps a resting room card openable', () => {
    render(<GridSheet />);
    const card = screen.getByTestId('grid-home-room-backtest');
    pointerOnto(card);
    fireEvent.click(card);
    expect(getActiveRoom()).toBe('backtest');
  });
});

describe('the sheet raises the alarm the readings raise', () => {
  it('reddens the incident edge, pulses it, and pins an annotation', async () => {
    serveDeployments([deployment(1, 'running'), deployment(2, 'errored')]);
    render(<GridSheet />);
    await settle();

    // Same source as the sheet's own dot — they cannot disagree.
    expect(screen.getByTestId('grid-home-dot-deploys').getAttribute('data-health')).toBe('fault');

    const red = wiresOfKind('err');
    expect(red).toHaveLength(1);
    expect(red[0].getAttribute('data-edge')).toBe('deploys-incidents');
    expect(red[0].getAttribute('marker-end')).toBe('url(#agrid-arrow-err)');
    expect(screen.getByTestId('grid-wire-pulse')).toBeTruthy();
    // At rest, with one fault, the sheet draws exactly one wire — the red one.
    expect(drawnWires().map((el) => el.getAttribute('data-edge'))).toEqual(['deploys-incidents']);

    const chip = screen.getByTestId('grid-alert');
    expect(chip.getAttribute('data-state')).toBe('alert');
    expect(chip.textContent).toContain('1 alert');
    expect(chip.textContent).toContain('gap_fade_r2');
    expect(chip.textContent).toContain('Deployments');
    // The leader points at the room the chip names, and does it in right
    // angles — an annotation of the schematic, not a scratch across it.
    const leader = screen.getByTestId('grid-alert-leader');
    expect(isOrthogonal(leader.getAttribute('d') ?? '')).toBe(true);
  });

  it('puts the alarm away the moment the deployment recovers', async () => {
    serveDeployments([deployment(1, 'errored')]);
    render(<GridSheet />);
    await settle();
    expect(wiresOfKind('err')).toHaveLength(1);

    serveDeployments([deployment(1, 'running')]);
    await settle();

    expect(wiresOfKind('err')).toHaveLength(0);
    expect(wiresOfKind('norm')).toHaveLength(8);
    // A recovered sheet draws nothing at all: no fault, no leader, no lines.
    expect(drawnWires()).toHaveLength(0);
    expect(screen.queryByTestId('grid-wire-pulse')).toBeNull();
    expect(screen.queryByTestId('grid-alert-leader')).toBeNull();
    const chip = screen.getByTestId('grid-alert');
    expect(chip.getAttribute('data-state')).toBe('clear');
    expect(chip.textContent).toContain('no open alerts');
  });

  it('opens the deployments room when the annotation is pressed', async () => {
    serveDeployments([deployment(1, 'errored')]);
    render(<GridSheet />);
    await settle();

    fireEvent.click(screen.getByTestId('grid-alert'));
    expect(getActiveRoom()).toBe('deploys');
  });

  it('cannot be pressed while there is nothing to open', async () => {
    render(<GridSheet />);
    await settle();

    const chip = screen.getByTestId('grid-alert') as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    fireEvent.click(chip);
    expect(getActiveRoom()).toBeNull();
  });
});

describe('a reduced-motion session gets no pulse', () => {
  it('keeps the red edge and drops the travelling dot', async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    try {
      serveDeployments([deployment(1, 'errored')]);
      render(<GridSheet />);
      await settle();

      // The alarm still reads — only the motion is withheld.
      expect(wiresOfKind('err')).toHaveLength(1);
      expect(screen.getByTestId('grid-alert').getAttribute('data-state')).toBe('alert');
      expect(screen.queryByTestId('grid-wire-pulse')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });
});
