/**
 * The resting state's content — the sentence, and the watches.
 *
 * Three claims carry the surface:
 *
 *  - the status line is one honest sentence: what the agent is doing right
 *    now, or that nothing is running — never a spinner, never blank;
 *  - the watch list is drawn from what EXISTS: the standing questions on the
 *    graph, each with the new-material count the shared feed lane carries,
 *    and a watch with nothing new says "gathering" rather than showing a
 *    zero dressed as news;
 *  - an install with no watches shows the sentence alone. No empty-state
 *    art, no ghost rows, no hint about what a person could place — the
 *    conversation is where things start, and this surface only reports.
 *
 * The rows are records, not controls: nothing here is clickable, and a test
 * asserting the absence of handlers would be asserting an implementation, so
 * what is pinned instead is that no interactive role renders inside the list.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authState: vi.fn(async () => ({ signedIn: false })),
  engineConfig: vi.fn(async () => ({ engineUrl: '', hasKey: false })),
  getJson: vi.fn(async () => null),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  connectCheck: vi.fn(async () => null),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import { GridHome } from '../grid/GridHome';
import { boardGraphStore, type BoardSnapshot } from '../../engine/boardGraphStore';
import { backtestStore, type BacktestResultData } from '../../engine/backtestStore';
import { engineFeeds, gridVitals } from '../../engine/gridVitals';
import type { BoardNode, BoardEdge } from '../../engine/boardGraph';

function research(id: string, hypothesis: string): BoardNode {
  return { id, kind: 'research', research: { hypothesis } } as unknown as BoardNode;
}

function snapshot(
  nodes: BoardNode[],
  status: BoardSnapshot['status'] = 'idle',
  edges: BoardEdge[] = []
): BoardSnapshot {
  return {
    workspaceId: 'ws',
    graph: { nodes, edges },
    status,
    sync: 'synced',
    dirty: false,
  } as unknown as BoardSnapshot;
}

function readyRun(jobId: number, over: Partial<BacktestResultData> = {}): void {
  vi.spyOn(backtestStore, 'getSnapshot').mockReturnValue({
    ...backtestStore.getSnapshot(),
    jobId,
    result: {
      equity: [1, 1.1],
      drawdown: [0, -0.05],
      labels: ['2020-01-01', '2020-01-02'],
      stats: { annualized_return: 0.22, sharpe: 1.4, max_drawdown: -0.18 },
      asOf: '2020-01-02',
      nBars: 500,
      trades: 42,
      ...over,
    },
  });
}

function seedCounters(rows: Array<{ nodeId: string; newMaterial: number }>): void {
  vi.spyOn(engineFeeds, 'getSnapshot').mockReturnValue({
    ...engineFeeds.getSnapshot(),
    material: rows.map((row) => ({ ...row, asOf: null })),
  });
}

beforeEach(() => {
  gridVitals.reset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  gridVitals.reset();
});

describe('the status line', () => {
  it('says nothing is running when nothing is', () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(snapshot([]));
    render(<GridHome />);

    expect(screen.getByTestId('resting-status').textContent).toBe('Nothing is running.');
  });

  it('says it is catching up while the graph loads', () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(snapshot([], 'loading'));
    render(<GridHome />);

    expect(screen.getByTestId('resting-status').textContent).toBe('Catching up.');
  });
});

describe('the watch list', () => {
  it('draws one row per standing question, with its count', () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(
      snapshot([
        research('q1', 'Does momentum survive high-vol regimes?'),
        research('q2', 'Watch small-cap earnings drift'),
      ])
    );
    seedCounters([{ nodeId: 'q1', newMaterial: 4 }]);
    render(<GridHome />);

    const rows = screen.getByTestId('resting-watches');
    expect(rows).toBeTruthy();
    expect(screen.getByTestId('resting-watch-q1').textContent).toContain(
      'Does momentum survive high-vol regimes?'
    );
    expect(screen.getByTestId('resting-watch-count-q1').textContent).toBe('+4 new');
    // Nothing new is "gathering", never a zero dressed as news.
    expect(screen.getByTestId('resting-watch-q2').textContent).toContain('gathering');
    expect(screen.queryByTestId('resting-watch-count-q2')).toBeNull();
  });

  it('ignores research cards whose question is still blank', () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(
      snapshot([research('q1', '   '), research('q2', 'A real question')])
    );
    render(<GridHome />);

    expect(screen.queryByTestId('resting-watch-q1')).toBeNull();
    expect(screen.getByTestId('resting-watch-q2')).toBeTruthy();
  });

  it('renders nothing interactive: rows are records, not controls', () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(
      snapshot([research('q1', 'A question')])
    );
    render(<GridHome />);

    const list = screen.getByTestId('resting-watches');
    expect(list.querySelectorAll('button, a, input, select, textarea')).toHaveLength(0);
  });
});

describe('an install with no watches', () => {
  it('shows the sentence alone — no list, no placeholder, no hint', () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(snapshot([]));
    render(<GridHome />);

    expect(screen.getByTestId('resting-status')).toBeTruthy();
    expect(screen.queryByTestId('resting-watches')).toBeNull();
    expect(screen.queryByTestId('resting-artifacts')).toBeNull();
    // The whole surface is the sentence: one paragraph, and nothing else
    // rendered beside it.
    expect(screen.getByTestId('grid-resting').children).toHaveLength(1);
  });
});

describe('artifacts on the stage', () => {
  it('renders a materialized card when its run is ready', () => {
    const strategy: BoardNode = { id: 's1', kind: 'strategy', label: 'Atlas Momentum' } as BoardNode;
    const test: BoardNode = {
      id: 't1',
      kind: 'test',
      label: 'Run',
      ref: { kind: 'backtest', id: '7' },
    } as unknown as BoardNode;
    const edge: BoardEdge = { id: 'e', from: 's1', to: 't1', origin: 'system' } as BoardEdge;
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(
      snapshot([strategy, test], 'idle', [edge])
    );
    readyRun(7);
    render(<GridHome />);

    const list = screen.getByTestId('resting-artifacts');
    expect(list).toBeTruthy();
    // The strategy quotes its child's ready run; both are cards.
    expect(screen.getByTestId('artifact-s1')).toBeTruthy();
    expect(screen.getByTestId('artifact-t1')).toBeTruthy();
    expect(screen.getByTestId('artifact-s1').querySelector('[data-testid="artifact-name"]')?.textContent).toBe(
      'Atlas Momentum'
    );
  });

  it('shows no artifact section when nothing has materialized', () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(
      snapshot([research('q1', 'A question')])
    );
    render(<GridHome />);

    expect(screen.queryByTestId('resting-artifacts')).toBeNull();
  });
});
