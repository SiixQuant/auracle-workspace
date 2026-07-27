/**
 * The Grid's room registry — the pack's whole surface map in one table.
 *
 * The pack contributes exactly ONE panel (the Grid). Everything it used to
 * register separately is now a ROOM inside it, addressed by room id. This
 * table is the only place a room is declared: the home plan lists it, the
 * router renders it, and the alias table (gridNav) resolves every retired
 * panel id onto one of these ids.
 *
 * Every room wears the same page frame ({@link RoomPage}); what differs is the
 * BODY. The rooms whose page has been built mount their real surface, the rest
 * mount a placeholder body until their own issue lands — which is why swapping
 * one in never touches anything upstream of this table.
 */
import type { ComponentType } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { tone } from '../panelkit';
import { RoomPage } from './RoomPage';
import { ROOM_CONTEXT } from './roomContext';
import { BacktestPage } from './pages/BacktestPage';
import { FindingsPage } from './pages/FindingsPage';
import { QcPage } from './pages/QcPage';
import { StrategiesPage } from './pages/StrategiesPage';
import { ValidationPage } from './pages/ValidationPage';

/** Every room, in the order the home plan lists them. */
export const ROOM_IDS = [
  'findings',
  'qc',
  'strategies',
  'backtest',
  'validation',
  'deploys',
  'blotter',
  'incidents',
  'schedules',
  'runway',
  'conns',
] as const;

export type RoomId = (typeof ROOM_IDS)[number];

export interface GridRoom {
  id: RoomId;
  /** The room's name, as the plan and the room header say it. */
  title: string;
  /** The page this room renders. A placeholder until its own issue lands. */
  component: ComponentType<PanelHostProps>;
}

/**
 * A room whose page is not built yet: the frame, an honest body, and nothing
 * it cannot back up. It wears the same frame as a finished room — including
 * the room's `data-testid` and its wired-to edges — so a route (and a jump
 * from another room) can be asserted before the real body exists, and keeps
 * working unchanged afterwards.
 *
 * Its context line is the room's own sentence from {@link ROOM_CONTEXT}, the
 * same one the sheet's hover peek shows — a room does not get described one
 * way on the plan and another way on its page.
 */
function placeholder(id: RoomId): ComponentType<PanelHostProps> {
  function RoomPlaceholder(): JSX.Element {
    return (
      <RoomPage room={id} status="nominal" statusLabel="not built" context={ROOM_CONTEXT[id]}>
        <p style={{ margin: 0, fontSize: 12.5, color: tone.text3 }}>
          This room is routed and named. Its page is not built yet.
        </p>
      </RoomPage>
    );
  }
  RoomPlaceholder.displayName = `GridRoom(${id})`;
  return RoomPlaceholder;
}

function room(id: RoomId, title: string, component?: ComponentType<PanelHostProps>): GridRoom {
  return { id, title, component: component ?? placeholder(id) };
}

/** The registry the router and the home plan both read. */
export const ROOMS: Record<RoomId, GridRoom> = {
  findings: room('findings', 'Findings', FindingsPage),
  qc: room('qc', 'QC Library', QcPage),
  strategies: room('strategies', 'Strategies', StrategiesPage),
  backtest: room('backtest', 'Backtest', BacktestPage),
  validation: room('validation', 'Validation', ValidationPage),
  deploys: room('deploys', 'Deployments'),
  blotter: room('blotter', 'Blotter'),
  incidents: room('incidents', 'Incidents'),
  schedules: room('schedules', 'Schedules'),
  runway: room('runway', 'Runway'),
  conns: room('conns', 'Connections'),
};

/** The rooms in plan order — `ROOM_IDS` is the single ordering authority. */
export const ROOM_LIST: GridRoom[] = ROOM_IDS.map((id) => ROOMS[id]);

/** Whether an arbitrary string names a room. */
export function isRoomId(value: string): value is RoomId {
  return Object.prototype.hasOwnProperty.call(ROOMS, value);
}
