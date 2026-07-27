/**
 * Deployments — the Operate district's front room.
 *
 * The body is the existing live desk, mounted whole: the deployments table with
 * its per-row lifecycle actions, the expandable order ledger and equity curve,
 * and the Deploy wizard. None of that behaviour is reimplemented here — the
 * rules about which action a row may offer, and the confirm before a liquidate,
 * stay where they already are (`engine/live`).
 *
 * Vitals come from the desk's own rows, reported up as it polls, so the figures
 * at the top of the page and the table underneath can never be two different
 * reads of `/deployments`. An errored row is stated as ATTENTION here for the
 * same reason the plan draws that room with a red dot: the two surfaces read
 * the same fact and must not disagree about it in front of the user.
 */
import { useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { money } from '../../../engine/format';
import { LiveAlgorithmsPanel, type LiveDeskSummary } from '../../LivePanel';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

function state(desk: LiveDeskSummary | null): { status: RoomStatus; label?: string } {
  if (!desk || desk.phase === 'loading') return { status: 'degraded', label: 'reading' };
  if (desk.phase === 'unreachable') return { status: 'attention', label: 'engine unreachable' };
  if ((desk.errored ?? 0) > 0) {
    const n = desk.errored as number;
    return { status: 'attention', label: `${n} errored` };
  }
  if (desk.deployed === 0) return { status: 'nominal', label: 'nothing deployed' };
  return { status: 'nominal', label: `${desk.active ?? 0} running` };
}

/** A count the desk actually reported, or null for the frame's placeholder. */
function figure(n: number | null | undefined): string | null {
  return typeof n === 'number' ? String(n) : null;
}

export function DeploysPage({ host }: PanelHostProps): JSX.Element {
  const [desk, setDesk] = useState<LiveDeskSummary | null>(null);
  const { status, label } = state(desk);

  const vitals: PageVital[] = [
    { label: 'deployed', value: figure(desk?.deployed) },
    { label: 'running', value: figure(desk?.active) },
    {
      label: 'errored',
      value: figure(desk?.errored),
      emphasis: 'bad',
    },
    { label: 'equity', value: typeof desk?.equity === 'number' ? money(desk.equity) : null },
  ];

  return (
    <RoomPage
      room="deploys"
      status={status}
      statusLabel={label}
      context={`${ROOM_CONTEXT.deploys} The capital behind each one is the engine's own figure; stop, restart and liquidate live on the row, and the orders they placed are next door in the Blotter.`}
      vitals={vitals}
    >
      <div data-testid="grid-page-deploys">
        <LiveAlgorithmsPanel host={host} onSummary={setDesk} />
      </div>
    </RoomPage>
  );
}
