/**
 * QuantConnect — an import library, on panelkit. Browse the linked account's
 * projects and, per project: **Import** it into an Auracle strategy scaffold
 * (with an honest coverage report — what mapped, what didn't) saved to your
 * workspace, or **Backtest in QC** (compile → cloud backtest → headline stats).
 * A separate **Export** action pushes one of your Auracle strategies into a QC
 * project as a starting point (honest: it needs adapting to QCAlgorithm there).
 *
 * Requires the QuantConnect integration to be connected in Settings.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { bumpConnectGeneration, getJson, getJsonDetailed, postJson } from '../engine/client';
import {
  QcChartBody,
  QcProject,
  StatLine,
  compilePhase,
  headlineStats,
  normalizeProject,
  qcContext,
  qcEquityPoints,
  qcPrompt,
} from '../engine/quantconnect';
import {
  Button,
  CenterState,
  Disclosure,
  EquityChart,
  Field,
  InlineNote,
  PanelShell,
  Select,
  SkeletonRows,
  ToolbarSpring,
  tone,
} from './panelkit';
import { useAiPanelContext, handOffToAgent, type AgentNote } from './aiPanel';

interface TranslateReport {
  style?: string;
  coverage?: number;
  unmapped?: string[];
  notes?: string[];
  scaffold?: string;
}

type ListState =
  | { phase: 'loading' }
  | { phase: 'unreachable' }
  | { phase: 'disconnected' }
  | { phase: 'ready'; projects: QcProject[] };

type ImportState =
  | { phase: 'translating' }
  | { phase: 'error'; message: string }
  | { phase: 'report'; report: TranslateReport; savePath: string; saved: string | null };

type BacktestState =
  | { phase: 'compiling' }
  | { phase: 'running' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; stats: StatLine[]; empty: boolean; equity: number[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'imported';

/**
 * A completed QC cloud backtest: its Strategy-Equity curve (when the engine
 * returned one) above the headline statistics. Every figure is a real QC
 * value — the curve renders only when there are points, never a placeholder.
 */
export function QcBacktestResult({
  stats,
  equity,
  empty,
}: {
  stats: StatLine[];
  equity: number[];
  empty: boolean;
}): JSX.Element {
  return (
    <>
      {equity.length >= 2 ? (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 9,
            border: `1px solid ${tone.border}`,
            background: tone.surface,
          }}
        >
          <EquityChart points={equity} height={140} label="Equity curve" />
        </div>
      ) : null}
      {!empty ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {stats.map((s) => (
            <div
              key={s.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                padding: '7px 11px',
                borderRadius: 8,
                border: `1px solid ${tone.border}`,
                minWidth: 120,
              }}
            >
              <span style={{ fontSize: 10.5, color: tone.text3 }}>{s.label}</span>
              <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {s.value}
              </span>
            </div>
          ))}
        </div>
      ) : equity.length < 2 ? (
        <InlineNote kind="muted">Backtest finished, but QuantConnect returned no statistics.</InlineNote>
      ) : null}
    </>
  );
}

