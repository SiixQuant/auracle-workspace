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
import { AccountSection } from './AccountSection';
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
import { Button, InlineNote, Pill, Select, ensurePanelKitStyles, tint, tone } from './panelkit';

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
    color: tone.text,
    font: `13px/1.5 ${tone.font}`,
  },
  header: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  title: { fontSize: 17, fontWeight: 600 as const, letterSpacing: -0.2 },
  subtitle: { fontSize: 12.5, color: tone.text3 },
  sectionHead: {
    fontSize: 12.5,
    fontWeight: 600 as const,
    letterSpacing: 0,
    color: tone.text2,
    display: 'flex',
    alignItems: 'center' as const,
    gap: 7,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    cursor: 'pointer',
    userSelect: 'none' as const,
    padding: '6px 0',
    borderBottom: `1px solid ${tone.border}`,
  },
  summary: { fontSize: 12, color: tone.text3 },
  rows: { display: 'flex', flexDirection: 'column' as const, gap: 6, marginTop: 8 },
  row: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: 10,
    padding: '9px 12px',
    borderRadius: 8,
    border: `1px solid ${tone.border}`,
    background: tone.surface,
    cursor: 'pointer',
  },
  dot: (color: string) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
    background: color,
  }),
  rowLabel: { fontWeight: 500 as const },
  rowBlurb: {
    fontSize: 12,
    color: tone.text3,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flex: 1,
    minWidth: 0,
  },
  statusText: (connected: boolean) => ({
    fontSize: 12,
    color: connected ? tone.ok : tone.text3,
    whiteSpace: 'nowrap' as const,
  }),
  chip: {
    fontSize: 10.5,
    fontWeight: 600 as const,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
    padding: '2px 8px',
    borderRadius: 999,
    color: tone.caution,
    background: 'rgba(212,160,23,0.14)',
    whiteSpace: 'nowrap' as const,
  },
  chev: { color: tone.text3, fontSize: 14 },
  accountCard: {
    padding: '12px 14px',
    borderRadius: 10,
    border: `1px solid ${tone.border}`,
    background: tone.surface,
  },

  // Detail view
  backBtn: {
    display: 'inline-flex',
    alignItems: 'center' as const,
    gap: 6,
    padding: '4px 10px 4px 6px',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    border: '1px solid transparent',
    background: 'transparent',
    color: tone.text2,
  },
  detailHead: { display: 'flex', alignItems: 'center' as const, gap: 10, flexWrap: 'wrap' as const },
  detailTitle: { fontSize: 15, fontWeight: 600 as const },
  card: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
    maxWidth: 560,
    padding: 18,
    borderRadius: 12,
    border: `1px solid ${tone.border}`,
    background: tone.surface,
  },
  field: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  fieldLabel: { fontSize: 12, color: tone.text2 },
  savedTag: { color: tone.text3, fontWeight: 400 as const },
  input: {
    width: '100%',
    padding: '7px 9px',
    borderRadius: 6,
    fontSize: 13,
    border: `1px solid ${tone.borderStrong}`,
    background: tone.sunken,
    color: tone.text,
    outline: 'none',
  },
  note: { fontSize: 12, color: tone.text3 },
  actions: { display: 'flex', gap: 8, marginTop: 2 },
  gatedBox: {
    fontSize: 12.5,
    color: tone.text2,
    padding: '11px 13px',
    borderRadius: 8,
    border: `1px solid ${tint(tone.caution, 35)}`,
    background: tint(tone.caution, 8),
  },
};

function statusText(connector: Connector): string {
  if (isConnected(connector.status)) return 'Connected';
  if (KEYLESS_IDS.has(connector.id)) return 'Ready — no key needed';
  const state = connector.status.state;
  if (!state || state === 'not_configured') return 'Not configured';
  return connector.status.detail ? `${state}: ${connector.status.detail}` : state;
}

/** Green when connected or keyless-ready, muted otherwise. Honest: only a live
 *  connection or a genuinely-ready keyless source reads as good. */
