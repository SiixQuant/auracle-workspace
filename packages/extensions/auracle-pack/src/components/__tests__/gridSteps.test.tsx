/**
 * Work in progress — a short step list, never a spinner, never invented.
 *
 *  - while an operation runs, the list shows exactly one current step, named
 *    by what it is doing. The client learns one thing about a dispatched
 *    intent (it is running), so the list says one thing rather than
 *    fabricating a walk;
 *  - the step is marked with whether it costs anything BEFORE it finishes: a
 *    mutation moves capital and is flagged, everything else is free;
 *  - when nothing is running there is no list at all — the outcome or the
 *    artifact is what remains, and this surface is only for the interval.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { GridSteps, runSteps } from '../grid/GridSteps';
import type { AiAction, AiRunState } from '../grid/gridAiActions';

function action(over: Partial<AiAction> = {}): AiAction {
  return {
    id: 'a1',
    class: 'advisory',
    room: 'deploys',
    label: 'Explain the deploys reading',
    icon: 'help',
    intent: { operation: 'deploys.explain', room: 'deploys', summary: 'x', fields: [] },
    ...over,
  } as AiAction;
}

function running(over: Partial<AiAction> = {}): AiRunState {
  return { pending: null, running: action(over), step: 'x', outcome: null };
}

const IDLE: AiRunState = { pending: null, running: null, step: null, outcome: null };

afterEach(cleanup);

describe('runSteps', () => {
  it('is one current step, named by the operation, while running', () => {
    const steps = runSteps(running());
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe('current');
    expect(steps[0].label).toBe('Explain the deploys reading');
  });

  it('marks a mutation as a capital cost before it runs', () => {
    expect(runSteps(running({ class: 'mutation' }))[0].cost).toBe('capital');
  });

  it('marks everything that is not a mutation free', () => {
    for (const cls of ['advisory', 'draft', 'repair'] as const) {
      expect(runSteps(running({ class: cls }))[0].cost).toBe('free');
    }
  });

  it('is empty when nothing is running', () => {
    expect(runSteps(IDLE)).toEqual([]);
    // A settled outcome is not a running step either — the artifact takes over.
    expect(
      runSteps({
        pending: null,
        running: null,
        step: null,
        outcome: { action: action(), result: { kind: 'done', note: 'ok' } },
      })
    ).toEqual([]);
  });
});

describe('the rendered list', () => {
  it('draws the current step with its cost tag', () => {
    render(<GridSteps state={running({ class: 'mutation', label: 'Liquidate the book' })} />);
    expect(screen.getByTestId('grid-steps')).toBeTruthy();
    expect(screen.getByTestId('grid-step-0').textContent).toContain('Liquidate the book');
    expect(screen.getByTestId('grid-step-cost-0').getAttribute('data-cost')).toBe('capital');
    expect(screen.getByTestId('grid-step-cost-0').textContent).toContain('capital');
  });

  it('is a spinner-free list: no progressbar, no raw log', () => {
    const { container } = render(<GridSteps state={running()} />);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(screen.getByTestId('grid-step-0').getAttribute('data-status')).toBe('current');
  });

  it('renders nothing at all when idle', () => {
    const { container } = render(<GridSteps state={IDLE} />);
    expect(container.querySelector('[data-testid="grid-steps"]')).toBeNull();
  });
});
