/**
 * How the Board grows itself, and — much more importantly — what it refuses to
 * claim while doing it.
 *
 * Three properties are pinned here because each is a promise made to a person
 * reading the canvas rather than an implementation detail:
 *
 *  - a re-poll RE-ANNOUNCES every artifact, and must find the cards it made
 *    last time rather than growing a second copy every thirty seconds;
 *  - a wire is drawn only where the lineage is genuinely known, and a card
 *    whose upstream is not on the Board appears UNWIRED rather than attached to
 *    the nearest plausible thing;
 *  - a feed that has not answered materializes nothing at all, which is a
 *    different state from a feed that answered with nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BacktestSnapshot } from '../backtestStore';
import { backtestStore } from '../backtestStore';
import type { BoardGraph } from '../boardGraph';
import { boardGraphStore } from '../boardGraphStore';
import type { BoardGraphTransport } from '../boardPersistence';
import type { Deployment } from '../live';
import {
  applyBoardCards,
  draftClaims,
  deploymentStrategyId,
  materializeBoardCards,
  planBoardCards,
  researchClaiming,
  resolveUpstream,
  type BoardArtifacts,
} from '../boardMaterialize';

/** The shared lanes, stubbed: the planner must never reach for a transport. */
const stub = vi.hoisted(() => ({
  feeds: { strategies: null, deployments: null } as {
    strategies: unknown[] | null;
    deployments: Deployment[] | null;
  },
}));

vi.mock('../gridVitals', () => ({
  engineFeeds: {
    subscribe: () => () => {},
    getSnapshot: () => stub.feeds,
  },
}));

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

function run(patch: Partial<BacktestSnapshot> = {}): BacktestSnapshot {
  return { ...IDLE_RUN, ...patch };
}

function artifacts(patch: Partial<BoardArtifacts> = {}): BoardArtifacts {
  return { strategies: null, deployments: null, run: IDLE_RUN, ...patch };
}

/** A discovery row as the engine serves it. */
function discovered(path: string, doc = ''): Record<string, unknown> {
  return { path, doc };
}

