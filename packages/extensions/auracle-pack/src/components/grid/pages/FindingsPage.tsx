/**
 * Findings — the Research district's front room.
 *
 * The body is the real research surface, mounted whole: engine-ranked rows
 * with the composite score in the margin, the sharpened hypothesis as the
 * rationale line, and the panel's own Transmog / Watch / Dismiss actions. The
 * page adds only the frame's framing — headline figures and the edges out.
 *
 * The vitals are the panel's OWN feed, reported up as it loads (`onSummary`),
 * not a second fetch of the same endpoint: two reads could disagree, and the
 * one the reader can check is the list underneath.
 */
import { useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { duration } from '../../../engine/format';
import { ResearchPanel, type ResearchSummary } from '../../ResearchPanel';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

/** A figure the engine gave us, or null for the frame's quiet placeholder. */
function figure(n: number | null | undefined): string | null {
  return typeof n === 'number' ? String(n) : null;
}

/** Elapsed since an ISO stamp, or null when there is no honest answer. */
function since(iso: string | null): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const ms = Date.now() - then;
  return ms < 0 ? null : duration(ms);
}

function state(summary: ResearchSummary | null): { status: RoomStatus; label?: string } {
  if (!summary || summary.phase === 'loading') return { status: 'degraded', label: 'reading' };
  if (summary.phase === 'failed') return { status: 'attention', label: 'engine unreachable' };
  if (summary.findings === 0) return { status: 'degraded', label: 'nothing surfaced yet' };
  return { status: 'nominal' };
}

export function FindingsPage({ host }: PanelHostProps): JSX.Element {
  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  const { status, label } = state(summary);

  const vitals: PageVital[] = [
    { label: 'findings', value: figure(summary?.findings) },
    { label: 'top score', value: figure(summary?.topScore) },
    { label: 'since scan', value: since(summary?.lastScan ?? null) },
  ];

  return (
    <RoomPage
      room="findings"
      status={status}
      statusLabel={label}
      context={`${ROOM_CONTEXT.findings} Every score is engine-computed; a finding you believe goes straight to a drafted strategy.`}
      vitals={vitals}
    >
      <ResearchPanel host={host} onSummary={setSummary} />
    </RoomPage>
  );
}
