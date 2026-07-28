/**
 * The AI presence layer: the strip on the plan, the bar on a room page, and
 * the approval gate between a mutation and anything happening.
 *
 * What is worth pinning here is not that buttons render. It is that AUTHORITY
 * is enforced by the layer rather than by whoever calls it:
 *
 *  - a mutation raises the dialog wherever it is pressed, and declining it is
 *    the absence of an event: nothing ran, nothing moved, the action is still
 *    on offer;
 *  - approving runs the executor with the EXACT payload the dialog showed, so
 *    what was consented to and what was executed are the same object;
 *  - an operation nobody has wired yet says so. This is the one that would rot
 *    quietly, so it is asserted from the outside: the surface must render the
 *    stub's answer as pending wiring and must not render it as a success;
 *  - the strip's three states are driven by the readings, not by a flag some
 *    surface remembered to set;
 *  - the palette's AI rows come and go with the system's state, because they
 *    are provided rather than listed.
 *
 * The engine client is mocked at its seam, so every reading asserted below is
 * one the fixtures actually served.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const stub = vi.hoisted(() => ({ feeds: {} as Record<string, unknown> }));

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getJson: vi.fn(async (path: string) => {
    for (const [prefix, body] of Object.entries(stub.feeds)) {
      if (path.startsWith(prefix)) return body;
    }
    return null;
  }),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
}));

import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { GridPanel } from '../grid/GridPanel';
import { RoomAiBar } from '../grid/RoomAiBar';
import {
  aiRunStore,
  availableActions,
  registerAiExecutor,
  type ActionIntent,
  type AiActionResult,
} from '../grid/gridAiActions';
import { closePalette } from '../grid/gridCommands';
import { getActiveRoom, openGridHome, openRoom } from '../grid/gridNav';
import { setFace } from '../grid/gridFaceStore';
import type { RoomId } from '../grid/rooms';
import { alertStore } from '../../engine/alertStore';
import { gridVitals } from '../../engine/gridVitals';
import { deploymentsBlock, summaryBody } from '../../engine/__tests__/summaryFixture';

const HOST_PROPS = {} as PanelHostProps;

/** A deployment row shaped as the engine serves it. */
function deployment(id: number, state: string): Record<string, unknown> {
  return {
    id,
    name: `strategy-${id}`,
    strategy_path: `strategies.s${id}.S`,
    broker: 'paper',
    mode: 'paper',
    state,
    positions: [],
  };
}

/** The consolidated status call describing `rows`, plus the naming read the
 *  sheet follows it with when one of them is errored. */
function serveDeployments(rows: Array<Record<string, unknown>>): void {
  stub.feeds['/ui/api/summary'] = summaryBody({
    deployments: deploymentsBlock(rows as Array<{ state: string }>),
  });
  stub.feeds['/deployments'] = rows;
}

/** One deployment in the failed state — the fault the plan draws in red. */
function anErroredDeployment(): void {
  serveDeployments([deployment(1, 'errored')]);
}

/** A healthy deployment: something IS deployed, but nothing is wrong. */
function aRunningDeployment(): void {
  serveDeployments([deployment(1, 'running')]);
}

/** Let every pending read land, inside act, so React sees one settled frame. */
async function settle(): Promise<void> {
  await act(async () => {
    await gridVitals.refresh();
  });
}

/** Flush the microtasks an execution settles on. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderGrid(): void {
  render(<GridPanel {...HOST_PROPS} />);
}

/** The bar on its own, for the cases that are about the bar rather than about
 *  the page it is framed by. */
function renderBar(room: RoomId): void {
  render(<RoomAiBar room={room} />);
}

function strip(): HTMLElement {
  return screen.getByTestId('grid-ai-strip');
}

/** The action as the layer currently offers it — what the dialog is showing
 *  and what an executor must be handed. */
function offered(id: string): { intent: ActionIntent } {
  const action = availableActions(gridVitals.getSnapshot()).find((row) => row.id === id);
  if (!action) throw new Error(`no action offered: ${id}`);
  return action;
}

