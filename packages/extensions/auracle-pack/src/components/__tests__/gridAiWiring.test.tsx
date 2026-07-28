/**
 * What the Grid's AI actions actually send, and what they say about what came
 * back. The presence layer's tests pin the ceremony; these pin the wire.
 *
 * The claims worth holding still:
 *
 *  - a REPAIR goes to the engine's maintenance operation declaring the
 *    autonomous class, and a refusal of that class is rendered as needing an
 *    approved operator rather than as a broken repair;
 *  - a MUTATION declares its exact payload only AFTER a person approves, sends
 *    the operation carrying what the engine issued for that declaration, and
 *    never declares anything on a decline. A stamp that ran out is reported as
 *    something to approve again — and is never quietly re-declared;
 *  - a DRAFT reports that a SESSION started. It never reports a strategy,
 *    because none exists until the agent is sent;
 *  - the sheet's readings come from one consolidated call, a second read
 *    happens only to name a reported fault, and a district the engine could not
 *    read stays quiet;
 *  - the undo beside a landed repair runs the engine's own recorded inverse.
 *
 * Every assertion below is against a mocked client, so what is being pinned is
 * the request this pack makes and the reading it takes from the answer.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

interface PostCall {
  path: string;
  body: unknown;
  headers: Record<string, string> | undefined;
}

const stub = vi.hoisted(() => ({
  gets: {} as Record<string, unknown>,
  /** Statuses for reads the engine REFUSES, as against ones it never answered. */
  getStatus: {} as Record<string, number>,
  /** A canned answer per path prefix, or a function for one that varies per call. */
  replies: {} as Record<
    string,
    | { ok: boolean; status: number; body: unknown }
    | (() => { ok: boolean; status: number; body: unknown })
  >,
  posts: [] as Array<{ path: string; body: unknown; headers: Record<string, string> | undefined }>,
}));

