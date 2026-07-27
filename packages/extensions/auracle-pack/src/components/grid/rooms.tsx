/**
 * The Grid's room registry — the pack's whole surface map in one table.
 *
 * The pack contributes exactly ONE panel (the Grid). Everything it used to
 * register separately is now a ROOM inside it, addressed by room id. This
 * table is the only place a room is declared: the home plan lists it, the
 * router renders it, and the alias table (gridNav) resolves every retired
 * panel id onto one of these ids.
 *
 * Room bodies are deliberately placeholders here. The sheet and the real
 * pages land in the follow-on work; what this file fixes NOW is the id set
 * and the routing contract, so nothing upstream has to change again when a
 * placeholder is swapped for its real page.
 */
import type { ComponentType } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { tone } from '../panelkit';

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
 * A room page that states what it is and nothing it cannot back up. Carries
 * the room's `data-testid` so a route can be asserted before the real page
 * exists — and keeps carrying it afterwards.
 */
function placeholder(id: RoomId, title: string, blurb: string): ComponentType<PanelHostProps> {
  function RoomPlaceholder(): JSX.Element {
    return (
      <section
        data-testid={`grid-room-${id}`}
        data-room={id}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '18px 20px',
          color: tone.text,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {title}
        </h2>
        <p style={{ margin: 0, fontSize: 12.5, color: tone.text2 }}>{blurb}</p>
        <p style={{ margin: 0, fontSize: 12.5, color: tone.text3 }}>
          This room is routed and named. Its page is not built yet.
        </p>
      </section>
    );
  }
  RoomPlaceholder.displayName = `GridRoom(${id})`;
  return RoomPlaceholder;
}

function room(id: RoomId, title: string, blurb: string): GridRoom {
  return { id, title, blurb, component: placeholder(id, title, blurb) };
}

/** The registry the router and the home plan both read. */
export const ROOMS: Record<RoomId, GridRoom> = {
  findings: room('findings', 'Findings', 'Ranked research findings and what makes them tradable.'),
  qc: room('qc', 'QC Library', 'Backtests imported from QuantConnect.'),
  strategies: room('strategies', 'Strategies', 'Every strategy in the workspace.'),
  backtest: room('backtest', 'Backtest', 'Run a strategy and read its metrics.'),
  validation: room('validation', 'Validation', 'Overfit checks and out-of-sample verdicts.'),
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
