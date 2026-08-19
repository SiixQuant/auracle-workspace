/**
 * The desk's own commands, in the Grid's palette.
 *
 * The browser conversation offers these on `/`; this is the same list on the
 * desktop, read from the same place — the engine. Neither surface holds it.
 *
 * ★ NOTHING IN THE PALETTE HAD TO CHANGE. It asks a registry, the registry
 * asks providers, and this is a provider. That seam was built for exactly this
 * and it is why a whole second surface arrives without the palette learning
 * anything about the desk.
 *
 * WHAT RUNNING ONE DOES, and how it differs from the browser. There, choosing
 * a command sends it. Here it PREFILLS a new agent session and the person
 * presses Send — `launchAgentSession` never auto-submits, and that is the
 * host's deliberate design rather than something to work around. The desktop
 * is where you edit the question before asking it; the browser is where you
 * ask it. Same list, same words, one honest difference in tempo.
 *
 * It dispatches through the AI action lane rather than calling the host
 * directly, because that lane is where outcomes are already reported — the
 * plan's strip reads the run store, so a hand-off that failed says so in the
 * place people already look.
 */
import { registerAiExecutor, requestAiAction, type ActionIntent } from './gridAiActions';
import { agentSessionHost } from './gridAiExecutors';
import { registerCommandProvider, type GridCommand } from './gridCommands';
import { deskCatalogue, runnableDeskCommands, type DeskCommand } from '../../engine/deskCatalogue';
import type { RoomId } from './rooms';

const OPERATION = 'desk.ask';

/**
 * Which room a desk command reads as, on this surface only.
 *
 * The engine does not carry this and should not: rooms are the IDE's furniture
 * and the browser has none. An action must name a room, so the ones that are
 * plainly about a room say so and everything else files under the control room
 * — which is where desk-wide work belongs anyway.
 *
 * A command the engine adds later that is not listed here still works; it just
 * files under `ops` until somebody decides it belongs elsewhere. That is the
 * right failure: a new command appears, rather than being dropped for want of
 * a mapping.
 */
const ROOM_FOR: Record<string, RoomId> = {
  running: 'deploys',
  activity: 'blotter',
  problems: 'incidents',
  analysis: 'backtest',
  strategies: 'strategies',
  data: 'catalog',
  ideas: 'findings',
  health: 'ops',
};

function roomFor(id: string): RoomId {
  return ROOM_FOR[id] ?? 'ops';
}

function intentFor(command: DeskCommand): ActionIntent {
  return {
    operation: OPERATION,
    room: roomFor(command.id),
    summary: `Ask the agent: ${command.hint}.`,
    // The question itself is the payload, shown in full. Nobody should have to
    // guess what a command is about to ask on their behalf.
    fields: [
      { label: 'Command', value: `/${command.id}` },
      { label: 'Question', value: command.prompt ?? '' },
    ],
  };
}

/**
 * One executor for every desk command — the operation is the same, only the
 * question differs. Registering one per command would put the engine's list
 * into this file, which is the thing being undone.
 */
registerAiExecutor(OPERATION, async (intent) => {
  const question = intent.fields.find((f) => f.label === 'Question')?.value ?? '';
  if (!question) {
    return { kind: 'failed', note: 'That command carries no question. Nothing was sent.' };
  }

  const host = agentSessionHost();
  // Feature-detected: an older host has no agent lane at all, which is a
  // different fact from a hand-off that failed. It reads as pending wiring.
  if (!host?.launchAgentSession) {
    return {
      kind: 'not-wired',
      operation: intent.operation,
      note: 'This build cannot hand off to the agent — update the IDE. Nothing was sent.',
    };
  }

  const result = await host.launchAgentSession(question, {
    title: intent.fields.find((f) => f.label === 'Command')?.value ?? 'Ask the desk',
  });
  if (!result.ok) {
    return { kind: 'failed', note: result.error ?? 'The agent hand-off failed.' };
  }
  // Dispatch, not delivery: the question is sitting in a session, unsent.
  return {
    kind: 'done',
    note: 'Agent session started with the question. Review it and press Send — nothing has been asked yet.',
  };
});

/**
 * The rows. Read at call time, so a catalogue that arrives after the palette
 * first opened is picked up on the next read rather than needing a reload.
 */
const deskProvider = {
  id: 'desk-commands',
  list(): GridCommand[] {
    return runnableDeskCommands().map((command) => ({
      id: `desk.${command.id}`,
      // The label reads as the command is typed elsewhere, so the same thing
      // is called the same name on both surfaces.
      label: `/${command.id} — ${command.label}`,
      icon: 'chat',
      keywords: [command.id, command.label, command.hint, command.utility],
      section: 'Ask the desk',
      // These hand work to the assistant; the mark says so on the row itself,
      // because the heading scrolls away while the rows are still on screen.
      badge: 'AI',
      run: () => {
        void requestAiAction({
          id: `desk.${command.id}`,
          class: 'draft',
          room: roomFor(command.id),
          label: command.label,
          icon: 'chat',
          intent: intentFor(command),
        });
      },
    }));
  },
};

registerCommandProvider(deskProvider);

/** Why the section is empty, when it is. Surfaced by the palette so an engine
 *  that predates the route does not read as a desk with nothing to offer. */
export function deskCommandsNote(): string | null {
  switch (deskCatalogue().status) {
    case 'ready':
      return null;
    case 'outdated':
      return 'This engine is too old to list the desk’s commands — update it.';
    case 'unreachable':
      return 'The desk’s commands could not be read from the engine.';
    case 'unread':
      return null;
  }
}
