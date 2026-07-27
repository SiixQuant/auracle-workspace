/**
 * Schedules — the Operate district's cadence room.
 *
 * The body is the existing schedules surface, mounted whole: the cron table
 * with its plain reading of each expression, and Run now / Pause / Delete on
 * each row. The humanising of a cron line and the connect-generation bump after
 * an action stay where they already are.
 *
 * Vitals are the panel's own feed, reported up as it polls.
 */
import { useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { SchedulesPanel, type SchedulesSummary } from '../../MonitorPanels';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

function state(table: SchedulesSummary | null): { status: RoomStatus; label?: string } {
  if (!table || table.phase === 'loading') return { status: 'degraded', label: 'reading' };
  if (table.phase === 'unreachable') return { status: 'attention', label: 'engine unreachable' };
  if (table.scheduled === 0) return { status: 'nominal', label: 'nothing scheduled' };
  if (table.enabled === 0) return { status: 'degraded', label: 'all paused' };
  return { status: 'nominal', label: `${table.enabled ?? 0} enabled` };
}

/** A count the feed actually reported, or null for the frame's placeholder. */
function figure(n: number | null | undefined): string | null {
  return typeof n === 'number' ? String(n) : null;
}

export function SchedulesPage({ host }: PanelHostProps): JSX.Element {
  const [table, setTable] = useState<SchedulesSummary | null>(null);
  const { status, label } = state(table);

  const vitals: PageVital[] = [
    { label: 'scheduled', value: figure(table?.scheduled) },
    { label: 'enabled', value: figure(table?.enabled) },
    {
      label: 'paused',
      value: figure(table?.paused),
      emphasis: (table?.paused ?? 0) > 0 ? 'warn' : undefined,
    },
  ];

  return (
    <RoomPage
      room="schedules"
      status={status}
      statusLabel={label}
      context={`${ROOM_CONTEXT.schedules} A paused schedule is stated as paused rather than quietly dropped from the list, because a strategy that stopped running on its own is exactly the thing worth noticing.`}
      vitals={vitals}
    >
      <div data-testid="grid-page-schedules">
        <SchedulesPanel host={host} onSummary={setTable} />
      </div>
    </RoomPage>
  );
}
