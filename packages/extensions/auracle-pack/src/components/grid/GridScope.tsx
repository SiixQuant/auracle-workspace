/**
 * The inferred-scope line — what the agent understood, said back before it acts.
 *
 * The whole agentic design rests on the agent guessing scope well from a
 * sentence, so it prints that guess where a person can catch it wrong. The
 * line is DISPLAY ONLY: no chips, no click-to-edit, no field. A wrong reading
 * is corrected by saying so in the conversation, and the agent restates its
 * scope in reply — the line updates because the agent changed its mind, never
 * because a control on the line did.
 *
 * The scope the panel can state is the current action's intent summary, which
 * is the agent's own one sentence for what it is about to do. The richer
 * research scope — universe, instrument, horizon — is stated by the agent in
 * the sidebar conversation, which is where the reading is corrected; this line
 * is the panel's echo of it for the work it is actually running.
 */
import type { AiRunState } from './gridAiActions';
import { ensurePanelKitStyles, tone } from '../panelkit';

const STYLE_ID = 'auracle-grid-scope-styles';

const SHEET = `
.ascope { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-left: 2px solid ${tone.border}; }
.ascope__reading { margin: 0; font-size: 12.5px; color: ${tone.text2}; }
.ascope__reading strong { font-weight: 600; color: ${tone.text}; }
.ascope__hint { margin: 0; font-size: 10.5px; color: ${tone.text3}; }
`;

function ensureScopeStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** The agent's stated scope for the work in hand, or none. Pure. */
export function scopeReading(state: AiRunState): string | null {
  const summary = state.running?.intent.summary ?? state.pending?.intent.summary ?? null;
  const trimmed = summary?.trim();
  return trimmed ? trimmed : null;
}

export function GridScope({ state }: { state: AiRunState }): JSX.Element | null {
  ensurePanelKitStyles();
  ensureScopeStyles();
  const reading = scopeReading(state);
  if (reading === null) return null;

  return (
    <div className="ascope" data-testid="grid-scope">
      <p className="ascope__reading" data-testid="grid-scope-reading">
        <strong>Reading this as:</strong> {reading}
      </p>
      {/* An instruction, not a control: the line is corrected by talking, so it
          points at the conversation rather than offering an edit of its own. */}
      <p className="ascope__hint" data-testid="grid-scope-hint">
        Not right? Say so and the agent will read it again.
      </p>
    </div>
  );
}