vi.mock('../../engine/client', () => ({
  getJson: vi.fn(async (path: string) => {
    for (const [prefix, body] of Object.entries(stub.gets)) {
      if (path.startsWith(prefix)) return body;
    }
    return null;
  }),
  getJsonDetailed: vi.fn(async (path: string) => {
    for (const [prefix, status] of Object.entries(stub.getStatus)) {
      if (path.startsWith(prefix)) return { ok: false, status, body: null };
    }
    for (const [prefix, body] of Object.entries(stub.gets)) {
      if (path.startsWith(prefix)) return { ok: true, body };
    }
    return { ok: false, status: 0, body: null };
  }),
  postJson: vi.fn(async (path: string, body?: unknown, headers?: Record<string, string>) => {
    stub.posts.push({ path, body, headers });
    for (const [prefix, reply] of Object.entries(stub.replies)) {
      if (path.startsWith(prefix)) return typeof reply === 'function' ? reply() : reply;
    }
    // Nothing said otherwise: the engine did not answer.
    return { ok: false, status: 0, body: null };
  }),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { getJson } from '../../engine/client';
import { alertStore } from '../../engine/alertStore';
import { gridVitals } from '../../engine/gridVitals';
import { deploymentsBlock, summaryBody } from '../../engine/__tests__/summaryFixture';
import { GridPanel } from '../grid/GridPanel';
import {
  aiRunStore,
  approveAiAction,
  declineAiAction,
  requestAiAction,
  type AiAction,
  type AiActionClass,
  type AiActionResult,
  type IntentField,
} from '../grid/gridAiActions';
import { registerAgentHost, repairUndoStore } from '../grid/gridAiExecutors';
import { openGridHome } from '../grid/gridNav';
import { setFace } from '../grid/gridFaceStore';
import type { RoomId } from '../grid/rooms';

const HOST_PROPS = {} as PanelHostProps;

/** A deployment row as the engine serves it. */
function deployment(id: number, state: string, mode = 'paper'): Record<string, unknown> {
  return {
    id,
    name: `strategy-${id}`,
    strategy_path: `strategies.s${id}.S`,
    broker: 'paper',
    mode,
    state,
    positions: [],
  };
}

/** The consolidated call plus the naming read, describing the same rows. */
function serveDeployments(rows: Array<Record<string, unknown>>): void {
  stub.gets['/ui/api/summary'] = summaryBody({
    deployments: deploymentsBlock(rows as Array<{ state: string }>),
  });
  stub.gets['/deployments'] = rows;
}

/**
 * One action, built the way the catalog builds it. Constructed here rather than
 * read off the live vitals so a case can name the exact payload it is about;
 * the store and the executor registry it goes through are the real ones.
 */
function action(
  operation: string,
  cls: AiActionClass,
  room: RoomId,
  fields: IntentField[] = []
): AiAction {
  return {
    id: `test-${operation}`,
    class: cls,
    room,
    label: `Run ${operation}`,
    icon: 'bolt',
    intent: { operation, room, summary: `Run ${operation}.`, fields },
  };
}

/** Run one action to completion. A mutation is approved on the way through. */
async function run(a: AiAction): Promise<AiActionResult> {
  const direct = await requestAiAction(a);
  if (direct !== null) return direct;
  const approved = await approveAiAction();
  if (approved === null) throw new Error('nothing ran');
  return approved;
}

function postsTo(prefix: string): PostCall[] {
  return stub.posts.filter((call) => call.path.startsWith(prefix));
}

beforeEach(() => {
  // The panel opens on the BOARD in a workspace that has not chosen a face.
  // These are the PLAN's tests, so they say so.
  setFace('plan');
  stub.gets = {};
  stub.getStatus = {};
  stub.replies = {};
  stub.posts = [];
  gridVitals.reset();
  aiRunStore.reset();
  repairUndoStore.clear();
  registerAgentHost(undefined);
});

afterEach(async () => {
  cleanup();
  openGridHome();
  aiRunStore.reset();
  repairUndoStore.clear();
  registerAgentHost(undefined);
  stub.gets = {};
  stub.getStatus = {};
  stub.replies = {};
  stub.posts = [];
  await alertStore.refresh();
  gridVitals.reset();
});

/* ── repair ─────────────────────────────────────────────────────────── */

describe('a repair runs as a journalled maintenance operation', () => {
  it('addresses the rows the engine reports errored, declaring the autonomous class', async () => {
    stub.gets['/deployments'] = [deployment(1, 'errored'), deployment(2, 'running')];
    stub.replies['/ui/api/ops/repair'] = {
      ok: true,
      status: 200,
      body: { entry: { id: 11, status: 'applied' } },
    };

    const result = await run(action('deploy.restart-errored', 'repair', 'deploys'));

    expect(postsTo('/ui/api/ops/repair')).toEqual([
      {
        path: '/ui/api/ops/repair',
        body: { action: 'redeploy_deployment', target: '1', actor_class: 'autonomous' },
        headers: undefined,
      },
    ]);
    expect(result.kind).toBe('done');
    // The healthy one was never addressed.
    expect(postsTo('/ui/api/ops/repair')).toHaveLength(1);
  });

  it('reconnects only the connectors the engine reports in error', async () => {
    stub.gets['/ui/api/connections'] = {
      connections: [
        { id: 'ibkr', kind: 'broker', status: { state: 'error' } },
        { id: 'yfinance', kind: 'data_provider', status: { state: 'connected' } },
      ],
    };
    stub.replies['/ui/api/ops/repair'] = { ok: true, status: 200, body: { entry: { id: 4 } } };

    const result = await run(action('connection.reconnect-errored', 'repair', 'conns'));

    expect(postsTo('/ui/api/ops/repair')[0].body).toEqual({
      action: 'restart_data_feed',
      target: 'ibkr',
      actor_class: 'autonomous',
    });
    expect(result.kind).toBe('done');
  });

  it('leaves an errored connector the operation cannot recycle alone, and says so', async () => {
    // The engine resolves this operation against its broker and provider
    // registries; an integration is in neither, so sending it would be asking
    // for a repair that cannot exist and reporting the 404 as a failure.
    stub.gets['/ui/api/connections'] = {
      connections: [
        { id: 'ibkr', kind: 'broker', status: { state: 'error' } },
        { id: 'quantconnect', kind: 'integration', status: { state: 'error' } },
      ],
    };
    stub.replies['/ui/api/ops/repair'] = { ok: true, status: 200, body: { entry: { id: 5 } } };

    const result = await run(action('connection.reconnect-errored', 'repair', 'conns'));

    expect(postsTo('/ui/api/ops/repair').map((call) => (call.body as { target: string }).target)).toEqual([
      'ibkr',
    ]);
    expect(result.kind).toBe('done');
    expect(result.kind === 'done' && result.note).toContain('cannot recycle');
  });

  it('reads a refusal of the autonomous class as needing an approved operator', async () => {
    stub.gets['/deployments'] = [deployment(1, 'errored', 'live')];
    stub.replies['/ui/api/ops/repair'] = {
      ok: false,
      status: 403,
      body: {
        detail:
          "autonomous maintenance is limited to paper-scope resources; this target resolved to 'live' scope and needs an approved operator",
      },
    };

    const result = await run(action('deploy.restart-errored', 'repair', 'deploys'));

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.note).toContain('requires approval on live scope');
    // The engine's own sentence travels with it, not a paraphrase.
    expect(result.kind === 'failed' && result.note).toContain('needs an approved operator');
    // Nothing landed, so nothing is offered to put back.
    expect(repairUndoStore.getSnapshot()).toBeNull();
  });

  it('does not read every refusal as an authority one', async () => {
    // The same status carries the plan-cap and licence refusals. Calling one of
    // those "requires approval" would send someone after a permission that was
    // never the problem.
    stub.gets['/deployments'] = [deployment(1, 'errored')];
    stub.replies['/ui/api/ops/repair'] = {
      ok: false,
      status: 403,
      body: { detail: 'your plan allows 3 deployments; this one would be the 4th' },
    };

    const result = await run(action('deploy.restart-errored', 'repair', 'deploys'));

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.note).toContain('your plan allows 3 deployments');
    expect(result.kind === 'failed' && result.note).not.toContain('requires approval');
  });

  it('says a refused listing is a refusal, not an engine that went quiet', async () => {
    stub.getStatus['/deployments'] = 500;

    const result = await run(action('deploy.restart-errored', 'repair', 'deploys'));

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.note).toContain('would not list');
    expect(result.kind === 'failed' && result.note).not.toContain('did not answer');
  });

  it('sends nothing when the fault cleared between the press and the call', async () => {
    stub.gets['/deployments'] = [deployment(1, 'running')];

    const result = await run(action('deploy.restart-errored', 'repair', 'deploys'));

    expect(stub.posts).toHaveLength(0);
    expect(result.kind).toBe('done');
    expect(result.kind === 'done' && result.note).toContain('nothing was sent');
  });
});

