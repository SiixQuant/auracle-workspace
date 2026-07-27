/**
 * Connections — the System district's wiring room.
 *
 * READ-ONLY on purpose. Credentials are edited in exactly one place (Settings →
 * Extensions → Auracle Connections); this room answers the operating question
 * the plan raises — is the broker up, is the data source up — without becoming a
 * second form that could disagree with the first about what is saved.
 *
 * Same source of truth as that Settings page, deliberately at three levels: the
 * same route (`/ui/api/connections?kind=all`, which is also what the sheet's own
 * reading polls), the same `normalizeConnector`, and the same `connectorTag`
 * rule — so one connector cannot be "Connected" here and "Not configured"
 * there.
 *
 * No deep link out: a panel can open its OWN settings view, but the host exposes
 * no way to open the Settings window at another extension's page, and inventing
 * a control that silently does nothing is worse than naming the location. So
 * the room names it in words.
 */
import { useCallback, useEffect, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { getJsonDetailed, onConnectGeneration } from '../../../engine/client';
import {
  connectorTag,
  isConnected,
  normalizeConnector,
  type Connector,
} from '../../../engine/model';
import { classifyLoadFailure, type LoadFailure } from '../../../engine/research';
import {
  Button,
  CenterState,
  InlineNote,
  PanelShell,
  Pill,
  SkeletonRows,
  ToolbarSpring,
  tone,
} from '../../panelkit';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

type ListState =
  | { phase: 'loading' }
  | { phase: 'failed'; why: LoadFailure }
  | { phase: 'ready'; connectors: Connector[] };

/** Where management actually lives — stated, not linked (see the file note). */
const MANAGE_WHERE =
  'Keys and credentials are managed in Settings → Extensions → Auracle Connections.';

/** The engine's kind slug, in the words the rest of the product uses. */
const KIND_LABEL: Record<string, string> = {
  broker: 'Broker',
  data_provider: 'Data source',
  integration: 'Integration',
};

/** Connector states that mean "wired but not healthy" — the same set the
 *  sheet's reading uses, so the room and the plan agree on what degraded is. */
const DEGRADED_STATES = new Set(['degraded', 'disconnected', 'connecting', 'reconnecting']);

function counts(connectors: Connector[]): {
  total: number;
  connected: number;
  degraded: number;
  errored: number;
} {
  return {
    total: connectors.length,
    connected: connectors.filter((row) => isConnected(row.status)).length,
    degraded: connectors.filter((row) => DEGRADED_STATES.has(row.status?.state ?? '')).length,
    errored: connectors.filter((row) => row.status?.state === 'error').length,
  };
}

function state(list: ListState): { status: RoomStatus; label?: string } {
  if (list.phase === 'loading') return { status: 'degraded', label: 'reading' };
  if (list.phase === 'failed') {
    return {
      status: 'attention',
      label: list.why === 'outdated' ? 'engine outdated' : 'engine unreachable',
    };
  }
  const { total, errored, degraded } = counts(list.connectors);
  if (total === 0) return { status: 'nominal', label: 'none available' };
  if (errored > 0) return { status: 'attention', label: `${errored} in error` };
  if (degraded > 0) return { status: 'degraded', label: `${degraded} degraded` };
  return { status: 'nominal' };
}

function ConnectorRow({ connector }: { connector: Connector }): JSX.Element {
  const tag = connectorTag(connector);
  return (
    <div
      data-testid={`conns-row-${connector.id}`}
      className="apk-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '11px 12px',
        borderTop: `1px solid ${tone.border}`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 200 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: tone.text }}>
          {connector.display_label || connector.id}
        </span>
        {connector.blurb ? (
          <span style={{ fontSize: 11.5, color: tone.text3 }}>{connector.blurb}</span>
        ) : null}
      </div>
      <span
        data-testid={`conns-kind-${connector.id}`}
        style={{ fontSize: 11.5, color: tone.text3, whiteSpace: 'nowrap' }}
      >
        {KIND_LABEL[connector.kind] ?? connector.kind ?? ''}
      </span>
      {connector.gated ? <Pill kind="caution">Upgrade</Pill> : null}
      <span data-testid={`conns-status-${connector.id}`}>
        <Pill kind={tag.kind} dot>
          {tag.label}
        </Pill>
      </span>
    </div>
  );
}

export function ConnsPage(_props: PanelHostProps): JSX.Element {
  const [list, setList] = useState<ListState>({ phase: 'loading' });

  const load = useCallback(async () => {
    const result = await getJsonDetailed<{
      connections?: Array<Partial<Connector> & { id: string }>;
    }>('/ui/api/connections?kind=all');
    if (!result.ok) {
      setList({ phase: 'failed', why: classifyLoadFailure(result.status) });
      return;
    }
    setList({
      phase: 'ready',
      connectors: (result.body.connections ?? []).map(normalizeConnector),
    });
  }, []);

  useEffect(() => {
    void load();
    // A save or disconnect on the Settings page bumps the generation, so this
    // list follows it immediately instead of showing a stale status.
    return onConnectGeneration(() => void load());
  }, [load]);

  const { status, label } = state(list);
  const ready = list.phase === 'ready' ? counts(list.connectors) : null;

  const vitals: PageVital[] = [
    { label: 'connected', value: ready ? `${ready.connected} of ${ready.total}` : null },
    {
      label: 'degraded',
      value: ready ? String(ready.degraded) : null,
      emphasis: 'warn',
    },
    { label: 'in error', value: ready ? String(ready.errored) : null, emphasis: 'bad' },
  ];

  return (
    <RoomPage
      room="conns"
      status={status}
      statusLabel={label}
      context={`${ROOM_CONTEXT.conns} What each one reports right now, read from the engine's own registry — the keys behind them are edited in one place, named below.`}
      vitals={vitals}
    >
      <div data-testid="grid-page-conns">
        <PanelShell
          title="Connections"
          toolbar={
            <>
              <Button variant="ghost" testId="conns-refresh" onClick={() => void load()}>
                Refresh
              </Button>
              <ToolbarSpring />
              <InlineNote kind="muted" testId="conns-manage-note">
                {MANAGE_WHERE}
              </InlineNote>
            </>
          }
        >
          {list.phase === 'loading' ? (
            <SkeletonRows rows={4} />
          ) : list.phase === 'failed' ? (
            <CenterState
              icon="⚡"
              tone={list.why === 'outdated' ? undefined : 'danger'}
              title={
                list.why === 'outdated'
                  ? 'Engine update required'
                  : "The engine didn't respond"
              }
              detail={
                list.why === 'outdated'
                  ? 'This engine build does not serve the connection registry. Update the Auracle stack from the launcher, then re-check.'
                  : 'Connections are reported by your local Auracle engine. Make sure the stack is running, then retry.'
              }
              actions={
                <Button variant="primary" onClick={() => void load()}>
                  Retry
                </Button>
              }
            />
          ) : list.connectors.length === 0 ? (
            <CenterState
              icon="○"
              title="No connectors reported"
              detail="This engine listed no brokers, data sources or integrations."
            />
          ) : (
            <div
              className="apk-enter"
              data-testid="conns-list"
              style={{
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 11,
                border: `1px solid ${tone.border}`,
                background: tone.surface,
                overflow: 'hidden',
              }}
            >
              {list.connectors.map((connector) => (
                <ConnectorRow key={connector.id} connector={connector} />
              ))}
            </div>
          )}
        </PanelShell>
      </div>
    </RoomPage>
  );
}
