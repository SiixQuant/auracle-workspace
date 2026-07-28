/**
 * How the Board's right half grows itself.
 *
 * The user places two kinds of card. Everything downstream of them —  strategy,
 * test, deploy — is written by this module when the engine data the pack
 * ALREADY holds shows that the artifact exists. Nothing here fetches: the
 * discovery list and the deployment feed arrive on {@link engineFeeds} (the
 * lanes the plan's vitals already run), and the session's run arrives on
 * {@link backtestStore}. That is the whole poll budget, and it is the same
 * budget the panel spent before the Board existed.
 *
 * ## Planning is pure; applying is not
 * {@link planBoardCards} turns a set of engine artifacts plus the current graph
 * into a list of steps. It has no store, no clock and no ids of its own, so
 * every rule below — which artifacts become cards, what each card is called,
 * and above all WHAT EACH ONE IS WIRED TO — is testable from fixtures.
 * {@link applyBoardCards} is the half that writes, and it does nothing a step
 * did not ask for.
 *
 * ## Idempotence is the store's, not ours
 * A re-poll re-announces every artifact; {@link boardGraphStore.materialize} is
 * idempotent on (kind, ref), so the second announcement finds the card it made
 * the first time. This module therefore plans the FULL set every pass rather
 * than trying to remember what it has already done — there is no bookkeeping to
 * fall out of step with the graph, and a card deleted by hand simply comes back
 * on the next poll, which is the honest behaviour for a card that only ever
 * said "this artifact exists".
 *
 * ## Wires are found, never invented
 * A card is wired to its upstream only where the lineage is genuinely known:
 *
 *  - a TEST is wired to the strategy card whose discovery id the run names;
 *  - a DEPLOY is wired to the strategy card whose discovery id the deployment
 *    names (`strategy_path` + `strategy_cls`, the two halves the engine stores
 *    separately);
 *  - a STRATEGY is wired to a research card that CLAIMS it — see
 *    {@link draftClaims}.
 *
 * Where the upstream is not on the Board, the card is created UNWIRED and the
 * user says where it came from. A materialized card asserts that an artifact
 * exists; a wire asserts where it came from, and the second claim is not
 * implied by the first.
 */
import { moduleOf, strategyOptionsFromDiscovery } from './backtest';
import type { BacktestSnapshot } from './backtestStore';
import { backtestStore } from './backtestStore';
import type { ArtifactRef, BoardGraph, BoardNode, MaterializedNodeKind } from './boardGraph';
import { boardGraphStore } from './boardGraphStore';
import { engineFeeds } from './gridVitals';
import type { Deployment } from './live';

/** The `ref.kind` each materialized card carries. */
export const STRATEGY_REF = 'strategy';
export const BACKTEST_REF = 'backtest';
export const DEPLOYMENT_REF = 'deployment';

/** Everything a pass reads. Null means "the engine has not answered", which is
 *  never read as "there is nothing" — an unanswered feed materializes nothing
 *  rather than nothing-at-all being asserted. */
export interface BoardArtifacts {
  /** Raw discovery rows (`/ui/api/backtest/strategies`). */
  strategies: unknown[] | null;
  /** The deployment feed. */
  deployments: Deployment[] | null;
  /** The session's backtest run. */
  run: BacktestSnapshot;
}

/**
 * The card a step's wire starts at, named by something STABLE rather than by a
 * node id the planner cannot mint: a user-placed card by its id (which it has,
 * because the user placed it), a materialized card by the artifact it points
 * at. The second form is what lets one pass wire a test to a strategy card the
 * same pass is creating — the applier resolves it against the graph as it
 * stands at that moment, not as it stood when the plan was drawn.
 */
export type BoardUpstream = { nodeId: string } | { artifact: ArtifactRef };

/** One card to create or refresh. */
export interface BoardCardStep {
  kind: MaterializedNodeKind;
  ref: ArtifactRef;
  label: string;
  /** Absent when nothing on the Board records where this came from. */
  from?: BoardUpstream;
}

