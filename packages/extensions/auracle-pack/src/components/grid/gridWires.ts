/**
 * The sheet's wiring, as geometry — how the rooms are joined on the plan.
 *
 * `wiring.ts` declares WHICH rooms feed which (the room page's chip row reads
 * it); this declares how the SHEET draws a subset of those edges: the flow a
 * person actually follows, routed as a schematic rather than a spider's web.
 * The two are separate because they answer different questions and change for
 * different reasons — a new hand-off adds a chip, not necessarily a wire.
 *
 * ## Trunk and gutter
 * Straight point-to-point lines between eleven cards read as noise — and so
 * does a channel full of near-parallel runs that all say the same thing. So the
 * routing is a BUS, the way a schematic is drawn, and it is the SAME bus the
 * Board is drawn with: {@link busPath} and {@link trunkBetween} come from
 * {@link ./boardLayout}, so neither face has a routing of its own to drift.
 *
 * The plan lays each district out as a COLUMN of rooms under its own header, so
 * the channels a trunk can run in are the GUTTERS between those columns:
 *
 *  - an edge crossing from one group to the next leaves its source card's
 *    trailing edge on that card's centreline, runs to the trunk standing in the
 *    gutter between the two columns, travels along it, and arrives at the
 *    target's leading edge. Two bends, no diagonal;
 *  - an edge between two rooms in the SAME column drops straight down (or
 *    climbs straight up) the shared centreline when nothing stands between
 *    them — the shortest honest line, and the one that makes a group's own
 *    sequence obvious. When a card is in the way it steps out into the channel
 *    beside the column instead, and comes back into the target's trailing edge:
 *    a wire is never drawn through a card;
 *  - each FLOW owns one LANE, and a lane is an offset across the gutter, so two
 *    flows crossing the same gutter stand beside each other rather than on top
 *    of each other. Two edges in ONE flow crossing one gutter share their trunk
 *    exactly — collinear rather than parallel;
 *  - every departure and every arrival sits on its own card's centreline. That
 *    single rule is what makes it impossible for a run to pass through a
 *    neighbouring card and for two edges in one lane to cross.
 *
 * The flows are the three the sheet has to tell apart: the strategy pipeline to
 * production, what a live deployment produces, and what supplies either from
 * outside it. So the lane an edge runs in is a property of what the edge MEANS,
 * not of the order the table happens to be written in — which is what keeps the
 * picture stable as edges are added. A new hand-off inside a known flow joins a
 * trunk that is already there; it does not add a line across the plan.
 *
 * Direction reads left to right along the pipeline, and the arrowhead is on the
 * ARRIVAL only. A trunk carries no arrows of its own, so two edges sharing one
 * can never be read as disagreeing about which way the work goes.
 *
 * This replaced a routing that hung every trunk in a horizontal lane BELOW one
 * flat rank of rooms. That was the right drawing while the rooms were a rank;
 * once each group became a column, a trunk under the whole plan meant every
 * wire took the long way round and a drop down a column ran through the cards
 * stacked in it. The gutters are where the room now is.
 *
 * EVERY line this module produces is orthogonal, the leader included. A
 * diagonal drawn across a schematic reads as a mistake in it, and one drawn the
 * width of the whole sheet reads as the loudest thing on it — which is why the
 * annotation's leader takes the same bus discipline as the wires instead of
 * cutting the plan in half.
 *
 * ## A dash means data
 * The sheet has two kinds of line and they must never be confused. STRUCTURE —
 * root to district to room — is a solid faint hairline drawn in CSS by the
 * cards themselves. DATA is what this module routes, and only data is dashed.
 * On top of that a quiet wire is not drawn at rest at all ({@link wireVisible}):
 * eight dashed lines that say nothing are eight lines in the way of the one
 * that does.
 *
 * ## Colour comes from the readings, never from here
 * An edge is quiet unless it WATCHES a room, and a watched edge takes that
 * room's health straight from `gridVitals` — the same table the dots, the
 * district flags and the room pages read. Nothing here decides that something
 * is broken; it only decides which line says so.
 */
