/**
 * The backtest-results "Deploy" edge, at the mocked seam: a finished run hands
 * its file to the shared deploy action (which fronts the Live Desk wizard), and
 * the button is disabled when the run has no resolvable file.
 */
// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const snapshot = {
  file: 'strategies/momentum.py' as string | null,
  strategyPath: 'strategies.momentum.Mom' as string | null,
  cls: 'Mom' as string | null,
  phase: 'succeeded' as const,
  options: [],
  excluded: [],
  jobId: 5 as number | null,
  detail: null,
  outdated: false,
  result: null,
  validation: { phase: 'idle' as const },
};

vi.mock('../../engine/backtestStore', () => ({
  backtestStore: {
    subscribe: vi.fn(() => () => {}),
    getSnapshot: vi.fn(() => snapshot),
    validate: vi.fn(),
    retry: vi.fn(),
    run: vi.fn(),
    choose: vi.fn(),
  },
}));
vi.mock('../spineActions', () => ({ deployFile: vi.fn() }));

import { BacktestPanel } from '../BacktestPanel';
import { deployFile } from '../spineActions';

afterEach(() => {
  cleanup();
  snapshot.file = 'strategies/momentum.py';
  snapshot.jobId = 5;
  vi.clearAllMocks();
});

describe('Backtest results "Deploy"', () => {
  it('hands the run\'s file (and dotted id) to the shared deploy action', () => {
    render(<BacktestPanel />);
    const deploy = screen.getByTestId('backtest-deploy') as HTMLButtonElement;
    expect(deploy.disabled).toBe(false);
    fireEvent.click(deploy);
    expect(deployFile).toHaveBeenCalledWith('strategies/momentum.py', 'strategies.momentum.Mom');
  });

  it('disables Deploy when the run has no resolvable file', () => {
    snapshot.file = null;
    render(<BacktestPanel />);
    const deploy = screen.getByTestId('backtest-deploy') as HTMLButtonElement;
    expect(deploy.disabled).toBe(true);
    fireEvent.click(deploy);
    expect(deployFile).not.toHaveBeenCalled();
  });
});
