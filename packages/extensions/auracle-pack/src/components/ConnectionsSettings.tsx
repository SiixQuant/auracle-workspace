/**
 * Connections settings page (Settings → Extensions → Auracle Connections).
 *
 * Master-detail over the engine's unified connector registry. Honesty rules
 * ported from the native client:
 *  - a row reads "Connected" only when the engine's status.state says so
 *  - no green from a missing tester: Test renders only when test_supported
 *  - secret values are never fetched; fields show has_value previews
 *  - tier-gated connectors say so, with the engine's reason, instead of
 *    rendering a form that cannot succeed
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SettingsPanelProps } from '@nimbalyst/extension-sdk';
import {
  bumpConnectGeneration,
  getJson,
  postJson,
} from '../engine/client';
import {
  Connector,
  FieldMeta,
  defaultExpanded,
  isConnected,
  normalizeConnector,
  sectionSummary,
} from '../engine/model';

const KEYLESS_IDS = new Set(['yfinance', 'simulator']);

const SECTIONS: Array<{ kind: string; title: string }> = [
  { kind: 'broker', title: 'Brokers' },
  { kind: 'data_provider', title: 'Data sources' },
  { kind: 'integration', title: 'Integrations' },
];

type LoadState =
  | { phase: 'loading' }
  | { phase: 'unreachable' }
  | { phase: 'ready'; connectors: Connector[] };

interface TestResult {
  ok: boolean;
  message: string;
}

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 18,
    maxWidth: 720,
    color: 'var(--text-primary, #d7dae0)',
    font: '13px/1.5 var(--font-family-ui, system-ui, sans-serif)',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'baseline' as const,
    justifyContent: 'space-between' as const,
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  sectionTitle: { fontSize: 13, fontWeight: 600 },
  summary: { fontSize: 12, color: 'var(--text-tertiary, #8a8f98)' },
  row: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: 10,
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.25))',
    background: 'var(--bg-secondary, rgba(127,127,127,0.06))',
    cursor: 'pointer',
  },
  rowLabel: { fontWeight: 500 },
  rowBlurb: {
    fontSize: 12,
    color: 'var(--text-tertiary, #8a8f98)',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flex: 1,
    minWidth: 0,
  },
  statusText: (connected: boolean) => ({
    fontSize: 12,
    color: connected ? '#2ea043' : 'var(--text-tertiary, #8a8f98)',
    whiteSpace: 'nowrap' as const,
  }),
  chip: {
    fontSize: 11,
    padding: '1px 8px',
    borderRadius: 999,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    color: 'var(--text-tertiary, #8a8f98)',
    whiteSpace: 'nowrap' as const,
  },
  button: (primary?: boolean) => ({
    padding: '5px 12px',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    background: primary ? 'var(--accent-primary, #0053fd)' : 'transparent',
    color: primary ? '#fff' : 'var(--text-primary, #d7dae0)',
  }),
  input: {
    width: '100%',
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 13,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    background: 'var(--bg-primary, rgba(0,0,0,0.2))',
    color: 'var(--text-primary, #d7dae0)',
  },
  fieldLabel: { fontSize: 12, color: 'var(--text-secondary, #b9bec7)', marginBottom: 4 },
  note: { fontSize: 12, color: 'var(--text-tertiary, #8a8f98)' },
};

function statusText(connector: Connector): string {
  if (isConnected(connector.status)) return 'Connected';
  if (KEYLESS_IDS.has(connector.id)) return 'Ready — no key needed';
  const state = connector.status.state;
  if (!state || state === 'not_configured') return 'Not configured';
  return connector.status.detail ? `${state}: ${connector.status.detail}` : state;
}

function ConnectorDetail({
  connector,
  onBack,
  onChanged,
}: {
  connector: Connector;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Connector | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [capability, setCapability] = useState<string>('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const body = await getJson<Record<string, unknown>>(`/ui/api/connections/${connector.id}`);
      if (cancelled) return;
      const raw = (body?.connection ?? body) as (Partial<Connector> & { id: string }) | null;
      setDetail(raw ? normalizeConnector({ ...raw, id: raw.id ?? connector.id }) : connector);
      const cap = await getJson<Record<string, unknown>>(
        `/ui/api/connections/${connector.id}/capability`
      );
      if (cancelled) return;
      const plain = (cap?.plain ?? cap?.summary ?? '') as string;
      if (typeof plain === 'string') setCapability(plain);
    })();
    return () => {
      cancelled = true;
    };
  }, [connector]);

  const shown = detail ?? connector;
  const enteredFields = useMemo(() => {
    const body: Record<string, string> = {};
    for (const [name, value] of Object.entries(values)) {
      if (value.trim().length > 0) body[name] = value;
    }
    return body;
  }, [values]);

  const runTest = async () => {
    setBusy('test');
    setTestResult(null);
    const response = await postJson(`/ui/api/connections/${shown.id}/test`, enteredFields);
    const body = (response.body ?? {}) as { ok?: boolean; message?: string };
    setTestResult({
      ok: response.ok && body.ok === true,
      message:
        body.message ??
        (response.ok ? 'Test finished.' : `Test failed (${response.status || 'engine unreachable'}).`),
    });
    setBusy(null);
  };

  const runSave = async () => {
    setBusy('save');
    const response = await postJson(`/ui/api/connections/${shown.id}/save`, enteredFields);
    setBusy(null);
    if (response.ok) {
      setTestResult({ ok: true, message: 'Saved.' });
      bumpConnectGeneration();
      onChanged();
    } else {
      const body = (response.body ?? {}) as { detail?: string; message?: string };
      setTestResult({
        ok: false,
        message: body.message ?? body.detail ?? `Save failed (${response.status || 'engine unreachable'}).`,
      });
    }
  };

  const runDisconnect = async () => {
    setBusy('disconnect');
    const response = await postJson(`/ui/api/connections/${shown.id}/disconnect`);
    setBusy(null);
    if (response.ok) {
      setValues({});
      setTestResult({ ok: true, message: 'Disconnected.' });
      bumpConnectGeneration();
      onChanged();
    } else {
      setTestResult({ ok: false, message: `Disconnect failed (${response.status}).` });
    }
  };

  return (
    <div style={styles.page}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" style={styles.button()} onClick={onBack}>
          ← Back
        </button>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {shown.display_label || shown.id}
        </span>
        <span style={styles.statusText(isConnected(shown.status))}>{statusText(shown)}</span>
      </div>
      {shown.blurb ? <div style={styles.note}>{shown.blurb}</div> : null}
      {capability ? <div style={styles.note}>{capability}</div> : null}

      {shown.gated ? (
        <div style={styles.note}>
          {shown.gated_reason || 'Your current plan does not include this connector.'}
        </div>
      ) : (
        <>
          {(detail?.fields ?? []).map((field: FieldMeta) => (
            <div key={field.name}>
              <div style={styles.fieldLabel}>
                {field.label || field.name}
                {field.required ? ' *' : ''}
                {field.has_value && field.preview ? `  (saved: ${field.preview})` : ''}
              </div>
              {field.options.length > 0 ? (
                <select
                  style={styles.input}
                  value={values[field.name] ?? ''}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                >
                  <option value="">{field.has_value ? '(keep saved value)' : 'Select…'}</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  style={styles.input}
                  type={field.kind === 'secret' || field.kind === 'password' ? 'password' : 'text'}
                  placeholder={field.has_value ? '(keep saved value)' : ''}
                  value={values[field.name] ?? ''}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                />
              )}
            </div>
          ))}
          {detail && detail.fields.length === 0 ? (
            <div style={styles.note}>
              {KEYLESS_IDS.has(shown.id)
                ? 'No credentials required — this source is ready to use.'
                : 'No editable fields reported by the engine.'}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8 }}>
            {shown.test_supported ? (
              <button type="button" style={styles.button()} disabled={busy !== null} onClick={() => void runTest()}>
                {busy === 'test' ? 'Testing…' : 'Test'}
              </button>
            ) : null}
            <button type="button" style={styles.button(true)} disabled={busy !== null} onClick={() => void runSave()}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            {isConnected(shown.status) ? (
              <button
                type="button"
                style={styles.button()}
                disabled={busy !== null}
                onClick={() => void runDisconnect()}
              >
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : null}
          </div>
          {testResult ? (
            <div style={{ ...styles.note, color: testResult.ok ? '#2ea043' : '#c4554d' }}>
              {testResult.message}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  connectors,
  onSelect,
}: {
  title: string;
  connectors: Connector[];
  onSelect: (connector: Connector) => void;
}) {
  const [expanded, setExpanded] = useState<boolean>(() => defaultExpanded(connectors));

  return (
    <div>
      <div style={styles.sectionHeader} onClick={() => setExpanded((value) => !value)}>
        <span style={styles.sectionTitle}>
          {expanded ? '▾' : '▸'} {title}
        </span>
        <span style={styles.summary}>{sectionSummary(connectors)}</span>
      </div>
      {expanded ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {connectors.map((connector) => (
            <div key={connector.id} style={styles.row} onClick={() => onSelect(connector)}>
              <span style={styles.rowLabel}>{connector.display_label || connector.id}</span>
              <span style={styles.rowBlurb}>{connector.blurb}</span>
              {connector.gated ? <span style={styles.chip}>Upgrade required</span> : null}
              <span style={styles.statusText(isConnected(connector.status))}>
                {statusText(connector)}
              </span>
              <span aria-hidden style={{ color: 'var(--text-tertiary, #8a8f98)' }}>
                ›
              </span>
            </div>
          ))}
          {connectors.length === 0 ? <div style={styles.note}>None available.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function AuracleConnections(_props: SettingsPanelProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [selected, setSelected] = useState<Connector | null>(null);

  const load = useCallback(async () => {
    const body = await getJson<{ connections?: Array<Partial<Connector> & { id: string }> }>(
      '/ui/api/connections?kind=all'
    );
    if (body?.connections) {
      setState({ phase: 'ready', connectors: body.connections.map(normalizeConnector) });
    } else {
      setState({ phase: 'unreachable' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === 'loading') {
    return <div style={styles.page}>Loading connections…</div>;
  }
  if (state.phase === 'unreachable') {
    return (
      <div style={styles.page}>
        <div>The Auracle engine is not reachable, so connections cannot be listed.</div>
        <div style={styles.note}>
          Start the Auracle stack (or install through the launcher), then retry.
        </div>
        <div>
          <button type="button" style={styles.button(true)} onClick={() => void load()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <ConnectorDetail
        connector={selected}
        onBack={() => setSelected(null)}
        onChanged={() => void load()}
      />
    );
  }

  return (
    <div style={styles.page}>
      {SECTIONS.map((section) => (
        <Section
          key={section.kind}
          title={section.title}
          connectors={state.connectors.filter((connector) => connector.kind === section.kind)}
          onSelect={setSelected}
        />
      ))}
    </div>
  );
}
