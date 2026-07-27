/**
 * Blotter — the Operate district's order book.
 *
 * The body is the existing blotter surface, mounted whole: every order the
 * engine has placed, newest first, with its status and the confirm-guarded
 * cancel-all. Per-row cancel is deliberately absent there and stays absent
 * here — the cancel route addresses the broker book, and the feed does not yet
 * carry the broker order id an honest per-row control would need.
 *
 * Vitals are the panel's own feed, reported up as it polls, so the page never
 * counts the book a second time and reaches a different total.
 */
import { useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { BlotterPanel, type BlotterSummary } from '../../MonitorPanels';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

function state(book: BlotterSummary | null): { status: RoomStatus; label?: string } {
  if (!book || book.phase === 'loading') return { status: 'degraded', label: 'reading' };
  if (book.phase === 'unreachable') return { status: 'attention', label: 'engine unreachable' };
  if (book.orders === 0) return { status: 'nominal', label: 'no orders yet' };
  return { status: 'nominal' };
}

/** A count the feed actually reported, or null for the frame's placeholder. */
function figure(n: number | null | undefined): string | null {
  return typeof n === 'number' ? String(n) : null;
}

export function BlotterPage({ host }: PanelHostProps): JSX.Element {
  const [book, setBook] = useState<BlotterSummary | null>(null);
  const { status, label } = state(book);

  const vitals: PageVital[] = [
    { label: 'orders', value: figure(book?.orders) },
    { label: 'filled', value: figure(book?.filled) },
    { label: 'working', value: figure(book?.working) },
  ];

  return (
    <RoomPage
      room="blotter"
      status={status}
      statusLabel={label}
      context={`${ROOM_CONTEXT.blotter} Newest first, each with the status the engine last read back — the record of what was actually placed, not what a strategy intended.`}
      vitals={vitals}
    >
      <div data-testid="grid-page-blotter">
        <BlotterPanel host={host} onSummary={setBook} />
      </div>
    </RoomPage>
  );
}