/* ── reading the graph ───────────────────────────────────────────────── */

function materializedNode(graph: BoardGraph, ref: ArtifactRef): BoardNode | undefined {
  return graph.nodes.find((node) => node.ref?.kind === ref.kind && node.ref.id === ref.id);
}

/** The node a step's upstream names, or undefined when it is not on the Board. */
export function resolveUpstream(graph: BoardGraph, from: BoardUpstream): string | undefined {
  if ('nodeId' in from) {
    return graph.nodes.some((node) => node.id === from.nodeId) ? from.nodeId : undefined;
  }
  return materializedNode(graph, from.artifact)?.id;
}

/**
 * The discovery ids a research card claims to have drafted.
 *
 * The claim lives in the node's `extra` bag, which the graph model preserves
 * verbatim across a save and a load — so a draft recorded in one session is
 * still a claim in the next one, with no schema of ours to migrate and no
 * second store to keep in step. A card may claim one id or several (one
 * question, several attempts at it).
 *
 * This is a READ of a contract, not a guess: nothing here infers lineage from a
 * name that looks similar, because a strategy attributed to the wrong question
 * is worse than one attributed to none.
 */
export function draftClaims(node: BoardNode): string[] {
  const claimed = node.extra?.drafted;
  if (typeof claimed === 'string') return claimed ? [claimed] : [];
  if (!Array.isArray(claimed)) return [];
  return claimed.filter((value): value is string => typeof value === 'string' && value !== '');
}

/**
 * The research card that claims `path`, if any. A claim matches the full
 * discovery id (`strategies.desk.atlas.AtlasMomentum`) or the module it came
 * from (`strategies.desk.atlas`) — the draft verb knows the file it wrote
 * before it knows which symbol the engine will discover inside it, so both
 * halves of that id have to be claimable.
 */
export function researchClaiming(graph: BoardGraph, path: string): string | undefined {
  const module = moduleOf(path);
  for (const node of graph.nodes) {
    if (node.kind !== 'research') continue;
    for (const claim of draftClaims(node)) {
      if (claim === path || claim === module) return node.id;
    }
  }
  return undefined;
}

/* ── planning (pure) ─────────────────────────────────────────────────── */

/** The trailing symbol of a dotted discovery id, for a card's title. */
function symbolOf(path: string): string {
  return path.split('.').pop() || path;
}

/** The discovery id a deployment names, from the two halves the engine keeps
 *  apart. A row without a class names the module alone, which is still what a
 *  strategy card built from that module would point at. */
export function deploymentStrategyId(row: Deployment): string {
  const path = (row.strategy_path ?? '').trim();
  const cls = (row.strategy_cls ?? '').trim();
  if (!path) return '';
  return cls ? `${path}.${cls}` : path;
}

function strategySteps(rows: unknown[], graph: BoardGraph): BoardCardStep[] {
  const records = rows.filter(
    (row): row is Record<string, unknown> =>
      typeof row === 'object' && row !== null && !Array.isArray(row)
  );
  return strategyOptionsFromDiscovery(records).map((option) => {
    const claimed = researchClaiming(graph, option.path);
    const step: BoardCardStep = {
      kind: 'strategy',
      ref: { kind: STRATEGY_REF, id: option.path },
      label: option.cls,
    };
    return claimed ? { ...step, from: { nodeId: claimed } } : step;
  });
}

/**
 * The session's run, once it has finished. A run loaded by id counts too: an
 * imported QuantConnect result is a completed backtest that happens to have
 * completed elsewhere, and its card carries the provenance to say so.
 */
function testSteps(run: BacktestSnapshot): BoardCardStep[] {
  if (run.phase !== 'succeeded' || run.jobId === null) return [];
  const label = run.cls || (run.strategyPath ? symbolOf(run.strategyPath) : `Run ${run.jobId}`);
  const step: BoardCardStep = {
    kind: 'test',
    ref: { kind: BACKTEST_REF, id: String(run.jobId) },
    label,
  };
  return run.strategyPath
    ? [{ ...step, from: { artifact: { kind: STRATEGY_REF, id: run.strategyPath } } }]
    : [step];
}

