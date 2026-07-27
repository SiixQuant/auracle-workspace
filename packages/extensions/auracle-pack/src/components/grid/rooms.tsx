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
  /** One line naming what lives here — the home card's second line. */
  blurb: string;
  /** The page this room renders. A placeholder until its own issue lands. */
  component: ComponentType<PanelHostProps>;
}

/**
 * A room whose page is not built yet: the frame, an honest body, and nothing
 * it cannot back up. It wears the same frame as a finished room — including
 * the room's `data-testid` and its wired-to edges — so a route (and a jump
 * from another room) can be asserted before the real body exists, and keeps
 * working unchanged afterwards.
 */
function placeholder(id: RoomId, blurb: string): ComponentType<PanelHostProps> {
  function RoomPlaceholder(): JSX.Element {
    return (
      <RoomPage room={id} status="nominal" statusLabel="not built" context={blurb}>
        <p style={{ margin: 0, fontSize: 12.5, color: tone.text3 }}>
          This room is routed and named. Its page is not built yet.
        </p>
      </RoomPage>
    );
  }
  RoomPlaceholder.displayName = `GridRoom(${id})`;
  return RoomPlaceholder;
}

function room(
  id: RoomId,
  title: string,
  blurb: string,
  component?: ComponentType<PanelHostProps>
): GridRoom {
  return { id, title, blurb, component: component ?? placeholder(id, blurb) };
}

/** The registry the router and the home plan both read. */
export const ROOMS: Record<RoomId, GridRoom> = {
  findings: room(
    'findings',
    'Findings',
    'Ranked research findings and what makes them tradable.',
    FindingsPage
  ),
  qc: room('qc', 'QC Library', 'Backtests imported from QuantConnect.', QcPage),
  strategies: room('strategies', 'Strategies', 'Every strategy in the workspace.', StrategiesPage),
  backtest: room('backtest', 'Backtest', 'Run a strategy and read its metrics.', BacktestPage),
  validation: room(
    'validation',
    'Validation',
    'Overfit checks and out-of-sample verdicts.',
    ValidationPage
  ),
  deploys: room('deploys', 'Deployments', 'Paper and live deployments, and their state.'),
  blotter: room('blotter', 'Blotter', 'Orders the deployments have sent.'),
  incidents: room('incidents', 'Incidents', 'What needs attention right now.'),
  schedules: room('schedules', 'Schedules', 'What runs, and when.'),
  runway: room('runway', 'Runway', 'How far each idea has travelled toward live.'),
  conns: room('conns', 'Connections', 'The engine, the broker, and the data sources.'),
};

/** The rooms in plan order — `ROOM_IDS` is the single ordering authority. */
export const ROOM_LIST: GridRoom[] = ROOM_IDS.map((id) => ROOMS[id]);

/** Whether an arbitrary string names a room. */
export function isRoomId(value: string): value is RoomId {
  return Object.prototype.hasOwnProperty.call(ROOMS, value);
}
