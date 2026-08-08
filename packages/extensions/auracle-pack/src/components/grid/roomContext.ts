/**
 * What each room is FOR, in one sentence — the Grid's one source of context
 * copy.
 *
 * Two surfaces state a room's purpose: the room page's context line, and the
 * sheet's hover peek. They used to be different strings in different files
 * (the page's own copy, and the registry's `blurb`), which is how two surfaces
 * end up describing the same room differently. This table is now the only
 * declaration: the peek renders it as-is, and a page that has MORE to say
 * appends its own sentence to it rather than restating the first one.
 *
 * Kept a leaf module — it imports the room id type and nothing else — so every
 * surface can read it without dragging the room registry (and through it, every
 * page component) into its import graph.
 */
import type { RoomId } from './rooms';

/** One sentence per room: what lives here, in the house voice. */
export const ROOM_CONTEXT: Record<RoomId, string> = {
  findings: 'Papers the engine scanned and ranked for tradability, strongest first.',
  qc: 'Your linked QuantConnect account.',
  strategies:
    'Every strategy the engine discovered in your workspace, and every file it had to leave out with the reason why.',
  strategy:
    "The focused strategy's performance tearsheet — its return curve against a benchmark, the drawdown beneath it, and the risk and return that summarize the run.",
  backtest:
    'Run a strategy from its file and its curves, headline metrics and overfit check land here.',
  validation:
    'The overfit gates for one strategy, every signal computed by the engine on a real backtest and walk-forward.',
  factors:
    "How much of the focused run's return is genuine alpha versus market and style-factor exposure, read in plain English from the engine's factor regression.",
  deploys: 'Paper and live deployments, and their state.',
  blotter: 'Orders the deployments have sent.',
  incidents: 'What needs attention right now.',
  schedules: 'What runs, and when.',
  runway: 'How far each idea has travelled toward live.',
};