function openFromRoot(): void {
  act(() => screen.getByTestId('auracle-grid').focus());
  fireEvent.click(screen.getByTestId('grid-root'));
}

function paletteRowIds(): string[] {
  return screen
    .getAllByRole('option')
    .map((row) => row.getAttribute('data-testid') ?? '')
    .map((id) => id.replace('grid-palette-item-', ''));
}

const disposers: Array<() => void> = [];

/** Install an executor for the length of one test. */
function wire(operation: string, executor: (intent: ActionIntent) => Promise<AiActionResult>) {
  const spy = vi.fn(executor);
  disposers.push(registerAiExecutor(operation, spy));
  return spy;
}

beforeEach(() => {
  // The panel opens on the BOARD in a workspace that has not chosen a face.
  // These are the PLAN's tests, so they say so.
  setFace('plan');
  stub.feeds = {};
  gridVitals.reset();
  aiRunStore.reset();
});

afterEach(async () => {
  cleanup();
  while (disposers.length > 0) disposers.pop()?.();
  closePalette();
  openGridHome();
  aiRunStore.reset();
  stub.feeds = {};
  await alertStore.refresh();
  gridVitals.reset();
});

describe('the strip is the assistant on the plan', () => {
  it('watches quietly while nothing is wrong', async () => {
    aRunningDeployment();
    renderGrid();
    await settle();

    expect(strip().getAttribute('data-state')).toBe('nominal');
    expect(screen.getByTestId('grid-ai-strip-line').textContent).toContain('Nothing needs attention');
    // Quiet means quiet: no controls at all, not disabled ones.
    expect(screen.queryByTestId('grid-ai-strip-repair')).toBeNull();
    expect(screen.queryByTestId('grid-ai-strip-open')).toBeNull();
  });

  it('names the fault, states the repair plan, and offers both moves', async () => {
    anErroredDeployment();
    renderGrid();
    await settle();

    expect(strip().getAttribute('data-state')).toBe('proposing');
    // It speaks about the room the plan drew in red, and quotes that room's
    // own reading rather than a second opinion about it — including which
    // deployment stopped, which is the difference between a count and a name.
    expect(strip().getAttribute('data-subject')).toBe('deploys');
    expect(screen.getByTestId('grid-ai-strip-subject').textContent).toBe('strategy-1');
    expect(screen.getByTestId('grid-ai-strip-line').textContent).toContain('1 errored');
    // And the repair addresses that same named thing.
    expect(offered('deploys-repair').intent.fields).toContainEqual({
      label: 'Named',
      value: 'strategy-1',
    });
    // The plan it states is the repair's own summary, not a paraphrase.
    expect(screen.getByTestId('grid-ai-strip-plan').textContent).toBe(
      offered('deploys-repair').intent.summary
    );
    expect(screen.getByTestId('grid-ai-strip-repair')).toBeTruthy();
    expect(screen.getByTestId('grid-ai-strip-open').textContent).toContain('Deployments');
  });

  it('opens the faulted room from the strip', async () => {
    anErroredDeployment();
    renderGrid();
    await settle();

    fireEvent.click(screen.getByTestId('grid-ai-strip-open'));

    expect(getActiveRoom()).toBe('deploys');
  });

  it('holds the working state while an execution is out, then states its outcome', async () => {
    let release: (result: AiActionResult) => void = () => {};
    const gate = new Promise<AiActionResult>((resolve) => {
      release = resolve;
    });
    wire('deploy.restart-errored', () => gate);

    anErroredDeployment();
    renderGrid();
    await settle();

    fireEvent.click(screen.getByTestId('grid-ai-strip-repair'));

    expect(strip().getAttribute('data-state')).toBe('working');
    expect(screen.getByTestId('grid-ai-strip-step').textContent).toContain(
      'deploy.restart-errored'
    );

    await act(async () => {
      release({ kind: 'done', note: 'The engine restarted it.' });
      await gate;
    });
    await flush();

    // The readings have not moved, so the strip goes back to proposing — the
    // strip states what IS true, and reports the attempt separately.
    expect(strip().getAttribute('data-state')).toBe('proposing');
    const outcome = screen.getByTestId('grid-ai-strip-result');
    expect(outcome.getAttribute('data-result')).toBe('done');
    expect(outcome.textContent).toContain('The engine restarted it.');
  });

  it('reports a repair the engine refused as a failure, never as a success', async () => {
    // Every mutation in this file's client stub answers "nothing answered", so
    // the repair reaches the engine lane and comes back refused.
    anErroredDeployment();
    renderGrid();
    await settle();

    fireEvent.click(screen.getByTestId('grid-ai-strip-repair'));
    await flush();

    const outcome = screen.getByTestId('grid-ai-strip-result');
    expect(outcome.getAttribute('data-result')).toBe('failed');
    expect(outcome.getAttribute('data-result')).not.toBe('done');
    expect(outcome.textContent).toContain('did not answer');
    // Nothing to put back, because nothing was recorded.
    expect(screen.queryByTestId('grid-ai-strip-undo')).toBeNull();
    // The fault is still the fault: nothing about the plan improved.
    expect(strip().getAttribute('data-state')).toBe('proposing');
  });

  it('reports an unavailable lane as pending wiring rather than as a result', async () => {
    // The draft hands off to the agent, and this host has no agent lane at all.
    // That is neither a success nor a failure, and the surface must say so.
    stub.feeds['/ui/api/summary'] = summaryBody({ research: { findings: 1, top_score: 87 } });
    openRoom('findings');
    renderGrid();
    await settle();

    fireEvent.click(screen.getByTestId('room-ai-action-findings-draft'));
    await flush();

    const outcome = screen.getByTestId('room-ai-outcome');
    expect(outcome.getAttribute('data-result')).toBe('not-wired');
    expect(screen.getByTestId('room-ai-note').textContent).toContain('Nothing was sent');
    expect(screen.queryByTestId('room-ai-reply')).toBeNull();
  });
});

