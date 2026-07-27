/**
 * The room's AI bar — what the assistant can do about THIS room, right now.
 *
 * ## The class is the affordance
 * A person should be able to tell what a press will cost before making it, so
 * the four authority classes are drawn as four different things rather than as
 * four labels on one button:
 *
 *  - Repair is a filled, one-press control. It puts something back.
 *  - Mutation is drawn in the caution hue and carries an explicit "needs
 *    approval" tag, because pressing it opens the dialog rather than doing the
 *    thing. It can never be a one-press control on any surface.
 *  - Draft is a quiet outline: it produces something to read, nothing more.
 *  - Advisory is the quietest of all and answers in place, underneath the bar.
 *
 * ## Nothing to offer means nothing drawn
 * The bar renders NULL when the room has no available action. An empty AI
 * strip on nine of eleven rooms would train people to ignore the one room
 * where it fills up, which is the room that needed them.
 *
 * ## Where the answers land
 * Outcomes are read from the shared run store and shown only in the room the
 * action belonged to. An advisory reply is rendered whole; a stubbed executor
 * is rendered as pending wiring, in the same neutral ink as everything else,
 * because "not wired yet" is neither a success nor a failure.
 */
import { useSyncExternalStore } from 'react';
import { gridVitals } from '../../engine/gridVitals';
import { tint, tone } from '../panelkit';
import {
  actionsForRoom,
  aiRunStore,
  dismissAiOutcome,
  needsApproval,
  requestAiAction,
  resultLine,
  type AiAction,
} from './gridAiActions';
import type { RoomId } from './rooms';

const STYLE_ID = 'auracle-grid-aibar-styles';

const SHEET = `
.agrid-aibar { display: flex; flex-direction: column; gap: 9px; padding: 12px 14px; border-radius: 10px; border: 1px solid ${tone.border}; background: ${tone.surface}; }
.agrid-aibar__top { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.agrid-aibar__mark { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 700; letter-spacing: 0.11em; text-transform: uppercase; color: ${tone.text3}; }
.agrid-aibar__mark .material-symbols-outlined { font-size: 14px; line-height: 1; }
.agrid-aibar__acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.agrid-aibar__btn { appearance: none; font: inherit; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 7px; padding: 5px 12px; border-radius: 7px; cursor: pointer; transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out; }
.agrid-aibar__btn:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 1px; }
.agrid-aibar__btn:disabled { cursor: default; opacity: 0.5; }
.agrid-aibar__btn .material-symbols-outlined { font-size: 15px; line-height: 1; }
.agrid-aibar__btn[data-class='repair'] { border: 1px solid transparent; background: ${tone.accent}; color: ${tone.accentInk}; }
.agrid-aibar__btn[data-class='repair']:hover:not(:disabled) { background: ${tone.accentHover}; }
.agrid-aibar__btn[data-class='mutation'] { border: 1px solid ${tint(tone.caution, 50)}; background: ${tint(tone.caution, 10)}; color: ${tone.caution}; }
.agrid-aibar__btn[data-class='mutation']:hover:not(:disabled) { background: ${tint(tone.caution, 18)}; }
.agrid-aibar__btn[data-class='draft'] { border: 1px solid ${tone.borderStrong}; background: transparent; color: ${tone.text}; }
.agrid-aibar__btn[data-class='draft']:hover:not(:disabled) { border-color: ${tone.accentDim}; }
.agrid-aibar__btn[data-class='advisory'] { border: 1px solid ${tone.border}; background: transparent; color: ${tone.text2}; font-weight: 500; }
.agrid-aibar__btn[data-class='advisory']:hover:not(:disabled) { color: ${tone.text}; border-color: ${tone.borderStrong}; }
.agrid-aibar__tag { font-size: 9.5px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; border: 1px solid currentColor; opacity: 0.85; }
.agrid-aibar__out { display: flex; align-items: flex-start; gap: 9px; padding-top: 9px; border-top: 1px solid ${tone.border}; }
.agrid-aibar__outtext { flex: 1; min-width: 0; font-size: 12px; line-height: 1.55; color: ${tone.text2}; }
.agrid-aibar__outtext[data-result='answered'] { color: ${tone.text}; }
.agrid-aibar__put { appearance: none; flex: none; border: 0; background: transparent; padding: 2px 4px; border-radius: 5px; color: ${tone.text3}; cursor: pointer; font: inherit; font-size: 11px; }
.agrid-aibar__put:hover { color: ${tone.text}; }
.agrid-aibar__put:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 1px; }
.agrid-aibar__step { font-size: 11.5px; color: ${tone.text3}; }

@media (prefers-reduced-motion: reduce) {
  .agrid-aibar__btn { transition: none; }
}
`;

function ensureAiBarStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** One action, drawn as its class. The approval tag is part of the CONTROL,
 *  not of the dialog it raises: a mutation has to look like a mutation before
 *  it is pressed, not after. */
function ActionButton({
  action,
  busy,
}: {
  action: AiAction;
  busy: boolean;
}): JSX.Element {
  const approval = needsApproval(action);
  return (
    <button
      type="button"
      className="agrid-aibar__btn"
      data-testid={`room-ai-action-${action.id}`}
      data-class={action.class}
      data-approval={approval ? 'required' : 'none'}
      disabled={busy}
      title={action.intent.summary}
      onClick={() => void requestAiAction(action)}
    >
      <span className="material-symbols-outlined" aria-hidden>
        {action.icon}
      </span>
      {action.label}
      {approval ? (
        <span className="agrid-aibar__tag" data-testid={`room-ai-approval-tag-${action.id}`}>
          Needs approval
        </span>
      ) : null}
    </button>
  );
}

export function RoomAiBar({ room }: { room: RoomId }): JSX.Element | null {
  ensureAiBarStyles();
  const vitals = useSyncExternalStore(
    gridVitals.subscribe,
    gridVitals.getSnapshot,
    gridVitals.getSnapshot
  );
  const run = useSyncExternalStore(aiRunStore.subscribe, aiRunStore.getSnapshot, aiRunStore.getSnapshot);

  const actions = actionsForRoom(room, vitals);
  // No empty chrome: a room with nothing to offer says nothing at all.
  if (actions.length === 0) return null;

  const working = run.running !== null;
  const runningHere = run.running?.room === room ? run.running : null;
  const outcome = run.outcome?.action.room === room ? run.outcome : null;

  return (
    <section
      className="agrid-aibar"
      data-testid="room-ai-bar"
      data-room={room}
      data-actions={actions.length}
      aria-label="Auracle Agent actions"
    >
      <div className="agrid-aibar__top">
        <span className="agrid-aibar__mark">
          <span className="material-symbols-outlined" aria-hidden>
            neurology
          </span>
          Auracle Agent
        </span>
        <div className="agrid-aibar__acts">
          {actions.map((action) => (
            <ActionButton key={action.id} action={action} busy={working} />
          ))}
        </div>
      </div>

      {runningHere ? (
        <p className="agrid-aibar__step" data-testid="room-ai-step">
          {run.step}
        </p>
      ) : null}

      {outcome ? (
        <div className="agrid-aibar__out" data-testid="room-ai-outcome" data-result={outcome.result.kind}>
          <p
            className="agrid-aibar__outtext"
            data-testid={outcome.result.kind === 'answered' ? 'room-ai-reply' : 'room-ai-note'}
            data-result={outcome.result.kind}
          >
            {resultLine(outcome.result)}
          </p>
          <button
            type="button"
            className="agrid-aibar__put"
            data-testid="room-ai-outcome-dismiss"
            onClick={() => dismissAiOutcome()}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </section>
  );
}