/* ── mutation ───────────────────────────────────────────────────────── */

describe('a capital-affecting action is declared only after it is approved', () => {
  function oneRunningDeployment(): void {
    stub.gets['/deployments'] = [deployment(1, 'running')];
    stub.replies['/confirm'] = {
      ok: true,
      status: 200,
      body: { token: 'issued-1', action: 'live.liquidate', payload: { deployment_id: 1 } },
    };
    stub.replies['/deployments/1/liquidate'] = {
      ok: true,
      status: 200,
      body: { ok: true, state: 'liquidating' },
    };
  }

  it('declares the exact payload, then sends the operation carrying what came back', async () => {
    oneRunningDeployment();

    const result = await run(action('deploy.liquidate-all', 'mutation', 'deploys'));

    expect(stub.posts.map((call) => call.path)).toEqual([
      '/confirm',
      '/deployments/1/liquidate',
    ]);
    // Bound to this one deployment, by the action scope the engine names.
    expect(stub.posts[0].body).toEqual({
      action: 'live.liquidate',
      payload: { deployment_id: 1 },
    });
    expect(stub.posts[1].headers).toEqual({ 'X-Auracle-Confirmation': 'issued-1' });
    expect(result.kind).toBe('done');
  });

  it('declares nothing at all when the approval is declined', async () => {
    oneRunningDeployment();

    const parked = await requestAiAction(action('deploy.liquidate-all', 'mutation', 'deploys'));
    expect(parked).toBeNull();
    declineAiAction();

    expect(stub.posts).toHaveLength(0);
  });

  it('reports an approval that ran out as one to give again, and never gives it itself', async () => {
    oneRunningDeployment();
    stub.replies['/deployments/1/liquidate'] = {
      ok: false,
      status: 401,
      body: {
        detail: {
          error: 'confirmation_expired',
          message: 'this confirmation has expired — confirm the action again.',
        },
      },
    };

    const result = await run(action('deploy.liquidate-all', 'mutation', 'deploys'));

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.note).toContain('has expired');
    expect(result.kind === 'failed' && result.note).toContain('Approve it again');
    // Exactly one declaration: a refused operation is never re-declared behind
    // the person who approved the first one.
    expect(postsTo('/confirm')).toHaveLength(1);
  });

  it('reports an approval already spent without offering a silent retry', async () => {
    oneRunningDeployment();
    stub.replies['/deployments/1/liquidate'] = {
      ok: false,
      status: 409,
      body: {
        detail: {
          error: 'confirmation_already_used',
          message: 'this confirmation was already used — confirm the action again.',
        },
      },
    };

    const result = await run(action('deploy.liquidate-all', 'mutation', 'deploys'));

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.note).toContain('already used');
    expect(postsTo('/confirm')).toHaveLength(1);
  });

  it('leaves a refusal that approving again would not fix without that invitation', async () => {
    oneRunningDeployment();
    stub.replies['/deployments/1/liquidate'] = {
      ok: false,
      status: 409,
      body: { detail: 'deployment 1 cannot move \'stopped\' -> \'liquidating\'' },
    };

    const result = await run(action('deploy.liquidate-all', 'mutation', 'deploys'));

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.note).toContain('cannot move');
    expect(result.kind === 'failed' && result.note).not.toContain('Approve it again');
  });

  it('addresses only the deployments the engine lifecycle accepts the verb from', async () => {
    stub.gets['/deployments'] = [deployment(1, 'running'), deployment(2, 'archived')];
    stub.replies['/confirm'] = { ok: true, status: 200, body: { token: 't' } };
    stub.replies['/deployments/1/liquidate'] = { ok: true, status: 200, body: { ok: true } };

    await run(action('deploy.liquidate-all', 'mutation', 'deploys'));

    expect(stub.posts.map((call) => call.path)).toEqual([
      '/confirm',
      '/deployments/1/liquidate',
    ]);
  });
});

