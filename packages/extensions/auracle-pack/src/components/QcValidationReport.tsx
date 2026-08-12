/**
 * Translation validation (#274) — the side-by-side that makes a QuantConnect
 * import trustworthy. Renders the graded verdict (reproduced / partial /
 * diverged / insufficient / stats-only) over a QuantConnect-vs-Auracle metric
 * table with an honest coverage note. Every figure is a real reported value; a
 * diverged metric is flagged, never hidden.
 */
import type {
  QcValidationGrade,
  QcValidationReport as Report,
} from '../engine/quantconnect';

const GRADE_LABEL: Record<QcValidationGrade, string> = {
  reproduced: 'Reproduced',
  reproduced_partial: 'Reproduced (partial)',
  stats_match: 'Stats match',
  diverged: 'Diverged',
  insufficient_coverage: 'Insufficient coverage',
};

const GRADE_CLASS: Record<QcValidationGrade, string> = {
  reproduced: 'bg-emerald-500/15 text-emerald-600',
  reproduced_partial: 'bg-emerald-500/15 text-emerald-600',
  stats_match: 'bg-sky-500/15 text-sky-600',
  diverged: 'bg-rose-500/15 text-rose-600',
  insufficient_coverage: 'bg-amber-500/15 text-amber-600',
};

/** Format a parsed statistic for display, by metric (units differ). */
function fmt(metric: string, value: number | null): string {
  if (value == null) return '—';
  switch (metric) {
    case 'cagr':
      return `${(value * 100).toFixed(2)}%`;
    case 'sharpe':
      return value.toFixed(2);
    case 'fees':
      return `$${Math.round(value).toLocaleString()}`;
    case 'orders':
      return Math.round(value).toLocaleString();
    default:
      return String(value);
  }
}

function fmtDelta(metric: string, value: number | null): string {
  if (value == null) return '—';
  const magnitude = fmt(metric, Math.abs(value));
  return value < 0 ? `−${magnitude}` : `+${magnitude}`;
}

export function QcValidationReport({ report }: { report: Report }): JSX.Element {
  const cov = report.coverage;
  return (
    <div className="qc-validation" data-testid="qc-validation" data-grade={report.grade}>
      <div className="flex items-center gap-2">
        <span
          data-testid="qc-validation-grade"
          className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium ${
            GRADE_CLASS[report.grade] ?? 'bg-slate-500/15 text-slate-600'
          }`}
        >
          {GRADE_LABEL[report.grade] ?? report.grade}
        </span>
        <p className="text-xs text-muted-foreground">{report.summary}</p>
      </div>

      <table className="mt-2 w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Metric</th>
            <th className="py-1 px-3 text-right font-medium">QuantConnect</th>
            <th className="py-1 px-3 text-right font-medium">Auracle</th>
            <th className="py-1 pl-3 text-right font-medium">&Delta;</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => {
            // A metric the local engine never produced is neither a match nor a
            // divergence — show it as "not measured", muted, with no delta,
            // rather than a rose-flagged row implying the import failed.
            const notMeasured = row.not_measured === true;
            const diverged = !notMeasured && !row.within_tolerance;
            return (
              <tr
                key={row.metric}
                data-testid={`qc-row-${row.metric}`}
                data-diverged={diverged ? 'true' : 'false'}
                data-not-measured={notMeasured ? 'true' : 'false'}
                className={diverged ? 'text-rose-500' : notMeasured ? 'text-muted-foreground' : ''}
              >
                <td className="py-1 pr-3">{row.label}</td>
                <td className="py-1 px-3 text-right">{fmt(row.metric, row.qc)}</td>
                <td className="py-1 px-3 text-right">
                  {notMeasured ? 'not measured' : fmt(row.metric, row.auracle)}
                </td>
                <td className="py-1 pl-3 text-right">
                  {notMeasured ? '—' : fmtDelta(row.metric, row.delta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-2 text-[11px] text-muted-foreground" data-testid="qc-validation-coverage">
        {cov ? (
          <>
            Priced {cov.coverage_pct}% of the book ({cov.covered}/{cov.total}).
            {cov.missing.length > 0
              ? ` Unverifiable: ${cov.missing.slice(0, 8).join(', ')}${
                  cov.missing.length > 8 ? ` +${cov.missing.length - 8} more` : ''
                }.`
              : ''}
          </>
        ) : (
          <>Coverage unverified — the QC run wasn&apos;t instrumented to record its universe.</>
        )}
      </p>
    </div>
  );
}
