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
