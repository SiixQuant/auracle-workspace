/**
 * The cards nobody placed, as a person meets them.
 *
 * What is pinned here is the behaviour that would quietly make the Board lie:
 *
 *  - a deploy card's dot is the DEPLOYMENT's state, read from the same feed the
 *    plan reads, and a feed that has not answered leaves the card quiet rather
 *    than claiming health it has not measured;
 *  - the peek's figures are the fixture's figures, and its badge names one
 *    provenance — a certified run and a local one look visibly different;
 *  - a press lands in the room that already owns the artifact, focused on it,
 *    through the routing lane every other hand-off uses;
 *  - a deploy card raises no peek, because the Plan is the operational home.
 *
 * WHAT THIS FILE CANNOT SEE: jsdom has no layout engine, so the peek's floated
 * placement, the container tiers and the card's hover transition are not
 * asserted here — nothing below claims a pixel. The curve is checked as the
 * path string its pure builder produced.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const stub = vi.hoisted(() => ({
  feeds: { strategies: null, deployments: null } as {
    strategies: unknown[] | null;
    deployments: unknown[] | null;
  },
}));

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getJson: vi.fn(async () => null),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  backtestJobResult: vi.fn(async () => ({ ok: false, status: 404 })),
  onConnectGeneration: vi.fn(() => () => {}),
}));

// The shared lanes, stubbed at their read view: subscribing must not start a
// poll in a test, and the rows have to be settable per case.
vi.mock('../../engine/gridVitals', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  engineFeeds: {
    subscribe: () => () => {},
    getSnapshot: () => stub.feeds,
  },
}));

import { BOARD_PEEK_DELAY_MS, BoardCardList, deployHealth } from '../grid/BoardCards';
import type { BoardGraph } from '../../engine/boardGraph';
import { backtestStore, type BacktestResultData, type BacktestSnapshot } from '../../engine/backtestStore';
import { boardRuns, type BoardRunCache } from '../../engine/boardRuns';
import { focusStore } from '../../engine/focusStore';
import { getActiveRoom, openGridHome } from '../grid/gridNav';

const IDLE_RUN: BacktestSnapshot = {
  file: null,
  strategyPath: null,
  cls: null,
  phase: 'idle',
  options: [],
  excluded: [],
  jobId: null,
  detail: null,
  outdated: false,
  result: null,
  origin: 'live',
  validation: { phase: 'idle' },
};

function result(patch: Partial<BacktestResultData> = {}): BacktestResultData {
  return {
    equity: [1, 2, 3],
    drawdown: [0, -4.2, -1.1],
    labels: ['a', 'b', 'c'],
    stats: { annualized_return: 0.2689, sharpe: 1.4231, max_drawdown: -0.3034 },
    asOf: '2026-07-28',
    nBars: 1890,
    trades: 128,
    ...patch,
  };
}

function deployment(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    name: 'Atlas paper',
    strategy_path: 'strategies.desk.atlas',
    strategy_cls: 'AtlasMomentum',
    broker: 'ibkr',
    mode: 'paper',
    state: 'running',
    positions: [],
    ...patch,
  };
}

/** A board carrying one of each materialized card, wired the way a real pass
 *  would have wired them. */
function board(patch: Partial<BoardGraph> = {}): BoardGraph {
  return {
    nodes: [
      { id: 's1', kind: 'strategy', ref: { kind: 'strategy', id: 'strategies.desk.atlas.AtlasMomentum' }, label: 'AtlasMomentum' },
      { id: 't1', kind: 'test', ref: { kind: 'backtest', id: '41' }, label: 'AtlasMomentum' },
      { id: 'd1', kind: 'deploy', ref: { kind: 'deployment', id: '7' }, label: 'Atlas paper' },
    ],
    edges: [
      { id: 'w1', from: 's1', to: 't1', origin: 'system' },
      { id: 'w2', from: 's1', to: 'd1', origin: 'system' },
    ],
    ...patch,
  };
}

