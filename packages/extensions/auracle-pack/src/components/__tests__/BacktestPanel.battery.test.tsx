/**
 * The factor-attribution battery inside the Metrics Viewer, at the mocked
 * client seam. Covers the rail rendering from a battery fixture, the strict
 * passthrough of the engine's verdict/reading strings (no client-side
 * threshold ever re-derives a judgment), the explicit absent state from a 4xx,
 * and the imported-run path (a persisted QC run, keyed by the same job id,
 * carries a cross-source provenance caveat).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { BacktestPanel } from '../BacktestPanel';
import { backtestStore } from '../../engine/backtestStore';
import { focusStore } from '../../engine/focusStore';

vi.mock('../../engine/client', async (importActual) => {
  const actual = await importActual<typeof import('../../engine/client')>();
  return { ...actual, backtestJobResult: vi.fn(), backtestJobFactors: vi.fn() };
});

import { backtestJobResult, backtestJobFactors } from '../../engine/client';

const localRun = {
  status: 'succeeded',
  chartable: true,
  strategy_path: 'strategies.desk.atlas.AtlasMomentum',
  as_of: '2026-01-02',
  n_bars: 300,
  stats: { annualized_return: 0.22, sharpe: 1.3, max_drawdown: -0.2 },
  chart: { labels: ['2020-01-01', '2020-06-01', '2021-01-01'], points: [1, 1.2, 1.5] },
  drawdown: { labels: ['2020-01-01', '2020-06-01', '2021-01-01'], points: [0, -5, -2] },
  trades: 12,
};
const qcRun = { ...localRun, kind: 'qc_import', strategy_path: 'imported.qc.MomentumBurst' };

const ALPHA_READING =
  'After stripping out market, size, value and momentum exposure, the strategy still added about 6.1% a year that the factors do not explain, and that edge is unlikely to be luck (p = 0.030).';

const battery = {
  ok: true,
  job_id: 42,
  n_obs: 250,
  factor_set: ['Mkt-RF', 'SMB', 'HML', 'UMD'],
  window: { start: '2015-01-02', end: '2016-06-30' },
  factor_data: {
    source: 'Ken French Data Library',
    coverage_start: '1926-07-01',
    coverage_end: '2024-12-31',
    stale: false,
    note: 'Bundled factors cover 1926-07-01 to 2024-12-31.',
  },
  hac_lags: 5,
  periods_per_year: 252,
  measures: [
    {
      measure: 'alpha',
      label: 'Alpha (annualized)',
      verdict: 'significant_positive',
      reading: ALPHA_READING,
      annual: 0.061,
      per_period: 0.00024,
      tstat: 2.17,
      pvalue: 0.03,
    },
    {
      measure: 'market_exposure',
      label: 'Market exposure (Mkt-RF)',
      verdict: 'market_like',
      reading: 'It moves about one-for-one with the market. (beta 1.00, p < 0.001).',
      beta: 1.0,
      tstat: 20.1,
      pvalue: 0.0002,
    },
    {
      measure: 'fit',
      label: 'Factor fit (R-squared)',
      verdict: 'well_explained',
      reading: 'The factors explain most of the return swings (86.0% of the variance).',
      r_squared: 0.86,
      r_squared_adj: 0.858,
    },
  ],
};

const ok = (body: Record<string, unknown>) => ({ ok: true as const, body });

beforeEach(() => {
  vi.mocked(backtestJobResult).mockResolvedValue(ok(localRun) as never);
  vi.mocked(backtestJobFactors).mockResolvedValue(ok(battery) as never);
});

afterEach(() => {
  cleanup();
  backtestStore.reset();
  focusStore.clear();
  vi.clearAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

async function showRunWithBattery(id: string) {
  focusStore.publish({ run: { kind: 'backtest', id } });
  render(<BacktestPanel />);
  // The saved-run view mounts, then the battery section requests by job id.
  await screen.findByTestId('metrics-viewer');
}

describe('Factor battery — Metrics Viewer rail', () => {
  it('renders the battery as a measure rail for a completed run, keyed by job id', async () => {
    await showRunWithBattery('42');

    expect(await screen.findByTestId('battery-measure-alpha')).toBeTruthy();
    expect(vi.mocked(backtestJobFactors)).toHaveBeenCalledWith(42);

    // Every measure row is present, labelled by the engine.
    expect(screen.getByTestId('battery-measure-market_exposure')).toBeTruthy();
    expect(screen.getByTestId('battery-measure-fit')).toBeTruthy();
    expect(screen.getByText('Alpha (annualized)')).toBeTruthy();
    expect(screen.getByText('Market exposure (Mkt-RF)')).toBeTruthy();

    // The engine's coverage note rides along.
    expect(screen.getByText('Bundled factors cover 1926-07-01 to 2024-12-31.')).toBeTruthy();
    // A local run implies no other source, so no cross-source caveat.
    expect(screen.queryByTestId('battery-provenance')).toBeNull();
  });

  it('renders the engine verdict and reading strings verbatim — no client threshold', async () => {
    await showRunWithBattery('42');
    await screen.findByTestId('battery-measure-alpha');

    // The reading is the engine's sentence, shown exactly.
    expect(screen.getByText(ALPHA_READING)).toBeTruthy();
    // The verdict word is the engine's category, humanized only for reading.
    expect(screen.getByText('significant positive')).toBeTruthy();
    expect(screen.getByText('market like')).toBeTruthy();
    expect(screen.getByText('well explained')).toBeTruthy();
  });

  it('never re-derives significance from the p-value it was handed', async () => {
    // Contradiction on purpose: a 0.9 p-value under a "significant_positive"
    // verdict. A client that applied its own 5% bar would flip this to
    // insignificant; the rail must show the engine's word unchanged.
    vi.mocked(backtestJobFactors).mockResolvedValue(
      ok({
        ...battery,
        measures: [
          {
            measure: 'alpha',
            label: 'Alpha (annualized)',
            verdict: 'significant_positive',
            reading: 'The engine judged this significant.',
            annual: 0.02,
            pvalue: 0.9,
          },
        ],
      }) as never
    );

    await showRunWithBattery('42');
    await screen.findByTestId('battery-measure-alpha');

    expect(screen.getByText('significant positive')).toBeTruthy();
    expect(screen.getByText('The engine judged this significant.')).toBeTruthy();
    // No invented "insignificant"/"not significant" language from the client.
    expect(screen.queryByText(/insignificant|not significant/i)).toBeNull();
  });

  it('shows the engine explanation when the battery is unavailable (4xx), never a blank section', async () => {
    const reason =
      'cannot run factor regression: not enough overlapping observations (12) to regress on 4 factors';
    vi.mocked(backtestJobFactors).mockResolvedValue({
      ok: false,
      status: 400,
      body: { ok: false, error: reason },
    } as never);

    await showRunWithBattery('42');

    const absent = await screen.findByTestId('battery-absent');
    expect(absent.textContent).toContain(reason);
    // The section is present but carries no measure rows.
    expect(screen.getByText('Factor attribution')).toBeTruthy();
    expect(screen.queryByTestId('battery-measure-alpha')).toBeNull();
  });

  it('serves a persisted QC import through the same rail with a cross-source caveat', async () => {
    vi.mocked(backtestJobResult).mockResolvedValue(ok(qcRun) as never);
    await showRunWithBattery('77');

    // Same rail, keyed by the imported run's job id.
    expect(await screen.findByTestId('battery-measure-alpha')).toBeTruthy();
    expect(vi.mocked(backtestJobFactors)).toHaveBeenCalledWith(77);

    // The provenance caveat names the source and denies cross-source comparison.
    const caveat = screen.getByTestId('battery-provenance');
    expect(caveat.textContent).toContain('QuantConnect');
    expect(caveat.textContent?.toLowerCase()).toContain('not comparable');
  });
});