import type { GridVitals, Health } from '../../engine/gridVitals';
import { busPath, trunkBetween } from './boardLayout';
import { ROOM_GROUP, firstFault } from './districts';
import { ROOMS, type RoomId } from './rooms';

/**
 * The container width, in px, at which the sheet switches to the FULL TREE and
 * the overlay becomes drawable. One constant, read by both the sheet's
 * `@container` rule and the overlay's own gate, so the CSS breakpoint and the
 * measured gate cannot drift apart.
 *
 * Below it the sheet stacks its districts into a column, the room rank the
 * lanes hang under does not exist, and the overlay draws NOTHING — the stacked
 * tiers say the same things through the room dot, the district flag and the
 * root node's count.
 *
 * The threshold is not "the width the tree needs to lay out" any more: the
 * plan lays out at its own fixed width and the canvas fit-scales it to the
 * stage, so the tree survives far below its natural size. What this gate
 * really buys is legibility — under it, a fitted tree would be too small to
 * read and the stacked list says more.
 */
export const TREE_MIN_WIDTH = 960;

/**
 * How wide the channel between two group columns is — the gutter every trunk
 * stands in. One constant, read by the sheet's `@container` rule and by the
 * routing, so the drawing and the geometry cannot drift: a gutter the CSS
 * narrowed would otherwise leave two lanes drawn on top of each other.
 *
 * Wide enough for the three lanes below to stand clear of one another and of
 * the cards on either side, narrow enough that four columns still read as one
 * plan rather than four plans.
 */
export const GROUP_GAP = 44;

/**
 * Lane offsets, in px, from the middle of the gutter a trunk runs in. Signed:
 * the flow a reader follows most stands nearest the column it leaves, and the
 * one that is only ever plumbing stands furthest.
 */
export const LANES = { 1: -12, 2: 0, 3: 12 } as const;

export type Lane = keyof typeof LANES;

/**
 * What an edge is ABOUT. Three answers, because the sheet only has three
 * stories to tell: a strategy's path to production, what a live deployment
 * produces, and what feeds either of those from outside it.
 */
export type WireFlow = 'pipeline' | 'execution' | 'supply';

/**
 * The lane each flow's trunk runs in — the whole of the lane assignment, in one
 * table nobody has to reason about per edge.
 *
 * Shallowest lane to the flow a reader follows most, deepest to the one that is
 * only ever plumbing. Because the mapping is by FLOW rather than by edge, an
 * edge cannot be given a lane by accident, two edges in a flow cannot end up in
 * different lanes, and the picture a reader learned yesterday is the picture
 * they get today.
 */
export const FLOW_LANE: Record<WireFlow, Lane> = {
  pipeline: 1,
  execution: 2,
  supply: 3,
};

/** How loudly a wire speaks: quiet, degraded, faulted. */
export type WireKind = 'norm' | 'warn' | 'err';

export interface WireDef {
  from: RoomId;
  to: RoomId;
  /** Which flow this edge belongs to — and so, which trunk it shares. */
  flow: WireFlow;
  /** The room whose reading colours this edge. Null = always quiet. */
  watch: RoomId | null;
}

/** Which lane an edge runs in. Never declared per edge — see {@link FLOW_LANE}. */
export function wireLane(def: WireDef): Lane {
  return FLOW_LANE[def.flow];
}

/**
 * The eight edges the sheet draws, grouped by the flow that gives each its
 * lane. Within a flow they are listed in the direction the work travels, which
 * is also left to right across the rank.
 */
