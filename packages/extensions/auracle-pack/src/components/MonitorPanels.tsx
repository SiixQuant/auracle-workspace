/**
 * Monitoring panels (blotter, incidents, schedules, validation, runway) over
 * one shared polled-feed scaffold — the TS port of the native panels' common
 * pattern: only a completed engine round-trip renders data; every other state
 * says exactly what is known. Per-row order cancel is deliberately withheld
 * until the engine's order feed carries broker_order_id (the cancel route
 * addresses the broker book, not DB rows) — an honest-control carry-over.
 */
import { useCallback, useEffect, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { bumpConnectGeneration, getJson, onConnectGeneration, postJson } from '../engine/client';
import {
  BlotterOrder,
  Incident,
  StageTruth,
  blotterContext,
  incidentsContext,
  runwayContext,
} from '../engine/monitors';
import { useAiPanelContext } from './aiPanel';

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    padding: 12,
    height: '100%',
    overflow: 'auto',
    color: 'var(--text-primary, #d7dae0)',
    font: '13px/1.5 var(--font-family-ui, system-ui, sans-serif)',
  },
  note: { fontSize: 12, color: 'var(--text-tertiary, #8a8f98)' },
  error: { fontSize: 12, color: '#c4554d' },
  row: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: 10,
    padding: '6px 8px',
    borderBottom: '1px solid var(--border-primary, rgba(127,127,127,0.15))',
  },
  button: (danger?: boolean) => ({
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    border: `1px solid ${danger ? '#c4554d' : 'var(--border-primary, rgba(127,127,127,0.35))'}`,
    background: 'transparent',
    color: danger ? '#c4554d' : 'var(--text-primary, #d7dae0)',
  }),
  chip: (tone: 'ok' | 'warn' | 'muted') => ({
    fontSize: 11,
    padding: '1px 8px',
    borderRadius: 999,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    color: tone === 'ok' ? '#2ea043' : tone === 'warn' ? '#d4a017' : 'var(--text-tertiary, #8a8f98)',
    whiteSpace: 'nowrap' as const,
  }),
  input: {
    padding: '5px 8px',
    borderRadius: 6,
    fontSize: 13,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    background: 'var(--bg-primary, rgba(0,0,0,0.2))',
    color: 'var(--text-primary, #d7dae0)',
    minWidth: 280,
  },
};

/**
 * Shared polled feed: fetch → apply → interval re-poll + connect-generation
 * re-poll. `data === undefined` means loading; `null` means unreachable.
 */
function usePolledFeed<T>(path: string, intervalMs: number): [T | null | undefined, () => void] {
  const [data, setData] = useState<T | null | undefined>(undefined);
  const load = useCallback(async () => {
    setData(await getJson<T>(path));
  }, [path]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), intervalMs);
    const off = onConnectGeneration(() => void load());
    return () => {
      clearInterval(timer);
      off();
    };
  }, [load, intervalMs]);
  return [data, () => void load()];
}

function Placeholder({ state, what }: { state: 'loading' | 'unreachable'; what: string }) {
  return (
    <div style={styles.note}>
      {state === 'loading'
        ? `Loading ${what}…`
        : `The Auracle engine is not reachable, so ${what} cannot be shown.`}
    </div>
  );
}

// ── Blotter ─────────────────────────────────────────────────────────────

