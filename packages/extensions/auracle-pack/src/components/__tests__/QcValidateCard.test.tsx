/**
 * The interactive Validate control (#274). The engine client is mocked at its
 * seam, so the states asserted here — prompt-when-no-run, validating → graded
 * report, and honest not-connected error — are exactly what the panel shows.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const postJson = vi.fn();
vi.mock('../../engine/client', () => ({
  postJson: (...args: unknown[]) => postJson(...args),
}));

import { QcValidateCard } from '../QcValidateCard';

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

const STATS = { 'Compounding Annual Return': '26.61%', 'Sharpe Ratio': '0.97' };

describe('QcValidateCard', () => {
  beforeEach(() => postJson.mockReset());

  it('prompts to run locally when there are no Auracle statistics', () => {
    render(<QcValidateCard projectId={1} backtestId="bt" auracleStatistics={null} />);
    expect(screen.getByTestId('qc-validate-needs-run').textContent).toMatch(/run the imported strategy/i);
  });

  it('validates and renders the graded report, calling the engine correctly', async () => {
    postJson.mockResolvedValue({ ok: true, status: 200, body: REPORT_BODY });
    render(<QcValidateCard projectId={7} backtestId="bt-9" auracleStatistics={STATS} />);
    fireEvent.click(screen.getByTestId('qc-validate-btn'));
    await waitFor(() => screen.getByTestId('qc-validation-grade'));
    expect(screen.getByTestId('qc-validation-grade').textContent).toContain('Reproduced (partial)');
    expect(postJson).toHaveBeenCalledWith(
      '/ui/api/quantconnect/validate',
      expect.objectContaining({ project_id: 7, backtest_id: 'bt-9', auracle_statistics: STATS })
    );
  });

  it('shows an honest reason when QuantConnect is not connected', async () => {
    postJson.mockResolvedValue({ ok: false, status: 200, body: { connected: false, report: null } });
    render(<QcValidateCard projectId={1} backtestId="bt" auracleStatistics={STATS} />);
    fireEvent.click(screen.getByTestId('qc-validate-btn'));
    await waitFor(() => screen.getByTestId('qc-validate-error'));
    expect(screen.getByTestId('qc-validate-error').textContent).toMatch(/connect quantconnect/i);
  });
});