/* ── draft ──────────────────────────────────────────────────────────── */

describe('a draft is a hand-off, and says so', () => {
  const FIELDS: IntentField[] = [
    { label: 'Source', value: 'the highest-ranked finding in the feed' },
    { label: 'Named', value: 'gap fade at the open' },
    { label: 'Reading', value: '12 findings · top 87' },
  ];

  it('opens a prefilled session carrying the reading, and reports the session', async () => {
    const launch = vi.fn(async () => ({ ok: true, sessionId: 's-1' }));
    registerAgentHost({ launchAgentSession: launch });

    const result = await run(action('strategy.draft-from-finding', 'draft', 'findings', FIELDS));

    expect(launch).toHaveBeenCalledTimes(1);
    const prompt = launch.mock.calls[0][0] as unknown as string;
    expect(prompt).toContain('12 findings · top 87');
    expect(prompt).toContain('gap fade at the open');
    expect(result.kind).toBe('done');
    // Dispatch, never delivery: a session exists, a strategy does not.
    expect(result.kind === 'done' && result.note).toContain('Agent session started');
    expect(result.kind === 'done' && result.note).toContain('no strategy has been written yet');
  });

  it('reads a host with no agent lane as unavailable, not as a draft', async () => {
    const result = await run(action('strategy.draft-from-finding', 'draft', 'findings', FIELDS));

    expect(result.kind).toBe('not-wired');
    expect(result.kind === 'not-wired' && result.note).toContain('Nothing was sent');
  });

  it('carries the reason the lane gave when the hand-off is refused', async () => {
    registerAgentHost({
      launchAgentSession: vi.fn(async () => ({ ok: false, error: 'no model is connected' })),
    });

    const result = await run(action('strategy.draft-from-finding', 'draft', 'findings', FIELDS));

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.note).toBe('no model is connected');
  });
});

