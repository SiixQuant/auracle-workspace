/**
 * Scenario room (Frontier #11): replays the focused run through historical
 * stress windows by slicing its stored curve. Pins the column shape, the idle
 * state, a covered window, and a window left blank when it's outside history.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/client')>();
  return { ...actual, tearsheetResult: vi.fn() };
});

import { tearsheetResult } from '../../engine/client';
import { focusStore } from '../../engine/focusStore';
import { runScenarios } from '../../engine/scenarios';
import { openGridHome } from '../grid/gridNav';
import { ScenarioPage, scenarioColumns } from '../grid/pages/ScenarioPage';

const resultMock = tearsheetResult as unknown as Mock;
const Page = ScenarioPage as unknown as () => JSX.Element;

// A curve spanning 2007→2021 so the GFC and COVID windows are covered.
const LABELS = ['2007-01-03', '2008-01-02', '2009-06-01', '2020-02-19', '2020-03-23', '2021-01-04'];
const POINTS = [1.0, 1.1, 0.7, 2.0, 1.6, 2.2];

afterEach(() => {
  cleanup();
  focusStore.clear();
  openGridHome();
  vi.clearAllMocks();
});

function focusRun(id = '42'): void {
  focusStore.publish({
    strategy: { filePath: 'strategies/x.py', dottedPath: 'strategies.x.X' },
    run: { kind: 'backtest', id },
  });
}

describe('scenarioColumns', () => {
  it('is the five-column stress shape with a return trend', () => {
    const cols = scenarioColumns(runScenarios(LABELS, POINTS));
    expect(cols.map((c) => c.key)).toEqual(['name', 'period', 'return', 'maxdd', 'trend']);
    expect(cols.find((c) => c.key === 'return')?.trend).toBe(true);
  });
});

describe('ScenarioPage', () => {
  it('shows the idle state when no run is focused', () => {
    render(<Page />);
    expect(screen.getByText('No run focused yet')).toBeTruthy();
  });

  it('replays the focused run — covered windows carry figures', async () => {
    resultMock.mockResolvedValue({ chartable: true, chart: { labels: LABELS, points: POINTS } });
    focusRun('42');
    render(<Page />);
    await screen.findByTestId('scenario-grid');
    const covid = screen.getByTestId('scenario-grid-row-covid'); // 2020-02-19 … 2020-03-23 present
    expect(within(covid).getAllByText(/%$/).length).toBeGreaterThanOrEqual(1); // return + drawdown %
  });

  it('leaves a window outside the run history blank', async () => {
    resultMock.mockResolvedValue({ chartable: true, chart: { labels: ['2021-01-04', '2021-06-01'], points: [1.0, 1.1] } });
    focusRun('7');
    render(<Page />);
    await screen.findByTestId('scenario-grid');
    const gfc = screen.getByTestId('scenario-grid-row-gfc'); // 2007–2009 — not in a 2021 curve
    expect(within(gfc).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});
