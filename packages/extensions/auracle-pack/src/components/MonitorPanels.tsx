/**
 * Monitoring panels (blotter, incidents, schedules, runway) over one shared
 * polled-feed scaffold, rendered on panelkit — the TS port of the native
 * panels' common pattern: only a completed engine round-trip renders data;
 * loading shows a skeleton, an unreachable engine shows a retry, and every
 * other state says exactly what is known. Per-row order cancel is deliberately
 * withheld until the engine's order feed carries broker_order_id (the cancel
 * route addresses the broker book, not DB rows) — an honest-control carry-over.
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
import {
  Button,
  CenterState,
  InlineNote,
  PanelShell,
  Pill,
  SkeletonRows,
  ToolbarSpring,
  tone,
} from './panelkit';

/** One list row, shared across the feeds: aligned, bottom-ruled, dense. */
const rowStyle = {
  display: 'flex',
  alignItems: 'center' as const,
  gap: 10,
  padding: '9px 2px',
  borderBottom: `1px solid ${tone.border}`,
  fontSize: 13,
  color: tone.text,
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

/**
 * Loading / unreachable gate for a polled feed — the content states are the
 * design: a shaped skeleton while the first round-trip is in flight, a named
 * retry when the engine didn't answer. Rendered inside each panel's shell.
 */
function feedGate(data: null | undefined, reload: () => void): JSX.Element {
  return data === undefined ? (
    <SkeletonRows rows={4} />
  ) : (
    <CenterState
      title="The engine didn't respond"
      detail="This panel reads from your local Auracle engine. Make sure the stack is running, then retry."
      actions={
        <Button variant="primary" onClick={reload}>
          Retry
        </Button>
      }
    />
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ── Blotter ─────────────────────────────────────────────────────────────

export function BlotterPanel({ host }: PanelHostProps): JSX.Element {
  const [data, reload] = usePolledFeed<{ orders?: BlotterOrder[] }>('/ui/api/orders', 30_000);
  const [confirming, setConfirming] = useState(false);
  useAiPanelContext(host, data ? blotterContext(data.orders ?? []) : null);

  const description = 'Every order your engine has placed, most recent first.';
  if (data === undefined || data === null) {
    return (
      <PanelShell title="Blotter" description={description}>
        {feedGate(data, reload)}
      </PanelShell>
    );
  }

  const orders = data.orders ?? [];
  const cancelAll = () => {
    setConfirming(false);
    void postJson('/ui/api/orders/cancel-all').then(reload);
  };

  return (
    <PanelShell
      title="Blotter"
      description={description}
      meta={orders.length > 0 ? plural(orders.length, 'order', 'orders') : undefined}
      toolbar={
        orders.length > 0 ? (
          <>
            <ToolbarSpring />
            {confirming ? (
              <>
                <InlineNote kind="err">Cancel every open order at the broker?</InlineNote>
                <Button variant="danger" onClick={cancelAll}>
                  Confirm cancel
                </Button>
                <Button variant="quiet" onClick={() => setConfirming(false)}>
                  Keep orders
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Cancel all
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {orders.length === 0 ? (
        <CenterState
          title="No orders yet"
          detail="When a deployed strategy places an order, it appears here."
        />
      ) : (
        <div>
          {orders.map((order, index) => (
            <div key={order.id ?? index} style={rowStyle}>
              <span>{order.plain ?? (`${order.action ?? ''} ${order.symbol ?? ''}`.trim() || '—')}</span>
              <span style={{ flex: 1 }} />
              <Pill kind={order.status === 'filled' ? 'ok' : 'muted'}>
                {order.status ?? 'unknown'}
              </Pill>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

// ── Incidents ───────────────────────────────────────────────────────────

export function IncidentsPanel({ host }: PanelHostProps): JSX.Element {
  const [data, reload] = usePolledFeed<{ incidents?: Incident[]; plain?: string }>(
    '/ui/api/incidents',
    30_000
  );
  useAiPanelContext(host, data ? incidentsContext(data.incidents ?? []) : null);

  const description = 'Anything that needs your attention across the running system.';
  if (data === undefined || data === null) {
    return (
      <PanelShell title="Incidents" description={description}>
        {feedGate(data, reload)}
      </PanelShell>
    );
  }

  const incidents = data.incidents ?? [];
  return (
    <PanelShell
      title="Incidents"
      description={description}
      meta={incidents.length > 0 ? plural(incidents.length, 'open', 'open') : undefined}
    >
      {incidents.length === 0 ? (
        <CenterState
          title="All clear"
          detail={data.plain ?? 'Nothing needs your attention right now.'}
        />
      ) : (
        <div>
          {incidents.map((incident, index) => (
            <div key={`${incident.dismiss_kind}:${incident.dismiss_id ?? index}`} style={rowStyle}>
              <Pill
                kind={
                  incident.severity === 'critical'
                    ? 'danger'
                    : incident.severity === 'warning'
                      ? 'caution'
                      : 'muted'
                }
              >
                {incident.severity ?? 'info'}
              </Pill>
              <span style={{ minWidth: 0 }}>
                {incident.cause ?? ''}
                {incident.detail ? (
                  <span style={{ color: tone.text3 }}> — {incident.detail}</span>
                ) : null}
              </span>
              <span style={{ flex: 1 }} />
              {incident.dismiss_kind && incident.dismiss_id !== undefined ? (
                <Button
                  variant="quiet"
                  onClick={() =>
                    void postJson('/ui/api/alerts/dismiss', {
                      kind: incident.dismiss_kind,
                      id: incident.dismiss_id,
                    }).then(reload)
                  }
                >
                  Dismiss
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </PanelShell>
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

  const description = 'Strategies set to run on a cron cadence.';
  if (data === undefined || data === null) {
    return (
      <PanelShell title="Schedules" description={description}>
        {feedGate(data, reload)}
      </PanelShell>
    );
  }

  const schedules = data.schedules ?? [];
  const act = (name: string, verb: string) =>
    void postJson(`/ui/api/schedules/${encodeURIComponent(name)}/${verb}`).then(() => {
      bumpConnectGeneration();
      reload();
    });

  return (
    <PanelShell
      title="Schedules"
      description={description}
      meta={schedules.length > 0 ? plural(schedules.length, 'scheduled', 'scheduled') : undefined}
    >
      {schedules.length === 0 ? (
        <CenterState
          title="No schedules yet"
          detail="Deploy a strategy on a cadence and it shows up here to run, pause, or remove."
        />
      ) : (
        <div>
          {schedules.map((schedule) => (
            <div key={schedule.id ?? schedule.name} style={rowStyle}>
              <span style={{ fontWeight: 500 }}>{schedule.name}</span>
              {schedule.cron ? (
                <span style={{ color: tone.text3, fontVariantNumeric: 'tabular-nums' }}>
                  {schedule.cron}
                </span>
              ) : null}
              <Pill kind={schedule.enabled ? 'ok' : 'muted'}>
                {schedule.enabled ? 'enabled' : 'paused'}
              </Pill>
              <span style={{ flex: 1 }} />
              <Button variant="quiet" onClick={() => act(schedule.name, 'run')}>
                Run now
              </Button>
              <Button variant="quiet" onClick={() => act(schedule.name, 'toggle')}>
                {schedule.enabled ? 'Pause' : 'Resume'}
              </Button>
              <Button variant="danger" onClick={() => act(schedule.name, 'delete')}>
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

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
  const [data, reload] = usePolledFeed<{ stages?: Record<string, StageTruth> }>(
    '/ui/api/runway',
    60_000
  );
  useAiPanelContext(host, data ? runwayContext(data.stages ?? {}) : null);

  const description = 'Research to live, one honest step at a time — each stage shows whether it has been reached, and the evidence.';
  if (data === undefined || data === null) {
    return (
      <PanelShell title="Runway" description={description}>
        {feedGate(data, reload)}
      </PanelShell>
    );
  }

  return (
    <PanelShell title="Runway" description={description}>
      <div>
        {RUNWAY_STAGES.map((stage) => {
          const truth = data.stages?.[stage] ?? {};
          const kind = truth.reached === 'yes' ? 'ok' : truth.reached === 'no' ? 'muted' : 'caution';
          return (
            <div key={stage} style={rowStyle}>
              <span style={{ fontWeight: 500, minWidth: 74 }}>{RUNWAY_LABELS[stage]}</span>
              <Pill kind={kind}>{truth.reached ?? 'unknown'}</Pill>
              {truth.evidence ? <span style={{ color: tone.text3 }}>{truth.evidence}</span> : null}
            </div>
          );
        })}
      </div>
    </PanelShell>
  );
}