describe('the classes are drawn as four different things', () => {
  it('gives a repair one press and a mutation an approval tag', async () => {
    anErroredDeployment();
    renderBar('deploys');
    await settle();

    const repair = screen.getByTestId('room-ai-action-deploys-repair');
    expect(repair.getAttribute('data-class')).toBe('repair');
    expect(repair.getAttribute('data-approval')).toBe('none');
    expect(screen.queryByTestId('room-ai-approval-tag-deploys-repair')).toBeNull();

    const mutation = screen.getByTestId('room-ai-action-deploys-liquidate');
    expect(mutation.getAttribute('data-class')).toBe('mutation');
    expect(mutation.getAttribute('data-approval')).toBe('required');
    expect(screen.getByTestId('room-ai-approval-tag-deploys-liquidate').textContent).toContain(
      'Needs approval'
    );
  });

  it('runs a draft on one press and produces only a visible draft', async () => {
    stub.feeds['/ui/api/summary'] = summaryBody({ research: { findings: 1, top_score: 87 } });
    const executor = wire('strategy.draft-from-finding', async () => ({
      kind: 'done',
      note: 'Wrote one draft strategy.',
    }));
    renderBar('findings');
    await settle();

    const draft = screen.getByTestId('room-ai-action-findings-draft');
    expect(draft.getAttribute('data-class')).toBe('draft');
    expect(draft.getAttribute('data-approval')).toBe('none');

    fireEvent.click(draft);
    await flush();

    // No dialog stood between the press and the work, and what it promises to
    // produce is a draft: the intent says so in the payload itself.
    expect(screen.queryByTestId('ai-approval')).toBeNull();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(offered('findings-draft').intent.fields).toContainEqual({
      label: 'Produces',
      value: 'one draft strategy file, left unrun',
    });
  });

  it('answers an advisory inline, from the reading on screen', async () => {
    stub.feeds['/ui/api/summary'] = summaryBody({ open_alerts: 2 });
    renderBar('incidents');
    await settle();

    const advisory = screen.getByTestId('room-ai-action-incidents-explain');
    expect(advisory.getAttribute('data-class')).toBe('advisory');

    fireEvent.click(advisory);
    await flush();

    const reply = screen.getByTestId('room-ai-reply');
    // Grounded: the answer quotes the room's own reading, so it cannot drift
    // from what the plan is showing.
    expect(reply.textContent).toContain('2 open');
    expect(screen.getByTestId('room-ai-outcome').getAttribute('data-result')).toBe('answered');
  });

  it('draws no bar at all for a room with nothing to offer', async () => {
    stub.feeds['/ui/api/summary'] = summaryBody({ schedules: { total: 1, active: 1 } });
    renderBar('schedules');
    await settle();

    expect(screen.queryByTestId('room-ai-bar')).toBeNull();
  });

  it('is mounted by the room frame, on the room that has actions', async () => {
    anErroredDeployment();
    openRoom('deploys');
    renderGrid();
    await settle();

    const bar = screen.getByTestId('room-ai-bar');
    expect(bar.getAttribute('data-room')).toBe('deploys');
    expect(screen.getByTestId('room-ai-action-deploys-repair')).toBeTruthy();
  });
});

