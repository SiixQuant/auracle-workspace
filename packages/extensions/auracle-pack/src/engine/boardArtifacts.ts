/**
 * Artifacts — the one shape every agent output takes on the stage.
 *
 * A card is a record that something EXISTS, never a form: a name, a one-line
 * reason, at most four numbers, and a badge that says where the numbers came
 * from. This module turns each real artifact kind into that shape, and the
 * card component draws it. Nothing here is editable and nothing here fetches;
 * these are pure adapters over data the panel already holds.
 *
 * Two rules are load-bearing and tested:
 *
 *  - **Four numbers, and they are ordered.** Any figure that QUALIFIES a
 *    result comes before the result it qualifies. A basket study leads with
 *    how much was searched and the bar that search implies, and only then the
 *    score — because a Sharpe read without its correction is the exact
 *    misreading the whole basket layer exists to prevent, and the rule holds
 *    in pixels as much as in prose.
 *
 *  - **The badge never drops.** Provenance and data quality ride the artifact
 *    into every rendering, including the most compact, because a caveat that
 *    appears only when there is room is a caveat that vanishes exactly when a
 *    figure is being skimmed.
 */
import type { BoardGraph, BoardNode } from './boardGraph';
import type { BacktestResultData, BacktestSnapshot } from './backtestStore';
import type { BoardRun, BoardRunCache } from './boardRuns';
import { runFor } from './boardRuns';
import { BACKTEST_REF } from './boardMaterialize';
import { peekMetrics, provenanceBadge } from './boardMetrics';

/** At most four figures on a card. More is a table, and a table is a room. */
export const MAX_ARTIFACT_METRICS = 4;

const EM_DASH = '—';

export interface ArtifactMetric {
  label: string;
  value: string;
}

/**
 * Where an artifact's numbers came from. Its own type rather than the runs'
 * {@link import('./boardMetrics').ProvenanceBadge}, because an artifact can
 * carry a caveat a run cannot — a basket study computed on survivor-biased
 * data is neither certified nor merely local, it is permanently flagged.
 */
export interface ArtifactBadge {
  tone: 'certified' | 'caution' | 'neutral';
  label: string;
  /** The one line the expanded card shows under the figures. */
  note: string;
}

export interface Artifact {
  id: string;
  kind: string;
  /** What it calls itself. */
  name: string;
  /** One line: what it is, or what it found. */
  reason: string;
  /** At most {@link MAX_ARTIFACT_METRICS}, qualifying figures first. */
  metrics: ArtifactMetric[];
  badge: ArtifactBadge;
}

/** Trim to the cap rather than trusting a caller to. A card that grew a fifth
 *  number would silently become a table. */
function capped(metrics: ArtifactMetric[]): ArtifactMetric[] {
  return metrics.slice(0, MAX_ARTIFACT_METRICS);
}

function shortName(ref: string): string {
  const tail = ref.split('.').pop() ?? ref;
  return tail || ref;
}

/* ── materialized runs: strategy, test, deploy ───────────────────────── */

const KIND_NOUN: Record<string, string> = {
  strategy: 'Strategy',
  test: 'Backtest',
  deploy: 'Deployment',
};

function runBadge(result: BacktestResultData): ArtifactBadge {
  const badge = provenanceBadge(result.source);
  return {
    tone: badge.kind === 'certified' ? 'certified' : 'neutral',
    label: badge.label,
    note: badge.note,
  };
}

/**
 * A materialized card, or null when there is nothing to show yet.
 *
 * Null is the whole point of "cards appear because an artifact exists": a
 * strategy whose run has not completed is not a blank card waiting to fill in,
 * it is simply not on the stage.
 */
export function materializedArtifact(node: BoardNode, run: BoardRun): Artifact | null {
  if (run.phase !== 'ready') return null;
  const noun = KIND_NOUN[node.kind] ?? 'Artifact';
  const result = run.result;
  return {
    id: node.id,
    kind: node.kind,
    // The display name lives on the node (the run result carries figures, not
    // a title); the kind noun is the fallback when a card has no label yet.
    name: node.label?.trim() || noun,
    reason: `${noun} measured over ${result.nBars} bars.`,
    metrics: capped(peekMetrics(result)),
    badge: runBadge(result),
  };
}

/* ── basket study verdict ────────────────────────────────────────────── */