/* ── the consolidated poll ──────────────────────────────────────────── */

describe('the sheet asks once for the districts the engine consolidates', () => {
  function getPaths(): string[] {
    return vi.mocked(getJson).mock.calls.map((call) => call[0] as string);
  }

  it('reads the one call and nothing per-room where nothing is deployed', async () => {
    stub.gets['/ui/api/summary'] = summaryBody({ deployments: { total: 0, running: 0, errored: 0 } });
    vi.mocked(getJson).mockClear();

    await gridVitals.refresh();

    const paths = getPaths();
    expect(paths.filter((path) => path.startsWith('/ui/api/summary'))).toHaveLength(1);
    // No detail read, and none of the per-room routes the one call replaced.
    expect(paths).not.toContain('/deployments');
    for (const replaced of ['/ui/api/incidents', '/ui/api/schedules', '/ui/api/runway', '/ui/api/research/feed']) {
      expect(paths.some((path) => path.startsWith(replaced))).toBe(false);
    }
  });

  it('follows a healthy deployment count with exactly one detail read', async () => {
    // The rows are read whenever anything is deployed, not only when something
    // broke: the sheet names an errored one from them and the board draws a
    // card per deployment from them. One read serves both.
    serveDeployments([deployment(1, 'running'), deployment(2, 'running')]);
    vi.mocked(getJson).mockClear();

    await gridVitals.refresh();

    expect(getPaths().filter((path) => path === '/deployments')).toHaveLength(1);
    expect(gridVitals.getSnapshot().deploys).toMatchObject({ health: 'nominal', note: '2 running of 2' });
  });

  it('follows a reported fault with exactly one read, to name it', async () => {
    serveDeployments([deployment(1, 'errored'), deployment(2, 'running')]);
    vi.mocked(getJson).mockClear();

    await gridVitals.refresh();

    expect(getPaths().filter((path) => path === '/deployments')).toHaveLength(1);
    expect(gridVitals.getSnapshot().deploys).toMatchObject({
      health: 'fault',
      subjects: ['strategy-1'],
    });
  });

  it('propagates the engine open-alert figure to the sheet and the badge alike', async () => {
    stub.gets['/ui/api/summary'] = summaryBody({ open_alerts: 3 });

    await gridVitals.refresh();
    await alertStore.refresh();

    expect(gridVitals.getSnapshot().incidents).toMatchObject({ health: 'fault', note: '3 open' });
    expect(alertStore.getSnapshot()).toBe(3);
  });

  it('stays quiet for a district the engine itself could not read', async () => {
    stub.gets['/ui/api/summary'] = summaryBody({
      deployments: null,
      open_alerts: null,
      degraded: ['deployments', 'incidents'],
    });

    await gridVitals.refresh();
    await alertStore.refresh();

    const vitals = gridVitals.getSnapshot();
    expect(vitals.deploys).toMatchObject({ health: 'nominal', note: null });
    expect(vitals.incidents).toMatchObject({ health: 'nominal', note: null });
    // The badge's own contract is unchanged: no figure reads as clear.
    expect(alertStore.getSnapshot()).toBe(0);
  });
});

