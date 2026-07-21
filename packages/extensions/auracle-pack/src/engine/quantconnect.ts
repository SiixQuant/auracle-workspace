/**
 * QuantConnect view model — types + pure helpers over the engine's
 * /ui/api/quantconnect/* surface. The engine proxies QC honestly (a
 * disconnected account or a QC-side failure is a shape, never a throw);
 * these helpers just coerce and read that shape.
 */

export interface QcProject {
  projectId: number;
  name: string;
  language: string;
}

export function normalizeProject(raw: Record<string, unknown>): QcProject | null {
  const id = raw.projectId ?? raw.id;
  const projectId = typeof id === 'number' ? id : Number(id);
  if (!Number.isFinite(projectId)) return null;
  return {
    projectId,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : `Project ${projectId}`,
    language: typeof raw.language === 'string' ? raw.language : '',
  };
}

/** Compile state as the panel reads it — building keeps polling. */
export type CompilePhase = 'building' | 'success' | 'error';

export function compilePhase(state: string | null | undefined): CompilePhase {
  if (state === 'BuildSuccess') return 'success';
  if (state === 'BuildError') return 'error';
  return 'building'; // InQueue, null, or anything else = still working
}

/**
 * The headline stats to surface from a QC backtest's statistics block, in
 * display order. QC returns a flat string→string map with human keys; we
 * pick the ones a quant looks at first and pass the rest through untouched.
 */
const HEADLINE_KEYS = [
  'Sharpe Ratio',
  'Total Return',
  'Compounding Annual Return',
  'Drawdown',
  'Win Rate',
  'Total Trades',
];

export interface StatLine {
  label: string;
  value: string;
}

/** The engine's QC equity-chart response (`.../backtest/{id}/chart`). */
export interface QcChartBody {
  connected?: boolean;
  /** false when QC is still building or the chart has no equity points. */
  chartable?: boolean;
  points?: number[];
  labels?: string[];
  n_points?: number;
}

/**
 * The equity y-series to plot from a QC chart response, or [] when QC returned
 * no chartable curve. Every value is a real QC equity value — the panel draws
 * this only when it's non-empty, never a fabricated line.
 */
export function qcEquityPoints(body: QcChartBody | null | undefined): number[] {
  if (!body || body.chartable !== true || !Array.isArray(body.points)) return [];
  return body.points.filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
}

export function headlineStats(statistics: Record<string, unknown> | null | undefined): StatLine[] {
  if (!statistics || typeof statistics !== 'object') return [];
  const out: StatLine[] = [];
  for (const key of HEADLINE_KEYS) {
    const v = (statistics as Record<string, unknown>)[key];
    if (v !== undefined && v !== null && String(v).length > 0) {
      out.push({ label: key, value: String(v) });
    }
  }
  return out;
}

/** The engine route that persists a completed QC backtest as a local-shaped
 *  run record (POST). Its response is read by {@link classifyPersist}. */
export function qcPersistPath(projectId: number, backtestId: string): string {
  return `/ui/api/quantconnect/projects/${projectId}/backtest/${encodeURIComponent(
    backtestId
  )}/persist`;
}

/** The engine's persist response (`.../backtest/{id}/persist`). Honest shape:
 *  a job id on success, a disconnected flag on 409, an error line on 422. */
export interface QcPersistBody {
  connected?: boolean;
  persisted?: boolean;
  job_id?: number | null;
  error?: string;
}

/**
 * What persisting a completed QC backtest as a local run yielded — the single
 * outbound edge's outcome. The engine answers honestly and this reads it:
 *   - `opened`       200 with `persisted:true` + a numeric `job_id` — ready to
 *                    open in the viewer.
 *   - `disconnected` 409 — the account isn't connected (token rotated / dropped).
 *   - `building`     422 — the backtest has no chartable equity series yet
 *                    (still building on QuantConnect).
 *   - `error`        anything else, including a dead transport (status 0).
 * Each non-`opened` outcome carries a plain reason so the affordance renders an
 * explanatory state, never a dead click.
 */
export type PersistOutcome =
  | { kind: 'opened'; jobId: number }
  | { kind: 'disconnected'; message: string }
  | { kind: 'building'; message: string }
  | { kind: 'error'; message: string };

const PERSIST_DISCONNECTED =
  'Reconnect QuantConnect in Settings to open this run in the viewer.';
const PERSIST_BUILDING =
  'QuantConnect is still finishing this backtest — open it in the viewer once the run completes.';

export function classifyPersist(status: number, body: unknown): PersistOutcome {
  const b = (body ?? {}) as QcPersistBody;
  if (status === 200 && b.persisted === true && typeof b.job_id === 'number') {
    return { kind: 'opened', jobId: b.job_id };
  }
  if (status === 409) return { kind: 'disconnected', message: PERSIST_DISCONNECTED };
  if (status === 422) {
    return {
      kind: 'building',
      message: typeof b.error === 'string' && b.error ? b.error : PERSIST_BUILDING,
    };
  }
  return {
    kind: 'error',
    message:
      typeof b.error === 'string' && b.error
        ? b.error
        : `Could not open this run in the viewer (${status || 'engine unreachable'}).`,
  };
}

/** The import translation report as the panel reads it. */
export interface QcTranslateReport {
  style?: string;
  coverage?: number;
  unmapped?: string[];
  notes?: string[];
  scaffold?: string;
}

/** Ambient context for an active QC import (project + last translation). */
export function qcContext(
  project: QcProject,
  report: QcTranslateReport | null,
  savedPath: string | null
): Record<string, unknown> {
  return {
    panel: 'qc-import',
    project: project.name,
    project_id: project.projectId,
    language: project.language,
    imported: report != null,
    coverage: typeof report?.coverage === 'number' ? report.coverage : null,
    unmapped: report?.unmapped ?? [],
    saved_path: savedPath,
  };
}

/** The "Adapt this translation" hand-off prompt. */
export function qcPrompt(
  project: QcProject,
  report: QcTranslateReport,
  savedPath: string | null
): string {
  const cov =
    typeof report.coverage === 'number' ? `${Math.round(report.coverage * 100)}%` : 'unknown';
  const lines: string[] = [
    `I imported the QuantConnect project "${project.name}" (#${project.projectId}, ` +
      `${project.language || 'unknown language'}) into an Auracle strategy.`,
    `The automatic translation covered ${cov}` +
      `${report.style ? ` (detected style: ${report.style})` : ''}.`,
  ];
  const unmapped = report.unmapped ?? [];
  if (unmapped.length > 0) {
    lines.push('', `These pieces did NOT translate and need hand-adapting: ${unmapped.join(', ')}.`);
  }
  if (savedPath) {
    lines.push(
      '',
      `The scaffold is saved at \`${savedPath}\` in my workspace. Read it, then finish the port: ` +
        'implement the unmapped pieces and make it a correct, runnable Auracle strategy (a subclass ' +
        'of auracle.backtest.Strategy with universe / prices_to_signals).'
    );
  } else {
    lines.push(
      '',
      'Here is the generated scaffold — finish the port (implement the unmapped pieces and make ' +
        'it a correct, runnable Auracle strategy):',
      '',
      '```python',
      report.scaffold ?? '',
      '```'
    );
  }
  return lines.join('\n');
}
