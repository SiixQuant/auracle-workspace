/**
 * The sheet's wiring, as geometry — how the rooms are joined on the plan.
 *
 * `wiring.ts` declares WHICH rooms feed which (the room page's chip row reads
 * it); this declares how the SHEET draws a subset of those edges: the flow a
 * person actually follows, routed as a schematic rather than a spider's web.
 * The two are separate because they answer different questions and change for
 * different reasons — a new hand-off adds a chip, not necessarily a wire.
 *
 * ## Trunk and drop
 * Straight point-to-point lines between eleven cards read as noise — and so
 * does a lane full of near-parallel runs that all say the same thing. So the
 * routing is a BUS, the way a schematic is drawn:
 *
 *  - each FLOW owns one lane, and one horizontal TRUNK runs in it beneath the
 *    room rank;
 *  - an edge is a DROP out of the source card's centre onto that trunk, a run
 *    along it, and a drop back up into the target's bottom edge. Two bends,
 *    never more than three, and no diagonal at any of them;
 *  - two edges on the same trunk SHARE it. Their runs are collinear rather than
 *    parallel, so a flow through five cards is one line with five drops off it
 *    instead of four lines stacked under the rank;
 *  - every drop sits on its own card's centreline. That single rule is what
 *    makes it impossible for a drop to pass through a neighbouring card, and
 *    impossible for two edges in one lane to cross — all their horizontals are
 *    the same line, and all their verticals are card centres.
 *
 * The flows are the three the sheet has to tell apart: the strategy pipeline to
 * production, what a live deployment produces, and what supplies either from
 * outside it. So the lane an edge runs in is a property of what the edge MEANS,
 * not of the order the table happens to be written in — which is what keeps the
 * picture stable as edges are added. A new hand-off inside a known flow adds a
 * drop; it does not add a line across the plan.
 *
 * Direction reads left to right along the pipeline, and the arrowhead is on the
 * TERMINAL drop only. A trunk carries no arrows of its own, so two edges
 * sharing one can never be read as disagreeing about which way the work goes.
 *
 * This replaced a point-to-point routing with a per-edge x-nudge on each tap.
 * The nudges kept verticals off each other pixel by pixel, but they also meant
 * no two lines ever quite lined up: revealed together, eight edges read as a
 * tangle rather than as one system. Sharing the trunk is what buys the picture
 * back, and centring every drop is what makes the sharing exact.
 *
 * EVERY line this module produces is orthogonal, the leader included. A
 * diagonal drawn across a schematic reads as a mistake in it, and one drawn the
 * width of the whole sheet reads as the loudest thing on it — which is why the
 * annotation's leader now takes the same lane discipline as the wires instead
 * of cutting the plan in half.
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
import { firstFault } from './districts';
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

/** Lane depth in px below the bottom of the room rank. */
export const LANES = { 1: 20, 2: 34, 3: 48 } as const;

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

