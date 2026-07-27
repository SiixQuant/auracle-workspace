/**
 * The sheet's wiring, as geometry — how the rooms are joined on the plan.
 *
 * `wiring.ts` declares WHICH rooms feed which (the room page's chip row reads
 * it); this declares how the SHEET draws a subset of those edges: the flow a
 * person actually follows, routed as a schematic rather than a spider's web.
 * The two are separate because they answer different questions and change for
 * different reasons — a new hand-off adds a chip, not necessarily a wire.
 *
 * ## Bus discipline
 * Straight point-to-point lines between eleven cards read as noise. So the
 * routing is orthogonal and LANE-DISCIPLINED, the way a schematic is drawn:
 *
 *  - every edge leaves the BOTTOM of its room, drops to a horizontal lane, runs
 *    along it, and rises into the bottom of its target;
 *  - the sequential flow (findings → strategies → backtest → validation →
 *    deploys → blotter) shares ONE lane, so it reads as a single bus;
 *  - each crossing edge gets a lane of its own, below the bus;
 *  - a room that several edges tap uses a FIXED x-offset per edge, so two
 *    verticals never land on the same pixel column.
 *
 * The lane offsets and the per-endpoint taps below are the design's, ported
 * verbatim from the shell-lab source of truth (mockups/shell-lab ShellMap) so
 * the shipped sheet and the design agree by construction rather than by eye.
 *
 * ## Colour comes from the readings, never from here
 * An edge is quiet unless it WATCHES a room, and a watched edge takes that
 * room's health straight from `gridVitals` — the same table the dots, the
 * district flags and the room pages read. Nothing here decides that something
 * is broken; it only decides which line says so.
 */
import type { GridVitals, Health } from '../../engine/gridVitals';
import type { RoomId } from './rooms';

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
 */
export const TREE_MIN_WIDTH = 1280;

/** Lane depth in px below the bottom of the room rank. */
export const LANES = { 1: 20, 2: 34, 3: 48 } as const;

export type Lane = keyof typeof LANES;

/** How loudly a wire speaks: quiet, degraded, faulted. */
export type WireKind = 'norm' | 'warn' | 'err';

export interface WireDef {
  from: RoomId;
  to: RoomId;
  lane: Lane;
  /** x nudge on the outgoing tap, so shared rooms fan out rather than stack. */
  fromOffset: number;
  /** x nudge on the incoming tap. */
  toOffset: number;
  /** The room whose reading colours this edge. Null = always quiet. */
  watch: RoomId | null;
}

/**
 * The eight edges the sheet draws. Lane 1 is the sequential bus; lanes 2 and 3
 * carry the edges that cross it.
 */
export const WIRE_DEFS: readonly WireDef[] = [
  { from: 'findings', to: 'strategies', lane: 1, fromOffset: 0, toOffset: -10, watch: null },
  { from: 'strategies', to: 'backtest', lane: 1, fromOffset: 10, toOffset: -14, watch: null },
  // Amber the moment the certification room is degraded: this is the edge a
  // strategy has to cross to reach a deployment.
  { from: 'backtest', to: 'validation', lane: 1, fromOffset: 0, toOffset: -8, watch: 'validation' },
  { from: 'validation', to: 'deploys', lane: 1, fromOffset: 8, toOffset: -16, watch: null },
  { from: 'deploys', to: 'blotter', lane: 1, fromOffset: -4, toOffset: 0, watch: null },
  { from: 'qc', to: 'backtest', lane: 2, fromOffset: 0, toOffset: 14, watch: null },
  // The one edge that turns red: a faulted deployment is what produces the
  // incident, so the wire between them carries the alarm.
  { from: 'deploys', to: 'incidents', lane: 2, fromOffset: 8, toOffset: 0, watch: 'deploys' },
  { from: 'schedules', to: 'deploys', lane: 3, fromOffset: 0, toOffset: 20, watch: null },
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

/**
 * One lane-disciplined path: down out of the source, along `laneY`, up into the
 * target, with the corners rounded by whatever radius actually fits. A pair of
 * rooms too close together (or a lane too shallow) gets a straight segment
 * rather than a corner drawn tighter than the gap it turns in.
 */
export function orthoPath(x1: number, y1: number, x2: number, y2: number, laneY: number): string {
  const dir = x2 > x1 ? 1 : -1;
  const r = Math.max(0, Math.min(6, Math.abs(x2 - x1) / 2 - 1, (laneY - y1) / 2, (laneY - y2) / 2));
  if (r === 0) return `M ${px(x1)} ${px(y1)} L ${px(x2)} ${px(y2)}`;
  return (
    `M ${px(x1)} ${px(y1)} L ${px(x1)} ${px(laneY - r)} Q ${px(x1)} ${px(laneY)} ${px(x1 + dir * r)} ${px(laneY)}` +
    ` L ${px(x2 - dir * r)} ${px(laneY)} Q ${px(x2)} ${px(laneY)} ${px(x2)} ${px(laneY - r)} L ${px(x2)} ${px(y2)}`
  );
}

export interface WireLayout {
  wires: Wire[];
  /** The first faulted path, for the travelling pulse. Empty when nothing is. */
  faultPath: string;
}

/**
 * Route every edge whose two rooms were measured. Lanes hang below the LOWEST
 * card in the rank, so a district whose cards ran to two lines cannot have a
 * wire drawn through it.
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
      a.cx + def.fromOffset,
      // +2 / +3: the tap starts just clear of the card's border, and the two
      // ends differ so a bidirectional pair never overdraws itself.
      a.bottom + 2,
      b.cx + def.toOffset,
      b.bottom + 3,
      rankBottom + LANES[def.lane]
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

/**
 * The dashed leader from the pinned annotation chip down to the room it names.
 * Returns an empty string when either end has no box to point at (a chip the
 * narrow tier has hidden, a room the plan has not laid out).
 */
export function leaderPath(chip: Anchor | null, room: RoomBox | null): string {
  if (!chip || !room) return '';
  // Out of the chip's lower edge and into the card's upper right: a diagonal,
  // so it never reads as one of the orthogonal wires.
  return `M ${px(chip.x)} ${px(chip.y)} L ${px(room.cx + 30)} ${px(room.top - 7)}`;
}

/* ── the sheet's one alert line ─────────────────────────────────────── */

export interface SheetAlert {
  /** True when a room is faulted — the chip is red and it is worth pressing. */
  active: boolean;
  text: string;
}

/**
 * What the pinned chip says. The STATE is `gridVitals`' own reading of the
 * deployments room — never a second count of the feed — and the naming comes
 * from the subjects that reading carries.
 */
export function sheetAlert(vitals: GridVitals): SheetAlert {
  const deploys = vitals.deploys;
  if (deploys.health !== 'fault') return { active: false, text: 'no open alerts' };
  const subjects = deploys.subjects;
  // Faulted with nothing named: still red, but it will not invent a name.
  if (subjects.length === 0) return { active: true, text: 'Deployments needs attention' };
  const named =
    subjects.length === 1 ? subjects[0] : `${subjects[0]} and ${subjects.length - 1} more`;
  const alerts = subjects.length === 1 ? '1 alert' : `${subjects.length} alerts`;
  return { active: true, text: `${alerts} — ${named} → Deployments` };
}
