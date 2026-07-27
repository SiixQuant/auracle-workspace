/**
 * The sheet's AI strip — the assistant's presence on the plan.
 *
 * It sits along the bottom of the plan and is in exactly one of three states,
 * because a presence that is always saying something is a presence nobody
 * reads:
 *
 *  - PROPOSING. Something is faulted. The strip names it (from the reading's
 *    own subjects where the vital carries them, so it says WHICH deployment
 *    stopped rather than "a deployment"), states the repair plan in the words
 *    the repair itself declares, and offers the two moves a person would make
 *    next: run the repair, or go and look.
 *  - WORKING. Something is executing. One step line, and the actions are held
 *    off until it settles.
 *  - NOMINAL. Nothing is wrong. One quiet line saying it is watching, and no
 *    controls at all.
 *
 * WHY IT NAMES THE FAULT RATHER THAN COUNTING IT: the root node already counts
 * ("2 need attention"). A count tells you to go looking; a name tells you what
 * happened. The strip is the difference between a dashboard and an assistant.
 *
 * NOT THE SAME THING AS THE PINNED ALERT: the wire overlay's chip annotates the
 * MAP — it hangs off the room it is about and draws only at the full tree tier.
 * This proposes a MOVE, and does it at every tier, which is why the two can
 * name the same deployment without either being redundant. Both read the same
 * vital, so they can never name different ones.
 *
 * WHAT IT WILL NOT DO: it never claims an outcome. A settled execution appends
 * the executor's own line — including the honest "pending engine wiring" an
 * unavailable lane returns — and the strip's state goes back to whatever the
 * readings actually say.
 *
 * THE UNDO NEXT TO THE OUTCOME: a repair that landed leaves the engine's own
 * journal id behind, so the strip can offer to put that one action back right
 * where it reported it — which is where a person is standing when they decide
 * it was the wrong call. It is the LAST repair only, and it is offered only
 * while the engine still holds it as reversible. The full history, every entry
 * and every reversal, stays in the Incidents room; this is the one-press
 * version of the row you just created.
 */
import { useState, useSyncExternalStore } from 'react';
import { gridVitals, type GridVitals } from '../../engine/gridVitals';
import { tone } from '../panelkit';
import { DISTRICTS } from './districts';
import {
  aiRunStore,
  dismissAiOutcome,
  repairForRoom,
  requestAiAction,
  resultLine,
} from './gridAiActions';
import { repairUndoStore, undoLastRepair } from './gridAiExecutors';
import { openRoomFocused, zoomOriginFrom } from './gridNav';
// The plan's structural accent (see gridTheme): the assistant's mark belongs
// to the plan's furniture, not to its state. Nothing here carrying state is
// drawn with it — the fault it names stays on the semantic red.
import { GRID_ACCENT, GRID_ACCENT_DIM, GRID_ACCENT_SOFT } from './gridTheme';
import { ROOMS, type RoomId } from './rooms';

const STYLE_ID = 'auracle-grid-aistrip-styles';

