/**
 * Translation validation (#274) — the side-by-side that makes a QuantConnect
 * import trustworthy. Renders the graded verdict (reproduced / partial /
 * diverged / insufficient / stats-only) over a QuantConnect-vs-Auracle metric
 * table with an honest coverage note. Every figure is a real reported value; a
 * diverged metric is flagged, a metric the local engine didn't produce reads
 * "not measured", never hidden.
 *
 * Styled with panelkit `tone` inline styles (the pack purges host Tailwind, so
 * utility classes would not resolve) — the grade colour carries the verdict:
 * green = reproduced, neutral = stats-only, amber = insufficient, red = diverged.
 */
import type { CSSProperties } from 'react';

import { numeric, tint, tone } from './panelkit';
import type { QcValidationGrade, QcValidationReport as Report } from '../engine/quantconnect';

const GRADE_LABEL: Record<QcValidationGrade, string> = {
  reproduced: 'Reproduced',
  reproduced_partial: 'Reproduced (partial)',
  stats_match: 'Stats match',
  diverged: 'Diverged',
  insufficient_coverage: 'Insufficient coverage',
};

const GRADE_COLOR: Record<QcValidationGrade, string> = {
  reproduced: tone.ok,
  reproduced_partial: tone.ok,
  stats_match: tone.text2,
  diverged: tone.danger,
  insufficient_coverage: tone.caution,
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

const thBase: CSSProperties = {
  padding: '5px 0',
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  color: tone.text3,
};
const tdBase: CSSProperties = { padding: '5px 0', fontSize: 12, ...numeric };

export function QcValidationReport({ report }: { report: Report }): JSX.Element {
  const cov = report.coverage;
  const gradeColor = GRADE_COLOR[report.grade] ?? tone.text2;

  return (
    <div data-testid="qc-validation" data-grade={report.grade} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          data-testid="qc-validation-grade"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: 5,
            padding: '3px 8px',
            fontSize: 11,
            fontWeight: 600,
            color: gradeColor,
            background: tint(gradeColor, 12),
            border: `1px solid ${tint(gradeColor, 40)}`,
          }}
        >
          {GRADE_LABEL[report.grade] ?? report.grade}
        </span>
        <span style={{ fontSize: 12, color: tone.text2, lineHeight: 1.5 }}>{report.summary}</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', ...numeric }}>
        <thead>
          <tr>
            <th style={{ ...thBase, textAlign: 'left' }}>Metric</th>
            <th style={{ ...thBase, textAlign: 'right', paddingLeft: 12 }}>QuantConnect</th>
            <th style={{ ...thBase, textAlign: 'right', paddingLeft: 12 }}>Auracle</th>
            <th style={{ ...thBase, textAlign: 'right', paddingLeft: 12 }}>&Delta;</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => {
            // A metric the local engine never produced is neither a match nor a
            // divergence — show it "not measured", muted, with no delta, rather
            // than a red-flagged row implying the import failed.
            const notMeasured = row.not_measured === true;
            const diverged = !notMeasured && !row.within_tolerance;
            const rowColor = diverged ? tone.danger : notMeasured ? tone.text3 : tone.text;
            return (
              <tr
                key={row.metric}
                data-testid={`qc-row-${row.metric}`}
                data-diverged={diverged ? 'true' : 'false'}
                data-not-measured={notMeasured ? 'true' : 'false'}
                style={{ color: rowColor, borderTop: `1px solid ${tone.border}` }}
              >
                <td style={{ ...tdBase, textAlign: 'left', color: notMeasured ? tone.text3 : tone.text2 }}>
                  {row.label}
                </td>
                <td style={{ ...tdBase, textAlign: 'right', paddingLeft: 12 }}>{fmt(row.metric, row.qc)}</td>
                <td style={{ ...tdBase, textAlign: 'right', paddingLeft: 12 }}>
                  {notMeasured ? 'not measured' : fmt(row.metric, row.auracle)}
                </td>
                <td style={{ ...tdBase, textAlign: 'right', paddingLeft: 12 }}>
                  {notMeasured ? '—' : fmtDelta(row.metric, row.delta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <span data-testid="qc-validation-coverage" style={{ fontSize: 11, lineHeight: 1.5, color: tone.text3 }}>
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
      </span>
    </div>
  );
}
