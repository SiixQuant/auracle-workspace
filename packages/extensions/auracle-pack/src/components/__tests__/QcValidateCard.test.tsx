/**
 * The interactive Validate control (#274). The engine client is mocked at its
 * seam, so the states asserted here are exactly what the panel shows: a prompt
 * when there are no local runs to compare, and — once a recent run is picked —
 * validate-by-job-id → graded report, plus the honest not-connected reason.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const postJson = vi.fn();
const tearsheetRuns = vi.fn();
vi.mock('../../engine/client', () => ({
  postJson: (...args: unknown[]) => postJson(...args),
  tearsheetRuns: (...args: unknown[]) => tearsheetRuns(...args),
}));

import { QcValidateCard } from '../QcValidateCard';

const RUN = {
  jobId: 42,
  strategyPath: 'strategies.desk.foo.Foo',
  asOf: '2020-12-31',
  nBars: 100,
  finishedAt: '2020-12-31T00:00:00Z',
  totalReturn: 1.7,
  sharpe: 0.97,
  maxDrawdown: -0.3,
};

const REPORT_BODY = {
  connected: true,
  completed: true,
  report: {
    grade: 'reproduced_partial',
    pass: true,
    summary: 'Reproduced 80% of the book within tolerance; 20% unverifiable.',
    coverage: { total: 5, covered: 4, coverage_pct: 80, missing: ['DEAD2'] },
    rows: [
      { metric: 'cagr', label: 'CAGR', qc: 0.2685, auracle: 0.2661, delta: -0.0024, limit: 0.005, within_tolerance: true },
      { metric: 'sharpe', label: 'Sharpe', qc: 0.945, auracle: 0.97, delta: 0.025, limit: 0.05, within_tolerance: true },
    ],
  },
};

describe('QcValidateCard', () => {
  beforeEach(() => {
    postJson.mockReset();
    tearsheetRuns.mockReset();
  });

  it('prompts to run locally when there are no local runs', async () => {
    tearsheetRuns.mockResolvedValue([]);
    render(<QcValidateCard projectId={1} backtestId="bt" />);
    await waitFor(() => screen.getByTestId('qc-validate-needs-run'));
    expect(screen.getByTestId('qc-validate-needs-run').textContent).toMatch(/run the imported strategy/i);
  });

  it('validates the picked run by job id and renders the graded report', async () => {
    tearsheetRuns.mockResolvedValue([RUN]);
    postJson.mockResolvedValue({ ok: true, status: 200, body: REPORT_BODY });
    render(<QcValidateCard projectId={7} backtestId="bt-9" />);
    await waitFor(() => screen.getByTestId('qc-validate-btn'));

    fireEvent.change(screen.getByLabelText('Local run to compare'), { target: { value: '42' } });
    fireEvent.click(screen.getByTestId('qc-validate-btn'));

    await waitFor(() => screen.getByTestId('qc-validation-grade'));
    expect(screen.getByTestId('qc-validation-grade').textContent).toContain('Reproduced (partial)');
    expect(postJson).toHaveBeenCalledWith(
      '/ui/api/quantconnect/validate',
      expect.objectContaining({ project_id: 7, backtest_id: 'bt-9', auracle_job_id: 42 })
    );
  });

  it('shows an honest reason when QuantConnect is not connected', async () => {
    tearsheetRuns.mockResolvedValue([RUN]);
    postJson.mockResolvedValue({ ok: false, status: 200, body: { connected: false, report: null } });
    render(<QcValidateCard projectId={1} backtestId="bt" />);
    await waitFor(() => screen.getByTestId('qc-validate-btn'));

    fireEvent.change(screen.getByLabelText('Local run to compare'), { target: { value: '42' } });
    fireEvent.click(screen.getByTestId('qc-validate-btn'));

    await waitFor(() => screen.getByTestId('qc-validate-error'));
    expect(screen.getByTestId('qc-validate-error').textContent).toMatch(/connect quantconnect/i);
  });
});