const SHEET = `
.agrid-ai { position: sticky; bottom: 0; z-index: 3; display: flex; align-items: flex-start; gap: 11px; padding: 11px 20px 13px; border-top: 1px solid ${tone.border}; background: ${tone.surface}; }
.agrid-ai__mark { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 7px; border: 1px solid ${GRID_ACCENT_DIM}; background: ${GRID_ACCENT_SOFT}; color: ${GRID_ACCENT}; }
.agrid-ai__mark .material-symbols-outlined { font-size: 15px; line-height: 1; }
.agrid-ai__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.agrid-ai__line { margin: 0; font-size: 12.5px; line-height: 1.5; color: ${tone.text}; }
.agrid-ai[data-state='nominal'] .agrid-ai__line { color: ${tone.text3}; }
.agrid-ai__subject { font-weight: 600; color: ${tone.danger}; }
.agrid-ai__plan { margin: 0; font-size: 11.5px; line-height: 1.5; color: ${tone.text2}; }
.agrid-ai__step { margin: 0; font-size: 11.5px; color: ${tone.text3}; font-variant-numeric: tabular-nums; }
.agrid-ai__acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.agrid-ai__btn { appearance: none; font: inherit; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 7px; cursor: pointer; transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out; }
.agrid-ai__btn:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 1px; }
.agrid-ai__btn:disabled { cursor: default; opacity: 0.5; }
.agrid-ai__btn .material-symbols-outlined { font-size: 15px; line-height: 1; }
.agrid-ai__btn--repair { border: 1px solid transparent; background: ${tone.accent}; color: ${tone.accentInk}; }
.agrid-ai__btn--repair:hover:not(:disabled) { background: ${tone.accentHover}; }
.agrid-ai__btn--open { border: 1px solid ${tone.borderStrong}; background: transparent; color: ${tone.text2}; }
.agrid-ai__btn--open:hover:not(:disabled) { color: ${tone.text}; border-color: ${tone.accentDim}; }
.agrid-ai__out { display: flex; align-items: flex-start; gap: 9px; }
.agrid-ai__outtext { margin: 0; flex: 1; min-width: 0; font-size: 11.5px; line-height: 1.5; color: ${tone.text2}; }
.agrid-ai__put { appearance: none; flex: none; border: 0; background: transparent; padding: 2px 4px; border-radius: 5px; color: ${tone.text3}; cursor: pointer; font: inherit; font-size: 11px; }
.agrid-ai__put:hover { color: ${tone.text}; }
.agrid-ai__put:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 1px; }
.agrid-ai__put:disabled { cursor: default; opacity: 0.5; }
.agrid-ai__put--undo { border: 1px solid ${tone.borderStrong}; color: ${tone.text2}; padding: 2px 8px; }
.agrid-ai__put--undo:hover:not(:disabled) { color: ${tone.text}; border-color: ${tone.accentDim}; }
.agrid-ai__undonote { margin: 0; font-size: 11px; line-height: 1.5; color: ${tone.danger}; }

@container auracle-grid (min-width: 1280px) {
  .agrid-ai { padding-inline: 28px; }
}

@media (prefers-reduced-motion: reduce) {
  .agrid-ai__btn { transition: none; }
}
`;

function ensureStripStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** The faulted room the strip speaks about: the first one in the order the
 *  plan is laid out, so the strip and the eye arrive at the same card. */
function firstFault(vitals: GridVitals): RoomId | null {
  for (const district of DISTRICTS) {
    for (const room of district.rooms) {
      if (vitals[room].health === 'fault') return room;
    }
  }
  return null;
}