/* ── the undo beside the outcome ────────────────────────────────────── */

describe('the strip offers to put the last repair back', () => {
  async function settle(): Promise<void> {
    await act(async () => {
      await gridVitals.refresh();
    });
  }

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('runs the engine recorded inverse for the entry the repair created', async () => {
    serveDeployments([deployment(1, 'errored')]);
    stub.replies['/ui/api/ops/repair'] = {
      ok: true,
      status: 200,
      body: { entry: { id: 42, status: 'applied' } },
    };
    stub.replies['/ui/api/ops/journal/42/undo'] = { ok: true, status: 200, body: { entry: {} } };

    render(<GridPanel {...HOST_PROPS} />);
    await settle();
    fireEvent.click(screen.getByTestId('grid-ai-strip-repair'));
    await flush();

    expect(screen.getByTestId('grid-ai-strip-result').getAttribute('data-result')).toBe('done');

    fireEvent.click(screen.getByTestId('grid-ai-strip-undo'));
    await flush();

    expect(postsTo('/ui/api/ops/journal/42/undo')).toHaveLength(1);
    // Reversed once: the offer is withdrawn rather than left to be pressed again.
    expect(screen.queryByTestId('grid-ai-strip-undo')).toBeNull();
    expect(repairUndoStore.getSnapshot()).toBeNull();
  });

  it('reverses every entry a multi-target repair created, not only the last', async () => {
    serveDeployments([deployment(1, 'errored'), deployment(2, 'errored')]);
    // Two targets, so the engine journals two entries.
    let nextEntry = 0;
    stub.replies['/ui/api/ops/repair'] = () => {
      nextEntry += 1;
      return { ok: true, status: 200, body: { entry: { id: nextEntry } } };
    };
    stub.replies['/ui/api/ops/journal'] = { ok: true, status: 200, body: { entry: {} } };

    render(<GridPanel {...HOST_PROPS} />);
    await settle();
    fireEvent.click(screen.getByTestId('grid-ai-strip-repair'));
    await flush();

    expect(repairUndoStore.getSnapshot()?.entryIds).toEqual(['1', '2']);

    fireEvent.click(screen.getByTestId('grid-ai-strip-undo'));
    await flush();

    // Newest first: a chain of changes comes apart in the order it went on.
    expect(postsTo('/ui/api/ops/journal').map((call) => call.path)).toEqual([
      '/ui/api/ops/journal/2/undo',
      '/ui/api/ops/journal/1/undo',
    ]);
    expect(repairUndoStore.getSnapshot()).toBeNull();
  });

  it('keeps the offer and states the reason when the engine refuses the reversal', async () => {
    serveDeployments([deployment(1, 'errored')]);
    stub.replies['/ui/api/ops/repair'] = {
      ok: true,
      status: 200,
      body: { entry: { id: 42, status: 'applied' } },
    };
    stub.replies['/ui/api/ops/journal/42/undo'] = {
      ok: false,
      status: 409,
      body: { detail: 'deployment 1 has moved on to \'running\'' },
    };

    render(<GridPanel {...HOST_PROPS} />);
    await settle();
    fireEvent.click(screen.getByTestId('grid-ai-strip-repair'));
    await flush();
    fireEvent.click(screen.getByTestId('grid-ai-strip-undo'));
    await flush();

    expect(screen.getByTestId('grid-ai-strip-undo-note').textContent).toContain('has moved on');
    expect(screen.getByTestId('grid-ai-strip-undo')).toBeTruthy();
  });
});
