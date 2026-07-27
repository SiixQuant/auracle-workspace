/**
 * The hover peek — what a room is, without spending a click to find out.
 *
 * Resting on a room card for {@link PEEK_DELAY_MS} lifts a small card beside it
 * carrying the room's icon and name, its live reading (the same note and health
 * the card's dot is drawn from), and the one sentence that says what the room is
 * for. It answers "what is this and how is it doing" at the cost of a pause,
 * which is the whole point: the plan stays a plan, and nothing has to be opened
 * to be understood.
 *
 * ## It never gets in the way
 * `pointer-events: none` — the peek cannot be hovered, so it can never keep
 * itself alive, swallow the click meant for the card underneath, or start a
 * flicker loop by covering its own trigger. It clears on leave, when a room
 * opens, when the plan scrolls under the pointer, and on unmount.
 *
 * ## Not on touch
 * A coarse pointer has no hover: the peek would either never fire, or fire on
 * the tap that already opened the room. Those sessions get nothing.
 *
 * ## Not an accessibility surface
 * It is `aria-hidden` and hover-only. Everything it says is already on the
 * card's own `aria-label` (title, health, note), so a screen reader is not read
 * the same facts twice, and a keyboard user is not shown a card that a keypress
 * cannot dismiss.
 *
 * Positioned with `@floating-ui/react` through a portal, per the house rule:
 * the sheet scrolls inside a clipping host pane, where hand-computed
 * coordinates get cut off at the bottom edge. No `autoUpdate` — the peek clears
 * on scroll rather than following it, so there is nothing to keep in sync.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { FloatingPortal, flip, offset, shift, useFloating } from '@floating-ui/react';
import type { GridVitals } from '../../engine/gridVitals';
import { tone } from '../panelkit';
import { HEALTH_COLOR, HEALTH_WORD, ROOM_ICONS } from './districts';
import { subscribeGrid } from './gridNav';
import { ROOM_CONTEXT } from './roomContext';
import { ROOMS, type RoomId } from './rooms';

/** Long enough that crossing the plan does not flash cards at you, short
 *  enough that a deliberate rest on one card feels like an answer. */
export const PEEK_DELAY_MS = 230;

/** Touch and pen. Absent `matchMedia` (an older host, a test environment) is
 *  treated as a fine pointer — the same reading the room page's motion check
 *  makes of an absent media query. */
function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** The card the pointer is resting on, and which room it is. */
interface PeekAnchor {
  id: RoomId;
  el: HTMLElement;
}

/** What a room card spreads to raise (and drop) its own peek. */
export interface PeekHandlers {
  onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
}

/**
 * The peek, as one hook: hand each room card `handlers(id)`, and render `peek`
 * once anywhere in the tree (it portals out regardless).
 *
 * Takes the vitals SNAPSHOT the sheet already subscribed to rather than
 * subscribing again — the peek and the card underneath it must never be able to
 * quote two different readings of the same room.
 */
export function useRoomPeek(vitals: GridVitals): {
  handlers: (id: RoomId) => PeekHandlers;
  peek: JSX.Element | null;
} {
  const [anchor, setAnchor] = useState<PeekAnchor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setAnchor((current) => (current === null ? current : null));
  }, []);

  // A peek belongs to the pointer that raised it, so it dies with the moment:
  // a room opening under it (the plan is gone), the plan scrolling beneath it
  // (the card it points at has moved), and the sheet unmounting.
  useEffect(() => {
    const onScroll = (): void => clear();
    // Capture: the plan scrolls inside the panel's own box, and a scroll event
    // there does not bubble to the window.
    window.addEventListener('scroll', onScroll, true);
    const unsubscribe = subscribeGrid(clear);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      unsubscribe();
      clear();
    };
  }, [clear]);

  const { refs, floatingStyles } = useFloating({
    open: anchor !== null,
    elements: { reference: anchor?.el ?? null },
    placement: 'bottom-start',
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
  });

  const handlers = useCallback(
    (id: RoomId): PeekHandlers => ({
      onMouseEnter: (event) => {
        if (isCoarsePointer()) return;
        // Read now: `currentTarget` is only valid for the life of the dispatch.
        const el = event.currentTarget;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          setAnchor({ id, el });
        }, PEEK_DELAY_MS);
      },
      onMouseLeave: clear,
    }),
    [clear]
  );

  const vital = anchor ? vitals[anchor.id] : null;
  const peek =
    anchor && vital ? (
      <FloatingPortal>
        <div
          ref={refs.setFloating}
          className="apk-enter"
          data-testid="grid-room-peek"
          data-room={anchor.id}
          data-health={vital.health}
          aria-hidden
          style={{
            ...floatingStyles,
            // The one rule that makes this safe rather than clever.
            pointerEvents: 'none',
            zIndex: 50,
            width: 244,
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${tone.borderStrong}`,
            background: tone.surface2,
            boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
            color: tone.text,
            font: `13px/1.5 ${tone.font}`,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              className="material-symbols-outlined"
              aria-hidden
              style={{ fontSize: 14, lineHeight: 1, flex: 'none', color: HEALTH_COLOR[vital.health] }}
            >
              {ROOM_ICONS[anchor.id]}
            </span>
            <span
              data-testid="grid-room-peek-title"
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12.5,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {ROOMS[anchor.id].title}
            </span>
            <span
              data-testid="grid-room-peek-health"
              style={{ flex: 'none', fontSize: 10.5, color: HEALTH_COLOR[vital.health] }}
            >
              {HEALTH_WORD[vital.health]}
            </span>
          </span>
          {/* Absent, not blank — the sheet's honesty rule, kept here too: a
              room whose source has not answered shows no note at all. */}
          {vital.note ? (
            <span
              data-testid="grid-room-peek-note"
              style={{ fontSize: 11.5, color: tone.text2, fontVariantNumeric: 'tabular-nums' }}
            >
              {vital.note}
            </span>
          ) : null}
          <span data-testid="grid-room-peek-context" style={{ fontSize: 11.5, color: tone.text3 }}>
            {ROOM_CONTEXT[anchor.id]}
          </span>
        </div>
      </FloatingPortal>
    ) : null;

  return { handlers, peek };
}
