/**
 * The validation-row "Open source" edge, at the mocked client seam: a workspace
 * verdict opens the strategy's `.py` (workspace-relative, never a container
 * path) and publishes focus; a desk-grafted verdict degrades to a disabled
 * affordance instead of opening an unresolvable path.
 */
// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ValidationPanel } from '../ValidationPanel';
import type { PanelHostLike } from '../aiPanel';
import { focusStore } from '../../engine/focusStore';

vi.mock('../../engine/client', () => ({
  getJsonDetailed: vi.fn(),
}));

import { getJsonDetailed } from '../../engine/client';

function verdictFor(strategyPath: string) {
  return {
    strategy_path: strategyPath,
    as_of: '2026-07-20',
    plain: 'Holds up.',
    signals: [{ signal: 's1', name: 'Signal 1', tier: 'green', value: 1, threshold: 2 }],
    fired_details: [],
  };
}

/** Route the two calls the panel makes: the deployable list, then the check. */
function wireClient(strategyPath: string) {
  vi.mocked(getJsonDetailed).mockImplementation((async (url: string) => {
    if (url.includes('/ui/api/backtest/strategies')) {
      return { ok: true, status: 200, body: { strategies: [{ path: strategyPath, doc: 'a strategy' }] } };
    }
    return { ok: true, status: 200, body: verdictFor(strategyPath) };
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

async function runCheckFor(strategyPath: string, host: PanelHostLike) {
  wireClient(strategyPath);
  render(<ValidationPanel host={host} />);
  const select = (await screen.findByLabelText('Strategy to check')) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: strategyPath } });
}

describe('Validation "Open source"', () => {
  it('opens the workspace-relative source file and publishes focus', async () => {
    const host: PanelHostLike = { openFile: vi.fn() };
    await runCheckFor('strategies.momentum.Mom', host);

    const button = (await screen.findByTestId('validation-open-source')) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    expect(host.openFile).toHaveBeenCalledWith('strategies/momentum.py');
    expect(host.openFile).not.toHaveBeenCalledWith(expect.stringMatching(/^\//));
    expect(focusStore.getSnapshot().strategy).toEqual({
      filePath: 'strategies/momentum.py',
      dottedPath: 'strategies.momentum.Mom',
    });
  });

  it('degrades to a disabled affordance for a desk-grafted strategy', async () => {
    const host: PanelHostLike = { openFile: vi.fn() };
    await runCheckFor('strategies.desk.Potential.a3.T25', host);

    const button = (await screen.findByTestId('validation-open-source')) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toContain('mounted');
    fireEvent.click(button);
    expect(host.openFile).not.toHaveBeenCalled();
  });
});
