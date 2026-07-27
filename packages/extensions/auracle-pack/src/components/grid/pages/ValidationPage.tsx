/**
 * Validation — the Build-Test district's gates room.
 *
 * The body is the existing validation surface, mounted whole: pick a strategy,
 * the engine runs a real backtest plus walk-forward and returns the tri-state
 * rail with the fix each red signal usually needs.
 *
 * The vitals count the rail the body is showing (reported up through
 * `onVerdict`), so the page headlines the same verdict the rows below it
 * explain. Before a check has run there is nothing to count, and every figure
 * stays a placeholder rather than a zero that would read as "all clear".
 */
import { useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import type { ValidationVerdict } from '../../../engine/validation';
import { ValidationPanel } from '../../ValidationPanel';
import { RoomPage, type RoomStatus, type RoomVital } from '../RoomPage';

interface Rail {
  healthy: number;
  red: number;
  unknown: number;
}

function rail(verdict: ValidationVerdict | null): Rail | null {
  if (!verdict || verdict.signals.length === 0) return null;
  const red = verdict.signals.filter((s) => s.tier === 'red').length;
  const unknown = verdict.signals.filter((s) => s.tier === 'unknown').length;
  return { healthy: verdict.signals.length - red - unknown, red, unknown };
}

function state(counts: Rail | null): { status: RoomStatus; label?: string } {
  if (!counts) return { status: 'nominal', label: 'no check run' };
  if (counts.red > 0) {
    return { status: 'attention', label: `${counts.red} gate${counts.red === 1 ? '' : 's'} failing` };
  }
  if (counts.unknown > 0) return { status: 'degraded', label: 'partly unchecked' };
  return { status: 'nominal' };
}

export function ValidationPage({ host }: PanelHostProps): JSX.Element {
  const [verdict, setVerdict] = useState<ValidationVerdict | null>(null);
  const counts = rail(verdict);
  const { status, label } = state(counts);

  const vitals: RoomVital[] = [
    { label: 'healthy', value: counts ? String(counts.healthy) : null },
    { label: 'need attention', value: counts ? String(counts.red) : null, emphasis: 'bad' },
    { label: 'not checked', value: counts ? String(counts.unknown) : null, emphasis: 'warn' },
  ];

  return (
    <RoomPage
      room="validation"
      status={status}
      statusLabel={label}
      context="The overfit gates for one strategy, every signal computed by the engine on a real backtest and walk-forward. This is the out-of-sample honesty check, not the deploy preflight."
      vitals={vitals}
    >
      <ValidationPanel host={host} onVerdict={setVerdict} />
    </RoomPage>
  );
}