function ProjectCard({
  project,
  active,
  importState,
  backtestState,
  onImport,
  onBacktest,
  onSave,
  onSavePathChange,
  onAdapt,
  adaptNote,
}: {
  project: QcProject;
  active: boolean;
  importState: ImportState | null;
  backtestState: BacktestState | null;
  onImport: () => void;
  onBacktest: () => void;
  onSave: () => void;
  onSavePathChange: (v: string) => void;
  onAdapt: () => void;
  adaptNote: AgentNote;
}) {
  const busy =
    importState?.phase === 'translating' ||
    backtestState?.phase === 'compiling' ||
    backtestState?.phase === 'running';
  return (
    <article
      className="apk-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '13px 15px',
        borderRadius: 9,
        border: `1px solid ${active ? tone.borderStrong : tone.border}`,
        background: tone.surface,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: tone.text }}>{project.name}</span>
          <span style={{ fontSize: 11, color: tone.text3 }}>
            QuantConnect · {project.language || 'project'} · #{project.projectId}
          </span>
        </div>
        <Button variant="quiet" busy={importState?.phase === 'translating'} disabled={busy} onClick={onImport}>
          Import
        </Button>
        <Button
          variant="quiet"
          busy={backtestState?.phase === 'compiling' || backtestState?.phase === 'running'}
          disabled={busy}
          onClick={onBacktest}
        >
          Backtest in QC
        </Button>
      </div>

      {importState ? (
        <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {importState.phase === 'translating' ? (
            <InlineNote kind="muted">Translating this project to an Auracle scaffold…</InlineNote>
          ) : importState.phase === 'error' ? (
            <InlineNote kind="err">{importState.message}</InlineNote>
          ) : (
            <>
              <div style={{ fontSize: 12, color: tone.text2 }}>
                Coverage {typeof importState.report.coverage === 'number'
                  ? `${Math.round(importState.report.coverage * 100)}%`
                  : '—'}
                {importState.report.style ? (
                  <span style={{ color: tone.text3 }}> · style {importState.report.style}</span>
                ) : null}
              </div>
              {(importState.report.unmapped ?? []).length > 0 ? (
                <div style={{ fontSize: 11.5, color: tone.caution }}>
                  Not translated: {(importState.report.unmapped ?? []).join(', ')}
                </div>
              ) : null}
              {(importState.report.notes ?? []).map((note, i) => (
                <div key={i} style={{ fontSize: 11.5, color: tone.text3 }}>{note}</div>
              ))}
              {importState.report.scaffold ? (
                <>
                  <pre
                    style={{
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      background: tone.sunken,
                      borderRadius: 7,
                      padding: 10,
                      maxHeight: 220,
                      overflow: 'auto',
                      margin: 0,
                    }}
                  >
                    {importState.report.scaffold}
                  </pre>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <Field label="Save to" value={importState.savePath} onChange={onSavePathChange} />
                    </div>
                    <Button variant="primary" onClick={onSave}>Save as strategy</Button>
                    <Button variant="quiet" onClick={onAdapt}>⚗ Ask the agent</Button>
                  </div>
                  {importState.saved ? (
                    <InlineNote kind="ok">Saved to {importState.saved}.</InlineNote>
                  ) : null}
                  {adaptNote ? <InlineNote kind={adaptNote.kind}>{adaptNote.text}</InlineNote> : null}
                </>
              ) : (
                <InlineNote kind="muted">The translator returned no scaffold for this project.</InlineNote>
              )}
            </>
          )}
        </div>
      ) : null}

      {backtestState ? (
        <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {backtestState.phase === 'compiling' ? (
            <InlineNote kind="muted">Compiling on QuantConnect…</InlineNote>
          ) : backtestState.phase === 'running' ? (
            <InlineNote kind="muted">Running the cloud backtest… this can take a minute.</InlineNote>
          ) : backtestState.phase === 'error' ? (
            <InlineNote kind="err">{backtestState.message}</InlineNote>
          ) : (
            <QcBacktestResult
              stats={backtestState.stats}
              equity={backtestState.equity}
              empty={backtestState.empty}
            />
          )}
        </div>
      ) : null}
    </article>
  );
}

