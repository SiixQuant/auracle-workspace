/**
 * The QC library's one outbound edge — "Open in Metrics Viewer" on a completed
 * cloud backtest. It persists the run through the engine (POST .../persist),
 * then opens it in the Backtest panel as an external run. The mocked seam is
 * the engine client's persist POST plus the spine action that fronts the
 * viewer; a recorded QC round-trip fixture drives the happy path and the honest
 * 409 (disconnected) / 422 (still building) states. The panel stays OFF the
 * Spine: the edge publishes no focus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { QcBacktestResult } from '../QcImportPanel';
import { focusStore } from '../../engine/focusStore';
import roundTrip from './fixtures/qcPersistRoundTrip.json';

vi.mock('../../engine/client', async (importActual) => {
  const actual = await importActual<typeof import('../../engine/client')>();
  return { ...actual, postJson: vi.fn() };
});
vi.mock('../spineActions', () => ({ openRunInViewer: vi.fn() }));

import { postJson } from '../../engine/client';
import { openRunInViewer } from '../spineActions';

const bridge = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  body,
});

// A completed, chartable QC backtest as the panel holds it once the poll ends.
const EQUITY = roundTrip.resultSourceBlind.chart.points;
const STATS = [{ label: 'Sharpe Ratio', value: '1.42' }];

function renderResult(overrides: { equity?: number[]; empty?: boolean } = {}) {
  return render(
    <QcBacktestResult
      projectId={9}
      backtestId="bt-9"
      stats={overrides.empty ? [] : STATS}
      equity={overrides.equity ?? EQUITY}
      empty={overrides.empty ?? false}
    />
  );
}

beforeEach(() => {
  vi.mocked(postJson).mockResolvedValue(bridge(200, roundTrip.persistOpened) as never);
});

afterEach(() => {
  cleanup();
  focusStore.clear();
  vi.clearAllMocks();
});

describe('QC open-in-viewer edge', () => {
  it('persists the completed backtest, then opens it as an external run', async () => {
    renderResult();

    fireEvent.click(screen.getByTestId('qc-open-in-viewer'));

    await waitFor(() =>
      expect(vi.mocked(postJson)).toHaveBeenCalledWith(
        '/ui/api/quantconnect/projects/9/backtest/bt-9/persist'
      )
    );
    // The persisted job id is opened in the viewer, tagged with its source so
    // the run is labelled and its local verbs hidden.
    await waitFor(() =>
      expect(vi.mocked(openRunInViewer)).toHaveBeenCalledWith(4242, 'quantconnect')
    );
  });

  it('publishes no Spine focus from the QC panel', async () => {
    renderResult();

    fireEvent.click(screen.getByTestId('qc-open-in-viewer'));
    await waitFor(() => expect(vi.mocked(openRunInViewer)).toHaveBeenCalled());

    // The edge drives the viewer; it never puts the QC run on the Spine.
    expect(focusStore.getSnapshot().run).toBeUndefined();
    expect(focusStore.getSnapshot().strategy).toBeUndefined();
  });

  it('renders a reconnect reason on 409 and does not open the viewer', async () => {
    vi.mocked(postJson).mockResolvedValue(bridge(409, roundTrip.persistDisconnected) as never);
    renderResult();

    fireEvent.click(screen.getByTestId('qc-open-in-viewer'));

    expect(await screen.findByText(/reconnect quantconnect/i)).toBeTruthy();
    expect(vi.mocked(openRunInViewer)).not.toHaveBeenCalled();
  });

  it('renders the still-building reason on 422 and does not open the viewer', async () => {
    vi.mocked(postJson).mockResolvedValue(bridge(422, roundTrip.persistBuilding) as never);
    renderResult();

    fireEvent.click(screen.getByTestId('qc-open-in-viewer'));

    expect(await screen.findByText(/no chartable equity series yet/i)).toBeTruthy();
    expect(vi.mocked(openRunInViewer)).not.toHaveBeenCalled();
  });

  it('disables the edge (no dead click) when there is no chartable curve yet', () => {
    renderResult({ equity: [1], empty: true });

    const btn = screen.getByTestId('qc-open-in-viewer') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(vi.mocked(postJson)).not.toHaveBeenCalled();
    expect(vi.mocked(openRunInViewer)).not.toHaveBeenCalled();
  });
});
