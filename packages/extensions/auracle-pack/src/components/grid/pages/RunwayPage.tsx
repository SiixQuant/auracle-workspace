/**
 * Runway — the System district's distance room.
 *
 * The body is the existing runway surface, mounted whole: the six stages from
 * research to monitor, each with the engine's verdict on whether it has been
 * reached and the evidence behind that verdict. The source is `/ui/api/runway`,
 * the same route the plan's own reading is composed from.
 *
 * Vitals are the panel's own stages, reported up as it polls. A stage the
 * engine reports as unknown is NOT counted as reached — that distinction is the
 * whole point of this room, and flattening it into a progress figure would
 * assert a negative the engine never stated.
 */
import { useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { RunwayPanel, type RunwaySummary } from '../../MonitorPanels';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

function state(runway: RunwaySummary | null): { status: RoomStatus; label?: string } {
  if (!runway || runway.phase === 'loading') return { status: 'degraded', label: 'reading' };
  if (runway.phase === 'unreachable') return { status: 'attention', label: 'engine unreachable' };
  if (runway.reached === 0) return { status: 'nominal', label: 'not started' };
  return { status: 'nominal' };
}

export function RunwayPage({ host }: PanelHostProps): JSX.Element {
  const [runway, setRunway] = useState<RunwaySummary | null>(null);
  const { status, label } = state(runway);

  const vitals: PageVital[] = [
    {
      label: 'stages reached',
      value:
        typeof runway?.reached === 'number' && typeof runway.stages === 'number'
          ? `${runway.reached} of ${runway.stages}`
          : null,
    },
    { label: 'furthest', value: runway?.furthest ?? null },
  ];

  return (
    <RoomPage
      room="runway"
      status={status}
      statusLabel={label}
      context={`${ROOM_CONTEXT.runway} One stage at a time, with the evidence behind each verdict — a stage the engine cannot vouch for reads unknown rather than not reached.`}
      vitals={vitals}
    >
      <div data-testid="grid-page-runway">
        <RunwayPanel host={host} onSummary={setRunway} />
      </div>
    </RoomPage>
  );
}
