/**
 * Translation-validation report (#274) — the honest side-by-side.
 *
 * The promise pinned here is honesty: the graded verdict is shown as-given, a
 * metric that fell outside tolerance is FLAGGED not hidden, every figure is the
 * real reported value formatted for its unit, and when the QC run wasn't
 * instrumented the coverage line says so rather than implying a full match.
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { QcValidationReport } from '../QcValidationReport';
import type { QcValidationReport as Report } from '../../engine/quantconnect';

const BASE: Report = {
  grade: 'reproduced_partial',
  pass: true,
  summary: 'Reproduced 80% of the book within tolerance; 20% unverifiable (1 symbols missing bars).',
  coverage: { total: 5, covered: 4, coverage_pct: 80, missing: ['DEAD2'] },
  rows: [
    { metric: 'cagr', label: 'CAGR', qc: 0.2685, auracle: 0.2661, delta: -0.0024, limit: 0.005, within_tolerance: true },
    { metric: 'sharpe', label: 'Sharpe', qc: 0.945, auracle: 0.97, delta: 0.025, limit: 0.05, within_tolerance: true },
    { metric: 'fees', label: 'Total Fees', qc: 60798, auracle: 58000, delta: -2798, limit: 3039, within_tolerance: true },
    { metric: 'orders', label: 'Total Orders', qc: 7623, auracle: 7700, delta: 77, limit: 152, within_tolerance: true },
  ],
};

describe('QcValidationReport', () => {
  it('renders the grade, summary, and a formatted side-by-side row per metric', () => {
    render(<QcValidationReport report={BASE} />);
    expect(screen.getByTestId('qc-validation-grade').textContent).toContain('Reproduced (partial)');
    expect(screen.getAllByTestId(/^qc-row-/)).toHaveLength(4);
    // real QC + Auracle values, formatted for the metric's unit
    const cagr = screen.getByTestId('qc-row-cagr');
    expect(cagr.textContent).toContain('26.85%');
    expect(cagr.textContent).toContain('26.61%');
    expect(screen.getByTestId('qc-row-fees').textContent).toContain('$60,798');
  });

  it('flags only the diverged metric', () => {
    const diverged: Report = {
      ...BASE,
      grade: 'diverged',
      pass: false,
      rows: BASE.rows.map((r) =>
        r.metric === 'sharpe'
          ? { ...r, auracle: 1.42, delta: 0.475, within_tolerance: false }
          : r
      ),
    };
    render(<QcValidationReport report={diverged} />);
    expect(screen.getByTestId('qc-row-sharpe').getAttribute('data-diverged')).toBe('true');
    expect(screen.getByTestId('qc-row-cagr').getAttribute('data-diverged')).toBe('false');
  });

  it('names the unverifiable symbols when coverage is partial', () => {
    render(<QcValidationReport report={BASE} />);
    const note = screen.getByTestId('qc-validation-coverage');
    expect(note.textContent).toContain('Priced 80%');
    expect(note.textContent).toContain('DEAD2');
  });

  it('says coverage is unverified for an un-instrumented (stats-only) run', () => {
    const statsOnly: Report = { ...BASE, grade: 'stats_match', coverage: null };
    render(<QcValidationReport report={statsOnly} />);
    expect(screen.getByTestId('qc-validation-grade').textContent).toContain('Stats match');
    expect(screen.getByTestId('qc-validation-coverage').textContent).toMatch(/unverified/i);
  });

  it('shows a metric the local engine did not produce as "not measured", not diverged', () => {
    const withUnmeasured: Report = {
      ...BASE,
      rows: BASE.rows.map((r) =>
        r.metric === 'fees'
          ? { ...r, auracle: null, delta: null, within_tolerance: false, not_measured: true }
          : r
      ),
    };
    render(<QcValidationReport report={withUnmeasured} />);
    const fees = screen.getByTestId('qc-row-fees');
    expect(fees.getAttribute('data-not-measured')).toBe('true');
    // absent from the local engine ≠ a divergence — must not be rose-flagged
    expect(fees.getAttribute('data-diverged')).toBe('false');
    expect(fees.textContent).toMatch(/not measured/i);
  });
});
