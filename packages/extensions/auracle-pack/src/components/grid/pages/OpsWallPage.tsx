/**
 * Ops wall — the System district's control room (Frontier #20).
 *
 * One screen for everything live: the health of each operate room (deploys,
 * blotter, incidents, schedules), the connection and data-freshness posture,
 * and a single headline that reads the WORST of them so "is anything wrong?"
 * is answered at a glance. Nothing here is recomputed — it reads the same
 * `gridVitals` and `engineFeeds` stores the plan already polls (so it updates
 * as they do), plus the data catalog (#12) for freshness. A red room is one
 * click from its detail.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';

import { dataCatalog, type DataCatalog } from '../../../engine/client';
import { engineFeeds, gridVitals, type Health } from '../../../engine/gridVitals';
import { Button, PanelShell, SectionLabel, ToolbarSpring, tint, tone } from '../../panelkit';
import { openRoom } from '../gridNav';
import { ROOMS, type RoomId } from '../rooms';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

/** The rooms whose health the wall watches — the Operate district. */
const OPERATE_ROOMS: readonly RoomId[] = ['deploys', 'blotter', 'incidents', 'schedules'];

function healthColor(h: Health): string {
  return h === 'fault' ? tone.danger : h === 'degraded' ? tone.caution : tone.ok;
}

/** The worst of a set of healths — the wall's headline reads the worst. */
export function worst(healths: Health[]): Health {
  if (healths.includes('fault')) return 'fault';
  if (healths.includes('degraded')) return 'degraded';
  return 'nominal';
}

/** A symbol is stale if its last bar is older than five days. */
export function staleCount(catalog: DataCatalog | null): { stale: number; total: number } {
  if (!catalog) return { stale: 0, total: 0 };
  const cutoff = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  let stale = 0;
  let total = 0;
  for (const s of catalog.symbols) {
    if (s.barCount === 0 || !s.lastBar) continue;
    total += 1;
    if (s.lastBar < cutoff) stale += 1;
  }
  return { stale, total };
}

function Dot({ health }: { health: Health }): JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: healthColor(health),
        boxShadow: `0 0 0 3px ${tint(healthColor(health), 16)}`,
        flexShrink: 0,
      }}
    />
  );
}

function Tile({ label, value, tone: t }: { label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '10px 12px',
        borderRadius: 9,
        background: tone.surface,
        border: `1px solid ${tone.border}`,
        minWidth: 96,
      }}
    >
      <span style={{ fontSize: 20, fontWeight: 700, color: t ?? tone.text, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
      <span style={{ fontSize: 11, color: tone.text3, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </span>
    </div>
  );
}

export function OpsWallPage(_: PanelHostProps): JSX.Element {
  const vitals = useSyncExternalStore(gridVitals.subscribe, gridVitals.getSnapshot, gridVitals.getSnapshot);
  const feeds = useSyncExternalStore(engineFeeds.subscribe, engineFeeds.getSnapshot, engineFeeds.getSnapshot);
  const [catalog, setCatalog] = useState<DataCatalog | null>(null);

  const loadCatalog = async (): Promise<void> => {
    setCatalog(await dataCatalog());
  };
  useEffect(() => {
    void loadCatalog();
  }, []);

  const operateHealth = worst(OPERATE_ROOMS.map((r) => vitals[r].health));
  const deployed = feeds.deployments?.length ?? null;
  const connections = feeds.connections?.length ?? null;
  const fresh = staleCount(catalog);

  const status: RoomStatus =
    operateHealth === 'fault' ? 'attention' : operateHealth === 'degraded' ? 'degraded' : 'nominal';
  const label =
    operateHealth === 'fault'
      ? 'attention'
      : operateHealth === 'degraded'
        ? 'degraded'
        : fresh.stale > 0
          ? `${fresh.stale} stale`
          : 'all nominal';

  const vitalsRow: PageVital[] = [
    { label: 'deployed', value: deployed !== null ? String(deployed) : null },
    { label: 'connections', value: connections !== null ? String(connections) : null },
    {
      label: 'stale data',
      value: catalog ? String(fresh.stale) : null,
      emphasis: fresh.stale > 0 ? 'warn' : undefined,
    },
  ];

  return (
    <RoomPage room="ops" status={status} statusLabel={label} context={ROOM_CONTEXT.ops} vitals={vitalsRow}>
      <PanelShell
        title="Ops wall"
        toolbar={
          <>
            <Button variant="ghost" onClick={() => void loadCatalog()}>
              Refresh
            </Button>
            <ToolbarSpring />
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }} data-testid="ops-tiles">
            <Tile label="deployed" value={deployed !== null ? String(deployed) : '—'} />
            <Tile label="connections" value={connections !== null ? String(connections) : '—'} />
            <Tile
              label="data fresh"
              value={catalog ? `${fresh.total - fresh.stale}/${fresh.total}` : '—'}
              tone={fresh.stale > 0 ? tone.caution : tone.ok}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SectionLabel>Operate</SectionLabel>
            {OPERATE_ROOMS.map((room) => {
              const v = vitals[room];
              return (
                <button
                  key={room}
                  type="button"
                  className="apk-row"
                  data-testid={`ops-room-${room}`}
                  onClick={() => openRoom(room)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '9px 8px',
                    border: 0,
                    borderTop: `1px solid ${tone.border}`,
                    background: 'transparent',
                    font: 'inherit',
                    color: tone.text,
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  <Dot health={v.health} />
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 96 }}>{ROOMS[room].title}</span>
                  <span style={{ fontSize: 12, color: tone.text3, flex: 1, minWidth: 0 }}>
                    {v.note ?? 'nominal'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </PanelShell>
    </RoomPage>
  );
}
