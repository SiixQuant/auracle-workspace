/**
 * The Grid's half of the focus spine — what a room transition does to focus,
 * and what the AI chat is told when a room opens.
 *
 * ## The rule: a transition CARRIES focus, a hint FILLS it
 * Focus is a routing identity, not page state: it names the one strategy and
 * the one run the user is looking at (`engine/focusStore`). Moving between
 * rooms does not change what that is — walking from Deployments to Incidents
 * is still about the same deployment, and walking from Findings to Strategies
 * after a draft is still about the same file. So a room open publishes the
 * CURRENT focus with the caller's hint written over it: the hint names the
 * concrete object the room is being opened FOR, and every field it does not
 * name is carried through untouched.
 *
 * That merge is deliberate, and it is the one place the store's
 * replace-don't-merge publish is fed a merged value. It matches what the panels
 * already do for the same reason — a run loaded by id keeps whatever strategy
 * was focused rather than blanking it (`BacktestPanel`) — because dropping half
 * the identity on a navigation would make the chat forget what the run belongs
 * to.
 *
 * ## No second write path
 * Focus is published through `focusStore.publish`, the same call every panel
 * makes, so panel-write precedence and the store's own no-op-on-unchanged still
 * hold. Nothing here debounces: the debounced ambient fallback already lives in
 * `focusStore` and is left alone.
 *
 * ## What the chat is told
 * A room open writes ONE compact descriptor — the room's id and title plus a
 * summary of the focused object — through the host's `setContext` lane, feature
 * detected exactly as `aiPanel` does it, so a host with no AI lane is a silent
 * no-op. It is the FLOOR, not the ceiling: the room's mounted body writes its
 * own richer context a moment later and wins, which is why the write is a
 * layout effect (see {@link useRoomAiContext}).
 */
import { useLayoutEffect } from 'react';
import { focusContext, focusStore, noteFocusAmbientWrite, type Focus } from '../../engine/focusStore';
import type { PanelHostLike } from '../aiPanel';
import type { RoomId } from './rooms';

/**
 * The focus a room should open with: `hint` written over what is already
 * focused. No hint means the focus is unchanged, which is what carries a
 * deployment across `deploys → incidents` and a strategy file across
 * `findings → strategies`.
 */
export function focusForOpen(hint?: Focus): Focus {
  const current = focusStore.getSnapshot();
  if (!hint) return current;
  return { strategy: hint.strategy ?? current.strategy, run: hint.run ?? current.run };
}

/**
 * Publish the opening focus for a room transition. A publish that changes
 * nothing is already a no-op inside the store, so an unhinted jump costs
 * nothing and cannot thrash subscribers.
 */
export function publishRoomFocus(hint?: Focus): void {
  focusStore.publish(focusForOpen(hint));
}

/**
 * The descriptor a room open hands the chat: where the user is, and which
 * concrete object they are looking at. The object half reuses the spine's own
 * {@link focusContext} shape so a strategy or a run reads identically whether
 * the chat heard about it from a room or from the focus fallback.
 */
export function roomAiContext(
  room: RoomId,
  title: string,
  focus: Focus
): Record<string, unknown> {
  return { ...focusContext(focus), panel: 'grid', room, room_title: title };
}

/**
 * Publish the descriptor once per room open, when the host has an AI lane.
 *
 * A LAYOUT effect on purpose. React flushes every layout effect (children
 * before parents) before any passive effect, and a room's body publishes its
 * own context from a passive effect (`useAiPanelContext`). Writing here
 * therefore lays the frame's floor down FIRST and lets the body's richer
 * document overwrite it — a passive effect on this router would land last and
 * flatten a body that already had something better to say (a remounted Backtest
 * room whose run is still loaded).
 *
 * The write also counts as a real panel write, so it cancels any pending
 * focus fallback: the minimal `{ panel: 'focus' }` payload must not land 600ms
 * later and undo a descriptor that says strictly more.
 *
 * `room` is null on the home plan, which writes nothing — the plan is not a
 * concrete object, and clearing would only tell the chat less than it knew.
 */
export function useRoomAiContext(
  host: PanelHostLike | undefined,
  room: RoomId | null,
  title: string | null
): void {
  const ai = host?.ai;
  useLayoutEffect(() => {
    if (!ai || !room) return;
    ai.setContext(roomAiContext(room, title ?? room, focusStore.getSnapshot()));
    noteFocusAmbientWrite();
  }, [ai, room, title]);
}
