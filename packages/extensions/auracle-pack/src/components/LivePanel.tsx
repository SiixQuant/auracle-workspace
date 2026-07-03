/**
 * Live Algorithms panel (fullscreen): deployments table with per-row ledger
 * expansion and lifecycle actions, plus the Deploy wizard. Honesty rules:
 * lifecycle buttons render only what the engine allows for the row's state,
 * Liquidate always confirms, the broker list comes from the engine (never a
 * hardcoded set), and every number shown is an engine value.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { getJson, onConnectGeneration, postJson } from '../engine/client';
import { Connector, isConnected, normalizeConnector } from '../engine/model';
import {
  ACTION_LABELS,
  COMPUTE_LABELS,
  Compute,
  DeployWizard,
  Deployment,
  DeploymentOrders,
  LiveAction,
  LiveAlgorithms,
  availableActions,
  canDeploy,
  formatReturn,
  isActive,
  isDestructive,
  newWizard,
  selectedDeployment,
  setRows,
  stateLabel,
  toRequest,
  validateWizard,
  verbEndpoint,
} from '../engine/live';

const POLL_MS = 20_000;

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
    padding: 16,
    height: '100%',
    overflow: 'auto',
    color: 'var(--text-primary, #d7dae0)',
    font: '13px/1.5 var(--font-family-ui, system-ui, sans-serif)',
  },
  headerRow: { display: 'flex', alignItems: 'center' as const, justifyContent: 'space-between' as const },
  title: { fontSize: 15, fontWeight: 600 },
  button: (primary?: boolean, danger?: boolean) => ({
    padding: '5px 12px',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    border: `1px solid ${danger ? '#c4554d' : 'var(--border-primary, rgba(127,127,127,0.35))'}`,
    background: primary ? 'var(--accent-primary, #0053fd)' : 'transparent',
    color: primary ? '#fff' : danger ? '#c4554d' : 'var(--text-primary, #d7dae0)',
  }),
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: {
    textAlign: 'left' as const,
    padding: '6px 8px',
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    color: 'var(--text-tertiary, #8a8f98)',
    borderBottom: '1px solid var(--border-primary, rgba(127,127,127,0.25))',
  },
  td: { padding: '7px 8px', borderBottom: '1px solid var(--border-primary, rgba(127,127,127,0.15))' },
  note: { fontSize: 12, color: 'var(--text-tertiary, #8a8f98)' },
  input: {
    width: '100%',
    maxWidth: 360,
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 13,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    background: 'var(--bg-primary, rgba(0,0,0,0.2))',
    color: 'var(--text-primary, #d7dae0)',
  },
  fieldLabel: { fontSize: 12, color: 'var(--text-secondary, #b9bec7)', marginBottom: 4 },
  error: { fontSize: 12, color: '#c4554d' },
};

interface StrategyOption {
  path: string;
  cls: string;
  label: string;
}

function DeployWizardView({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [wizard, setWizard] = useState<DeployWizard>(newWizard());
  const [brokers, setBrokers] = useState<Connector[]>([]);
  const [dataProviders, setDataProviders] = useState<Connector[]>([]);
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const connections = await getJson<{ connections?: Array<Partial<Connector> & { id: string }> }>(
        '/ui/api/connections?kind=all'
      );
      const all = (connections?.connections ?? []).map(normalizeConnector);
      setBrokers(all.filter((connector) => connector.kind === 'broker'));
      setDataProviders(all.filter((connector) => connector.kind === 'data_provider'));

      const strategiesBody = await getJson<{
        strategies?: Array<{ path?: string; strategy_path?: string; cls?: string; strategy_cls?: string; name?: string; label?: string }>;
      }>('/ui/api/backtest/strategies');
      const options = (strategiesBody?.strategies ?? [])
        .map((raw) => {
          const path = raw.strategy_path ?? raw.path ?? '';
          const cls = raw.strategy_cls ?? raw.cls ?? '';
          return { path, cls, label: raw.label ?? raw.name ?? (path && cls ? `${path} · ${cls}` : path || cls) };
        })
        .filter((option) => option.path.length > 0);
      setStrategies(options);
    })();
  }, []);

  const errors = useMemo(() => validateWizard(wizard), [wizard]);

  const submit = async () => {
    setSubmitting(true);
    setServerError(null);
    const response = await postJson('/deploy/live', toRequest(wizard));
    setSubmitting(false);
    if (response.ok) {
      onDone();
    } else {
      const body = (response.body ?? {}) as { detail?: unknown };
      setServerError(
        typeof body.detail === 'string'
          ? body.detail
          : `Deploy rejected (${response.status || 'engine unreachable'}).`
      );
    }
  };

  const set = (patch: Partial<DeployWizard>) => setWizard((prev) => ({ ...prev, ...patch }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
      <div>
        <div style={styles.fieldLabel}>Name</div>
        <input style={styles.input} value={wizard.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div>
        <div style={styles.fieldLabel}>Mode</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['paper', 'live'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              style={styles.button(wizard.mode === mode)}
              onClick={() => set({ mode })}
            >
              {mode === 'paper' ? 'Paper' : 'Live'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div style={styles.fieldLabel}>Strategy</div>
        <select
          style={styles.input}
          value={wizard.strategy_path && wizard.strategy_cls ? `${wizard.strategy_path}::${wizard.strategy_cls}` : ''}
          onChange={(e) => {
            const [path, cls] = e.target.value.split('::');
            set({ strategy_path: path ?? '', strategy_cls: cls ?? '' });
          }}
        >
          <option value="">Select a strategy…</option>
          {strategies.map((option) => (
            <option key={`${option.path}::${option.cls}`} value={`${option.path}::${option.cls}`}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div style={styles.fieldLabel}>Brokerage</div>
        <select
          style={styles.input}
          value={wizard.broker ?? ''}
          onChange={(e) => set({ broker: e.target.value || null })}
        >
          <option value="">Select a brokerage…</option>
          {brokers.map((broker) => (
            <option key={broker.id} value={broker.id}>
              {(broker.display_label || broker.id) +
                (isConnected(broker.status) ? '' : ' (not connected)')}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div style={styles.fieldLabel}>Starting capital / AUM {wizard.mode === 'live' ? '(required)' : '(optional for paper)'}</div>
        <input
          style={styles.input}
          inputMode="decimal"
          placeholder="100000"
          value={wizard.aum ?? ''}
          onChange={(e) => {
            const cleaned = e.target.value.replace(/[$,\s]/g, '');
            const parsed = cleaned.length > 0 ? Number(cleaned) : null;
            set({ aum: parsed !== null && Number.isFinite(parsed) ? parsed : null });
          }}
        />
      </div>
      <div>
        <div style={styles.fieldLabel}>Compute</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(Object.keys(COMPUTE_LABELS) as Compute[]).map((compute) => (
            <button
              key={compute}
              type="button"
              style={styles.button(wizard.compute === compute)}
              onClick={() => set({ compute })}
            >
              {COMPUTE_LABELS[compute]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div style={styles.fieldLabel}>Data sources</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {dataProviders.map((provider) => {
            const checked = wizard.data_providers.includes(provider.id);
            return (
              <button
                key={provider.id}
                type="button"
                style={styles.button(checked)}
                onClick={() =>
                  set({
                    data_providers: checked
                      ? wizard.data_providers.filter((id) => id !== provider.id)
                      : [...wizard.data_providers, provider.id],
                  })
                }
              >
                {provider.display_label || provider.id}
              </button>
            );
          })}
          {dataProviders.length === 0 ? <span style={styles.note}>None reported by the engine.</span> : null}
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={wizard.auto_restart}
          onChange={(e) => set({ auto_restart: e.target.checked })}
        />
        Automatically restart the algorithm after interruptions
      </label>

      {errors.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {errors.map((error) => (
            <div key={error} style={styles.error}>
              {error}
            </div>
          ))}
        </div>
      ) : null}
      {serverError ? <div style={styles.error}>{serverError}</div> : null}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          style={styles.button(true)}
          disabled={!canDeploy(wizard) || submitting}
          onClick={() => void submit()}
        >
          {submitting ? 'Deploying…' : 'Deploy'}
        </button>
        <button type="button" style={styles.button()} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function LedgerView({ deployment }: { deployment: Deployment }) {
  const [ledger, setLedger] = useState<DeploymentOrders | null | 'unavailable'>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const body = await getJson<DeploymentOrders>(`/deployments/${deployment.id}/orders`);
      if (!cancelled) setLedger(body ?? 'unavailable');
    })();
    return () => {
      cancelled = true;
    };
  }, [deployment.id]);

  if (ledger === null) return <div style={styles.note}>Loading ledger…</div>;
  if (ledger === 'unavailable') {
    return (
      <div style={styles.note}>
        The engine did not serve a ledger for this deployment (older engine versions lack the
        per-deployment orders feed).
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 8px 10px' }}>
      <table style={styles.table}>
        <thead>
          <tr>
            {['Symbol', 'Action', 'Qty', 'Filled', 'Avg price', 'Status', 'Placed'].map((h) => (
              <th key={h} style={styles.th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ledger.orders.map((order) => (
            <tr key={order.id}>
              <td style={styles.td}>{order.symbol}</td>
              <td style={styles.td}>{order.action}</td>
              <td style={styles.td}>{order.quantity ?? '—'}</td>
              <td style={styles.td}>{order.filled_quantity ?? '—'}</td>
              <td style={styles.td}>{order.avg_fill_price ?? '—'}</td>
              <td style={styles.td}>{order.status}</td>
              <td style={styles.td}>{order.created_at ?? '—'}</td>
            </tr>
          ))}
          {ledger.orders.length === 0 ? (
            <tr>
              <td style={styles.td} colSpan={7}>
                <span style={styles.note}>No orders yet.</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function LiveAlgorithmsPanel(_props: PanelHostProps): JSX.Element {
  const [model, setModel] = useState<LiveAlgorithms>({ rows: [], selected: null });
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unreachable'>('loading');
  const [view, setView] = useState<'table' | 'wizard'>('table');
  const [pendingConfirm, setPendingConfirm] = useState<{ id: number; action: LiveAction } | null>(null);

  const load = useCallback(async () => {
    const rows = await getJson<Deployment[]>('/deployments');
    if (rows) {
      setModel((prev) => setRows(prev, rows));
      setPhase('ready');
    } else {
      setPhase('unreachable');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const offGeneration = onConnectGeneration(() => void load());
    return () => {
      clearInterval(timer);
      offGeneration();
    };
  }, [load]);

  const dispatch = async (id: number, action: LiveAction) => {
    if (isDestructive(action) && pendingConfirm?.id !== id) {
      setPendingConfirm({ id, action });
      return;
    }
    setPendingConfirm(null);
    await postJson(verbEndpoint(id, action));
    await load();
  };

  if (view === 'wizard') {
    return (
      <div style={styles.page}>
        <div style={styles.headerRow}>
          <span style={styles.title}>Deploy</span>
        </div>
        <DeployWizardView
          onDone={() => {
            setView('table');
            void load();
          }}
          onCancel={() => setView('table')}
        />
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <span style={styles.title}>Live Algorithms</span>
        <button type="button" style={styles.button(true)} onClick={() => setView('wizard')}>
          Deploy
        </button>
      </div>
      {phase === 'loading' ? <div style={styles.note}>Loading deployments…</div> : null}
      {phase === 'unreachable' ? (
        <div style={styles.note}>
          The Auracle engine is not reachable. Start the stack, then this table will populate.
        </div>
      ) : null}
      {phase === 'ready' ? (
        <table style={styles.table}>
          <thead>
            <tr>
              {['', 'Strategy', 'Broker', 'Mode', 'AUM', 'Equity', 'Return', 'Status', 'Actions'].map(
                (h) => (
                  <th key={h} style={styles.th}>
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => {
              const expanded = model.selected === row.id;
              return (
                <FragmentRow
                  key={row.id}
                  row={row}
                  expanded={expanded}
                  pendingConfirm={pendingConfirm}
                  onToggle={() =>
                    setModel((prev) => ({ ...prev, selected: expanded ? null : row.id }))
                  }
                  onAction={(action) => void dispatch(row.id, action)}
                  onCancelConfirm={() => setPendingConfirm(null)}
                />
              );
            })}
            {model.rows.length === 0 ? (
              <tr>
                <td style={styles.td} colSpan={9}>
                  <span style={styles.note}>
                    No deployments yet. Click Deploy to launch a strategy (paper mode needs no
                    credentials — the simulator broker is the default).
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
      {phase === 'ready' && selectedDeployment(model) ? (
        <LedgerView deployment={selectedDeployment(model) as Deployment} />
      ) : null}
    </div>
  );
}

function FragmentRow({
  row,
  expanded,
  pendingConfirm,
  onToggle,
  onAction,
  onCancelConfirm,
}: {
  row: Deployment;
  expanded: boolean;
  pendingConfirm: { id: number; action: LiveAction } | null;
  onToggle: () => void;
  onAction: (action: LiveAction) => void;
  onCancelConfirm: () => void;
}) {
  const actions = availableActions(row.state);
  const confirming = pendingConfirm?.id === row.id ? pendingConfirm.action : null;
  return (
    <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
      <td style={styles.td}>
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            display: 'inline-block',
            background: isActive(row.state) ? '#2ea043' : '#8a8f98',
          }}
        />
      </td>
      <td style={styles.td}>
        {row.name || row.strategy_path}
        <span style={{ ...styles.note, marginLeft: 6 }}>{expanded ? '▾' : '▸'}</span>
      </td>
      <td style={styles.td}>{row.broker}</td>
      <td style={styles.td}>{row.mode}</td>
      <td style={styles.td}>{row.aum ?? '—'}</td>
      <td style={styles.td}>{row.equity ?? '—'}</td>
      <td style={styles.td}>{formatReturn(row.return_pct)}</td>
      <td style={styles.td}>{stateLabel(row.state)}</td>
      <td style={styles.td} onClick={(e) => e.stopPropagation()}>
        {confirming ? (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <span style={styles.error}>Liquidate — flatten all positions?</span>
            <button type="button" style={styles.button(false, true)} onClick={() => onAction(confirming)}>
              Confirm
            </button>
            <button type="button" style={styles.button()} onClick={onCancelConfirm}>
              Cancel
            </button>
          </span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                style={styles.button(false, isDestructive(action))}
                onClick={() => onAction(action)}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </span>
        )}
      </td>
    </tr>
  );
}