export function BlotterPanel({ host }: PanelHostProps): JSX.Element {
  const [data, reload] = usePolledFeed<{ orders?: BlotterOrder[] }>('/ui/api/orders', 30_000);
  const [confirming, setConfirming] = useState(false);
  useAiPanelContext(host, data ? blotterContext(data.orders ?? []) : null);
  if (data === undefined) return <div style={styles.page}><Placeholder state="loading" what="orders" /></div>;
  if (data === null) return <div style={styles.page}><Placeholder state="unreachable" what="orders" /></div>;
  const orders = data.orders ?? [];
  return (
    <div style={styles.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={styles.note}>{orders.length} order(s)</span>
        {orders.length > 0 ? (
          confirming ? (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span style={styles.error}>Cancel every open order at the broker?</span>
              <button
                type="button"
                style={styles.button(true)}
                onClick={() => {
                  setConfirming(false);
                  void postJson('/ui/api/orders/cancel-all').then(reload);
                }}
              >
                Confirm
              </button>
              <button type="button" style={styles.button()} onClick={() => setConfirming(false)}>
                Keep orders
              </button>
            </span>
          ) : (
            <button type="button" style={styles.button(true)} onClick={() => setConfirming(true)}>
              Cancel all
            </button>
          )
        ) : null}
      </div>
      {orders.map((order, index) => (
        <div key={order.id ?? index} style={styles.row}>
          <span>{order.plain ?? (`${order.action ?? ''} ${order.symbol ?? ''}`.trim() || '—')}</span>
          <span style={{ flex: 1 }} />
          <span style={styles.chip(order.status === 'filled' ? 'ok' : 'muted')}>
            {order.status ?? 'unknown'}
          </span>
        </div>
      ))}
      {orders.length === 0 ? <div style={styles.note}>No orders in the feed.</div> : null}
    </div>
  );
}

// ── Incidents ───────────────────────────────────────────────────────────

export function IncidentsPanel({ host }: PanelHostProps): JSX.Element {
  const [data, reload] = usePolledFeed<{ incidents?: Incident[]; plain?: string }>(
    '/ui/api/incidents',
    30_000
  );
  useAiPanelContext(host, data ? incidentsContext(data.incidents ?? []) : null);
  if (data === undefined) return <div style={styles.page}><Placeholder state="loading" what="incidents" /></div>;
  if (data === null) return <div style={styles.page}><Placeholder state="unreachable" what="incidents" /></div>;
  const incidents = data.incidents ?? [];
  return (
    <div style={styles.page}>
      {incidents.length === 0 ? (
        <div style={styles.note}>{data.plain ?? 'Nothing needs your attention right now.'}</div>
      ) : null}
      {incidents.map((incident, index) => (
        <div key={`${incident.dismiss_kind}:${incident.dismiss_id ?? index}`} style={styles.row}>
          <span style={styles.chip(incident.severity === 'critical' ? 'warn' : 'muted')}>
            {incident.severity ?? 'info'}
          </span>
          <span>
            {incident.cause ?? ''}
            {incident.detail ? <span style={styles.note}> — {incident.detail}</span> : null}
          </span>
          <span style={{ flex: 1 }} />
          {incident.dismiss_kind && incident.dismiss_id !== undefined ? (
            <button
              type="button"
              style={styles.button()}
              onClick={() =>
                void postJson('/ui/api/alerts/dismiss', {
                  kind: incident.dismiss_kind,
                  id: incident.dismiss_id,
                }).then(reload)
              }
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ── Schedules ───────────────────────────────────────────────────────────

interface ScheduleRow {
  id?: number;
  name: string;
  strategy_path?: string;
  cron?: string;
  enabled?: boolean;
}

export function SchedulesPanel(_props: PanelHostProps): JSX.Element {
  const [data, reload] = usePolledFeed<{ schedules?: ScheduleRow[] }>(
    '/ui/api/schedules.json',
    30_000
  );
  if (data === undefined) return <div style={styles.page}><Placeholder state="loading" what="schedules" /></div>;
  if (data === null) return <div style={styles.page}><Placeholder state="unreachable" what="schedules" /></div>;
  const schedules = data.schedules ?? [];
  const act = (name: string, verb: string) =>
    void postJson(`/ui/api/schedules/${encodeURIComponent(name)}/${verb}`).then(() => {
      bumpConnectGeneration();
      reload();
    });
  return (
    <div style={styles.page}>
      {schedules.map((schedule) => (
        <div key={schedule.id ?? schedule.name} style={styles.row}>
          <span style={{ fontWeight: 500 }}>{schedule.name}</span>
          <span style={styles.note}>{schedule.cron ?? ''}</span>
          <span style={styles.chip(schedule.enabled ? 'ok' : 'muted')}>
            {schedule.enabled ? 'enabled' : 'paused'}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" style={styles.button()} onClick={() => act(schedule.name, 'run')}>
            Run now
          </button>
          <button type="button" style={styles.button()} onClick={() => act(schedule.name, 'toggle')}>
            {schedule.enabled ? 'Pause' : 'Resume'}
          </button>
          <button type="button" style={styles.button(true)} onClick={() => act(schedule.name, 'delete')}>
            Delete
          </button>
        </div>
      ))}
      {schedules.length === 0 ? <div style={styles.note}>No schedules defined.</div> : null}
    </div>
  );
}

// ── Validation ──────────────────────────────────────────────────────────

// ── Runway ──────────────────────────────────────────────────────────────

const RUNWAY_STAGES = ['research', 'build', 'validate', 'paper', 'go_live', 'monitor'] as const;
const RUNWAY_LABELS: Record<(typeof RUNWAY_STAGES)[number], string> = {
  research: 'Research',
  build: 'Build',
  validate: 'Validate',
  paper: 'Paper',
  go_live: 'Go live',
  monitor: 'Monitor',
};

export function RunwayPanel({ host }: PanelHostProps): JSX.Element {
  const [data] = usePolledFeed<{ stages?: Record<string, StageTruth> }>('/ui/api/runway', 60_000);
  useAiPanelContext(host, data ? runwayContext(data.stages ?? {}) : null);
  if (data === undefined) return <div style={styles.page}><Placeholder state="loading" what="the runway" /></div>;
  if (data === null) return <div style={styles.page}><Placeholder state="unreachable" what="the runway" /></div>;
  return (
    <div style={styles.page}>
      {RUNWAY_STAGES.map((stage) => {
        const truth = data.stages?.[stage] ?? {};
        const tone = truth.reached === 'yes' ? 'ok' : truth.reached === 'no' ? 'muted' : 'warn';
        return (
          <div key={stage} style={styles.row}>
            <span style={{ fontWeight: 500, minWidth: 70 }}>{RUNWAY_LABELS[stage]}</span>
            <span style={styles.chip(tone)}>{truth.reached ?? 'unknown'}</span>
            <span style={styles.note}>{truth.evidence ?? ''}</span>
          </div>
        );
      })}
    </div>
  );
}
