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
  // The home hero reads these: the recent-runs feed drives its auto-focus, and
  // the focused run's result drives the tearsheet it lands on.
  tearsheetRuns: vi.fn(async () => []),
  tearsheetResult: vi.fn(async () => null),
  tearsheetFactors: vi.fn(async () => null),
  tearsheetSummary: vi.fn(async () => null),
}));

import { GridHome } from '../grid/GridHome';
import { boardGraphStore, type BoardSnapshot } from '../../engine/boardGraphStore';
import { backtestStore, type BacktestResultData } from '../../engine/backtestStore';
import { aiRunStore, type AiAction, type AiRunState } from '../grid/gridAiActions';
import { engineFeeds, gridVitals } from '../../engine/gridVitals';
import { focusStore } from '../../engine/focusStore';
import { tearsheetResult, tearsheetRuns, type RecentRun } from '../../engine/client';
import type { BoardNode, BoardEdge } from '../../engine/boardGraph';

/** A host object shaped like the real PanelHost the panel hands the hero. */
const host = { panelId: 'com.auracle.pack.grid', extensionId: 'com.auracle.pack' } as never;

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
  focusStore.clear();
  // Default the hero's reads to "nothing to show" so a suite that is not about
  // the hero rests on its empty state without wiring the feed each time.
  vi.mocked(tearsheetRuns).mockResolvedValue([]);
  vi.mocked(tearsheetResult).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  focusStore.clear();
  gridVitals.reset();
});

describe('the status line', () => {
  it('says nothing is running when nothing is', () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(snapshot([]));
    render(<GridHome host={host} />);

    expect(screen.getByTestId('resting-status').textContent).toBe('Nothing is running.');
  });

  it('says it is catching up while the graph loads', () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(snapshot([], 'loading'));
    render(<GridHome host={host} />);

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
    render(<GridHome host={host} />);

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
    render(<GridHome host={host} />);

    expect(screen.queryByTestId('resting-watch-q1')).toBeNull();
    expect(screen.getByTestId('resting-watch-q2')).toBeTruthy();
  });

  it('renders nothing interactive: rows are records, not controls', () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(
      snapshot([research('q1', 'A question')])
    );
    render(<GridHome host={host} />);

    const list = screen.getByTestId('resting-watches');
    expect(list.querySelectorAll('button, a, input, select, textarea')).toHaveLength(0);
  });
});

describe('an install with no watches', () => {
  it('rests on the sentence, the tearsheet empty state, and the closed ledger', async () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(snapshot([]));
    render(<GridHome host={host} />);

    expect(screen.getByTestId('resting-status')).toBeTruthy();
    // With no backtest to show, the hero rests on its honest empty state.
    await screen.findByTestId('grid-tearsheet-empty');
    expect(screen.queryByTestId('resting-watches')).toBeNull();
    expect(screen.queryByTestId('resting-artifacts')).toBeNull();
    expect(screen.queryByTestId('grid-steps')).toBeNull();
    // The activity ledger is the one deliberate persistent fixture — closed,
    // not empty-state art.
    expect(screen.getByTestId('grid-ledger').getAttribute('data-open')).toBe('closed');
    // The sentence, the tearsheet hero, and the ledger — nothing else.
    expect(screen.getByTestId('grid-resting').children).toHaveLength(3);
  });
});

describe('the tearsheet hero — the default thing seen', () => {
  const RUN: RecentRun = {
    jobId: 9,
    strategyPath: 'strategies.desk.atlas.Atlas',
    asOf: '2026-08-01',
    nBars: 500,
    finishedAt: '2026-08-01T00:00:00Z',
    totalReturn: 0.3,
    sharpe: 1.2,
    maxDrawdown: -0.2,
  };

  it('renders the tearsheet when a run is focused', async () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(snapshot([]));
    vi.mocked(tearsheetResult).mockResolvedValue({
      status: 'succeeded',
      chartable: false,
      strategy_path: RUN.strategyPath,
      stats: { annualized_return: 0.22, sharpe: 1.4, max_drawdown: -0.18 },
    });
    focusStore.publish({ run: { kind: 'backtest', id: '9' } });
    render(<GridHome host={host} />);

    expect(await screen.findByTestId('grid-tearsheet-hero')).toBeTruthy();
    // The one shared body renders here, keyed off the focused run.
    expect(await screen.findByTestId('tearsheet-room')).toBeTruthy();
    expect(await screen.findByTestId('tearsheet-metrics')).toBeTruthy();
    expect(screen.queryByTestId('grid-tearsheet-empty')).toBeNull();
  });

  it('shows an honest empty state when there are no backtests', async () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(snapshot([]));
    vi.mocked(tearsheetRuns).mockResolvedValue([]);
    render(<GridHome host={host} />);

    await screen.findByTestId('grid-tearsheet-empty');
    expect(screen.queryByTestId('grid-tearsheet-hero')).toBeNull();
    // Auto-focus published nothing, so the focus is left untouched.
    expect(focusStore.getSnapshot().run).toBeUndefined();
  });

  it('auto-focuses the latest run on open when nothing is focused', async () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(snapshot([]));
    vi.mocked(tearsheetRuns).mockResolvedValue([RUN]);
    vi.mocked(tearsheetResult).mockResolvedValue({
      status: 'succeeded',
      chartable: false,
      strategy_path: RUN.strategyPath,
      stats: {},
    });
    render(<GridHome host={host} />);

    // The hook publishes the latest run, so the hero lands on its tearsheet.
    expect(await screen.findByTestId('grid-tearsheet-hero')).toBeTruthy();
    expect(focusStore.getSnapshot().run).toEqual({ kind: 'backtest', id: '9' });
  });
});

describe('while the agent works', () => {
  function running(): AiRunState {
    const action = {
      id: 'a1',
      class: 'mutation',
      room: 'deploys',
      label: 'Restart the errored deployments',
      icon: 'x',
      intent: { operation: 'deploy.restart', room: 'deploys', summary: 's', fields: [] },
    } as AiAction;
    return { pending: null, running: action, step: 'x', outcome: null };
  }

  it('shows the headline and the step list, not a spinner', () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(snapshot([]));
    vi.spyOn(aiRunStore, 'getSnapshot').mockReturnValue(running());
    render(<GridHome host={host} />);

    // The sentence is the headline; the operation and its cost live in the
    // step below, so the two do not repeat each other.
    expect(screen.getByTestId('resting-status').textContent).toBe('Working on Deployments.');
    expect(screen.getByTestId('grid-steps')).toBeTruthy();
    expect(screen.getByTestId('grid-step-cost-0').textContent).toContain('capital');
  });

  it('shows no step list when nothing is running', () => {
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(snapshot([]));
    render(<GridHome host={host} />);
    expect(screen.queryByTestId('grid-steps')).toBeNull();
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
    render(<GridHome host={host} />);

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
    render(<GridHome host={host} />);

    expect(screen.queryByTestId('resting-artifacts')).toBeNull();
  });
});