export const WIRE_DEFS: readonly WireDef[] = [
  // PIPELINE — the path a strategy takes to production. Consecutive rooms in
  // rank order, so the whole flow is ONE unbroken trunk from the first card to
  // the last with a drop at each room along it. That single line is the thing a
  // reader is meant to find first, which is why nothing else is allowed to
  // share lane 1 and thicken a stretch of it.
  { from: 'findings', to: 'strategies', flow: 'pipeline', watch: null },
  { from: 'strategies', to: 'backtest', flow: 'pipeline', watch: null },
  // Amber the moment the certification room is degraded: this is the edge a
  // strategy has to cross to reach a deployment.
  { from: 'backtest', to: 'validation', flow: 'pipeline', watch: 'validation' },
  { from: 'validation', to: 'deploys', flow: 'pipeline', watch: null },
  // EXECUTION — what a deployment produces once it is live. Both edges leave
  // the same card, so they leave on the same drop and share the trunk out of
  // it: a fan-out drawn as a fan-out rather than as two lines saying it twice.
  { from: 'deploys', to: 'blotter', flow: 'execution', watch: null },
  // The one edge that turns red: a faulted deployment is what produces the
  // incident, so the wire between them carries the alarm. It takes its flow's
  // own trunk — an alarm is not a reason to leave the bus.
  { from: 'deploys', to: 'incidents', flow: 'execution', watch: 'deploys' },
  // SUPPLY — what feeds the two flows above from outside them: the library a
  // backtest draws its strategies from, and the scheduler that decides when a
  // deployment runs. The deepest lane, and the one a connections or runway
  // attachment lands in later without any further decision being needed.
  { from: 'qc', to: 'backtest', flow: 'supply', watch: null },
  { from: 'schedules', to: 'deploys', flow: 'supply', watch: null },
];

/** Every room an edge touches — the only cards the overlay has to measure. */
export const WIRED_ROOMS: readonly RoomId[] = [
  ...new Set(WIRE_DEFS.flatMap((def) => [def.from, def.to])),
];

/** A watched edge speaks exactly as loudly as the room it watches. */
const KIND_FOR_HEALTH: Record<Health, WireKind> = {
  nominal: 'norm',
  degraded: 'warn',
  fault: 'err',
};

export function wireKind(def: WireDef, vitals: GridVitals): WireKind {
  return def.watch === null ? 'norm' : KIND_FOR_HEALTH[vitals[def.watch].health];
}

/**
 * Whether an edge is drawn right now.
 *
 * A wire that is merely NOMINAL is not news — it is the plan's own plumbing,
 * true on every frame of every session — so at rest it is not drawn, and the
 * sheet is left with only the lines that are saying something. It comes back
 * the moment a person asks for the flow by resting on a wired card or on the
 * alert chip, and goes again when they leave: a reveal, not a mode, so there is
 * no state to get stuck in and no timer to fire after the pointer has gone.
 *
 * Anything ABOVE nominal is always drawn. A warning that only appeared on hover
 * would be a warning nobody saw.
 */
export function wireVisible(kind: WireKind, revealed: boolean): boolean {
  return kind !== 'norm' || revealed;
}

/**
 * A measured room card, in the sheet's own coordinate space.
 *
 * The whole box, not a centre and two edges: a bus running in a gutter departs
 * from a card's SIDE and arrives at another card's side, and deciding whether a
 * third card stands between two others in a column needs all four edges.
 */
export interface RoomBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Horizontal centre. */
  cx: number;
  /** Vertical centre — where a run into or out of a card's side sits. */
  cy: number;
}

export interface Wire {
  /** `from-to` — stable, and what `data-edge` carries. */
  key: string;
  /** The SVG path. */
  d: string;
  kind: WireKind;
}

