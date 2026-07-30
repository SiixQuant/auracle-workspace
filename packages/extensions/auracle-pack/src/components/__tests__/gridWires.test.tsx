/**
 * The sheet's wires and its pinned alert.
 *
 * Two things are worth pinning, and they are different kinds of claim:
 *
 *  - the ROUTING is a pure function of measured boxes, so it is asserted
 *    directly, and what is asserted is the SCHEMATIC's own discipline: a trunk
 *    that stands in the gutter between two group columns and is decided by that
 *    gutter and the edge's flow alone (which is what makes two edges in a flow
 *    one line rather than two), every departure and arrival on its card's own
 *    centreline, no line drawn through any card it does not join, two bends a
 *    path, and the right angles every line (the annotation's leader included) is
 *    made of. Those properties are what stop eight revealed edges reading as a
 *    tangle, so they are held by test rather than by eye;
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
 * out, so the plan tier is described here explicitly — four group columns with
 * each district's rooms stacked down its own, a plan wide enough to clear the
 * tier gate, and a chip pinned top-right.
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
import { busPath } from '../grid/boardLayout';
import { DISTRICTS, ROOM_GROUP } from '../grid/districts';
import {
  FLOW_LANE,
  GROUP_GAP,
  LANES,
  TREE_MIN_WIDTH,
  WIRE_DEFS,
  layoutWires,
  leaderPath,
  sheetAlert,
  wireLane,
  wireVisible,
  type RoomBox,
  type WireFlow,
} from '../grid/gridWires';
import { ROOM_IDS, type RoomId } from '../grid/rooms';
import { alertStore } from '../../engine/alertStore';
import type { BacktestSnapshot } from '../../engine/backtestStore';
import type { Deployment } from '../../engine/live';
import { deriveRooms, erroredNames, gridVitals, type VitalSources } from '../../engine/gridVitals';
import { deploymentsBlock, summaryBody } from '../../engine/__tests__/summaryFixture';

/* ── a plan-tier layout, described because jsdom lays nothing out ───── */

const ROOM_W = 200;
const ROOM_H = 52;
/** Between two rooms stacked in one group's column. */
const ROOM_GAP = 16;
/** Between the trailing edge of one column's cards and the leading edge of the
 *  next's — the channel the trunks stand in. */
const COL_GAP = 62;
const PLAN_LEFT = 20;
const RANK_TOP = 200;
const PLAN_H = 620;
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

/** Which group column a room sits in and how far down it — the plan's own
 *  geography, read off the districts rather than restated here, so the fixture
 *  cannot describe a layout the sheet would never draw. */
function slotOf(id: RoomId): { group: number; row: number } {
  for (const [group, district] of DISTRICTS.entries()) {
    const row = district.rooms.indexOf(id);
    if (row >= 0) return { group, row };
  }
  throw new Error(`no district holds ${id}`);
}

/** Where the routing believes a card is, given the layout above. `shift` stands
 *  in for a rearrangement the plan's own box does not reveal — a folded
 *  district. */
function boxFor(id: RoomId, shift = 0): RoomBox {
  const { group, row } = slotOf(id);
  const left = PLAN_LEFT + shift + group * (ROOM_W + COL_GAP);
  const top = RANK_TOP + row * (ROOM_H + ROOM_GAP);
  return {
    left,
    right: left + ROOM_W,
    top,
    bottom: top + ROOM_H,
    cx: left + ROOM_W / 2,
    cy: top + ROOM_H / 2,
  };
}

/** The middle of the channel BETWEEN two neighbouring group columns — where a
 *  trunk with no lane offset of its own stands. Measured, so it is the midpoint
 *  of the ground the two columns actually leave. */
function crossGutter(left: number): number {
  return PLAN_LEFT + left * (ROOM_W + COL_GAP) + ROOM_W + COL_GAP / 2;
}

/** The channel BESIDE one column, which an edge that stays inside it steps out
 *  into. There is nothing on the far side to measure to, so it takes the
 *  gutter's own declared pitch off the column's trailing edge. */
