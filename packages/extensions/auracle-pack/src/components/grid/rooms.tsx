/**
 * The Grid's room registry — the pack's whole surface map in one table.
 *
 * The pack contributes exactly ONE panel (the Grid). Everything it used to
 * register separately is now a ROOM inside it, addressed by room id. This
 * table is the only place a room is declared: the home plan lists it, the
 * router renders it, and the alias table (gridNav) resolves every retired
 * panel id onto one of these ids.
 *
 * Every room wears the same page frame (`RoomPage`); what differs is the BODY,
 * which mounts the real surface for that work rather than a lookalike. Swapping
 * a page in never touches anything upstream of this table.
 *
 * What a room is FOR is not declared here — that sentence lives in
 * `roomContext.ts`, which the page and the sheet's hover peek both read, so a
 * room is never described one way on the plan and another way on its own page.
 */
import type { ComponentType } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { BacktestPage } from './pages/BacktestPage';
import { BlotterPage } from './pages/BlotterPage';
import { DeploysPage } from './pages/DeploysPage';
import { FactorPage } from './pages/FactorPage';
import { FindingsPage } from './pages/FindingsPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { QcPage } from './pages/QcPage';
import { RunwayPage } from './pages/RunwayPage';
import { SchedulesPage } from './pages/SchedulesPage';
import { StrategiesPage } from './pages/StrategiesPage';
import { StrategyPage } from './pages/StrategyPage';
import { ValidationPage } from './pages/ValidationPage';

/** Every room, in the order the home plan lists them. */
export const ROOM_IDS = [
  'findings',
  'qc',
  'strategies',
  'strategy',
  'backtest',
  'validation',
  'factors',
  'deploys',
  'blotter',
  'incidents',
  'schedules',
  'runway',
] as const;

export type RoomId = (typeof ROOM_IDS)[number];

export interface GridRoom {
  id: RoomId;
  /** The room's name, as the plan and the room header say it. */
  title: string;
  /** The page this room renders. */
  component: ComponentType<PanelHostProps>;
}

function room(id: RoomId, title: string, component: ComponentType<PanelHostProps>): GridRoom {
  return { id, title, component };
}

/** The registry the router and the home plan both read. */
export const ROOMS: Record<RoomId, GridRoom> = {
  findings: room('findings', 'Findings', FindingsPage),
  qc: room('qc', 'QC Library', QcPage),
  strategies: room('strategies', 'Strategies', StrategiesPage),
  strategy: room('strategy', 'Tearsheet', StrategyPage),
  backtest: room('backtest', 'Backtest', BacktestPage),
  validation: room('validation', 'Validation', ValidationPage),
  factors: room('factors', 'Factors', FactorPage),
  deploys: room('deploys', 'Deployments', DeploysPage),
  blotter: room('blotter', 'Blotter', BlotterPage),
  incidents: room('incidents', 'Incidents', IncidentsPage),
  schedules: room('schedules', 'Schedules', SchedulesPage),
  runway: room('runway', 'Runway', RunwayPage),
};

/** The rooms in plan order — `ROOM_IDS` is the single ordering authority. */
export const ROOM_LIST: GridRoom[] = ROOM_IDS.map((id) => ROOMS[id]);

/** Whether an arbitrary string names a room. */
export function isRoomId(value: string): value is RoomId {
  return Object.prototype.hasOwnProperty.call(ROOMS, value);
}