/** Hand the list a cached result for job 41 without a fetch. */
function seedRun(patch: Partial<BacktestResultData> = {}): void {
  const cache: BoardRunCache = { '41': { phase: 'ready', result: result(patch) } };
  vi.spyOn(boardRuns, 'getSnapshot').mockReturnValue(cache);
}

function session(patch: Partial<BacktestSnapshot> = {}): void {
  vi.spyOn(backtestStore, 'getSnapshot').mockReturnValue({ ...IDLE_RUN, ...patch });
}

function pointerOnto(el: HTMLElement): void {
  fireEvent.mouseOver(el);
  fireEvent.mouseEnter(el);
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

async function rest(el: HTMLElement): Promise<void> {
  pointerOnto(el);
  await wait(BOARD_PEEK_DELAY_MS);
}

function card(id: string): HTMLElement {
  return screen.getByTestId(`board-card-${id}`);
}

beforeEach(() => {
  stub.feeds = { strategies: null, deployments: null };
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  openGridHome();
  focusStore.clear();
  boardRuns.reset();
  vi.restoreAllMocks();
});

/* ── the cards ───────────────────────────────────────────────────────── */

describe('the materialized cards', () => {
  it('draws one per artifact, and leaves the placed kinds to their own layer', () => {
    render(
      <BoardCardList
        graph={board({
          nodes: [
            ...board().nodes,
            { id: 'src1', kind: 'source', source: { name: 'Bars', connectorKind: 'data_provider', endpoint: '', payloadType: 'bars' } },
            { id: 'r1', kind: 'research', research: { hypothesis: 'Does trend pay?' } },
          ],
        })}
      />
    );

    expect(screen.getAllByTestId(/^board-card-/)).toHaveLength(3);
    expect(screen.queryByTestId('board-card-src1')).toBeNull();
    expect(screen.queryByTestId('board-card-r1')).toBeNull();
    expect(card('s1').getAttribute('data-kind')).toBe('strategy');
    expect(card('t1').getAttribute('data-kind')).toBe('test');
    expect(card('d1').getAttribute('data-kind')).toBe('deploy');
  });

  it('draws nothing at all for a board with no materialized card on it', () => {
    render(<BoardCardList graph={{ nodes: [], edges: [] }} />);
    expect(screen.queryByTestId('board-cards')).toBeNull();
  });

  it('titles each card after its artifact', () => {
    render(<BoardCardList graph={board()} />);
    expect(card('s1').textContent).toContain('AtlasMomentum');
    expect(card('d1').textContent).toContain('Atlas paper');
  });

  it('says how far a strategy has got, in runs', () => {
    render(<BoardCardList graph={board()} />);
    expect(screen.getByTestId('board-note-s1').textContent).toBe('1 run on the board');

    cleanup();
    render(<BoardCardList graph={board({ edges: [] })} />);
    expect(screen.getByTestId('board-note-s1').textContent).toBe('no run yet');
  });

  it('quotes the run on a test card once its figures are known', () => {
    seedRun();
    render(<BoardCardList graph={board()} />);
    expect(screen.getByTestId('board-note-t1').textContent).toBe('Sharpe 1.42');
  });
});

/* ── the deploy card reads the deployment feed ───────────────────────── */

describe('a deploy card carries the deployment state', () => {
  it.each([
    ['running', 'nominal', 'Live · paper'],
    ['errored', 'fault', 'Errored · paper'],
    ['stopped', 'degraded', 'Stopped · paper'],
    ['starting', 'nominal', 'Starting · paper'],
  ])('reads %s as %s', (state, health, note) => {
    stub.feeds = { strategies: null, deployments: [deployment({ state })] };
    render(<BoardCardList graph={board()} />);

    expect(card('d1').getAttribute('data-health')).toBe(health);
    expect(screen.getByTestId('board-dot-d1').getAttribute('data-health')).toBe(health);
    expect(screen.getByTestId('board-note-d1').textContent).toBe(note);
  });

  it('stays quiet while the feed has not answered', () => {
    render(<BoardCardList graph={board()} />);

    // No note at all rather than a placeholder, and no dot above nominal: the
    // card must not report a state nobody has measured.
    expect(screen.queryByTestId('board-note-d1')).toBeNull();
    expect(card('d1').getAttribute('data-health')).toBe('nominal');
  });

  it('says so when the feed answered and no longer lists it', () => {
    stub.feeds = { strategies: null, deployments: [] };
    render(<BoardCardList graph={board()} />);

    expect(screen.getByTestId('board-note-d1').textContent).toBe('no longer in the deployment feed');
  });

  it('reads a lifecycle state the same way the plan does', () => {
    expect(deployHealth('errored')).toBe('fault');
    expect(deployHealth('running')).toBe('nominal');
    expect(deployHealth('restarting')).toBe('nominal');
    expect(deployHealth('archived')).toBe('degraded');
    expect(deployHealth('')).toBe('degraded');
  });
});

/* ── the metrics peek ────────────────────────────────────────────────── */

describe('the metrics peek', () => {
  it('waits for a rest, then quotes the run exactly', async () => {
    seedRun();
    render(<BoardCardList graph={board()} />);

    pointerOnto(card('t1'));
    await wait(BOARD_PEEK_DELAY_MS - 40);
    expect(screen.queryByTestId('board-peek')).toBeNull();

    await wait(80);

    expect(screen.getByTestId('board-peek')).toBeTruthy();
    expect(screen.getByTestId('board-peek-cagr').textContent).toBe('26.89%');
    expect(screen.getByTestId('board-peek-sharpe').textContent).toBe('1.42');
    expect(screen.getByTestId('board-peek-max-dd').textContent).toBe('-30.34%');
    expect(screen.getByTestId('board-peek-trades').textContent).toBe('128');
  });

  it('draws the equity curve as the path its builder produced', async () => {
    seedRun({ equity: [1, 2, 3] });
    render(<BoardCardList graph={board()} />);

    await rest(card('t1'));

    // 220 x 40, three rising points: the pure builder's output, verbatim.
    expect(screen.getByTestId('board-peek-spark').querySelector('path')?.getAttribute('d')).toBe(
      'M0 40 L110 20 L220 0'
    );
  });

  it('draws no curve at all rather than a fabricated one', async () => {
    seedRun({ equity: [1] });
    render(<BoardCardList graph={board()} />);

    await rest(card('t1'));

    expect(screen.getByTestId('board-peek')).toBeTruthy();
    expect(screen.queryByTestId('board-peek-spark')).toBeNull();
  });

  it('badges a QuantConnect-sourced run differently from a local one', async () => {
    seedRun({ source: 'quantconnect' });
    render(<BoardCardList graph={board()} />);
    await rest(card('t1'));

    const certified = screen.getByTestId('board-peek-badge');
    expect(certified.getAttribute('data-provenance')).toBe('certified');
    expect(certified.textContent).toBe('QC-certified');

    cleanup();
    seedRun();
    render(<BoardCardList graph={board()} />);
    await rest(card('t1'));

    const local = screen.getByTestId('board-peek-badge');
    expect(local.getAttribute('data-provenance')).toBe('local');
    expect(local.textContent).toBe('local dev run');
  });

  it('quotes the overfit check only for the run the session checked', async () => {
    seedRun();
    session({
      jobId: 41,
      validation: {
        phase: 'done',
        verdict: {
          as_of: null,
          strategy_path: 'x',
          signals: [
            { signal: 'a', name: 'A', tier: 'red', value: null, threshold: null, plain: '', what_usually_fixes_it: '' },
            { signal: 'b', name: 'B', tier: 'green', value: null, threshold: null, plain: '', what_usually_fixes_it: '' },
          ],
          fired_details: [],
          plain: '',
        },
      },
    });
    render(<BoardCardList graph={board()} />);

    await rest(card('t1'));

    expect(screen.getByTestId('board-peek-validation').textContent).toBe(
      'Overfit check: 1 of 2 checks need attention'
    );
  });

  it('opens on a strategy card too, showing its latest run', async () => {
    seedRun();
    render(<BoardCardList graph={board()} />);

    await rest(card('s1'));

    expect(screen.getByTestId('board-peek').getAttribute('data-kind')).toBe('strategy');
    expect(screen.getByTestId('board-peek-sharpe').textContent).toBe('1.42');
  });

  it('says plainly that a strategy has no run rather than showing empty figures', async () => {
    render(<BoardCardList graph={board({ edges: [] })} />);

    await rest(card('s1'));

    expect(screen.getByTestId('board-peek-empty').textContent).toContain('No completed run');
    expect(screen.queryByTestId('board-peek-metrics')).toBeNull();
  });

  it('is not raised by a deploy card — its numbers live in the room it links to', async () => {
    stub.feeds = { strategies: null, deployments: [deployment()] };
    render(<BoardCardList graph={board()} />);

    await rest(card('d1'));

    expect(screen.queryByTestId('board-peek')).toBeNull();
  });

  it('never takes the pointer, so it cannot swallow the press underneath it', async () => {
    seedRun();
    render(<BoardCardList graph={board()} />);
    await rest(card('t1'));

    expect(screen.getByTestId('board-peek').style.pointerEvents).toBe('none');
    expect(screen.getByTestId('board-peek').getAttribute('aria-hidden')).toBe('true');
  });

  it('says the same facts on the card, for a session that will never hover', () => {
    seedRun({ source: 'quantconnect' });
    render(<BoardCardList graph={board()} />);

    // The peek is aria-hidden and hover-only, so the control itself carries it.
    const label = card('t1').getAttribute('aria-label') ?? '';
    expect(label).toContain('Sharpe 1.42');
    expect(label).toContain('Max DD -30.34%');
    expect(label).toContain('QC-certified');
  });

  it('clears when a room opens under it', async () => {
    seedRun();
    render(<BoardCardList graph={board()} />);
    await rest(card('t1'));
    expect(screen.getByTestId('board-peek')).toBeTruthy();

    await act(async () => {
      fireEvent.click(card('t1'));
    });

    expect(screen.queryByTestId('board-peek')).toBeNull();
  });
});

/* ── where a press lands ─────────────────────────────────────────────── */

describe('a press opens the page that already owns the artifact', () => {
  it('takes a test card to the full Backtest room, focused on its run', async () => {
    render(<BoardCardList graph={board()} />);

    await act(async () => {
      fireEvent.click(card('t1'));
    });

    expect(getActiveRoom()).toBe('backtest');
    expect(focusStore.getSnapshot().run).toEqual({ kind: 'backtest', id: '41' });
  });

  it('takes a strategy card to the same room, on its latest run and its file', async () => {
    render(<BoardCardList graph={board()} />);

    await act(async () => {
      fireEvent.click(card('s1'));
    });

    expect(getActiveRoom()).toBe('backtest');
    expect(focusStore.getSnapshot()).toEqual({
      strategy: {
        filePath: 'strategies.desk.atlas',
        dottedPath: 'strategies.desk.atlas.AtlasMomentum',
      },
      run: { kind: 'backtest', id: '41' },
    });
  });

  it('takes a deploy card across to the Plan, which stays the operational home', async () => {
    stub.feeds = { strategies: null, deployments: [deployment()] };
    render(<BoardCardList graph={board()} />);

    await act(async () => {
      fireEvent.click(card('d1'));
    });

    expect(getActiveRoom()).toBe('deploys');
    expect(focusStore.getSnapshot().run).toEqual({ kind: 'deployment', id: '7' });
  });
});