export function GridAiStrip(): JSX.Element {
  ensureStripStyles();
  const vitals = useSyncExternalStore(
    gridVitals.subscribe,
    gridVitals.getSnapshot,
    gridVitals.getSnapshot
  );
  const run = useSyncExternalStore(
    aiRunStore.subscribe,
    aiRunStore.getSnapshot,
    aiRunStore.getSnapshot
  );
  const reversible = useSyncExternalStore(
    repairUndoStore.subscribe,
    repairUndoStore.getSnapshot,
    repairUndoStore.getSnapshot
  );
  const [undoing, setUndoing] = useState(false);
  const [undoNote, setUndoNote] = useState<string | null>(null);

  const fault = firstFault(vitals);
  const state = run.running !== null ? 'working' : fault !== null ? 'proposing' : 'nominal';
  const repair = fault === null ? null : repairForRoom(fault, vitals);
  const vital = fault === null ? null : vitals[fault];
  const named = vital === null ? [] : vital.subjects;

  return (
    <aside
      className="agrid-ai"
      data-testid="grid-ai-strip"
      data-state={state}
      data-subject={fault ?? undefined}
      aria-label="Auracle Agent"
      aria-live="polite"
    >
      <span className="agrid-ai__mark">
        <span className="material-symbols-outlined" aria-hidden>
          neurology
        </span>
      </span>

      <div className="agrid-ai__body">
        {state === 'working' && run.running ? (
          <>
            <p className="agrid-ai__line" data-testid="grid-ai-strip-line">
              Working on {ROOMS[run.running.room].title}: {run.running.label}.
            </p>
            <p className="agrid-ai__step" data-testid="grid-ai-strip-step">
              {run.step}
            </p>
          </>
        ) : null}

        {state === 'proposing' && fault && vital ? (
          <>
            <p className="agrid-ai__line" data-testid="grid-ai-strip-line">
              <span className="agrid-ai__subject" data-testid="grid-ai-strip-subject">
                {/* The names when the reading carries them, the room and its
                    own note when it does not. Either way this is quoting the
                    reading the plan drew its red dot from. */}
                {named.length > 0 ? named.join(', ') : ROOMS[fault].title}
              </span>{' '}
              needs attention{vital.note ? ` — ${vital.note}` : ''}.
            </p>
            <p className="agrid-ai__plan" data-testid="grid-ai-strip-plan">
              {repair
                ? repair.intent.summary
                : `There is no repair for this one. Open ${ROOMS[fault].title} to see what it is about.`}
            </p>
            <div className="agrid-ai__acts">
              {repair ? (
                <button
                  type="button"
                  className="agrid-ai__btn agrid-ai__btn--repair"
                  data-testid="grid-ai-strip-repair"
                  data-class="repair"
                  data-approval="none"
                  title={repair.intent.summary}
                  onClick={() => void requestAiAction(repair)}
                >
                  <span className="material-symbols-outlined" aria-hidden>
                    {repair.icon}
                  </span>
                  {repair.label}
                </button>
              ) : null}
              <button
                type="button"
                className="agrid-ai__btn agrid-ai__btn--open"
                data-testid="grid-ai-strip-open"
                // No hint: the strip names a ROOM, not a particular strategy
                // or run, so the focus the reader already had is carried in
                // rather than blanked on the way.
                onClick={(event) =>
                  openRoomFocused(fault, undefined, zoomOriginFrom(event.currentTarget))
                }
              >
                Open {ROOMS[fault].title}
              </button>
            </div>
          </>
        ) : null}

        {state === 'nominal' ? (
          <p className="agrid-ai__line" data-testid="grid-ai-strip-line">
            Watching the plan. Nothing needs attention.
          </p>
        ) : null}

        {/* The last outcome, in whichever state the readings put the strip in
            afterwards. Never folded into the line above: what the system IS
            and what was just attempted are two different claims. */}
        {run.outcome ? (
          <div className="agrid-ai__out" data-testid="grid-ai-strip-result" data-result={run.outcome.result.kind}>
            <p className="agrid-ai__outtext">
              {run.outcome.action.label}: {resultLine(run.outcome.result)}
            </p>
            {/* Offered against THIS outcome only: the engine journalled an
                entry for the repair that just ran, and this reverses that one.
                It disappears the moment the engine no longer holds it. */}
            {reversible !== null && reversible.operation === run.outcome.action.intent.operation ? (
              <button
                type="button"
                className="agrid-ai__put agrid-ai__put--undo"
                data-testid="grid-ai-strip-undo"
                disabled={undoing}
                title="Run the engine's recorded inverse for the repair that just ran"
                onClick={() => {
                  setUndoing(true);
                  setUndoNote(null);
                  void undoLastRepair().then((result) => {
                    setUndoing(false);
                    // Only a refusal says anything: a reversal that worked
                    // withdraws the offer, which is the whole message.
                    if (!result.ok) setUndoNote(result.message ?? 'The undo did not go through.');
                  });
                }}
              >
                Undo
              </button>
            ) : null}
            <button
              type="button"
              className="agrid-ai__put"
              data-testid="grid-ai-strip-result-dismiss"
              onClick={() => {
                setUndoNote(null);
                dismissAiOutcome();
              }}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {undoNote ? (
          <p className="agrid-ai__undonote" data-testid="grid-ai-strip-undo-note">
            {undoNote}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
