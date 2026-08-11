/**
 * Audit — the System district's provenance ledger (Frontier #17).
 *
 * The append-only record of what happened on this install: security events
 * (logins, broker swaps, order placement) the engine has always kept, plus
 * every backtest now (tied to its reproducibility hash). This room is the
 * browsable surface over the engine's owner-only `/ui/api/audit`, read through
 * the dense DataGrid, newest first. The read is owner-only by design (it can
 * carry IP addresses and login traces), so a non-owner sees an honest "owner
 * only" state rather than an empty table.
 */
import { useCallback, useEffect, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';

import { auditLog, type AuditEntry, type AuditResult } from '../../../engine/client';
import { EM_DASH } from '../../../engine/houseStats';
import {
  Button,
  CenterState,
  PanelShell,
  SkeletonRows,
  ToolbarSpring,
  tone,
} from '../../panelkit';
import { DataGrid, type Column } from '../DataGrid';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; result: AuditResult };

/** The engine's ISO stamp as a readable local-ish "YYYY-MM-DD HH:MM". */
function whenLabel(ts: string | null): string {
  if (!ts) return EM_DASH;
  return ts.slice(0, 16).replace('T', ' ');
}

export function auditColumns(): Column<AuditEntry>[] {
  return [
    { key: 'when', header: 'When', value: (r) => whenLabel(r.ts), title: (r) => r.ts ?? undefined },
    {
      key: 'event',
      header: 'Event',
      value: (r) => <code style={{ fontFamily: tone.mono, color: tone.text2 }}>{r.event}</code>,
    },
    { key: 'detail', header: 'Detail', value: (r) => r.detail ?? EM_DASH, title: (r) => r.detail ?? undefined },
    { key: 'user', header: 'User', value: (r) => r.userEmail ?? EM_DASH },
  ];
}

function state(s: State): { status: RoomStatus; label?: string } {
  if (s.phase === 'loading') return { status: 'degraded', label: 'reading' };
  if (s.result.kind === 'unavailable') return { status: 'attention', label: 'engine unreachable' };
  if (s.result.kind === 'forbidden') return { status: 'degraded', label: 'owner only' };
  if (s.result.rows.length === 0) return { status: 'nominal', label: 'no activity yet' };
  return { status: 'nominal' };
}

export function AuditPage(_: PanelHostProps): JSX.Element {
  const [s, setS] = useState<State>({ phase: 'loading' });

  const load = useCallback(async () => {
    setS({ phase: 'loading' });
    setS({ phase: 'ready', result: await auditLog(200) });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = s.phase === 'ready' && s.result.kind === 'ok' ? s.result.rows : null;
  const total = s.phase === 'ready' && s.result.kind === 'ok' ? s.result.total : null;
  const { status, label } = state(s);

  const vitals: PageVital[] = [
    { label: 'events', value: total !== null ? String(total) : null },
    { label: 'shown', value: rows !== null ? String(rows.length) : null },
  ];

  return (
    <RoomPage
      room="audit"
      status={status}
      statusLabel={label}
      context={ROOM_CONTEXT.audit}
      vitals={vitals}
    >
      <PanelShell
        title="Audit trail"
        toolbar={
          <>
            <Button variant="ghost" onClick={() => void load()}>
              Refresh
            </Button>
            <ToolbarSpring />
          </>
        }
      >
        {s.phase === 'loading' ? (
          <SkeletonRows rows={6} />
        ) : s.result.kind === 'unavailable' ? (
          <CenterState
            title="The engine didn't respond"
            detail="The audit trail is read from your local Auracle engine. Make sure the stack is running, then retry."
            actions={
              <Button variant="primary" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        ) : s.result.kind === 'forbidden' ? (
          <CenterState
            title="Owner only"
            detail="The audit trail can carry IP addresses and sign-in traces, so only the install's owner may read it. Sign in as the owner to view it here."
          />
        ) : s.result.rows.length === 0 ? (
          <CenterState
            title="No activity yet"
            detail="Nothing has been recorded. Sign-ins, connection changes, backtests and deployments show up here as they happen."
          />
        ) : (
          <DataGrid
            testId="audit-grid"
            label="Audit trail"
            columns={auditColumns()}
            rows={s.result.rows}
            rowKey={(r) => r.id}
          />
        )}
      </PanelShell>
    </RoomPage>
  );
}
