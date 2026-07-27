/**
 * QC Library — the Research district's second room.
 *
 * The body is the existing QuantConnect surface, mounted whole: the linked
 * account's projects, per-project import and cloud backtest, and the export
 * lane. Its one outbound edge opens a finished run in the Metrics Viewer (the
 * Backtest room) — this room certifies nothing locally, which is why the
 * context line says where certification actually lives.
 *
 * Vitals are the panel's own list state, reported up as it loads.
 */
import { useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { QcImportPanel, type QcLibrarySummary } from '../../QcImportPanel';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';

function state(summary: QcLibrarySummary | null): { status: RoomStatus; label?: string } {
  if (!summary || summary.phase === 'loading') return { status: 'degraded', label: 'reading' };
  if (summary.phase === 'unreachable') return { status: 'attention', label: 'engine unreachable' };
  if (summary.phase === 'disconnected') return { status: 'degraded', label: 'not linked' };
  if (summary.projects === 0) return { status: 'degraded', label: 'no projects' };
  return { status: 'nominal' };
}

export function QcPage({ host }: PanelHostProps): JSX.Element {
  const [summary, setSummary] = useState<QcLibrarySummary | null>(null);
  const { status, label } = state(summary);

  const vitals: PageVital[] = [
    { label: 'projects', value: typeof summary?.projects === 'number' ? String(summary.projects) : null },
    { label: 'record home', value: 'QC' },
  ];

  return (
    <RoomPage
      room="qc"
      status={status}
      statusLabel={label}
      context="Your linked QuantConnect account. Backtests of record live there, not here — a finished cloud run opens in the Metrics Viewer, and nothing is certified locally."
      vitals={vitals}
    >
      <QcImportPanel host={host} onSummary={setSummary} />
    </RoomPage>
  );
}