function deploySteps(rows: Deployment[]): BoardCardStep[] {
  const steps: BoardCardStep[] = [];
  for (const row of rows) {
    if (typeof row?.id !== 'number' && typeof row?.id !== 'string') continue;
    const strategyId = deploymentStrategyId(row);
    const step: BoardCardStep = {
      kind: 'deploy',
      ref: { kind: DEPLOYMENT_REF, id: String(row.id) },
      // The engine's own fallback wording for an unnamed row, so the card and
      // the plan's fault annotation call the same deployment the same thing.
      label: row.name || `deployment ${row.id}`,
    };
    steps.push(
      strategyId ? { ...step, from: { artifact: { kind: STRATEGY_REF, id: strategyId } } } : step
    );
  }
  return steps;
}

/**
 * Every card the current artifacts justify, in dependency order: strategies
 * first, so the tests and deployments planned after them can be wired to cards
 * the same pass is about to create.
 */
export function planBoardCards(artifacts: BoardArtifacts, graph: BoardGraph): BoardCardStep[] {
  return [
    ...(artifacts.strategies ? strategySteps(artifacts.strategies, graph) : []),
    ...testSteps(artifacts.run),
    ...(artifacts.deployments ? deploySteps(artifacts.deployments) : []),
  ];
}

/* ── applying ────────────────────────────────────────────────────────── */

/**
 * Write a plan to the Board. Each step resolves its upstream against the graph
 * as it stands right then, so the order {@link planBoardCards} returns is what
 * makes a test land wired to a strategy card created moments earlier.
 *
 * Returns the node ids touched, newest last — the count a test asserts against
 * to show that a second pass created nothing.
 */
export function applyBoardCards(steps: readonly BoardCardStep[]): string[] {
  const applied: string[] = [];
  for (const step of steps) {
    const graph = boardGraphStore.getSnapshot().graph;
    const from = step.from ? resolveUpstream(graph, step.from) : undefined;
    const result = boardGraphStore.materialize({
      kind: step.kind,
      ref: step.ref,
      label: step.label,
      ...(from ? { from } : {}),
    });
    if (result.ok) applied.push(result.nodeId);
  }
  return applied;
}

/* ── the live pass ───────────────────────────────────────────────────── */

/** Re-entrancy guard: the pass writes to a store it also listens to, and the
 *  write notifies synchronously. Without this the second pass would run inside
 *  the first, plan against a half-applied graph, and re-enter again. */
let running = false;

/**
 * One pass over what the pack currently holds.
 *
 * A CLOSED Board is skipped rather than written to: a card added to the closed
 * snapshot would never be saved and would be dropped the moment a workspace
 * opened. The pass re-runs when the Board opens (it listens to the store), so
 * nothing is lost by waiting.
 */
export function materializeBoardCards(): void {
  if (running) return;
  const snapshot = boardGraphStore.getSnapshot();
  if (snapshot.status === 'closed') return;
  const feeds = engineFeeds.getSnapshot();
  running = true;
  try {
    applyBoardCards(
      planBoardCards(
        {
          strategies: feeds.strategies,
          deployments: feeds.deployments,
          run: backtestStore.getSnapshot(),
        },
        snapshot.graph
      )
    );
  } finally {
    running = false;
  }
}

/**
 * Follow the three sources for as long as the Board is on screen, and return
 * the teardown. Subscribing to {@link engineFeeds} is what starts the shared
 * lanes, so the Board polls exactly while it is being looked at.
 */
export function startBoardMaterialization(): () => void {
  const stops = [
    engineFeeds.subscribe(materializeBoardCards),
    backtestStore.subscribe(materializeBoardCards),
    boardGraphStore.subscribe(materializeBoardCards),
  ];
  materializeBoardCards();
  return () => {
    for (const stop of stops) stop();
  };
}
