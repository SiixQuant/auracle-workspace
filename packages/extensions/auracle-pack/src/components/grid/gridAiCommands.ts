/**
 * The AI actions, as palette commands.
 *
 * This is the seam the command registry was built for: the palette learns
 * nothing about the assistant, and the assistant does not reach into the
 * palette. It registers a PROVIDER, the provider is asked on every read, and
 * because it answers from the live vitals the rows appear and disappear with
 * the system's state — "Restart the errored deployments" is simply not in the
 * list while nothing is errored, rather than listed and refused.
 *
 * WHY THE ROWS OPEN THE ROOM: an action run from the palette settles somewhere
 * the person cannot see unless they are taken there. Advisory answers render
 * in the room's own bar, a repair's outcome renders there too, and a mutation
 * raises the approval dialog above whatever is showing. So a row navigates
 * first and then requests, which makes one keystroke read as one move. It
 * navigates through the focus spine's own entry point and passes no hint: an
 * AI row names a ROOM, so whatever the reader was already focused on is
 * carried into it, exactly as the rooms provider does it.
 *
 * The class discipline is untouched by the shortcut: `requestAiAction` is the
 * same entry point the room bar uses, so a mutation reached from the palette
 * still parks for approval and still executes nothing until it is approved.
 *
 * Kept apart from `gridAiActions` (the model, a leaf that knows nothing about
 * surfaces) and imported for its side effect by the panel, so registration
 * happens exactly once, as early as the Grid exists.
 */
import { registerCommandProvider, type GridCommandProvider } from './gridCommands';
import { availableActions, requestAiAction } from './gridAiActions';
import { openRoomFocused } from './gridNav';
import { ROOMS } from './rooms';

/** The heading the assistant's rows file under. */
export const AI_SECTION = 'AI actions';

/** The mark every AI row carries, so a command that will act on the system is
 *  never mistaken for a command that merely goes somewhere. */
export const AI_BADGE = 'AI';

const aiProvider: GridCommandProvider = {
  id: 'ai-actions',
  list: ({ vitals }) =>
    availableActions(vitals).map((action) => ({
      id: `ai-${action.id}`,
      label: action.label,
      icon: action.icon,
      keywords: [
        'ai',
        'agent',
        action.class,
        action.room,
        ROOMS[action.room].title,
        ...(action.keywords ?? []),
      ],
      section: AI_SECTION,
      badge: AI_BADGE,
      // Deliberately no `health`: these are actions, not places. The dot in
      // this palette means "this room is unwell", and an action row wearing
      // one would say something about itself that is not true.
      run: () => {
        openRoomFocused(action.room);
        void requestAiAction(action);
      },
    })),
};

registerCommandProvider(aiProvider);