describe('a mutation cannot happen without approval', () => {
  it('raises the dialog instead of executing, wherever it is pressed', async () => {
    const executor = wire('deploy.liquidate-all', async () => ({ kind: 'done', note: 'flat' }));
    aRunningDeployment();
    openRoom('deploys');
    renderGrid();
    await settle();

    fireEvent.click(screen.getByTestId('room-ai-action-deploys-liquidate'));
    await flush();

    expect(screen.getByTestId('ai-approval')).toBeTruthy();
    expect(executor).not.toHaveBeenCalled();
  });

  it('shows the exact payload the approval would be bound to', async () => {
    aRunningDeployment();
    openRoom('deploys');
    renderGrid();
    await settle();

    fireEvent.click(screen.getByTestId('room-ai-action-deploys-liquidate'));

    expect(screen.getByTestId('ai-approval-operation').textContent).toBe('deploy.liquidate-all');
    expect(screen.getByTestId('ai-approval-title').textContent).toBe('Liquidate every open position');
    expect(screen.getByTestId('ai-approval-class').textContent).toBe('Mutation');
    expect(screen.getByTestId('ai-approval-field-affects-capital').textContent).toContain('yes');
    expect(screen.getByTestId('ai-approval-field-reversible').textContent).toContain('no');
    // Every declared field is on screen, not a chosen few.
    const shown = screen.getByTestId('ai-approval-fields').querySelectorAll('[data-testid^="ai-approval-field-"]');
    expect(shown).toHaveLength(offered('deploys-liquidate').intent.fields.length);
  });

  it('leaves everything untouched on decline', async () => {
    const executor = wire('deploy.liquidate-all', async () => ({ kind: 'done', note: 'flat' }));
    aRunningDeployment();
    openRoom('deploys');
    renderGrid();
    await settle();

    const before = aiRunStore.getSnapshot();
    fireEvent.click(screen.getByTestId('room-ai-action-deploys-liquidate'));
    fireEvent.click(screen.getByTestId('ai-approval-decline'));
    await flush();

    expect(screen.queryByTestId('ai-approval')).toBeNull();
    expect(executor).not.toHaveBeenCalled();
    // A decline is not an event: no outcome was recorded, nothing is running,
    // and the store is back exactly where it started.
    expect(aiRunStore.getSnapshot()).toEqual(before);
    expect(screen.queryByTestId('room-ai-outcome')).toBeNull();
    // And the action is still on offer, because nothing about the state moved.
    expect(screen.getByTestId('room-ai-action-deploys-liquidate')).toBeTruthy();
  });

  it('declines on Escape as well as on the button', async () => {
    const executor = wire('deploy.liquidate-all', async () => ({ kind: 'done', note: 'flat' }));
    aRunningDeployment();
    openRoom('deploys');
    renderGrid();
    await settle();

    fireEvent.click(screen.getByTestId('room-ai-action-deploys-liquidate'));
    fireEvent.keyDown(screen.getByTestId('ai-approval-decline'), { key: 'Escape' });
    await flush();

    expect(screen.queryByTestId('ai-approval')).toBeNull();
    expect(executor).not.toHaveBeenCalled();
    // Escape stayed inside the dialog: the room page did not also take it and
    // walk back to the plan.
    expect(getActiveRoom()).toBe('deploys');
  });

  it('hands the executor the exact intent that was approved', async () => {
    const executor = wire('deploy.liquidate-all', async () => ({ kind: 'done', note: 'flat' }));
    aRunningDeployment();
    openRoom('deploys');
    renderGrid();
    await settle();

    const intent = offered('deploys-liquidate').intent;
    fireEvent.click(screen.getByTestId('room-ai-action-deploys-liquidate'));
    fireEvent.click(screen.getByTestId('ai-approval-approve'));
    await flush();

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0][0]).toEqual(intent);
    expect(executor.mock.calls[0][0].operation).toBe('deploy.liquidate-all');
    expect(screen.queryByTestId('ai-approval')).toBeNull();
  });

  it('surfaces the engine refusing an approved operation, never as a success', async () => {
    aRunningDeployment();
    openRoom('deploys');
    renderGrid();
    await settle();

    fireEvent.click(screen.getByTestId('room-ai-action-deploys-liquidate'));
    fireEvent.click(screen.getByTestId('ai-approval-approve'));
    await flush();

    const outcome = screen.getByTestId('room-ai-outcome');
    expect(outcome.getAttribute('data-result')).toBe('failed');
    expect(screen.getByTestId('room-ai-note').textContent).toContain('did not answer');
    expect(screen.queryByTestId('room-ai-reply')).toBeNull();
  });
});