function besideGutter(group: number): number {
  return PLAN_LEFT + group * (ROOM_W + COL_GAP) + ROOM_W + GROUP_GAP / 2;
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
      const box = boxFor(room as RoomId, shift);
      return rect(box.left, box.top, ROOM_W, ROOM_H);
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

/**
 * Every point a path passes through, in order, with the `H`/`V` shorthand
 * expanded back into whole coordinates. Written as a parse rather than a regex
 * over number pairs because a shorthand command carries ONE number: a pattern
 * looking for two would read the end of one leg and the start of the next as a
 * point that is on neither.
 */
function points(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const tokens = d.trim().split(/\s+/);
  let x = 0;
  let y = 0;
  for (let i = 0; i < tokens.length; ) {
    const command = tokens[i];
    i += 1;
    if (command === 'M' || command === 'L') {
      x = Number(tokens[i]);
      y = Number(tokens[i + 1]);
      i += 2;
    } else if (command === 'H') {
      x = Number(tokens[i]);
      i += 1;
    } else if (command === 'V') {
      y = Number(tokens[i]);
      i += 1;
    } else {
      continue;
    }
    out.push([x, y]);
  }
  return out;
}

/**
 * The axis of every segment in a path, with consecutive runs of the same axis
 * collapsed into one. Leave, run the trunk and arrive reads `['h', 'v', 'h']`.
 *
 * A segment sharing neither coordinate with the one before it is a DIAGONAL,
 * which this sheet does not have; it is reported rather than thrown away, so
 * both the shape assertions and the orthogonality one read the same parse.
 */
function axes(d: string): string[] {
  const pts = points(d);
  const out: string[] = [];
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    if (ax === bx && ay === by) continue;
    const axis = ax === bx ? 'v' : ay === by ? 'h' : 'diagonal';
    if (out[out.length - 1] !== axis) out.push(axis);
  }
  return out;
}

/** Turns per path. Leave–run–arrive is two; three is the most the sheet
 *  allows. */
function bends(d: string): number {
  return Math.max(0, axes(d).length - 1);
}

function isOrthogonal(d: string): boolean {
  return !axes(d).includes('diagonal');
}

/** The trunk a path rides: the x of its vertical run, and the y it travels FROM
 *  and TO along it — signed, so the direction of travel is readable. Null for a
 *  path with no trunk to ride, which is every edge whose two cards already line
 *  up on one line. */
function trunkOf(d: string): { x: number; from: number; to: number } | null {
  const pts = points(d);
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    if (ax === bx && ay !== by) return { x: ax, from: ay, to: by };
  }
  return null;
}

/** Every straight segment of a path, endpoint to endpoint. */
function segments(d: string): Array<[[number, number], [number, number]]> {
  const pts = points(d);
  const out: Array<[[number, number], [number, number]]> = [];
  for (let i = 1; i < pts.length; i += 1) {
    if (pts[i - 1][0] === pts[i][0] && pts[i - 1][1] === pts[i][1]) continue;
    out.push([pts[i - 1], pts[i]]);
  }
  return out;
}

/** Whether a segment passes through a box — the property that matters most on
 *  a plan of columns, where the ground above a card is another card. */
