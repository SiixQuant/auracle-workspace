/**
 * The live-deployment "Open source" edge, at the mocked client seam. A
 * deployment reports the module alone (its class rides `strategy_cls`), so the
 * transform keeps every module segment and hands the editor a workspace-relative
 * path; a desk-grafted deployment degrades to a disabled affordance.
 */
// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LiveAlgorithmsPanel } from '../LivePanel';
import { focusStore } from '../../engine/focusStore';

vi.mock('../../engine/client', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  authState: vi.fn().mockResolvedValue({ tier: 'community' }),
  connectCheck: vi.fn().mockResolvedValue({ live_allowed: false }),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import { getJson } from '../../engine/client';

function deployment(strategyPath: string, cls: string | null) {
  return {
    id: 7,
    name: 'Momentum',
    strategy_path: strategyPath,
    strategy_cls: cls,
    broker: 'sim',
    mode: 'paper',
    state: 'running',
    positions: [],
  };
}

function wireDeployments(strategyPath: string, cls: string | null) {
  vi.mocked(getJson).mockImplementation((async (url: string) => {
    if (url === '/deployments') return [deployment(strategyPath, cls)];
    return null; // equity / orders — the detail renders without them
  }) as never);
}

beforeEach(() => {
  focusStore.clear();
});

afterEach(() => {
  cleanup();
  focusStore.clear();
  vi.clearAllMocks();
});

async function openDetail(strategyPath: string, cls: string | null, host: { openFile: ReturnType<typeof vi.fn> }) {
  wireDeployments(strategyPath, cls);
  render(<LiveAlgorithmsPanel host={host as never} />);
  // Wait for the row, then expand it to reveal the detail section.
  const nameCell = await screen.findByText('Momentum');
  fireEvent.click(nameCell);
}

describe('Live deployment "Open source"', () => {
  it('opens the workspace-relative source and publishes focus with the full dotted id', async () => {
    const host = { openFile: vi.fn() };
    await openDetail('strategies.momentum', 'Mom', host);

    const button = (await screen.findByTestId('deployment-open-source')) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    expect(host.openFile).toHaveBeenCalledWith('strategies/momentum.py');
    expect(host.openFile).not.toHaveBeenCalledWith(expect.stringMatching(/^\//));
    expect(focusStore.getSnapshot().strategy).toEqual({
      filePath: 'strategies/momentum.py',
      dottedPath: 'strategies.momentum.Mom',
    });
  });

  it('degrades to a disabled affordance for a desk-grafted deployment', async () => {
    const host = { openFile: vi.fn() };
    await openDetail('strategies.desk.Potential.a3', 'T25', host);

    const button = (await screen.findByTestId('deployment-open-source')) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(host.openFile).not.toHaveBeenCalled();
  });
});
