/**
 * Extraction regression for the validation rail. The measure-row and gauge
 * primitives now live in panelkit and are shared with the factor battery, but
 * the overfit rail must look and behave exactly as before: each signal renders
 * its name, plain reading, the "usually fixed by" line for a red signal, the
 * measured value against its threshold, and the per-tier status word. This
 * pins that the move to the shared primitive changed nothing the reader sees.
 */
// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ValidationPanel } from '../ValidationPanel';
import { focusStore } from '../../engine/focusStore';

vi.mock('../../engine/client', () => ({
  getJsonDetailed: vi.fn(),
}));

import { getJsonDetailed } from '../../engine/client';

const STRAT = 'strategies.momentum.Mom';

const verdict = {
  strategy_path: STRAT,
  as_of: '2026-07-20',
  plain: 'One signal needs attention.',
  signals: [
    {
      signal: 'sharpe_degradation',
      name: 'Sharpe degradation',
      tier: 'red',
      value: 0.41,
      threshold: 0.2,
      plain: 'The out-of-sample Sharpe fell hard.',
      what_usually_fixes_it: 'Simplify the rule set.',
    },
    {
      signal: 'trade_count',
      name: 'Trade count',
      tier: 'unknown',
      value: null,
      threshold: null,
      plain: 'Not enough history to judge this one.',
      what_usually_fixes_it: '',
    },
    {
      signal: 'wf_efficiency',
      name: 'Walk-forward efficiency',
      tier: 'green',
      value: 0.9,
      threshold: 0.5,
      plain: 'Holds up out of sample.',
      what_usually_fixes_it: '',
    },
  ],
  fired_details: [],
};

function wireClient() {
  vi.mocked(getJsonDetailed).mockImplementation((async (url: string) => {
    if (url.includes('/ui/api/backtest/strategies')) {
      return { ok: true, status: 200, body: { strategies: [{ path: STRAT, doc: 'a strategy' }] } };
    }
    return { ok: true, status: 200, body: verdict };
  }) as never);
}

beforeEach(() => {
  focusStore.clear();
  wireClient();
});

afterEach(() => {
  cleanup();
  focusStore.clear();
  vi.clearAllMocks();
});

describe('Validation rail after the primitive extraction', () => {
  it('renders each signal row exactly as before on the shared primitive', async () => {
    render(<ValidationPanel />);
    const select = (await screen.findByLabelText('Strategy to check')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: STRAT } });

    // Names and plain readings survive.
    expect(await screen.findByText('Sharpe degradation')).toBeTruthy();
    expect(screen.getByText('The out-of-sample Sharpe fell hard.')).toBeTruthy();
    expect(screen.getByText('Not enough history to judge this one.')).toBeTruthy();
    expect(screen.getByText('Holds up out of sample.')).toBeTruthy();

    // The red signal keeps its fix line...
    expect(screen.getByText('Usually fixed by: Simplify the rule set.')).toBeTruthy();

    // ...and its value-vs-threshold gauge figures (2dp, as fmtSig renders them).
    expect(screen.getByText('0.41')).toBeTruthy();
    expect(screen.getByText('threshold 0.20')).toBeTruthy();

    // The per-tier status words are the row's, lowercase (VerdictHero's tally
    // uses capitalized labels, so these exact-case matches are the rows).
    expect(screen.getByText('attention')).toBeTruthy();
    expect(screen.getByText('not checked')).toBeTruthy();
    expect(screen.getByText('healthy')).toBeTruthy();
  });
});
