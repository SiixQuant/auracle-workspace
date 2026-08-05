/**
 * The sheet's four districts — the floor the rooms are laid out on.
 *
 * `rooms.tsx` owns WHAT a room is (its id, title, page); this owns WHERE it
 * sits. The two orderings are deliberately separate: the registry's `ROOM_IDS`
 * is the id authority and the router's order, while the districts are the
 * home's geography, which groups by what a person is doing — research, build
 * and test, operate, and the system underneath all three. A test holds them in
 * lockstep, so a room added to the registry cannot quietly go homeless.
 *
 * The icon table lives here rather than in the registry for the same reason:
 * it is a property of the SHEET (the only surface that draws a room icon), so
 * the registry stays the routing contract and nothing else.
 */
import { worseHealth, type GridVitals, type Health } from '../../engine/gridVitals';
import { tone } from '../panelkit';
import type { RoomId } from './rooms';

export interface District {
  /** Stable slug — what `data-testid` carries. */
  id: string;
  /** The number the label leads with, set in mono. */
  number: string;
  /** Title case in source; the label uppercases it. */
  name: string;
  /** The rooms on this floor, in the order the sheet lays them out. */
  rooms: RoomId[];
}

export const DISTRICTS: readonly District[] = [
  { id: 'research', number: '01', name: 'Research', rooms: ['findings', 'qc'] },
  { id: 'build-test', number: '02', name: 'Build · Test', rooms: ['strategies', 'strategy', 'backtest', 'validation'] },
  { id: 'operate', number: '03', name: 'Operate', rooms: ['deploys', 'blotter', 'incidents', 'schedules'] },
  { id: 'system', number: '04', name: 'System', rooms: ['conns', 'runway'] },
];

/**
 * Which group column a room sits in, as the districts' own order — the table
 * read back the other way round.
 *
 * The sheet lays each district out as a COLUMN of its rooms under its own
 * header, so this is what tells the wire routing whether a hand-off crosses
 * from one group to the next (and therefore rides the gutter between their
 * columns) or stays inside a single group's column. Derived from
 * {@link DISTRICTS} rather than written out, so a room cannot be in one place
 * on the plan and another in the wiring.
 */
export const ROOM_GROUP: Record<string, number> = Object.fromEntries(
  DISTRICTS.flatMap((district, index) => district.rooms.map((room) => [room, index]))
);

/** Material Symbols ligature per room — the host loads that face globally
 *  (renderer/index.css), which is also what the pack's rail button draws with. */
export const ROOM_ICONS: Record<RoomId, string> = {
  findings: 'lightbulb',
  qc: 'library_books',
  strategies: 'description',
  strategy: 'insights',
  backtest: 'query_stats',
  validation: 'fact_check',
  deploys: 'rocket_launch',
  blotter: 'receipt_long',
  incidents: 'warning',
  schedules: 'schedule',
  runway: 'flight_takeoff',
  conns: 'hub',
};

/**
 * How a reading is drawn and how it is said — one table each, read by every
 * surface that renders health on the sheet (the card's dot and border, the
 * district's flag, a folded district's chip, the hover peek, a palette row).
 * They live beside the icon table for the same reason: presentation of the
 * plan, not routing.
 *
 * `nominal` is GREY on purpose: a healthy room is not an achievement to
 * celebrate, it is the absence of a problem, so only trouble takes a hue.
 */
export const HEALTH_COLOR: Record<Health, string> = {
  nominal: tone.text3,
  degraded: tone.caution,
  fault: tone.danger,
};

export const HEALTH_WORD: Record<Health, string> = {
  nominal: 'nominal',
  degraded: 'degraded',
  fault: 'needs attention',
};

/** Every room this district contains, at its worst reading — what the label's
 *  flag reports. A district is only as healthy as the room needing most help. */
export function districtHealth(district: District, vitals: GridVitals): Health {
  return district.rooms.reduce<Health>(
    (worst, room) => worseHealth(worst, vitals[room].health),
    'nominal'
  );
}

/**
 * The district's live summary line, composed from its rooms' own facts. Every
 * fragment came from a source that answered; a district whose sources are all
 * quiet says so rather than filling the line with zeros it cannot back.
 */
export function districtSummary(district: District, vitals: GridVitals): string {
  const facts = district.rooms
    .map((room) => vitals[room].fact)
    .filter((fact): fact is string => fact !== null && fact.length > 0);
  return facts.length > 0 ? facts.join(' · ') : 'no readings yet';
}

/** The first faulted room in the order the plan lays the districts out — the
 *  AI strip, the pinned alert and the reader's eye all arrive at the same
 *  card. Null when nothing is faulted. */
export function firstFault(vitals: GridVitals): RoomId | null {
  for (const district of DISTRICTS) {
    for (const room of district.rooms) {
      if (vitals[room].health === 'fault') return room;
    }
  }
  return null;
}

/** Rooms across the whole sheet that are not nominal — the root node's count. */
export function roomsNeedingAttention(vitals: GridVitals): number {
  return DISTRICTS.reduce(
    (total, district) =>
      total + district.rooms.filter((room) => vitals[room].health !== 'nominal').length,
    0
  );
}
