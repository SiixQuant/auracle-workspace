/**
 * The inferred-scope line — said back before work, and impossible to mistake
 * for an input.
 *
 *  - it states the agent's own one sentence for the work in hand (the intent
 *    summary), so a wrong reading is caught before anything expensive runs;
 *  - it is DISPLAY ONLY: no chip, no editable field, no control of any kind.
 *    The hint points at the conversation, because that is where a reading is
 *    corrected — by talking, never by a widget on the line;
 *  - it is absent when there is nothing to read.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { GridScope, scopeReading } from '../grid/GridScope';
import type { AiAction, AiRunState } from '../grid/gridAiActions';

function action(summary: string): AiAction {
  return {
    id: 'a1',
    class: 'advisory',
    room: 'deploys',
    label: 'Do the thing',
    icon: 'x',
    intent: { operation: 'x.y', room: 'deploys', summary, fields: [] },
  } as AiAction;
}

const IDLE: AiRunState = { pending: null, running: null, step: null, outcome: null };

function running(summary: string): AiRunState {
  return { pending: null, running: action(summary), step: 'x', outcome: null };
}

function pendingState(summary: string): AiRunState {
  return { pending: action(summary), running: null, step: null, outcome: null };
}

afterEach(cleanup);

describe('scopeReading', () => {
  it('is the running action summary', () => {
    expect(scopeReading(running('Restart the errored deployments and re-read them'))).toBe(
      'Restart the errored deployments and re-read them'
    );
  });

  it('falls back to a pending action awaiting approval', () => {
    expect(scopeReading(pendingState('Liquidate the whole book'))).toBe(
      'Liquidate the whole book'
    );
  });

  it('is null when nothing is in hand, or the summary is blank', () => {
    expect(scopeReading(IDLE)).toBeNull();
    expect(scopeReading(running('   '))).toBeNull();
  });
});

describe('the rendered line', () => {
  it('shows the reading and points at the conversation to change it', () => {
    render(<GridScope state={running('Find something that holds up in a choppy market')} />);
    expect(screen.getByTestId('grid-scope-reading').textContent).toContain(
      'Find something that holds up in a choppy market'
    );
    expect(screen.getByTestId('grid-scope-hint').textContent).toContain('Say so');
  });

  it('is display only: no chip, no field, no control at all', () => {
    render(<GridScope state={running('some scope')} />);
    const line = screen.getByTestId('grid-scope');
    expect(line.querySelectorAll('input, select, textarea, button, [contenteditable]')).toHaveLength(
      0
    );
  });

  it('renders nothing when there is no scope to state', () => {
    const { container } = render(<GridScope state={IDLE} />);
    expect(container.querySelector('[data-testid="grid-scope"]')).toBeNull();
  });
});
