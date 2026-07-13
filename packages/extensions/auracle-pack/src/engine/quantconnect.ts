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
