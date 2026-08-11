/**
 * EntityLink — a rendered entity value that becomes navigation (Frontier #2).
 *
 * The one place a strategy/run reference shown in a panel turns into a click
 * that opens that entity's room, focused on it. The where/what mapping lives in
 * S3 ({@link entityFocus} / {@link PRIMARY_ROOM}), never here; this component is
 * only the affordance. Defaults to the entity's tearsheet (the strategy room);
 * pass `room` to pivot somewhere specific.
 */
import type { ReactNode } from 'react';

import { entityFocus, PRIMARY_ROOM, type EntityRef } from '../../engine/entityLinks';
import { tone } from '../panelkit';
import { openRoomFocused } from './gridNav';
import { GRID_ACCENT } from './gridTheme';
import { ROOMS, type RoomId } from './rooms';

export function EntityLink({
  entity,
  room,
  children,
  testId,
}: {
  entity: EntityRef;
  /** Where the click lands. Defaults to the entity's tearsheet. */
  room?: RoomId;
  /** Custom label; defaults to `entity.label`. */
  children?: ReactNode;
  testId?: string;
}): JSX.Element {
  const target = room ?? PRIMARY_ROOM;
  return (
    <button
      type="button"
      data-testid={testId ?? 'entity-link'}
      data-entity-kind={entity.kind}
      data-entity-room={target}
      title={`Open ${entity.label} — ${ROOMS[target].title}`}
      onClick={() => openRoomFocused(target, entityFocus(entity))}
      style={{
        appearance: 'none',
        border: 0,
        background: 'transparent',
        padding: 0,
        margin: 0,
        font: 'inherit',
        fontWeight: 600,
        color: GRID_ACCENT,
        cursor: 'pointer',
        textDecorationLine: 'underline',
        textDecorationColor: `color-mix(in srgb, ${GRID_ACCENT} 40%, transparent)`,
        textUnderlineOffset: 2,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget.style as CSSStyleDeclaration).textDecorationColor = GRID_ACCENT;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget.style as CSSStyleDeclaration).textDecorationColor =
          `color-mix(in srgb, ${GRID_ACCENT} 40%, transparent)`;
      }}
      onFocus={(e) => {
        (e.currentTarget.style as CSSStyleDeclaration).outline = `2px solid ${tone.accentText}`;
        (e.currentTarget.style as CSSStyleDeclaration).outlineOffset = '2px';
      }}
      onBlur={(e) => {
        (e.currentTarget.style as CSSStyleDeclaration).outline = 'none';
      }}
    >
      {children ?? entity.label}
    </button>
  );
}
