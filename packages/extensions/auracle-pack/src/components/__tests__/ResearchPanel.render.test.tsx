/**
 * The redesigned research surface, exercised at the mocked client seam:
 * six-factor bars render only the whitelisted numeric keys (never the
 * data_note string), an unscored row draws no bars, the abstract stays behind
 * a panel-scoped expand toggle, and the honesty labels — score origin and the
 * status pill — survive the restyle.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { ResearchPanel } from '../ResearchPanel';
import type { PanelHostLike } from '../aiPanel';

vi.mock('../../engine/client', () => ({
  authState: vi.fn(),
  getJsonDetailed: vi.fn(),
  postJson: vi.fn(),
}));

import { authState, getJsonDetailed, postJson } from '../../engine/client';

const RICH = {
  id: 1,
  paper_id: 'p1',
  source: 'arxiv',
  title: 'A tradable momentum signal',
  status: 'surfaced',
  model: 'heuristic',
  confidence: 'medium',
  composite: 72,
  band: 'candidate',
  hypothesis: 'Cross-sectional momentum in X predicts Y.',
  abstract: 'A long abstract body that stays hidden until the reader asks for it.',
  categories: ['q-fin.TR', 'stat.ML'],
  factors: {
    implementability: 80,
    data_availability: 65,
    expected_edge: 55,
    regime_robustness: 30,
    backtestability: 70,
    novelty: 40,
    data_note: 'daily bars suffice',
  },
};

const feed = (finding: Record<string, unknown>) => ({
  findings: [finding],
  last_scan: '2026-07-08T00:00:00Z',
});

function hostWith(overrides: Partial<PanelHostLike> = {}): PanelHostLike {
  return {
    launchAgentSession: vi.fn().mockResolvedValue({ ok: true, sessionId: 's1' }),
    openFile: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getJsonDetailed).mockResolvedValue({ ok: true, body: feed(RICH) } as never);
  vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, body: {} });
  vi.mocked(authState).mockResolvedValue({ signedIn: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('six-factor bars', () => {
  it('renders one bar per numeric factor, labeled by origin, and never a bar for the note', async () => {
    render(<ResearchPanel host={hostWith()} />);

    const block = await screen.findByTestId('factors-1');
    // Exactly the six whitelisted keys — the data_note string is not a bar.
    expect(within(block).getAllByTestId(/^factor-1-/)).toHaveLength(6);
    expect(screen.queryByTestId('factor-1-data_note')).toBeNull();
    // The bars' origin is labeled (heuristic rows carry factors, not hidden).
    expect(within(block).getByText(/Six-factor score · Heuristic/)).toBeTruthy();
  });

  it('draws no six-factor block for an unscored (empty-factors) row', async () => {
    vi.mocked(getJsonDetailed).mockResolvedValue({
      ok: true,
      body: feed({ ...RICH, factors: {} }),
    } as never);
    render(<ResearchPanel host={hostWith()} />);

    // The row still renders (its hypothesis is present), but no bars and no gap.
    expect(await screen.findByText(/Cross-sectional momentum/)).toBeTruthy();
    expect(screen.queryByTestId('factors-1')).toBeNull();
  });
});

describe('abstract density + panel-scoped keyboard', () => {
  it('keeps the abstract behind an expand toggle that Escape collapses', async () => {
    render(<ResearchPanel host={hostWith()} />);

    const toggle = await screen.findByTestId('abstract-toggle-1');
    expect(screen.queryByTestId('abstract-1')).toBeNull();

    fireEvent.click(toggle);
    const abstract = screen.getByTestId('abstract-1');
    expect(abstract.textContent).toContain('A long abstract body');
    // arXiv categories only earn space inside the expanded abstract.
    expect(abstract.textContent).toContain('q-fin.TR');

    // Escape, dispatched from within the list, collapses it back.
    fireEvent.keyDown(toggle, { key: 'Escape' });
    expect(screen.queryByTestId('abstract-1')).toBeNull();
  });
});

describe('honesty invariants survive the restyle', () => {
  it('labels the score origin on the row', async () => {
    render(<ResearchPanel host={hostWith()} />);
    expect(await screen.findByText(/scored:\s*heuristic\s*·\s*confidence\s*medium/)).toBeTruthy();
  });

  it('renders the watchlist status pill', async () => {
    vi.mocked(getJsonDetailed).mockResolvedValue({
      ok: true,
      body: feed({ ...RICH, status: 'watchlist' }),
    } as never);
    render(<ResearchPanel host={hostWith()} />);
    expect(await screen.findByText('Watching')).toBeTruthy();
  });
});
