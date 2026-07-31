/**
 * Artifacts — the shape every agent output takes, and the two rules that make
 * the shape honest.
 *
 *  - FOUR NUMBERS, ORDERED. A card carries at most four figures, and any
 *    figure that qualifies a result precedes it. The basket verdict is the
 *    case with teeth: trials and the luck bar come before the best score and
 *    its p-value, so a Sharpe is never read without the correction beside it.
 *
 *  - THE BADGE NEVER DROPS. Every artifact carries a provenance/quality badge
 *    with a permanent note, and a basket study's is a caution it can never
 *    shed, because its numbers are computed on survivor-biased data.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_ARTIFACT_METRICS,
  basketVerdictArtifact,
  materializedArtifact,
  graphArtifacts,
  type BasketVerdict,
} from '../boardArtifacts';
import type { BoardGraph, BoardNode } from '../boardGraph';
import type { BoardRun } from '../boardRuns';
import type { BacktestResultData, BacktestSnapshot } from '../backtestStore';

function result(over: Partial<BacktestResultData> = {}): BacktestResultData {
  return {
    equity: [1, 1.1],
    drawdown: [0, -0.05],
    labels: ['2020-01-01', '2020-01-02'],
    stats: { annualized_return: 0.22, sharpe: 1.4, max_drawdown: -0.18 },
    asOf: '2020-01-02',
    nBars: 500,
    trades: 42,
    ...over,
  };
}

const VERDICT: BasketVerdict = {
  strategy_ref: 'strategies.example_ma.MACrossover',
  trials: 448,
  luck_bar_portfolio: 1.41,
  luck_bar_single: 1.28,
  survived: false,
  winner: null,
  winner_sharpe: null,
  pvalue: 0.539,
  default_universe: 'quant.liquid',
  ranking: [{ sharpe: 0.73, selectable: false }],
  provenance: [
    'survivorship: basket membership was derived from currently-listed names',
    'coverage: 49 buckets were not computable',
  ],
};

describe('the basket verdict card', () => {
  it('leads with the search, then the bar, then the result', () => {
    const card = basketVerdictArtifact(VERDICT);
    const labels = card.metrics.map((m) => m.label);
    // Qualifying figures precede the result they qualify.
    expect(labels).toEqual(['Trials', 'Luck bar', 'Best', 'p']);
    expect(card.metrics[0].value).toBe('448');
    expect(card.metrics[1].value).toBe('1.41');
  });

  it('reports the null result as a default, not a finding', () => {
    const card = basketVerdictArtifact(VERDICT);
    expect(card.reason).toContain('No basket beat its benchmark');
    expect(card.reason).toContain('quant.liquid');
    expect(card.reason).toContain('a default not a finding');
    // The best descriptive score still shows, so the shape of the result is
    // visible even when nothing survived.
    expect(card.metrics.find((m) => m.label === 'Best')?.value).toBe('0.73');
  });

  it('shows the winner and its score when a basket survives', () => {
    const card = basketVerdictArtifact({
      ...VERDICT,
      survived: true,
      winner: 'risk.vol_high|top5|equal',
      winner_sharpe: 1.83,
      pvalue: 0.012,
    });
    expect(card.reason).toContain('risk.vol_high|top5|equal');
    expect(card.metrics.find((m) => m.label === 'Best')?.value).toBe('1.83');
    expect(card.metrics.find((m) => m.label === 'p')?.value).toBe('0.01');
  });

  it('carries a permanent survivorship badge, never certified', () => {
    const card = basketVerdictArtifact(VERDICT);
    expect(card.badge.tone).toBe('caution');
    expect(card.badge.label).toBe('survivor-biased');
    // The exact survivorship line from the study rides the card.
    expect(card.badge.note.toLowerCase()).toContain('survivorship');
  });

  it('degrades to em-dashes rather than inventing figures', () => {
    const card = basketVerdictArtifact({ strategy_ref: 'x.Y' });
    expect(card.metrics.map((m) => m.value)).toEqual(['—', '—', '—', '—']);
    // The badge, and its note, are present even with no numbers at all.
    expect(card.badge.note).not.toBe('');
  });
});

describe('the metric cap', () => {
  it('never exceeds four figures on any kind', () => {
    expect(basketVerdictArtifact(VERDICT).metrics.length).toBeLessThanOrEqual(
      MAX_ARTIFACT_METRICS
    );
    const node: BoardNode = { id: 's1', kind: 'strategy', label: 'Atlas' };
    const run: BoardRun = { phase: 'ready', result: result() };
    expect(materializedArtifact(node, run)!.metrics.length).toBeLessThanOrEqual(
      MAX_ARTIFACT_METRICS
    );
  });
});

describe('materialized cards', () => {
  it('titles from the node label and carries the run provenance', () => {
    const node: BoardNode = { id: 's1', kind: 'strategy', label: 'Atlas Momentum' };
    const card = materializedArtifact(node, { phase: 'ready', result: result() })!;
    expect(card.name).toBe('Atlas Momentum');
    expect(card.metrics.map((m) => m.label)).toEqual(['CAGR', 'Sharpe', 'Max DD', 'Trades']);
    // A local run is neutral, not certified.
    expect(card.badge.tone).toBe('neutral');
  });

  it('reads certified when the run declares a certifying source', () => {
    const node: BoardNode = { id: 't1', kind: 'test', label: 'QC run' };
    const card = materializedArtifact(node, {
      phase: 'ready',
      result: result({ source: 'quantconnect' }),
    })!;
    expect(card.badge.tone).toBe('certified');
    expect(card.badge.label.toLowerCase()).toContain('qc');
  });

  it('does not render a card for a run that has not completed', () => {
    const node: BoardNode = { id: 's1', kind: 'strategy', label: 'Atlas' };
    expect(materializedArtifact(node, { phase: 'idle' })).toBeNull();
    expect(materializedArtifact(node, { phase: 'loading' })).toBeNull();
    expect(materializedArtifact(node, { phase: 'missing' })).toBeNull();
  });
});

describe('graphArtifacts', () => {
  const session: BacktestSnapshot = { jobId: null, status: 'idle', result: null } as BacktestSnapshot;

  it('emits only materialized nodes whose runs are ready, in order', () => {
    const graph: BoardGraph = {
      nodes: [
        { id: 'src', kind: 'source' },
        { id: 'q', kind: 'research', research: { hypothesis: 'x' } },
        { id: 's1', kind: 'strategy', label: 'Atlas' },
        { id: 't1', kind: 'test', label: 'Run', ref: { kind: 'backtest', id: 'job-1' } },
      ],
      edges: [{ id: 'e', from: 's1', to: 't1', origin: 'system' }],
    } as unknown as BoardGraph;

    const runs = { 'job-1': { phase: 'ready', result: result() } as BoardRun };
    const artifacts = graphArtifacts(graph, session, runs);
    // The strategy quotes its child test's ready run; the test quotes its own.
    // Sources and questions never become artifacts.
    const kinds = artifacts.map((a) => a.kind);
    expect(kinds).toEqual(['strategy', 'test']);
  });

  it('is empty on a graph with no materialized nodes', () => {
    const graph: BoardGraph = {
      nodes: [{ id: 'q', kind: 'research', research: { hypothesis: 'x' } }],
      edges: [],
    } as unknown as BoardGraph;
    expect(graphArtifacts(graph, session, {})).toEqual([]);
  });
});
