/**
 * The Overview's plain-English summary + AuraPoint dossier card (WS-F / FR-F1,
 * FR-F2, FR-F3, AC-3/4 panel side).
 *
 * Two promises are pinned. HONESTY (summary): the strip renders the engine's
 * summary text as-is; a docstring fallback is flagged quietly ("no agent
 * summary yet"), a stale summary is flagged quietly ("may be out of date"), and
 * an absent one shows a quiet empty rest — never fabricated prose. DOSSIER: the
 * Download action POSTs to the dossier route, and once the engine resolves the
 * report it opens the file and shows the "Saved to reports/…" line; a 503 is
 * rendered as the honest "generator not available on this engine build" note, a
 * 400/404 as "this run can't be built".
 *
 * The fetch seams are `client.tearsheetSummary`, `client.buildDossier` and
 * `client.openReport`; mocking them stands in for a live engine. Plotly is
 * mocked because the shared StrategyPage module imports the Overview chart.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('plotly.js-basic-dist-min', () => ({
  default: {
    react: vi.fn(() => Promise.resolve()),
    newPlot: vi.fn(() => Promise.resolve()),
    purge: vi.fn(),
    Plots: { resize: vi.fn() },
  },
}));

vi.mock('../../engine/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/client')>();
  return {
    ...actual,
    tearsheetResult: vi.fn(),
    tearsheetFactors: vi.fn(),
    tearsheetTrades: vi.fn(),
    tearsheetRuns: vi.fn(),
    tearsheetSummary: vi.fn(),
    buildDossier: vi.fn(),
    openReport: vi.fn(),
  };
});

import {
  buildDossier,
  openReport,
  tearsheetFactors,
  tearsheetResult,
  tearsheetRuns,
  tearsheetSummary,
  tearsheetTrades,
  type BacktestResultBody,
  type DossierReport,
  type StrategySummaryBody,
} from '../../engine/client';
import { focusStore } from '../../engine/focusStore';
import { StrategyPage } from '../grid/pages/StrategyPage';

const STRATEGY = 'strategies.desk.fund_pair.FundPair';

/** A loaded, CHARTABLE backtest so the summary + dossier mount below the
 *  metrics. The dossier is only offered for chartable runs (a signal/function
 *  run has no equity curve to build one from), so its test uses a run with a
 *  curve — Plotly is mocked above, so the Overview chart renders harmlessly. */
const RESULT: BacktestResultBody = {
  status: 'succeeded',
  chartable: true,
  chart: { labels: ['2020-01-02', '2020-01-03'], points: [1, 1.1] },
  drawdown: { labels: ['2020-01-02', '2020-01-03'], points: [0, -0.05] },
  strategy_path: STRATEGY,
  stats: {},
};

const AGENT_SUMMARY: StrategySummaryBody = {
  summary_text: 'This strategy runs two engines at once — a trend core and a hedged volatility sleeve.',
  source_run_id: 42,
  generated_at: '2026-08-05T12:00:00Z',
  stale: false,
  is_fallback: false,
};

const REPORT: DossierReport = {
  id: 'rep_2026-08-05_fund-pair',
  filename: '2026-08-05_fund-pair_t25-sfxh2.pdf',
  path: 'reports/2026-08-05_fund-pair_t25-sfxh2.pdf',
  created_at: '2026-08-05T12:00:00Z',
  cached: false,
};

/** Minimal host — no `launchAgentSession`, so the optional agent hand-off stays
 *  hidden and these tests stay on the summary + dossier contract. */
const host = { panelId: 'com.auracle.pack.grid', extensionId: 'com.auracle.pack' } as never;

beforeEach(() => {
  vi.mocked(tearsheetResult).mockResolvedValue(RESULT);
  vi.mocked(tearsheetFactors).mockResolvedValue(null);
  vi.mocked(tearsheetTrades).mockResolvedValue({ status: 'succeeded', trades: [] });
  vi.mocked(tearsheetRuns).mockResolvedValue([]);
  vi.mocked(tearsheetSummary).mockResolvedValue(AGENT_SUMMARY);
  vi.mocked(buildDossier).mockResolvedValue({ ok: true, report: REPORT });
  vi.mocked(openReport).mockResolvedValue({ ok: true, opened: true });
  focusStore.publish({ run: { kind: 'backtest', id: '42' } });
});

