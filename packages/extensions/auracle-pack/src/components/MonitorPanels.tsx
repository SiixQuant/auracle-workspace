/**
 * Monitoring panels (blotter, incidents, schedules, runway) over one shared
 * polled-feed scaffold, rendered on panelkit — the TS port of the native
 * panels' common pattern: only a completed engine round-trip renders data;
 * loading shows a skeleton, an unreachable engine shows a retry, and every
 * other state says exactly what is known. Per-row order cancel is deliberately
 * withheld until the engine's order feed carries broker_order_id (the cancel
 * route addresses the broker book, not DB rows) — an honest-control carry-over.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
  numeric,
  tint,
  tone,
} from './panelkit';

/** One list row, shared across the feeds: aligned, bottom-ruled, hoverable. */
const rowStyle = {
  display: 'flex',
  alignItems: 'center' as const,
  gap: 12,
  padding: '11px 12px',
  borderRadius: 8,
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
      icon="⚡"
      tone="danger"
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

/** A hairline-separated list of rows in a single card. */
function ListCard({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 11,
        border: `1px solid ${tone.border}`,
        background: tone.surface,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

// ── Blotter ─────────────────────────────────────────────────────────────

/** Buy green, sell red — the one glance that matters in an order row. */
function SideTag({ action }: { action?: string }): JSX.Element | null {
  if (action !== 'buy' && action !== 'sell') return null;
  const color = action === 'buy' ? tone.ok : tone.danger;
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.4,
        color,
        width: 34,
        flex: 'none',
      }}
    >
      {action.toUpperCase()}
    </span>
  );
}

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
          icon="↔"
          title="No orders yet"
          detail="When a deployed strategy places an order, it appears here."
        />
      ) : (
        <ListCard>
          {orders.map((order, index) => (
            <div
              key={order.id ?? index}
              className="apk-row"
              style={{ ...rowStyle, borderRadius: 0, borderBottom: index === orders.length - 1 ? 'none' : `1px solid ${tone.border}` }}
            >
              <SideTag action={order.action} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {order.plain ?? (`${order.action ?? ''} ${order.symbol ?? ''}`.trim() || '—')}
              </span>
              <span style={{ flex: 1 }} />
              <Pill kind={order.status === 'filled' ? 'ok' : 'muted'} dot={order.status === 'filled'}>
                {order.status ?? 'unknown'}
              </Pill>
            </div>
          ))}
        </ListCard>
      )}
    </PanelShell>
  );
}

// ── Incidents ───────────────────────────────────────────────────────────

