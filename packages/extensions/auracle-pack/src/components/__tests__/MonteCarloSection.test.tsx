/**
 * Monte-Carlo robustness section (WS-2). The engine client is mocked at its
 * seam: a completed run renders the fan + terminal multiples + a factual read;
 * an engine rejection renders the engine's own reason, never a blank section.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const backtestJobMonteCarlo = vi.fn();
vi.mock('../../engine/client', () => ({
  backtestJobMonteCarlo: (...a: unknown[]) => backtestJobMonteCarlo(...a),
}));

import { MonteCarloSection } from '../MonteCarloSection';

const OK = {
  ok: true as const,
  body: {
    ok: true,
    n_paths: 500,
    labels: ['2020-01-02', '2020-01-03', '2020-01-06'],
    p05: [1, 0.98, 0.95],
    p50: [1, 1.01, 1.04],
    p95: [1, 1.05, 1.12],
    realised_terminal: 1.09,
    p50_terminal: 1.04,
    p05_terminal: 0.95,
    p95_terminal: 1.12,
  },
};

describe('MonteCarloSection', () => {
  beforeEach(() => backtestJobMonteCarlo.mockReset());

  it('renders the fan, terminal multiples, and a factual read', async () => {
    backtestJobMonteCarlo.mockResolvedValue(OK);
    render(<MonteCarloSection jobId={7} />);
    await waitFor(() => screen.getByTestId('mc-fan'));
    expect(screen.getByTestId('mc-terminals').textContent).toContain('1.09×');
    expect(screen.getByTestId('mc-terminals').textContent).toContain('1.12×');
    const read = screen.getByTestId('mc-read').textContent || '';
    expect(read).toMatch(/500/);
    expect(read).toMatch(/above the resampled median/);
    // never a statistical verdict
    expect(read).not.toMatch(/luck|skill|overfit/i);
    expect(backtestJobMonteCarlo).toHaveBeenCalledWith(7);
  });

  it("shows the engine's own reason when there's insufficient data", async () => {
    backtestJobMonteCarlo.mockResolvedValue({
      ok: false,
      status: 400,
      body: { ok: false, error: 'insufficient data (need ≥30 bars)' },
    });
    render(<MonteCarloSection jobId={1} />);
    await waitFor(() => screen.getByTestId('mc-absent'));
    expect(screen.getByTestId('mc-absent').textContent).toMatch(/insufficient data/);
  });
});