function deployment(patch: Partial<Deployment> = {}): Deployment {
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

const EMPTY: BoardGraph = { nodes: [], edges: [] };

function lane(): BoardGraphTransport {
  const docs: Record<string, string> = {};
  return {
    async load(workspaceId: string) {
      return docs[workspaceId] ?? null;
    },
    async save(workspaceId: string, json: string) {
      docs[workspaceId] = json;
      return true;
    },
  };
}

async function openBoard(): Promise<void> {
  await boardGraphStore.open('ws-1', { transport: lane(), saveDelayMs: 5000 });
}

function graph(): BoardGraph {
  return boardGraphStore.getSnapshot().graph;
}

function kinds(): string[] {
  return graph().nodes.map((node) => node.kind);
}

/** The card of `kind` pointing at `id`, if the Board has one. */
function card(kind: string, id: string) {
  return graph().nodes.find((node) => node.kind === kind && node.ref?.id === id);
}

/** The system wire into `nodeId`, if there is one. */
function wireInto(nodeId: string) {
  return graph().edges.find((edge) => edge.to === nodeId);
}

beforeEach(() => {
  stub.feeds = { strategies: null, deployments: null };
});

afterEach(() => {
  boardGraphStore.reset();
  vi.restoreAllMocks();
});

/* ── what becomes a card ─────────────────────────────────────────────── */

describe('a feed that has not answered materializes nothing', () => {
  it('plans no cards at all from an unanswered engine', () => {
    expect(planBoardCards(artifacts(), EMPTY)).toEqual([]);
  });

  it('distinguishes "no answer" from "answered with nothing"', () => {
    // Both plan zero cards, but only one of them is a statement. The
    // distinction matters where a caller later wants to know whether the
    // engine has spoken, so the planner must tolerate both shapes.
    expect(planBoardCards(artifacts({ strategies: [], deployments: [] }), EMPTY)).toEqual([]);
  });
});

describe('a drafted strategy file becomes a strategy card', () => {
  it('names the card after the discovered symbol and points at the discovery id', () => {
    const steps = planBoardCards(
      artifacts({ strategies: [discovered('strategies.desk.atlas.AtlasMomentum', 'Trend')] }),
      EMPTY
    );

    expect(steps).toEqual([
      {
        kind: 'strategy',
        ref: { kind: 'strategy', id: 'strategies.desk.atlas.AtlasMomentum' },
        label: 'AtlasMomentum',
      },
    ]);
  });

  it('drops a row the engine sent without a path', () => {
    const steps = planBoardCards(artifacts({ strategies: [{ doc: 'nameless' }, 'nonsense'] }), EMPTY);
    expect(steps).toEqual([]);
  });
});

describe('a completed backtest becomes a test card', () => {
  it('plans one, wired to the strategy the run names', () => {
    const steps = planBoardCards(
      artifacts({
        run: run({
          phase: 'succeeded',
          jobId: 41,
          cls: 'AtlasMomentum',
          strategyPath: 'strategies.desk.atlas.AtlasMomentum',
        }),
      }),
      EMPTY
    );

    expect(steps).toEqual([
      {
        kind: 'test',
        ref: { kind: 'backtest', id: '41' },
        label: 'AtlasMomentum',
        from: { artifact: { kind: 'strategy', id: 'strategies.desk.atlas.AtlasMomentum' } },
      },
    ]);
  });

  it.each(['idle', 'running', 'queued', 'failed'] as const)(
    'plans nothing while a run is %s',
    (phase) => {
      expect(planBoardCards(artifacts({ run: run({ phase, jobId: 41 }) }), EMPTY)).toEqual([]);
    }
  );

  it('takes a run loaded by id too — an imported result is a completed run', () => {
    const steps = planBoardCards(
      artifacts({ run: run({ phase: 'succeeded', jobId: 99, origin: 'loaded' }) }),
      EMPTY
    );
    expect(steps).toEqual([{ kind: 'test', ref: { kind: 'backtest', id: '99' }, label: 'Run 99' }]);
  });
});

describe('a deployment becomes a deploy card', () => {
  it('joins the two halves of the strategy id the engine stores apart', () => {
    expect(deploymentStrategyId(deployment())).toBe('strategies.desk.atlas.AtlasMomentum');
    expect(deploymentStrategyId(deployment({ strategy_cls: null }))).toBe('strategies.desk.atlas');
    expect(deploymentStrategyId(deployment({ strategy_path: '' }))).toBe('');
  });

  it('names an unnamed row the way the plan names it', () => {
    const steps = planBoardCards(artifacts({ deployments: [deployment({ name: '' })] }), EMPTY);
    expect(steps[0].label).toBe('deployment 7');
  });
});

/* ── wires are found, never invented ─────────────────────────────────── */

describe('a strategy is wired to the research card that claims it', () => {
  const research = (drafted: unknown): BoardGraph => ({
    nodes: [
      { id: 'r1', kind: 'research', research: { hypothesis: 'Does trend pay?' }, extra: { drafted } },
    ],
    edges: [],
  });

  it('reads a claim on the full discovery id', () => {
    const steps = planBoardCards(
      artifacts({ strategies: [discovered('strategies.desk.atlas.AtlasMomentum')] }),
      research(['strategies.desk.atlas.AtlasMomentum'])
    );
    expect(steps[0].from).toEqual({ nodeId: 'r1' });
  });

  it('reads a claim on the MODULE, which is all the draft verb knows', () => {
    const steps = planBoardCards(
      artifacts({ strategies: [discovered('strategies.desk.atlas.AtlasMomentum')] }),
      research('strategies.desk.atlas')
    );
    expect(steps[0].from).toEqual({ nodeId: 'r1' });
  });

  it('leaves a strategy nobody claims unwired rather than guessing', () => {
    const steps = planBoardCards(
      artifacts({ strategies: [discovered('strategies.desk.atlas.AtlasMomentum')] }),
      research(['strategies.desk.OTHER.Thing'])
    );
    expect(steps[0].from).toBeUndefined();
  });

  it('ignores a claim bag that is not a list of strings', () => {
    expect(draftClaims({ id: 'r1', kind: 'research', extra: { drafted: 7 } })).toEqual([]);
    expect(draftClaims({ id: 'r1', kind: 'research', extra: { drafted: [1, 'a', ''] } })).toEqual(['a']);
    expect(draftClaims({ id: 'r1', kind: 'research' })).toEqual([]);
  });

  it('never reads a claim off a card that is not a research card', () => {
    const board: BoardGraph = {
      nodes: [{ id: 's0', kind: 'source', extra: { drafted: 'strategies.desk.atlas' } }],
      edges: [],
    };
    expect(researchClaiming(board, 'strategies.desk.atlas.AtlasMomentum')).toBeUndefined();
  });
});

describe('an upstream that is not on the Board resolves to nothing', () => {
  it('answers undefined for a node id that has gone', () => {
    expect(resolveUpstream(EMPTY, { nodeId: 'r1' })).toBeUndefined();
  });

  it('answers undefined for an artifact no card points at', () => {
    expect(resolveUpstream(EMPTY, { artifact: { kind: 'strategy', id: 'x' } })).toBeUndefined();
  });
});

/* ── applying: idempotence, and one pass wiring itself ───────────────── */

describe('applying a plan', () => {
  const full = (): BoardArtifacts =>
    artifacts({
      strategies: [discovered('strategies.desk.atlas.AtlasMomentum')],
      deployments: [deployment()],
      run: run({
        phase: 'succeeded',
        jobId: 41,
        cls: 'AtlasMomentum',
        strategyPath: 'strategies.desk.atlas.AtlasMomentum',
      }),
    });

  it('creates one card per artifact, each wired to the strategy in the SAME pass', async () => {
    await openBoard();

    applyBoardCards(planBoardCards(full(), graph()));

    expect(kinds()).toEqual(['strategy', 'test', 'deploy']);
    const strategy = card('strategy', 'strategies.desk.atlas.AtlasMomentum');
    const test = card('test', '41');
    const deploy = card('deploy', '7');
    expect(strategy).toBeDefined();
    // The strategy card did not exist when the plan was drawn; the test and the
    // deployment still land wired to it, because the upstream is resolved as
    // each step is applied rather than when the plan was made.
    expect(wireInto(test!.id)).toMatchObject({ from: strategy!.id, origin: 'system' });
    expect(wireInto(deploy!.id)).toMatchObject({ from: strategy!.id, origin: 'system' });
  });

  it('re-poll re-announces everything and creates nothing', async () => {
    await openBoard();
    applyBoardCards(planBoardCards(full(), graph()));
    const before = graph();

    applyBoardCards(planBoardCards(full(), graph()));
    applyBoardCards(planBoardCards(full(), graph()));

    expect(graph().nodes).toHaveLength(3);
    expect(graph().edges).toHaveLength(2);
    // Not merely the same count — the same graph object, because a pass that
    // changes nothing must not arm a save or redraw the canvas.
    expect(graph()).toBe(before);
  });

  it('attaches a card to the Board unwired when its upstream is absent', async () => {
    await openBoard();

    // A deployment of a strategy discovery has not listed: the deployment is
    // real, so the card is real, but nothing on the Board says where it came
    // from and no wire is invented to fill the gap.
    applyBoardCards(planBoardCards(artifacts({ deployments: [deployment()] }), graph()));

    const deploy = card('deploy', '7');
    expect(deploy).toBeDefined();
    expect(graph().edges).toEqual([]);
  });

  it('picks the wire up later, without moving the card', async () => {
    await openBoard();
    applyBoardCards(planBoardCards(artifacts({ deployments: [deployment()] }), graph()));
    const deployId = card('deploy', '7')!.id;

    // Discovery catches up on a later poll.
    applyBoardCards(planBoardCards(full(), graph()));

    expect(card('deploy', '7')!.id).toBe(deployId);
    expect(wireInto(deployId)).toMatchObject({ origin: 'system' });
  });

  it('refreshes a renamed artifact instead of drawing a second card for it', async () => {
    await openBoard();
    applyBoardCards(planBoardCards(artifacts({ deployments: [deployment()] }), graph()));
    const deployId = card('deploy', '7')!.id;

    applyBoardCards(
      planBoardCards(artifacts({ deployments: [deployment({ name: 'Atlas live' })] }), graph())
    );

    expect(graph().nodes).toHaveLength(1);
    expect(card('deploy', '7')).toMatchObject({ id: deployId, label: 'Atlas live' });
  });

  it('stores a reference, never the artifact', async () => {
    await openBoard();
    applyBoardCards(planBoardCards(artifacts({ deployments: [deployment()] }), graph()));

    // Two fields, and nothing of the deployment's state, equity or positions.
    expect(card('deploy', '7')!.ref).toEqual({ kind: 'deployment', id: '7' });
    expect(Object.keys(card('deploy', '7')!)).toEqual(['id', 'kind', 'ref', 'label']);
  });
});

/* ── the live pass ───────────────────────────────────────────────────── */

describe('the live pass', () => {
  it('writes nothing while the Board is closed', () => {
    stub.feeds = { strategies: [discovered('strategies.desk.atlas.AtlasMomentum')], deployments: [] };

    materializeBoardCards();

    // A card written into a closed snapshot would never be saved and would be
    // dropped the moment a workspace opened — so it is not written at all.
    expect(boardGraphStore.getSnapshot().status).toBe('closed');
    expect(graph().nodes).toEqual([]);
  });

  it('materializes from the shared feeds once a workspace is open', async () => {
    stub.feeds = {
      strategies: [discovered('strategies.desk.atlas.AtlasMomentum')],
      deployments: [deployment()],
    };
    vi.spyOn(backtestStore, 'getSnapshot').mockReturnValue(
      run({ phase: 'succeeded', jobId: 41, strategyPath: 'strategies.desk.atlas.AtlasMomentum' })
    );
    await openBoard();

    materializeBoardCards();

    expect(kinds()).toEqual(['strategy', 'test', 'deploy']);
  });

  it('survives being re-entered by its own write', async () => {
    stub.feeds = { strategies: [discovered('strategies.desk.atlas.AtlasMomentum')], deployments: [] };
    await openBoard();
    // The pass writes to a store it also listens to, and the write notifies
    // synchronously. Without the guard this recurses.
    const stop = boardGraphStore.subscribe(() => materializeBoardCards());

    materializeBoardCards();
    stop();

    expect(graph().nodes).toHaveLength(1);
  });
});
