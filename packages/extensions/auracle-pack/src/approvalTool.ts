/**
 * The seam between the agent and the approval dialog.
 *
 * ## The gap this closes
 *
 * The engine's state-changing tools now answer a call with no stamp by
 * DESCRIBING what they would do. The IDE's agent reaches those tools directly
 * over MCP, so what comes back to it is that description as JSON — and an
 * agent with nowhere to put it will do the obvious thing and print it, leaving
 * a person reading a payload in a chat bubble and no way to say yes.
 *
 * Meanwhile the pack already owns a proper approval dialog: it quotes the
 * action rather than summarising it, the safe control takes focus, and Escape
 * means decline. What was missing was a way for the agent to hand a request TO
 * that dialog.
 *
 * This is that handoff, and it needs nothing from the host. The pack already
 * contributes agent tools; this adds one whose whole job is to take the
 * description the agent just received, put it in front of the person, and wait.
 *
 * ## Why a tool rather than a host-side renderer
 *
 * A renderer would be better — the agent would not have to be told to call
 * anything. But that lives in the host's chat surface, not in an extension,
 * and this works today with the seam that already exists. If the host later
 * grows a tool-result renderer, this becomes the fallback rather than the
 * mechanism, and the contract it speaks does not change.
 *
 * ## What it does NOT do
 *
 * It does not approve anything itself. It raises the dialog and reports what
 * the person decided. Declining is a first-class answer, not an error — the
 * agent needs to be able to tell "they said no" from "it broke", because those
 * lead to completely different next sentences.
 */
import type { ExtensionAITool, ExtensionToolResult } from '@nimbalyst/extension-sdk';
import {
  aiRunStore,
  requestAiAction,
  type AiAction,
  type AiActionResult,
} from './components/grid/gridAiActions';
import { intentFromConfirmation, isEngineConfirmation } from './engine/engineConfirmation';
import { registerEngineConfirmation } from './engine/runApproved';

/** What the person decided, or the fact that they were never asked. */
type Decision = { kind: 'settled'; result: AiActionResult } | { kind: 'declined' } | { kind: 'busy' };

/**
 * Wait for one action to leave the run store.
 *
 * The store settles two different ways and they are not distinguishable from
 * the outcome alone: an approved action ends with an outcome carrying THIS
 * action, while a declined one simply stops being pending and leaves whatever
 * outcome was already there — possibly from an earlier, unrelated run. So the
 * action object's identity is what is matched on, not the presence of an
 * outcome.
 */
function awaitDecision(action: AiAction): Promise<Decision> {
  return new Promise<Decision>((resolve) => {
    const settle = (decision: Decision) => {
      stop();
      resolve(decision);
    };
    const check = () => {
      const state = aiRunStore.getSnapshot();
      if (state.outcome?.action === action) {
        settle({ kind: 'settled', result: state.outcome.result });
        return;
      }
      // No longer waiting and no longer running, without having produced an
      // outcome of its own: the person declined.
      if (state.pending !== action && state.running !== action) {
        settle({ kind: 'declined' });
      }
    };
    const stop = aiRunStore.subscribe(check);
    check();
  });
}

/** The agent-facing answer. Wording matters: it is read aloud to the person. */
function reply(decision: Decision, summary: string): ExtensionToolResult {
  if (decision.kind === 'busy') {
    return {
      success: false,
      error:
        'Something else is already waiting on the desk. Finish that first — two changes ' +
        'running off one conversation is not something anyone can reason about afterwards.',
    };
  }
  if (decision.kind === 'declined') {
    // NOT an error. "They said no" and "it broke" need different next
    // sentences, and an agent that cannot tell them apart will retry a refusal.
    return { success: true, message: `Declined. Nothing happened. (${summary})`, data: { declined: true } };
  }
  const { result } = decision;
  if (result.kind === 'done') return { success: true, message: result.note };
  if (result.kind === 'not-wired') {
    return { success: false, error: `Nothing is wired to carry that out yet. ${result.note}` };
  }
  if (result.kind === 'answered') return { success: true, message: result.text };
  return { success: false, error: result.note };
}

export const approvalAiTools: ExtensionAITool[] = [
  {
    name: 'auracle_ask_before_changing',
    scope: 'global',
    access: { kind: 'filesystem' },
    description:
      'Put a change in front of the person and wait for their answer. Call this when an ' +
      'Auracle engine tool answered with `confirmation_required` instead of doing the work: ' +
      'pass its `action` and `payload` back here EXACTLY as they were returned, unaltered. ' +
      'The person sees what would happen and says yes or no, and this returns what they ' +
      'decided. A decline is a normal answer, not a failure — do not retry it, and do not ' +
      'try to work around it with a different tool.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'The `action` from the confirmation, e.g. `mcp.add_security`.',
        },
        payload: {
          type: 'object',
          description: 'The `payload` from the confirmation, unchanged.',
        },
      },
      required: ['action', 'payload'],
    },
    handler: async (params): Promise<ExtensionToolResult> => {
      const confirmation = {
        confirmation_required: true,
        action: params.action,
        payload: params.payload,
        summary: typeof params.summary === 'string' ? params.summary : '',
        confirm_path: '/confirm',
      };

      // Structural check on the way in. An agent that paraphrased the request
      // instead of passing it through would otherwise raise a dialog quoting
      // something the engine never said.
      if (!isEngineConfirmation(confirmation) || !confirmation.action.startsWith('mcp.')) {
        return {
          success: false,
          error:
            'That is not a confirmation this desk issued. Pass back the `action` and `payload` ' +
            'exactly as the engine tool returned them.',
        };
      }

      const intent = intentFromConfirmation(confirmation);
      const action: AiAction = {
        id: `engine:${confirmation.action}`,
        // The room the adapter placed it in — the dialog's provenance line.
        room: intent.room,
        label: intent.summary,
        // A mutation is the one class that is PARKED for approval rather than
        // run. Any other class here would skip the dialog entirely.
        class: 'mutation',
        icon: 'gpp_maybe',
        intent,
      };

      // Bound to this request, not to the operation in general — two
      // confirmations for one tool carry different payloads.
      const dispose = registerEngineConfirmation(confirmation);
      try {
        // ★ PARK FIRST, THEN WATCH. Subscribing before the action is in the
        // store means the watcher's first look sees "not pending, not
        // running" — which is exactly how a decline reads — and settles as
        // declined before the person has been shown anything.
        //
        // ★ THE RETURN VALUE CANNOT TELL YOU WHETHER IT PARKED.
        // `requestAiAction` resolves null BOTH when it parks a mutation and
        // when it drops the request because something is already in flight.
        // Reading it as success means a second change silently reports
        // "waiting for you" while the dialog is showing the first one, and
        // the agent then waits forever for an answer to a question nobody was
        // asked. The store is the only thing that knows.
        await requestAiAction(action);
        if (aiRunStore.getSnapshot().pending !== action) {
          return reply({ kind: 'busy' }, intent.summary);
        }

        // Safe to watch now: `awaitDecision` also matches an outcome already
        // carrying this action, so a decision taken between these two lines is
        // caught by its first look rather than missed.
        return reply(await awaitDecision(action), intent.summary);
      } finally {
        dispose();
      }
    },
  },
];