export function QcImportPanel({ host }: PanelHostProps): JSX.Element {
  const [list, setList] = useState<ListState>({ phase: 'loading' });
  const [activeId, setActiveId] = useState<number | null>(null);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [backtestState, setBacktestState] = useState<BacktestState | null>(null);
  const [adaptNote, setAdaptNote] = useState<AgentNote>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportable, setExportable] = useState<Array<{ path: string; label: string }>>([]);
  const [exportPath, setExportPath] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNote, setExportNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const loadProjects = useCallback(async () => {
    setList({ phase: 'loading' });
    const body = await getJson<{ connected?: boolean; projects?: Array<Record<string, unknown>> }>(
      '/ui/api/quantconnect/projects'
    );
    if (!body) { setList({ phase: 'unreachable' }); return; }
    if (body.connected === false) { setList({ phase: 'disconnected' }); return; }
    const projects = (body.projects ?? [])
      .map(normalizeProject)
      .filter((p): p is QcProject => p !== null);
    setList({ phase: 'ready', projects });
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  // Ambient: publish the active project + its last translation to the AI chat.
  const activeProject =
    list.phase === 'ready' ? list.projects.find((p) => p.projectId === activeId) : undefined;
  const activeReport = importState?.phase === 'report' ? importState.report : null;
  const activeSaved = importState?.phase === 'report' ? importState.saved : null;
  useAiPanelContext(
    host,
    activeProject && activeReport ? qcContext(activeProject, activeReport, activeSaved) : null
  );
  const adaptTranslation = async () => {
    if (!activeProject || !activeReport) return;
    setAdaptNote(
      await handOffToAgent(
        host,
        qcPrompt(activeProject, activeReport, activeSaved),
        `Adapt: ${activeProject.name}`
      )
    );
  };

  const openExport = useCallback(async () => {
    setExportOpen((v) => !v);
    if (exportable.length === 0) {
      const body = await getJson<{ strategies?: Array<{ path?: string; kind?: string; doc?: string }> }>(
        '/ui/api/backtest/strategies?deployable=1'
      );
      const rows = (body?.strategies ?? [])
        .filter((s) => typeof s.path === 'string' && s.path.length > 0)
        .map((s) => {
          const path = s.path as string;
          const cls = path.split('.').pop() ?? path;
          const doc = typeof s.doc === 'string' ? s.doc : '';
          return { path, label: doc ? `${cls} — ${doc}` : cls };
        });
      setExportable(rows);
    }
  }, [exportable.length]);

  const beginImport = async (project: QcProject) => {
    setActiveId(project.projectId);
    setBacktestState(null);
    setImportState({ phase: 'translating' });
    const response = await postJson('/ui/api/quantconnect/translate', {
      project_id: project.projectId,
      name: project.name,
    });
    if (cancelled.current) return;
    if (!response.ok || !response.body || typeof response.body !== 'object') {
      setImportState({ phase: 'error', message: `Translate failed (${response.status || 'engine unreachable'}).` });
      return;
    }
    const report = response.body as TranslateReport;
    setImportState({
      phase: 'report',
      report,
      savePath: `strategies/${slug(project.name)}.py`,
      saved: null,
    });
  };

  const saveImport = async () => {
    if (importState?.phase !== 'report' || !importState.report.scaffold) return;
    const response = await postJson('/ui/api/strategy/source', {
      path: importState.savePath,
      source: importState.report.scaffold,
    });
    const body = (response.body ?? {}) as { ok?: boolean; error?: string };
    if (response.ok && body.ok !== false) {
      setImportState({ ...importState, saved: importState.savePath });
      bumpConnectGeneration();
    } else {
      setImportState({ phase: 'error', message: body.error ?? `Save failed (${response.status || 'engine unreachable'}).` });
    }
  };

  const beginBacktest = async (project: QcProject) => {
    setActiveId(project.projectId);
    setImportState(null);
    setBacktestState({ phase: 'compiling' });
    const base = `/ui/api/quantconnect/projects/${project.projectId}`;

    const compile = await postJson(`${base}/compile`);
    const compileId = (compile.body as { compile_id?: string } | null)?.compile_id;
    if (!compile.ok || !compileId) {
      const errs = (compile.body as { errors?: string[] } | null)?.errors;
      setBacktestState({ phase: 'error', message: errs?.join(' ') ?? 'QuantConnect refused the compile.' });
      return;
    }
    // Poll the compile (bounded ~2 min).
    for (let i = 0; i < 60; i += 1) {
      await sleep(2000);
      if (cancelled.current) return;
      const status = await getJson<{ state?: string; logs?: string[] }>(`${base}/compile/${compileId}`);
      const phase = compilePhase(status?.state);
      if (phase === 'success') break;
      if (phase === 'error') {
        setBacktestState({ phase: 'error', message: (status?.logs ?? []).join(' ') || 'Build failed on QuantConnect.' });
        return;
      }
      if (i === 59) {
        setBacktestState({ phase: 'error', message: 'Compile is still queued on QuantConnect — try again shortly.' });
        return;
      }
    }
    if (cancelled.current) return; // the compile loop can break on success; don't set state after unmount

    setBacktestState({ phase: 'running' });
    const bt = await postJson(`${base}/backtest`, { compile_id: compileId, name: `Auracle — ${project.name}` });
    const backtestId = (bt.body as { backtest_id?: string } | null)?.backtest_id;
    if (!bt.ok || !backtestId) {
      const errs = (bt.body as { errors?: string[] } | null)?.errors;
      setBacktestState({ phase: 'error', message: errs?.join(' ') ?? 'QuantConnect refused the backtest.' });
      return;
    }
    // Poll the backtest (bounded ~5 min).
    for (let i = 0; i < 100; i += 1) {
      await sleep(3000);
      if (cancelled.current) return;
      const res = await getJson<{ completed?: boolean; statistics?: Record<string, unknown>; error?: string }>(
        `${base}/backtest/${backtestId}`
      );
      if (res?.error) {
        setBacktestState({ phase: 'error', message: res.error });
        return;
      }
      if (res?.completed) {
        const stats = headlineStats(res.statistics);
        // Pull the Strategy-Equity curve. An older engine without this route
        // (404) just leaves equity empty — we show the stats without a chart
        // rather than invent one.
        const chart = await getJsonDetailed<QcChartBody>(`${base}/backtest/${backtestId}/chart`);
        if (cancelled.current) return;
        const equity = chart.ok ? qcEquityPoints(chart.body) : [];
        setBacktestState({ phase: 'done', stats, empty: stats.length === 0, equity });
        return;
      }
      if (i === 99) {
        setBacktestState({ phase: 'error', message: 'The backtest is still running on QuantConnect — check back in the QC dashboard.' });
        return;
      }
    }
  };

  const runExport = async () => {
    if (!exportPath) return;
    setExportBusy(true);
    setExportNote(null);
    const response = await postJson('/ui/api/quantconnect/export', { strategy_path: exportPath });
    setExportBusy(false);
    const body = (response.body ?? {}) as { project_id?: number; note?: string; error?: unknown };
    if (response.ok && body.project_id) {
      setExportNote({
        kind: 'ok',
        text: `Pushed to QuantConnect project #${body.project_id}. ${body.note ?? ''}`.trim(),
      });
      void loadProjects();
    } else {
      const err = typeof body.error === 'string' ? body.error : `Export failed (${response.status || 'engine unreachable'}).`;
      setExportNote({ kind: 'err', text: err });
    }
  };

  return (
    <PanelShell
      title="QuantConnect"
      description="Your QuantConnect import library. Bring a QC project into Auracle, run a cloud backtest, or push one of your strategies out to QuantConnect."
      toolbar={
        list.phase === 'ready' ? (
          <>
            <Button variant="ghost" onClick={() => void openExport()}>
              {exportOpen ? 'Close export' : 'Export a strategy →'}
            </Button>
            <Button variant="ghost" onClick={() => void loadProjects()}>Refresh</Button>
            <ToolbarSpring />
          </>
        ) : undefined
      }
    >
      {exportOpen && list.phase === 'ready' ? (
        <Disclosure>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: tone.text }}>Export to QuantConnect</div>
            {exportable.length === 0 ? (
              <InlineNote kind="muted">No Auracle strategies to export yet — create or import one first.</InlineNote>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Select
                  ariaLabel="Strategy to export"
                  placeholder="Pick a strategy to push…"
                  minWidth={280}
                  value={exportPath}
                  onChange={setExportPath}
                  options={exportable.map((s) => ({ value: s.path, label: s.label }))}
                />
                <Button variant="primary" busy={exportBusy} disabled={!exportPath} onClick={() => void runExport()}>
                  Push to QuantConnect
                </Button>
              </div>
            )}
            {exportNote ? <InlineNote kind={exportNote.kind}>{exportNote.text}</InlineNote> : null}
            <div style={{ fontSize: 11, color: tone.text3 }}>
              The pushed source is Auracle-native — adapt it to QuantConnect's QCAlgorithm before running it there.
            </div>
          </div>
        </Disclosure>
      ) : null}

      {list.phase === 'loading' ? (
        <SkeletonRows rows={4} />
      ) : list.phase === 'unreachable' ? (
        <CenterState
          title="The engine didn't respond"
          detail="QuantConnect projects load through your local Auracle engine. Make sure the stack is running, then retry."
          actions={<Button variant="primary" onClick={() => void loadProjects()}>Retry</Button>}
        />
      ) : list.phase === 'disconnected' ? (
        <CenterState
          title="Connect QuantConnect"
          detail="Add your QuantConnect user id and API token under Settings → Auracle → Connections, then reopen this panel to browse your projects."
          actions={<Button variant="ghost" onClick={() => void loadProjects()}>Re-check</Button>}
        />
      ) : list.projects.length === 0 ? (
        <CenterState
          title="No projects in the linked account"
          detail="This QuantConnect account has no projects yet. Create one on QuantConnect, or export an Auracle strategy to start one."
        />
      ) : (
        <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11.5, color: tone.text3 }}>
            {list.projects.length} project{list.projects.length === 1 ? '' : 's'} in your QuantConnect account
          </div>
          {list.projects.map((project) => (
            <ProjectCard
              key={project.projectId}
              project={project}
              active={activeId === project.projectId}
              importState={activeId === project.projectId ? importState : null}
              backtestState={activeId === project.projectId ? backtestState : null}
              onImport={() => void beginImport(project)}
              onBacktest={() => void beginBacktest(project)}
              onSave={() => void saveImport()}
              onSavePathChange={(v) =>
                setImportState((s) => (s?.phase === 'report' ? { ...s, savePath: v } : s))
              }
              onAdapt={() => void adaptTranslation()}
              adaptNote={activeId === project.projectId ? adaptNote : null}
            />
          ))}
        </div>
      )}
    </PanelShell>
  );
}