const SEVERITY: Record<string, { color: string; pill: 'danger' | 'caution' | 'muted' }> = {
  critical: { color: tone.danger, pill: 'danger' },
  warning: { color: tone.caution, pill: 'caution' },
  info: { color: tone.text3, pill: 'muted' },
};

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
          icon="✓"
          tone="ok"
          title="All clear"
          detail={data.plain ?? 'Nothing needs your attention right now.'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {incidents.map((incident, index) => {
            const sev = SEVERITY[incident.severity ?? 'info'] ?? SEVERITY.info;
            // Critical / warning tint the whole card; info stays a plain surface.
            const tinted = incident.severity === 'critical' || incident.severity === 'warning';
            return (
              <div
                key={`${incident.dismiss_kind}:${incident.dismiss_id ?? index}`}
                className="apk-enter"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: `1px solid ${tinted ? tint(sev.color, 34) : tone.border}`,
                  background: tinted ? tint(sev.color, 8) : tone.surface,
                }}
              >
                <Pill kind={sev.pill} dot solid={incident.severity === 'critical'}>
                  {incident.severity ?? 'info'}
                </Pill>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>{incident.cause ?? ''}</span>
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
            );
          })}
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

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** Best-effort plain reading of a 5-field cron; falls back to null (raw shown). */
function humanizeCron(cron?: string): string | null {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [min, hour, , , dow] = parts;
  const time = /^\d+$/.test(hour) && /^\d+$/.test(min) ? `${hour.padStart(2, '0')}:${min.padStart(2, '0')}` : null;
  if (!time) return null;
  let days: string;
  if (dow === '*') days = 'Daily';
  else if (dow === '1-5') days = 'Weekdays';
  else if (dow === '0,6' || dow === '6,0' || dow === '0,7' || dow === '6,7') days = 'Weekends';
  // cron treats both 0 and 7 as Sunday; normalise mod 7 so `7` doesn't print "undefineds".
  else if (/^\d$/.test(dow)) days = DOW_PLURAL[Number(dow) % 7];
  else days = dow.split(',').map((d) => DOW[Number(d) % 7] ?? d).join(', ');
  return `${days} · ${time}`;
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
          icon="◷"
          title="No schedules yet"
          detail="Deploy a strategy on a cadence and it shows up here to run, pause, or remove."
        />
      ) : (
        <ListCard>
          {schedules.map((schedule, index) => {
            const human = humanizeCron(schedule.cron);
            return (
              <div
                key={schedule.id ?? schedule.name}
                className="apk-row"
                style={{ ...rowStyle, borderRadius: 0, borderBottom: index === schedules.length - 1 ? 'none' : `1px solid ${tone.border}` }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                  <span style={{ fontWeight: 600 }}>{schedule.name}</span>
                  <span style={{ fontSize: 11.5, color: tone.text3, ...numeric }}>
                    {human ?? schedule.cron ?? '—'}
                    {human && schedule.cron ? (
                      <span style={{ opacity: 0.6 }}> · {schedule.cron}</span>
                    ) : null}
                  </span>
                </div>
                <Pill kind={schedule.enabled ? 'ok' : 'muted'} dot>
                  {schedule.enabled ? 'enabled' : 'paused'}
                </Pill>
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
            );
          })}
        </ListCard>
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

const REACHED_PILL: Record<string, { label: string; kind: 'ok' | 'caution' | 'muted' }> = {
  yes: { label: 'reached', kind: 'ok' },
  partial: { label: 'in progress', kind: 'caution' },
  no: { label: 'not yet', kind: 'muted' },
  // A stage the engine reports as unknown (or omits) must NOT read as "not yet"
  // reached — that would assert a negative the engine never stated.
  unknown: { label: 'unknown', kind: 'caution' },
};

export function RunwayPanel({ host }: PanelHostProps): JSX.Element {
  const [data, reload] = usePolledFeed<{ stages?: Record<string, StageTruth> }>(
    '/ui/api/runway',
    60_000
  );
  useAiPanelContext(host, data ? runwayContext(data.stages ?? {}) : null);

  const description =
    'Research to live, one honest step at a time — each stage shows whether it has been reached, and the evidence.';
  if (data === undefined || data === null) {
    return (
      <PanelShell title="Runway" description={description}>
        {feedGate(data, reload)}
      </PanelShell>
    );
  }

  return (
    <PanelShell title="Runway" description={description}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {RUNWAY_STAGES.map((stage, i) => {
          const truth = data.stages?.[stage] ?? {};
          const reached = truth.reached ?? 'unknown';
          const pill = REACHED_PILL[reached] ?? REACHED_PILL.unknown;
          const nodeColor =
            reached === 'yes' ? tone.ok : reached === 'partial' || reached === 'unknown' ? tone.caution : tone.text3;
          const filled = reached === 'yes';
          const isLast = i === RUNWAY_STAGES.length - 1;
          return (
            <div key={stage} style={{ display: 'flex', gap: 14 }}>
              {/* node + connecting spine */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16 }}>
                <span
                  aria-hidden
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: '50%',
                    flex: 'none',
                    marginTop: 3,
                    background: filled ? nodeColor : 'transparent',
                    border: `2px solid ${nodeColor}`,
                    boxShadow: filled ? `0 0 0 3px ${tint(nodeColor, 16)}` : 'none',
                  }}
                />
                {!isLast ? (
                  <span
                    aria-hidden
                    style={{
                      flex: 1,
                      width: 2,
                      minHeight: 26,
                      margin: '4px 0',
                      background: reached === 'yes' ? tint(tone.ok, 55) : tone.border,
                    }}
                  />
                ) : null}
              </div>
              {/* label + evidence */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingBottom: isLast ? 0 : 16, minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: reached === 'no' ? tone.text3 : tone.text }}>
                    {RUNWAY_LABELS[stage]}
                  </span>
                  <Pill kind={pill.kind}>{pill.label}</Pill>
                </div>
                {truth.evidence ? (
                  <span style={{ fontSize: 12, color: tone.text3 }}>{truth.evidence}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </PanelShell>
  );
}