function dotColor(connector: Connector): string {
  if (isConnected(connector.status) || KEYLESS_IDS.has(connector.id)) return tone.ok;
  return tone.text3;
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
  ensurePanelKitStyles();
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

  const connected = isConnected(shown.status);
  const disabled = busy !== null;

  return (
    <div style={styles.page}>
      <div>
        <button type="button" style={styles.backBtn} onClick={onBack}>
          <span aria-hidden>‹</span> Connections
        </button>
        <div style={{ ...styles.detailHead, marginTop: 4 }}>
          <span aria-hidden style={styles.dot(dotColor(shown))} />
          <span style={styles.detailTitle}>{shown.display_label || shown.id}</span>
          <span style={styles.statusText(connected)}>{statusText(shown)}</span>
        </div>
        {shown.blurb ? <div style={{ ...styles.note, marginTop: 6 }}>{shown.blurb}</div> : null}
        {capability ? <div style={styles.note}>{capability}</div> : null}
      </div>

      {shown.gated ? (
        <div style={styles.gatedBox}>
          {shown.gated_reason || 'Your current plan does not include this connector.'}
        </div>
      ) : (
        <div style={styles.card}>
          {(detail?.fields ?? []).map((field: FieldMeta) => (
            <div key={field.name} style={styles.field}>
              <div style={styles.fieldLabel}>
                {field.label || field.name}
                {field.required ? ' *' : ''}
                {field.has_value && field.preview ? (
                  <span style={styles.savedTag}>{`  (saved: ${field.preview})`}</span>
                ) : null}
              </div>
              {field.options.length > 0 ? (
                <Select
                  fluid
                  ariaLabel={field.label || field.name}
                  placeholder={field.has_value ? '(keep saved value)' : 'Select…'}
                  value={values[field.name] ?? ''}
                  onChange={(next) => setValues((prev) => ({ ...prev, [field.name]: next }))}
                  options={field.options.map((option) => ({ value: option, label: option }))}
                />
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

          <div style={styles.actions}>
            {shown.test_supported ? (
              <Button variant="ghost" disabled={disabled} onClick={() => void runTest()}>
                {busy === 'test' ? 'Testing…' : 'Test'}
              </Button>
            ) : null}
            <Button variant="primary" disabled={disabled} onClick={() => void runSave()}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
            {connected ? (
              <Button variant="danger" disabled={disabled} onClick={() => void runDisconnect()}>
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            ) : null}
          </div>
          {testResult ? (
            <InlineNote kind={testResult.ok ? 'ok' : 'err'}>{testResult.message}</InlineNote>
          ) : null}
        </div>
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
        <span style={styles.sectionHead}>
          <span aria-hidden>{expanded ? '▾' : '▸'}</span> {title}
        </span>
        <span style={styles.summary}>{sectionSummary(connectors)}</span>
      </div>
      {expanded ? (
        <div style={styles.rows}>
          {connectors.map((connector) => {
            const connected = isConnected(connector.status);
            const keyless = KEYLESS_IDS.has(connector.id);
            const st = connector.status.state;
            const errored = st === 'error';
            // Any other non-empty, non-"not_configured" state (connecting, stale,
            // expired…) must show as-is, not be flattened to "Not configured".
            const intermediate = !connected && !keyless && !errored && !!st && st !== 'not_configured';
            return (
              <div key={connector.id} className="apk-card" style={styles.row} onClick={() => onSelect(connector)}>
                <span aria-hidden style={styles.dot(dotColor(connector))} />
                <span style={styles.rowLabel}>{connector.display_label || connector.id}</span>
                <span style={styles.rowBlurb}>{connector.blurb}</span>
                {connector.gated ? <Pill kind="caution">Upgrade</Pill> : null}
                {connected ? (
                  <Pill kind="ok" dot>
                    Connected
                  </Pill>
                ) : keyless ? (
                  <Pill kind="ok" dot>
                    Ready
                  </Pill>
                ) : errored ? (
                  <Pill kind="danger" dot>
                    {connector.status.detail || 'Error'}
                  </Pill>
                ) : intermediate ? (
                  <Pill kind="caution" dot>
                    {connector.status.detail || st}
                  </Pill>
                ) : (
                  <span style={styles.statusText(false)}>Not configured</span>
                )}
                <span aria-hidden style={styles.chev}>
                  ›
                </span>
              </div>
            );
          })}
          {connectors.length === 0 ? <div style={styles.note}>None available.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function AuracleConnections(_props: SettingsPanelProps): JSX.Element {
  ensurePanelKitStyles();
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
        <div style={styles.header}>
          <span style={styles.title}>Connections</span>
          <span style={styles.subtitle}>
            The Auracle engine is not reachable, so connections cannot be listed.
          </span>
        </div>
        <div style={styles.note}>
          Start the Auracle stack (or install through the launcher), then retry.
        </div>
        <div>
          <Button variant="primary" onClick={() => void load()}>
            Retry
          </Button>
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
      <div style={styles.header}>
        <span style={styles.title}>Connections</span>
        <span style={styles.subtitle}>Brokers, data sources, and integrations the engine can use.</span>
      </div>
      <div>
        <div style={{ ...styles.sectionHead, marginBottom: 8 }}>Account</div>
        <div style={styles.accountCard}>
          <AccountSection />
        </div>
      </div>
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