/** Path numbers at one decimal — enough for a hairline, short enough to read. */
function px(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface WireLayout {
  wires: Wire[];
  /** The first faulted path, for the travelling pulse. Empty when nothing is. */
  faultPath: string;
}

/** How far clear of a card's border a run begins, and ends. The two differ so a
 *  pair of opposed edges between the same two cards cannot overdraw each other
 *  exactly — and so the arrowhead lands ON the border rather than under the line
 *  leaving it. */
const DEPART = 2;
const ARRIVE = 3;

/**
 * Whether a straight run between two cards in one column would pass through a
 * third. Measured, never assumed: a fold takes cards out of the plan, and a
 * gap that was blocked a moment ago is honestly clear now.
 */
function obstructed(
  a: RoomBox,
  b: RoomBox,
  boxes: Partial<Record<RoomId, RoomBox>>
): boolean {
  const from = Math.min(a.bottom, b.bottom);
  const to = Math.max(a.top, b.top);
  for (const other of Object.values(boxes)) {
    if (!other || other === a || other === b) continue;
    // Only what shares the column: a card off to the side is not in the way.
    if (other.right <= a.left || other.left >= a.right) continue;
    if (other.bottom > from && other.top < to) return true;
  }
  return false;
}

/** Every measured room of one group column — what a gutter beside it is
 *  measured from. */
function columnBoxes(
  group: number,
  boxes: Partial<Record<RoomId, RoomBox>>
): RoomBox[] {
  const out: RoomBox[] = [];
  for (const [id, box] of Object.entries(boxes)) {
    if (box && ROOM_GROUP[id] === group) out.push(box);
  }
  return out;
}

/**
 * Route every edge whose two rooms were measured.
 *
 * The trunks are computed FIRST, one per gutter, from every card on both sides
 * of it rather than from the two an edge happens to join — that is what makes
 * the sharing exact rather than approximate, and what keeps a trunk standing in
 * the channel instead of wherever one pair of cards left room. A lane is then a
 * fixed offset off that one line, so two flows crossing a gutter are two
 * parallel trunks and two edges in a flow are one.
 *
 * Departures and arrivals are card centrelines, untouched by anything per-edge:
 * two edges meeting at a card meet on one line.
 */
export function layoutWires(
  boxes: Partial<Record<RoomId, RoomBox>>,
  vitals: GridVitals
): WireLayout {
  const drawable = WIRE_DEFS.map((def) => ({
    def,
    a: boxes[def.from],
    b: boxes[def.to],
  })).filter((row): row is { def: WireDef; a: RoomBox; b: RoomBox } => !!row.a && !!row.b);

  // One gutter per pair of columns an edge crosses, plus one beside a column
  // whose own edges have to step out of it. Keyed by the columns rather than by
  // the edge, so every edge in a channel measures the same channel.
  const gutters = new Map<string, number>();
  for (const { def } of drawable) {
    const from = ROOM_GROUP[def.from];
    const to = ROOM_GROUP[def.to];
    const key = from === to ? `beside-${from}` : `${Math.min(from, to)}-${Math.max(from, to)}`;
    if (gutters.has(key)) continue;
    if (from === to) {
      // Beside the column: there is nothing on the far side to measure to, so
      // the gutter takes its own pitch off the column's trailing edge.
      gutters.set(
        key,
        trunkBetween(columnBoxes(from, boxes).map((box) => box.right), [], GROUP_GAP)
      );
      continue;
    }
    const [left, right] = from < to ? [from, to] : [to, from];
    gutters.set(
      key,
      trunkBetween(
        columnBoxes(left, boxes).map((box) => box.right),
        columnBoxes(right, boxes).map((box) => box.left),
        GROUP_GAP
      )
    );
  }

  const wires: Wire[] = [];
  let faultPath = '';
  for (const { def, a, b } of drawable) {
    const from = ROOM_GROUP[def.from];
    const to = ROOM_GROUP[def.to];
    const inside = from === to;
    const key = inside ? `beside-${from}` : `${Math.min(from, to)}-${Math.max(from, to)}`;
    const trunk = px((gutters.get(key) ?? a.right + GROUP_GAP / 2) + LANES[wireLane(def)]);

    let d: string;
    if (inside && !obstructed(a, b, boxes)) {
      // Straight down (or straight up) the shared centreline. `busPath` collapses
      // to the one segment when both ends already stand on the trunk.
      const down = b.top >= a.bottom;
      d = busPath(
        px(a.cx),
        px(down ? a.bottom + DEPART : a.top - DEPART),
        px(a.cx),
        px(down ? b.top - ARRIVE : b.bottom + ARRIVE),
        px(a.cx)
      );
    } else if (inside || b.left >= a.right) {
      // Out of the trailing edge, along the trunk, and in again: at the target's
      // LEADING edge when the work crosses to the next column, at its trailing
      // edge when the wire only stepped out of its own.
      d = busPath(
        px(a.right + DEPART),
        px(a.cy),
        px(inside ? b.right + ARRIVE : b.left - ARRIVE),
        px(b.cy),
        trunk
      );
    } else {
      // The work travels leftwards — the same shape, mirrored, so a table that
      // ever wires a room back to an earlier group still draws a bus.
      d = busPath(px(a.left - DEPART), px(a.cy), px(b.right + ARRIVE), px(b.cy), trunk);
    }

    wires.push({ key: `${def.from}-${def.to}`, d, kind: wireKind(def, vitals) });
    if (wires[wires.length - 1].kind === 'err' && faultPath === '') faultPath = d;
  }
  return { wires, faultPath };
}

/** A point in the sheet's coordinate space — where the leader starts. */
export interface Anchor {
  x: number;
  y: number;
}

/**
 * How wide a channel the leader is given down the plan's right edge — and so
 * how much clear ground the sheet's own padding has to leave beyond the last
 * column. Read by the sheet's CSS as well, for the reason {@link GROUP_GAP} is.
 */
export const LEADER_CHANNEL = 18;

/**
 * The leader from the pinned annotation chip to the room it names, drawn with
 * the same bus discipline as the wires: out of the chip along the clear band
 * beneath it, down the channel beside the named room's own column, and back in
 * at that card's trailing edge.
 *
 * It used to be a single diagonal, on the theory that a diagonal could never be
 * mistaken for a wire. On a plan the width of a real pane that theory cost more
 * than it bought: the one line crossing the entire sheet was the first thing
 * the eye found and the last thing it could follow. Orthogonal, it reads as an
 * annotation of the schematic rather than a scratch across it, and the dash
 * pattern is what keeps it distinct from the wires.
 *
 * It comes down BESIDE the target's column rather than down the plan's right
 * edge, and arrives at the card's side rather than its top. Both for the same
 * reason: on a plan of columns, the ground above a card is the card above it
 * and the ground between the right edge and a card is every column in between —
 * either route would draw the annotation straight through rooms it says nothing
 * about. The channel beside a column is clear ground by construction, and the
 * last leg is then only as long as that channel is wide. `channel` caps it, so
 * the room in the LAST column is pointed at from inside the plan's own margin
 * rather than from off the edge of it.
 *
 * Returns an empty string when either end has no box to point at (a chip the
 * narrow tier has hidden, a room the plan has not laid out).
 */
export function leaderPath(chip: Anchor | null, room: RoomBox | null, channel: number): string {
  if (!chip || !room) return '';
  const trunk = Math.min(channel, room.right + LEADER_CHANNEL / 2);
  return busPath(px(chip.x), px(chip.y), px(room.right + ARRIVE), px(room.cy), px(trunk));
}

/* ── the sheet's one alert line ─────────────────────────────────────── */

export interface SheetAlert {
  /** True when a room is faulted — the chip is red and it is worth pressing. */
  active: boolean;
  text: string;
  /** The faulted room the chip points at — the leader's target and the room
   *  the chip opens. Null when the sheet is clear. */
  room: RoomId | null;
  /** The target room's display title, for the button's accessible label. */
  roomTitle: string | null;
}

/**
 * What the pinned chip says. The STATE is `gridVitals`' own reading — never a
 * second count of any feed — and the TARGET is the same first-faulted-room
 * rule the AI strip speaks by ({@link firstFault}), so the chip, the strip and
 * the red dot always point at one card. Naming comes from the subjects the
 * reading carries; a room that names nothing gets its note instead, and a
 * faulted room with nothing to say is still red — it will not invent a name.
 */
export function sheetAlert(vitals: GridVitals): SheetAlert {
  const room = firstFault(vitals);
  if (room === null) return { active: false, text: 'no open alerts', room: null, roomTitle: null };
  const title = ROOMS[room].title;
  const vital = vitals[room];
  const subjects = vital.subjects;
  if (subjects.length > 0) {
    const named =
      subjects.length === 1 ? subjects[0] : `${subjects[0]} and ${subjects.length - 1} more`;
    const alerts = subjects.length === 1 ? '1 alert' : `${subjects.length} alerts`;
    return { active: true, text: `${alerts} — ${named} → ${title}`, room, roomTitle: title };
  }
  const detail = vital.fact ?? vital.note;
  return {
    active: true,
    text: detail ? `${title} needs attention — ${detail}` : `${title} needs attention`,
    room,
    roomTitle: title,
  };
}