afterEach(() => {
  cleanup();
  focusStore.clear();
  vi.clearAllMocks();
});

describe('the plain-English summary (FR-F1)', () => {
  it('fetches by strategy_path and renders the agent text below the metrics', async () => {
    render(<StrategyPage host={host} />);
    const text = await screen.findByTestId('tearsheet-summary-text');
    expect(vi.mocked(tearsheetSummary)).toHaveBeenCalledWith(STRATEGY);
    expect(text.textContent).toContain('two engines at once');
    // A real agent summary carries neither the docstring nor the stale note.
    expect(screen.queryByTestId('tearsheet-summary-fallback')).toBeNull();
    expect(screen.queryByTestId('tearsheet-summary-stale')).toBeNull();
  });

  it('notes quietly when the text is only the strategy docstring (is_fallback)', async () => {
    vi.mocked(tearsheetSummary).mockResolvedValue({
      ...AGENT_SUMMARY,
      summary_text: 'A trend + volatility fund pair.',
      is_fallback: true,
    });
    render(<StrategyPage host={host} />);
    const note = await screen.findByTestId('tearsheet-summary-fallback');
    expect(note.textContent?.toLowerCase()).toContain('docstring');
    // The text still renders — the fallback is a note beneath it, not a blank.
    expect(screen.getByTestId('tearsheet-summary-text').textContent).toContain('fund pair');
  });

  it('notes quietly when a stored summary is stale', async () => {
    vi.mocked(tearsheetSummary).mockResolvedValue({ ...AGENT_SUMMARY, stale: true });
    render(<StrategyPage host={host} />);
    const note = await screen.findByTestId('tearsheet-summary-stale');
    expect(note.textContent?.toLowerCase()).toContain('out of date');
  });

  it('shows a quiet empty rest when the engine has no summary', async () => {
    vi.mocked(tearsheetSummary).mockResolvedValue(null);
    render(<StrategyPage host={host} />);
    await screen.findByTestId('tearsheet-summary-empty');
    expect(screen.queryByTestId('tearsheet-summary-text')).toBeNull();
  });
});

describe('the AuraPoint dossier card (FR-F2, FR-F3)', () => {
  it('POSTs the build for the focused run, then opens the resolved report and shows the saved path', async () => {
    render(<StrategyPage host={host} />);
    const button = await screen.findByTestId('tearsheet-dossier-download');

    fireEvent.click(button);
    // POST carries the focused strategy + backtest job id (E5).
    await waitFor(() => expect(vi.mocked(buildDossier)).toHaveBeenCalledWith(STRATEGY, 42));
    // Once resolved, the file is served through the host and the path is shown.
    await waitFor(() => expect(vi.mocked(openReport)).toHaveBeenCalledWith(REPORT.id, REPORT.filename));
    const saved = await screen.findByTestId('tearsheet-dossier-saved');
    expect(saved.textContent).toContain('reports/2026-08-05_fund-pair_t25-sfxh2.pdf');
    expect(screen.queryByTestId('tearsheet-dossier-error')).toBeNull();
  });

  it('renders the honest "generator unavailable" note on a 503 (no WeasyPrint)', async () => {
    vi.mocked(buildDossier).mockResolvedValue({ ok: false, status: 503 });
    render(<StrategyPage host={host} />);
    const button = await screen.findByTestId('tearsheet-dossier-download');

    fireEvent.click(button);
    const err = await screen.findByTestId('tearsheet-dossier-error');
    expect(err.textContent?.toLowerCase()).toContain('not available on this engine');
    // Nothing was opened and no saved path was claimed.
    expect(vi.mocked(openReport)).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tearsheet-dossier-saved')).toBeNull();
  });

  it('renders a "run can’t be built" note on a 400/404', async () => {
    vi.mocked(buildDossier).mockResolvedValue({ ok: false, status: 404 });
    render(<StrategyPage host={host} />);
    fireEvent.click(await screen.findByTestId('tearsheet-dossier-download'));
    const err = await screen.findByTestId('tearsheet-dossier-error');
    expect(err.textContent?.toLowerCase()).toContain("can’t be built");
  });
});