/** A measured room card, in the sheet's own coordinate space. */
export interface RoomBox {
  /** Horizontal centre. */
  cx: number;
  top: number;
  bottom: number;
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

/** The radius a turn takes when there is room for it. */
const CORNER = 6;

/**
 * One DROP–RUN–DROP path: down out of the source to `laneY`, along the trunk,
 * and out again into the target, with the corners rounded by whatever radius
 * actually fits.
 *
 * Two bends whenever there is a run to make, and never more than two — they are
 * the only turns the sheet draws anywhere. Two taps already in one column need
 * no trunk and take none, which is the only case that bends fewer times.
 * The two vertical legs are signed independently, so this one shape serves both
 * things the sheet needs: a wire that drops out of a card, runs under the rank
 * and rises into another, and a leader that drops out of the pinned chip, runs
 * across above the rank and drops into the card it names.
 *
 * Nothing here is ever diagonal. When a corner will not fit — cards nearly in
 * the same column, or a lane too shallow to turn in — the turn is drawn SQUARE
 * rather than cut across. That case used to collapse to a single straight
 * segment between the taps, which is fine when the two taps share a y and is a
 * stray hypotenuse the moment they do not; the shape is the contract here, and
 * a schematic with one diagonal in it reads as a schematic with a mistake in it.
 */
export function orthoPath(x1: number, y1: number, x2: number, y2: number, laneY: number): string {
  // Same column: the drop IS the path. Sending it down to the trunk and back up
  // the same line would draw the line over itself and call it a route.
  if (px(x1) === px(x2)) return `M ${px(x1)} ${px(y1)} L ${px(x1)} ${px(y2)}`;
  const dir = x2 > x1 ? 1 : -1;
  // Which way each leg travels to reach (and leave) the lane. A wire arrives
  // from above and leaves upward; a leader arrives from above and leaves
  // downward, which is the only difference between the two shapes.
  const into = laneY >= y1 ? 1 : -1;
  const outOf = y2 >= laneY ? 1 : -1;
  const r = Math.max(
    0,
    Math.min(CORNER, Math.abs(x2 - x1) / 2 - 1, Math.abs(laneY - y1) / 2, Math.abs(y2 - laneY) / 2)
  );
  if (r === 0) {
    return (
      `M ${px(x1)} ${px(y1)} L ${px(x1)} ${px(laneY)}` +
      ` L ${px(x2)} ${px(laneY)} L ${px(x2)} ${px(y2)}`
    );
  }
  return (
    `M ${px(x1)} ${px(y1)} L ${px(x1)} ${px(laneY - into * r)} Q ${px(x1)} ${px(laneY)} ${px(x1 + dir * r)} ${px(laneY)}` +
    ` L ${px(x2 - dir * r)} ${px(laneY)} Q ${px(x2)} ${px(laneY)} ${px(x2)} ${px(laneY + outOf * r)} L ${px(x2)} ${px(y2)}`
  );
}

export interface WireLayout {
  wires: Wire[];
  /** The first faulted path, for the travelling pulse. Empty when nothing is. */
  faultPath: string;
}

/** How far clear of a card's border its drop begins, and ends. The two differ
 *  so a pair of opposed edges between the same two cards cannot overdraw each
 *  other exactly — and so the arrowhead lands ON the border rather than under
 *  the line leaving it. */
const DROP_OUT = 2;
const DROP_IN = 3;

/**
 * Route every edge whose two rooms were measured.
 *
 * Every trunk hangs below the LOWEST card in the rank, not below its own two
 * cards, so a district whose cards ran to two lines cannot have a wire drawn
 * through it — and so every edge in a lane lands on the SAME trunk y, which is
 * what makes the sharing exact rather than approximate. The drops are card
 * centres, untouched by anything per-edge: two edges meeting at a card meet on
 * one line.
 */
export function layoutWires(
  boxes: Partial<Record<RoomId, RoomBox>>,
  vitals: GridVitals
): WireLayout {
  let rankBottom = 0;
  for (const box of Object.values(boxes)) {
    if (box) rankBottom = Math.max(rankBottom, box.bottom);
  }

  const wires: Wire[] = [];
  let faultPath = '';
  for (const def of WIRE_DEFS) {
    const a = boxes[def.from];
    const b = boxes[def.to];
    if (!a || !b) continue;
    const kind = wireKind(def, vitals);
    const d = orthoPath(
      a.cx,
      a.bottom + DROP_OUT,
      b.cx,
      b.bottom + DROP_IN,
      rankBottom + LANES[wireLane(def)]
    );
    wires.push({ key: `${def.from}-${def.to}`, d, kind });
    if (kind === 'err' && faultPath === '') faultPath = d;
  }
  return { wires, faultPath };
}

/** A point in the sheet's coordinate space — where the leader starts. */
export interface Anchor {
  x: number;
  y: number;
}

/** How far above the target card the leader's horizontal run sits, and where on
 *  the card's top edge it lands — right of centre, clear of the title. */
const LEADER_LANE = 18;
const LEADER_TAP = 24;
/** The shortest first leg the leader will take before turning. */
const LEADER_DROP = 10;

/**
 * The leader from the pinned annotation chip to the room it names, drawn with
 * the same lane discipline as the wires: down the plan's right edge out of the
 * chip, across a lane just above the room rank, and down into the target card's
 * top edge.
 *
 * It used to be a single diagonal, on the theory that a diagonal could never be
 * mistaken for a wire. On a plan the width of a real pane that theory cost more
 * than it bought: the one line crossing the entire sheet was the first thing
 * the eye found and the last thing it could follow. Orthogonal, it reads as an
 * annotation of the schematic rather than a scratch across it, and the dash
 * pattern is what keeps it distinct from the wires.
 *
 * Returns an empty string when either end has no box to point at (a chip the
 * narrow tier has hidden, a room the plan has not laid out).
 */
export function leaderPath(chip: Anchor | null, room: RoomBox | null): string {
  if (!chip || !room) return '';
  // The lane sits above the card, but never above the chip it leaves: a target
  // high on the plan gets a short drop rather than a leg doubling back.
  const laneY = Math.max(chip.y + LEADER_DROP, room.top - LEADER_LANE);
  return orthoPath(chip.x, chip.y, room.cx + LEADER_TAP, room.top - 3, laneY);
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