/** The verdict shape the engine's `/ui/api/baskets/verdict` returns — the
 *  fields this card reads, loosely typed so an engine that adds keys never
 *  breaks the panel. */
export interface BasketVerdict {
  strategy_ref?: string;
  trials?: number;
  luck_bar_portfolio?: number;
  luck_bar_single?: number;
  survived?: boolean;
  winner?: string | null;
  winner_sharpe?: number | null;
  pvalue?: number | null;
  default_universe?: string | null;
  headline?: string;
  ranking?: Array<{ sharpe?: number; selectable?: boolean }>;
  provenance?: string[];
}

function decimal(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : EM_DASH;
}

function bestSharpe(verdict: BasketVerdict): number | null {
  if (typeof verdict.winner_sharpe === 'number') return verdict.winner_sharpe;
  const top = verdict.ranking?.find((row) => typeof row.sharpe === 'number');
  return typeof top?.sharpe === 'number' ? top.sharpe : null;
}

/**
 * A basket study's verdict as a card.
 *
 * The number order is the honesty rule made visible: trials and the luck bar —
 * what the search was and what it has to beat — come before the best score and
 * its p-value. Read left to right, the bar is known before the result it
 * judges.
 *
 * The badge is permanent and never certified: a basket built on today's listed
 * names inherits a survivorship bias the study itself records, and that fact
 * rides the card rather than living in a caption someone remembers.
 */
export function basketVerdictArtifact(verdict: BasketVerdict): Artifact {
  const survived = verdict.survived === true;
  const best = bestSharpe(verdict);

  const reason = survived
    ? `${verdict.winner ?? 'A basket'} beat its benchmark after the search.`
    : `No basket beat its benchmark; running on ${
        verdict.default_universe ?? 'a default'
      }, a default not a finding.`;

  const survivorship =
    verdict.provenance?.find((line) => line.toLowerCase().startsWith('survivorship')) ??
    'Basket membership is drawn from currently-listed names.';

  return {
    id: `basket:${verdict.strategy_ref ?? 'study'}`,
    kind: 'basket-verdict',
    name: `Instruments for ${shortName(verdict.strategy_ref ?? 'strategy')}`,
    reason,
    // Qualifying figures first: how much was tried, then the bar that many
    // trials implies, then the best result and its significance.
    metrics: capped([
      { label: 'Trials', value: typeof verdict.trials === 'number' ? String(verdict.trials) : EM_DASH },
      { label: 'Luck bar', value: decimal(verdict.luck_bar_portfolio) },
      { label: 'Best', value: decimal(best) },
      { label: 'p', value: decimal(verdict.pvalue) },
    ]),
    badge: {
      tone: 'caution',
      label: 'survivor-biased',
      note: survivorship,
    },
  };
}

/* ── the stage's artifact list ───────────────────────────────────────── */

/**
 * The backtest run a materialized card quotes, or undefined when it has none.
 *
 * A test card names its own run; a strategy card names its most recent test,
 * which is the LAST such child on the graph, because materialization appends.
 * Lives here rather than on the Board so the stage can read a run without
 * importing the canvas that the redesign deletes.
 */
export function runIdForNode(graph: BoardGraph, node: BoardNode): string | undefined {
  if (node.kind === 'test') return node.ref?.kind === BACKTEST_REF ? node.ref.id : undefined;
  if (node.kind !== 'strategy') return undefined;
  let latest: string | undefined;
  for (const edge of graph.edges) {
    if (edge.from !== node.id) continue;
    const child = graph.nodes.find((candidate) => candidate.id === edge.to);
    if (child?.kind === 'test' && child.ref?.kind === BACKTEST_REF) latest = child.ref.id;
  }
  return latest;
}

/**
 * Every materialized artifact on the graph, newest last, in one pass. Cards
 * with no ready run fall away here rather than rendering blank — the whole
 * point of "a card exists because its artifact does".
 */
export function graphArtifacts(
  graph: BoardGraph,
  session: BacktestSnapshot,
  runs: BoardRunCache
): Artifact[] {
  const out: Artifact[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== 'strategy' && node.kind !== 'test' && node.kind !== 'deploy') continue;
    const jobId = runIdForNode(graph, node);
    const run: BoardRun = jobId ? runFor(jobId, session, runs) : { phase: 'idle' };
    const artifact = materializedArtifact(node, run);
    if (artifact) out.push(artifact);
  }
  return out;
}
