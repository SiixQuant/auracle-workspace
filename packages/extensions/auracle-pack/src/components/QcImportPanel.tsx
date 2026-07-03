/**
 * QuantConnect import: browse the linked account's projects, translate one
 * into an Auracle strategy scaffold (with an honest coverage report — what
 * mapped, what didn't), then save it into the strategies folder. Requires the
 * QuantConnect integration to be connected in Settings → Extensions → Auracle.
 */
import { useEffect, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { bumpConnectGeneration, getJson, postJson } from '../engine/client';

interface QcProject {
  id?: number;
  projectId?: number;
  name?: string;
  language?: string;
}

interface TranslateReport {
  style?: string;
  coverage?: number;
  components?: Array<{ name?: string; mapped?: boolean; note?: string } | string>;
  unmapped?: string[];
  notes?: string[];
  scaffold?: string;
}

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    padding: 14,
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
    padding: '7px 10px',
    borderRadius: 6,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.25))',
    cursor: 'pointer',
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
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 13,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    background: 'var(--bg-primary, rgba(0,0,0,0.2))',
    color: 'var(--text-primary, #d7dae0)',
    minWidth: 320,
  },
  pre: {
    fontSize: 11,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    background: 'var(--bg-primary, rgba(0,0,0,0.25))',
    borderRadius: 6,
    padding: 10,
    maxHeight: 260,
    overflow: 'auto',
  },
};

export function QcImportPanel(_props: PanelHostProps): JSX.Element {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'unreachable' }
    | { phase: 'disconnected' }
    | { phase: 'ready'; projects: QcProject[] }
  >({ phase: 'loading' });
  const [selected, setSelected] = useState<QcProject | null>(null);
  const [report, setReport] = useState<TranslateReport | null | 'loading'>(null);
  const [savePath, setSavePath] = useState('');
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const body = await getJson<{ connected?: boolean; projects?: QcProject[] }>(
        '/ui/api/quantconnect/projects'
      );
      if (!body) setState({ phase: 'unreachable' });
      else if (body.connected === false) setState({ phase: 'disconnected' });
      else setState({ phase: 'ready', projects: body.projects ?? [] });
    })();
  }, []);

  const translate = async (project: QcProject) => {
    setSelected(project);
    setReport('loading');
    setSaveResult(null);
    const projectId = project.projectId ?? project.id;
    const response = await postJson('/ui/api/quantconnect/translate', {
      project_id: projectId,
      name: project.name,
    });
    setReport(
      response.ok && response.body && typeof response.body === 'object'
        ? (response.body as TranslateReport)
        : null
    );
    setSavePath(
      `strategies/${(project.name ?? 'imported').toLowerCase().replace(/[^a-z0-9]+/g, '_')}.py`
    );
  };

  const save = async () => {
    if (!report || report === 'loading' || !report.scaffold) return;
    const response = await postJson('/ui/api/strategy/source', {
      path: savePath,
      source: report.scaffold,
    });
    const body = (response.body ?? {}) as { ok?: boolean; error?: string };
    if (response.ok && body.ok !== false) {
      setSaveResult({ ok: true, message: `Saved to ${savePath}.` });
      bumpConnectGeneration();
    } else {
      setSaveResult({
        ok: false,
        message: body.error ?? `Save failed (${response.status || 'engine unreachable'}).`,
      });
    }
  };

  if (state.phase === 'loading') return <div style={styles.page}>Loading QuantConnect projects…</div>;
  if (state.phase === 'unreachable')
    return <div style={styles.page}>The Auracle engine is not reachable.</div>;
  if (state.phase === 'disconnected')
    return (
      <div style={styles.page}>
        <div>QuantConnect is not connected.</div>
        <div style={styles.note}>
          Add your QuantConnect credentials under Settings → Extensions → Auracle → Integrations,
          then reopen this panel.
        </div>
      </div>
    );

  return (
    <div style={styles.page}>
      <div style={{ fontWeight: 600 }}>QuantConnect projects</div>
      {state.projects.map((project) => (
        <div
          key={project.projectId ?? project.id ?? project.name}
          style={{
            ...styles.row,
            borderColor:
              selected === project ? 'var(--accent-primary, #0053fd)' : undefined,
          }}
          onClick={() => void translate(project)}
        >
          <span style={{ fontWeight: 500 }}>{project.name ?? '(unnamed project)'}</span>
          <span style={styles.note}>{project.language ?? ''}</span>
        </div>
      ))}
      {state.projects.length === 0 ? (
        <div style={styles.note}>No projects reported for the linked account.</div>
      ) : null}

      {report === 'loading' ? <div style={styles.note}>Translating…</div> : null}
      {report && report !== 'loading' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            Coverage:{' '}
            {typeof report.coverage === 'number' ? `${Math.round(report.coverage * 100)}%` : '—'}
            {report.style ? <span style={styles.note}> · style: {report.style}</span> : null}
          </div>
          {(report.unmapped ?? []).length > 0 ? (
            <div style={styles.note}>Not translated: {(report.unmapped ?? []).join(', ')}</div>
          ) : null}
          {(report.notes ?? []).map((note, index) => (
            <div key={index} style={styles.note}>
              {note}
            </div>
          ))}
          {report.scaffold ? (
            <>
              <pre style={styles.pre}>{report.scaffold}</pre>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  style={styles.input}
                  value={savePath}
                  onChange={(event) => setSavePath(event.target.value)}
                />
                <button type="button" style={styles.button(true)} onClick={() => void save()}>
                  Save as strategy
                </button>
              </div>
            </>
          ) : (
            <div style={styles.note}>The translator returned no scaffold for this project.</div>
          )}
          {saveResult ? (
            <div style={saveResult.ok ? styles.note : styles.error}>{saveResult.message}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