describe('the palette carries the assistant', () => {
  it('lists a repair only while something is errored', async () => {
    aRunningDeployment();
    renderGrid();
    await settle();
    openFromRoot();

    expect(paletteRowIds()).not.toContain('ai-deploys-repair');
    closePalette();

    anErroredDeployment();
    await settle();
    openFromRoot();

    expect(paletteRowIds()).toContain('ai-deploys-repair');
    expect(screen.getByTestId('grid-palette-badge-ai-deploys-repair').textContent).toBe('AI');
  });

  it('offers the draft on the findings context', async () => {
    stub.feeds['/ui/api/summary'] = summaryBody({ research: { findings: 1, top_score: 87 } });
    renderGrid();
    await settle();
    openFromRoot();

    expect(paletteRowIds()).toContain('ai-findings-draft');
    // Filed under its own heading, so an action is never mistaken for a place.
    expect(screen.getByRole('group', { name: 'AI actions' })).toBeTruthy();
  });

  it('files the rooms first and the actions after them', async () => {
    anErroredDeployment();
    renderGrid();
    await settle();
    openFromRoot();

    const ids = paletteRowIds();
    const lastRoom = ids.map((id) => id.startsWith('room-')).lastIndexOf(true);
    const firstAi = ids.findIndex((id) => id.startsWith('ai-'));
    expect(firstAi).toBeGreaterThan(lastRoom);
  });

  it('takes a mutation raised from the palette through the same gate', async () => {
    const executor = wire('deploy.liquidate-all', async () => ({ kind: 'done', note: 'flat' }));
    aRunningDeployment();
    renderGrid();
    await settle();
    openFromRoot();

    fireEvent.click(screen.getByTestId('grid-palette-item-ai-deploys-liquidate'));
    await flush();

    // It went to the room it acts on, and it still asked first.
    expect(getActiveRoom()).toBe('deploys');
    expect(screen.getByTestId('ai-approval')).toBeTruthy();
    expect(executor).not.toHaveBeenCalled();
  });
});
