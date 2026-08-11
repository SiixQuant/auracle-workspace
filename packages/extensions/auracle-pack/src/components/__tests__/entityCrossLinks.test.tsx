/**
 * Cross-linked entities (Frontier #2).
 *
 * Every room header names the strategy it is about and turns that name into a
 * one-click pivot to its tearsheet — the S3 registry resolves the target, the
 * EntityLink is the affordance, RoomPage is the first consumer. Pinned here:
 * the crumb shows the humanized name, clicking it navigates focused, and it is
 * absent where it would be redundant (the tearsheet room itself) or impossible
 * (nothing focused).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { focusStore } from '../../engine/focusStore';
import { entityFocus, type EntityRef } from '../../engine/entityLinks';
import { EntityLink } from '../grid/EntityLink';
import { getActiveRoom, openGridHome } from '../grid/gridNav';
import { RoomPage } from '../grid/RoomPage';

const PATH = 'strategies.desk.fund_pair.FundPair';

afterEach(() => {
  cleanup();
  focusStore.clear();
  openGridHome();
});

describe('the focused-strategy crumb in a room header', () => {
  it('names the focused strategy and pivots to its tearsheet on click', () => {
    focusStore.publish({ strategy: { filePath: 'strategies/x.py', dottedPath: PATH } });
    render(
      <RoomPage room="factors" status="nominal" context="ctx">
        body
      </RoomPage>
    );
    const crumb = screen.getByTestId('room-focused-entity');
    expect(crumb.textContent).toBe('FundPair'); // humanized from the dotted path
    fireEvent.click(crumb);
    expect(getActiveRoom()).toBe('strategy');
    expect(focusStore.getSnapshot().strategy?.dottedPath).toBe(PATH);
  });

  it('is absent in the tearsheet room itself — no self-link', () => {
    focusStore.publish({ strategy: { dottedPath: PATH } });
    render(
      <RoomPage room="strategy" status="nominal" context="ctx">
        body
      </RoomPage>
    );
    expect(screen.queryByTestId('room-focused-entity')).toBeNull();
  });

  it('is absent when nothing is focused', () => {
    focusStore.clear();
    render(
      <RoomPage room="factors" status="nominal" context="ctx">
        body
      </RoomPage>
    );
    expect(screen.queryByTestId('room-focused-entity')).toBeNull();
  });
});

describe('EntityLink — the reusable affordance', () => {
  const STRATEGY: EntityRef = { kind: 'strategy', id: PATH, label: 'FundPair', strategyPath: PATH };

  it('defaults to the tearsheet and can be pointed at a specific room', () => {
    render(<EntityLink entity={STRATEGY} room="factors" />);
    const link = screen.getByTestId('entity-link');
    expect(link.getAttribute('data-entity-room')).toBe('factors');
    fireEvent.click(link);
    expect(getActiveRoom()).toBe('factors');
    expect(focusStore.getSnapshot().strategy?.dottedPath).toBe(entityFocus(STRATEGY).strategy?.dottedPath);
  });
});