function cuts(segment: [[number, number], [number, number]], box: RoomBox): boolean {
  const [[ax, ay], [bx, by]] = segment;
  return (
    Math.min(ax, bx) < box.right &&
    Math.max(ax, bx) > box.left &&
    Math.min(ay, by) < box.bottom &&
    Math.max(ay, by) > box.top
  );
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

/**
 * Which edges belong to which flow, written out rather than derived, because
 * the point of the table is that it is a DECISION: an edge's lane comes from
 * what the edge means, and a reader who learned the picture yesterday gets the
 * same picture today. A move between flows has to be made here as well as in
 * the routing, deliberately.
 */
const FLOW_EDGES: Record<WireFlow, string[]> = {
  pipeline: [
    'findings-strategies',
    'strategies-backtest',
    'backtest-validation',
    'validation-deploys',
  ],
  execution: ['deploys-blotter', 'deploys-incidents'],
  supply: ['qc-backtest', 'schedules-deploys'],
};

/** Every edge routed against the full rank, with its declared lane beside it. */
function routed(): Array<{ key: string; lane: number; d: string }> {
  const { wires } = layoutWires(ALL_BOXES, quietVitals());
  return WIRE_DEFS.map((def) => {
    const key = `${def.from}-${def.to}`;
    const wire = wires.find((w) => w.key === key);
    expect(wire).toBeTruthy();
    return { key, lane: wireLane(def), d: wire!.d };
  });
}

describe('the routing is one trunk per gutter and flow, with runs off it', () => {
  it('takes its lane from the flow, never from the edge', () => {
    expect(FLOW_LANE).toEqual({ pipeline: 1, execution: 2, supply: 3 });

    const grouped: Record<string, string[]> = { pipeline: [], execution: [], supply: [] };
    for (const def of WIRE_DEFS) grouped[def.flow].push(`${def.from}-${def.to}`);
    expect(grouped).toEqual(FLOW_EDGES);

    for (const def of WIRE_DEFS) expect(wireLane(def)).toBe(FLOW_LANE[def.flow]);
  });

  it('stands every trunk in the gutter its edge crosses, at its flow lane', () => {
    for (const wire of routed()) {
      const [from, to] = wire.key.split('-') as [RoomId, RoomId];
      const groups = [ROOM_GROUP[from], ROOM_GROUP[to]];
      if (axes(wire.d).length === 1) {
        // No trunk to stand in: the two cards already share the line the work
        // travels along, so the edge is one straight segment — across to the
        // next group, or down the group's own column.
        expect(axes(wire.d)).toEqual([groups[0] === groups[1] ? 'v' : 'h']);
        continue;
      }
      const trunk = trunkOf(wire.d);
      expect(trunk).toBeTruthy();
      // The trunk is a function of the GUTTER and the FLOW, and of nothing
      // else. That is exactly what makes two edges of one flow crossing one
      // gutter collinear rather than parallel: neither edge can move the line
      // it rides, so neither can move off the other's.
      const channel =
        groups[0] === groups[1]
          ? besideGutter(groups[0])
          : crossGutter(Math.min(groups[0], groups[1]));
      expect({ edge: wire.key, x: trunk!.x }).toEqual({
        edge: wire.key,
        x: channel + LANES[wire.lane as keyof typeof LANES],
      });
    }
  });

  it('leaves and arrives on its own card centreline', () => {
    const { wires } = layoutWires(ALL_BOXES, quietVitals());
    expect(wires).toHaveLength(WIRE_DEFS.length);

    for (const def of WIRE_DEFS) {
      const wire = wires.find((w) => w.key === `${def.from}-${def.to}`)!;
      const pts = points(wire.d);
      const a = boxFor(def.from);
      const b = boxFor(def.to);
      const straightDownTheColumn =
        ROOM_GROUP[def.from] === ROOM_GROUP[def.to] && axes(wire.d).length === 1;
      // A run into or out of a card's SIDE sits on that card's vertical
      // centreline; a run straight down a column sits on the two cards' shared
      // horizontal one. Either way there is no per-edge nudge anywhere, which
      // is what lets two edges meeting at a card meet on one line.
      if (straightDownTheColumn) {
        expect(a.cx).toBe(b.cx);
        expect([pts[0][0], pts[pts.length - 1][0]]).toEqual([a.cx, a.cx]);
      } else {
        expect([pts[0][1], pts[pts.length - 1][1]]).toEqual([a.cy, b.cy]);
      }
    }
  });

  it('never draws a line through a card it does not join', () => {
    for (const wire of routed()) {
      const [from, to] = wire.key.split('-') as [RoomId, RoomId];
      for (const segment of segments(wire.d)) {
        for (const id of ROOM_IDS) {
          if (id === from || id === to) continue;
          expect({ edge: wire.key, id, through: cuts(segment, boxFor(id)) }).toEqual({
            edge: wire.key,
            id,
            through: false,
          });
        }
      }
    }
  });

  it('bends at most twice: leave, run the trunk, arrive', () => {
    for (const wire of routed()) {
      // Three shapes and no others: a straight run across to a card on the same
      // line, a straight run down a column, and the full leave-trunk-arrive.
      expect([['h'], ['v'], ['h', 'v', 'h']]).toContainEqual(axes(wire.d));
      expect(bends(wire.d)).toBeLessThanOrEqual(2);
      expect(isOrthogonal(wire.d)).toBe(true);
    }
  });

  it('leaves no two edges on a trunk arguing about direction', () => {
    const all = routed()
      .map((wire) => ({ ...wire, trunk: trunkOf(wire.d) }))
      .filter((wire) => wire.trunk !== null);

    for (const a of all) {
      for (const b of all) {
        if (a.key === b.key || a.trunk!.x !== b.trunk!.x) continue;
        const overlap =
          Math.min(Math.max(a.trunk!.from, a.trunk!.to), Math.max(b.trunk!.from, b.trunk!.to)) -
          Math.max(Math.min(a.trunk!.from, a.trunk!.to), Math.min(b.trunk!.from, b.trunk!.to));
        if (overlap <= 0) continue;
        // Two runs sharing a stretch of trunk travel the same way along it, so
        // the shared line is never ambiguous about which way the work goes.
        expect(Math.sign(a.trunk!.to - a.trunk!.from)).toBe(
          Math.sign(b.trunk!.to - b.trunk!.from)
        );
      }
    }
  });

  it('reads forwards along the pipeline: across to the next group, or down', () => {
    const byKey = new Map(routed().map((wire) => [wire.key, wire]));
    for (const key of FLOW_EDGES.pipeline) {
      const [from, to] = key.split('-') as [RoomId, RoomId];
      const pts = points(byKey.get(key)!.d);
      const [startX, startY] = pts[0];
      const [endX, endY] = pts[pts.length - 1];
      if (ROOM_GROUP[from] === ROOM_GROUP[to]) {
        // Down the group's own column, in the order the group lists its rooms.
        expect(endY).toBeGreaterThan(startY);
      } else {
        // On to the next group's column, left to right.
        expect(ROOM_GROUP[to]).toBeGreaterThan(ROOM_GROUP[from]);
        expect(endX).toBeGreaterThan(startX);
      }
    }
  });

  it('steps out of a column only when a card stands in the way', () => {
    // Two rooms next to each other in one group are joined by the shortest
    // honest line there is, which is also the one that makes the group's own
    // sequence obvious.
    expect(axes(routed().find((wire) => wire.key === 'strategies-backtest')!.d)).toEqual(['v']);

    // Two rooms in one group with a third between them cannot be: the wire
    // steps out into the channel beside the column and comes back in at the
    // target's trailing edge rather than being drawn through the card.
    const skipping = routed().find((wire) => wire.key === 'deploys-incidents')!;
    expect(axes(skipping.d)).toEqual(['h', 'v', 'h']);
    const pts = points(skipping.d);
    expect(pts[pts.length - 1][0]).toBeGreaterThan(boxFor('incidents').cx);
    expect(trunkOf(skipping.d)!.x).toBeGreaterThan(boxFor('blotter').right);
  });

  it('routes nothing for a room the plan did not lay out', () => {
    const partial = { ...ALL_BOXES };
    delete partial.blotter;
    const { wires } = layoutWires(partial, quietVitals());
    expect(wires.map((w) => w.key)).not.toContain('deploys-blotter');
    expect(wires).toHaveLength(WIRE_DEFS.length - 1);
  });
});

describe('the bus both faces are drawn with', () => {
  it('collapses to one segment when there is no turn to make', () => {
    // Straight across to a card on the same line: no hop, and no bends put on
    // a straight line.
    expect(busPath(0, 40, 200, 40, 90)).toBe('M 0 40 H 200');
    expect(bends(busPath(0, 40, 200, 40, 90))).toBe(0);
    // Straight along the trunk itself, which is what a run down one column is.
    expect(busPath(100, 0, 100, 50, 100)).toBe('M 100 0 V 50');
    expect(bends(busPath(100, 0, 100, 50, 100))).toBe(0);
  });

  it('draws only right angles, whichever side of the trunk each end is on', () => {
    // Forwards: out of a card, along the trunk, into the next column.
    const forward = busPath(0, 40, 200, 300, 90);
    expect(axes(forward)).toEqual(['h', 'v', 'h']);
    expect(isOrthogonal(forward)).toBe(true);
    expect(bends(forward)).toBe(2);
    // Out and BACK: an edge that stepped beside its own column, and the
    // leader's shape too. Both ends left of the trunk, and still no diagonal.
    const back = busPath(600, 40, 560, 300, 640);
    expect(axes(back)).toEqual(['h', 'v', 'h']);
    expect(isOrthogonal(back)).toBe(true);
    expect(Math.max(...points(back).map(([x]) => x))).toBe(640);
  });
});

describe('the alert leader keeps to the channels', () => {
  /** The pinned chip's lower-left, top-right of a plan-tier plan. */
  const CHIP = { x: WIDE - 208, y: 42 };
  /** The clear ground the plan's own right margin leaves. */
  const CHANNEL = WIDE - 9;

  it('turns at right angles rather than cutting across the sheet', () => {
    // The whole point of the rewrite: the old leader was one long diagonal
    // from the chip to the card, and on a real pane it was the loudest line
    // on the plan.
    const room = boxFor('deploys');
    const d = leaderPath(CHIP, room, CHANNEL);
    expect(isOrthogonal(d)).toBe(true);
    // The same leave-trunk-arrive the wires are made of: the annotation is
    // drawn in the schematic's own hand, and only its dash pattern sets it
    // apart.
    expect(axes(d)).toEqual(['h', 'v', 'h']);
    expect(bends(d)).toBeLessThanOrEqual(3);
  });

  it('leaves the chip and lands on the card it names, from the side', () => {
    const room = boxFor('deploys');
    const pts = points(leaderPath(CHIP, room, CHANNEL));
    expect(pts[0]).toEqual([CHIP.x, CHIP.y]);

    const [x, y] = pts[pts.length - 1];
    // On the card's trailing edge, at its own centreline. Not the top edge:
    // above a card in a column is the card above it, and a leader let down
    // through that would annotate a room it says nothing about.
    expect(x).toBeGreaterThan(room.right);
    expect(x).toBeLessThan(room.right + GROUP_GAP / 2);
    expect(y).toBe(room.cy);
  });

  it('comes down beside the named room rather than down the whole plan', () => {
    // Every room, wherever its group sits: the trunk stands clear of that
    // room's own column and of nothing further out, so the last leg is only as
    // long as the channel is wide and crosses no other column on the way.
    for (const id of ROOM_IDS) {
      const room = boxFor(id);
      const d = leaderPath(CHIP, room, CHANNEL);
      const trunk = trunkOf(d)!;
      expect({ id, clear: trunk.x > room.right }).toEqual({ id, clear: true });
      for (const other of ROOM_IDS) {
        if (other === id) continue;
        for (const segment of segments(d)) {
          expect({ id, other, through: cuts(segment, boxFor(other)) }).toEqual({
            id,
            other,
            through: false,
          });
        }
      }
    }
  });

  it('stays inside the plan when the room it names is in the last column', () => {
    // The channel caps the trunk, so the room furthest right is pointed at
    // from inside the plan's own margin rather than from off the edge of it.
    const trunk = trunkOf(leaderPath(CHIP, boxFor('runway'), CHANNEL))!;
    expect(trunk.x).toBeLessThanOrEqual(CHANNEL);
  });

  it('says nothing when either end has no box to point at', () => {
    expect(leaderPath(null, boxFor('deploys'), CHANNEL)).toBe('');
    expect(leaderPath(CHIP, null, CHANNEL)).toBe('');
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
    // Flow by flow, and within a flow in the direction the work travels.
    expect(wires.map((el) => el.getAttribute('data-edge'))).toEqual([
      ...FLOW_EDGES.pipeline,
      ...FLOW_EDGES.execution,
      ...FLOW_EDGES.supply,
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

  it('puts the flow away when a fold takes the card out from under the pointer', async () => {
    render(<GridSheet />);
    const card = screen.getByTestId('grid-home-room-deploys');
    pointerOnto(card);
    expect(drawnWires()).toHaveLength(8);

    // The card leaves the DOM without ever firing a mouseleave; without a
    // second way out the sheet would be left drawing every wire for good.
    await act(async () => {
      gridFoldStore.set('operate', true);
    });
    expect(screen.queryByTestId('grid-home-room-deploys')).toBeNull();
    expect(drawnWires()).toHaveLength(0);
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
