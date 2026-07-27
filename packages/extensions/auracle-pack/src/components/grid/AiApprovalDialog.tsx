/**
 * The approval dialog — the one gate a mutation passes through.
 *
 * WHAT IT IS FOR: a person cannot consent to a thing they were not shown. So
 * this dialog does not summarise the action, it QUOTES it: the label as the
 * button read, the operation an executor will be asked for, and the intent's
 * every field, verbatim, in the order the action declared them. If the payload
 * is wrong, it is wrong on screen before anything runs.
 *
 * WHY IT IS ITS OWN COMPONENT: a mutation can be raised from the plan, from a
 * room page, or from the palette, and the ceremony must be identical in all
 * three. It is mounted once, above the router (GridPanel), and driven by the
 * run store — so the surface that raised it does not have to still be showing
 * when it is answered.
 *
 * THE CONTRACT THE NEXT CHANGE BINDS TO: Approve is the point where the
 * engine-side lane mints a confirmation token bound to exactly this payload.
 * That is why `operation` is rendered rather than hidden: the token binds to
 * the operation and its fields, and what was approved has to be legible as the
 * same thing that was executed. Approve here calls the executor with this
 * intent and nothing else.
 *
 * DECLINE IS FREE: it closes and touches nothing. Escape and a press outside
 * mean decline, and the safe control takes focus on open, because a dialog
 * whose default action changes live state is one Enter away from a decision
 * nobody made.
 */
import { useEffect, useRef } from 'react';
import { tint, tone } from '../panelkit';
import { CLASS_PROMISE, CLASS_WORD, type AiAction } from './gridAiActions';

const STYLE_ID = 'auracle-grid-approval-styles';

const SHEET = `
.agrid-ok { position: absolute; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 24px 16px; background: rgba(0, 0, 0, 0.55); }
.agrid-ok__box { display: flex; flex-direction: column; width: 100%; max-width: 460px; max-height: 100%; overflow: hidden; border-radius: 12px; border: 1px solid ${tone.borderStrong}; background: ${tone.surface}; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55); }
.agrid-ok__head { display: flex; flex-direction: column; gap: 6px; padding: 15px 17px 13px; border-bottom: 1px solid ${tone.border}; }
.agrid-ok__class { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; font-size: 10px; font-weight: 700; letter-spacing: 0.11em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; color: ${tone.caution}; border: 1px solid ${tint(tone.caution, 45)}; background: ${tint(tone.caution, 12)}; }
.agrid-ok__title { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: ${tone.text}; }
.agrid-ok__sum { margin: 0; font-size: 12.5px; line-height: 1.55; color: ${tone.text2}; }
.agrid-ok__body { flex: 1; min-height: 0; overflow-y: auto; padding: 13px 17px 15px; display: flex; flex-direction: column; gap: 11px; }
.agrid-ok__cap { font-size: 10px; font-weight: 700; letter-spacing: 0.11em; text-transform: uppercase; color: ${tone.text3}; }
.agrid-ok__fields { display: flex; flex-direction: column; gap: 7px; margin: 0; }
.agrid-ok__field { display: flex; gap: 12px; align-items: baseline; font-size: 12px; }
.agrid-ok__flabel { flex: none; width: 108px; color: ${tone.text3}; }
.agrid-ok__fvalue { flex: 1; min-width: 0; color: ${tone.text}; overflow-wrap: anywhere; }
.agrid-ok__op { font-family: ${tone.mono}; font-size: 11px; color: ${tone.text2}; border: 1px solid ${tone.border}; border-radius: 6px; padding: 4px 8px; align-self: flex-start; }
.agrid-ok__foot { display: flex; align-items: center; gap: 9px; padding: 12px 17px; border-top: 1px solid ${tone.border}; background: ${tone.sunken}; }
.agrid-ok__note { flex: 1; min-width: 0; font-size: 11px; color: ${tone.text3}; }
.agrid-ok__btn { appearance: none; font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 14px; border-radius: 7px; cursor: pointer; }
.agrid-ok__btn:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 1px; }
.agrid-ok__decline { border: 1px solid ${tone.borderStrong}; background: transparent; color: ${tone.text2}; }
.agrid-ok__decline:hover { color: ${tone.text}; border-color: ${tone.accentDim}; }
.agrid-ok__approve { border: 1px solid ${tint(tone.caution, 55)}; background: ${tint(tone.caution, 14)}; color: ${tone.caution}; }
.agrid-ok__approve:hover { background: ${tint(tone.caution, 22)}; }

@container auracle-grid (min-width: 640px) {
  .agrid-ok__box { max-width: 520px; }
}
`;

function ensureApprovalStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** A field label as a stable test hook — "Affects capital" becomes
 *  `affects-capital`, so a test can name the field it cares about. */
export function fieldSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function AiApprovalDialog({
  action,
  onApprove,
  onDecline,
}: {
  action: AiAction;
  onApprove: () => void;
  onDecline: () => void;
}): JSX.Element {
  ensureApprovalStyles();
  const declineRef = useRef<HTMLButtonElement | null>(null);

  // The safe control takes focus, not the one that changes live state.
  useEffect(() => {
    declineRef.current?.focus();
  }, []);

  return (
    <div
      className="agrid-ok"
      data-testid="ai-approval"
      data-action={action.id}
      data-class={action.class}
      role="presentation"
      // Mousedown rather than click: the press outside is the decision, and it
      // is the SAFE decision, so it does not wait for a release.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDecline();
      }}
    >
      <div
        className="agrid-ok__box"
        role="dialog"
        aria-modal="true"
        aria-label={`Approve: ${action.label}`}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          // Stopped here so the room page's own window-level Escape (which
          // leaves for the plan) never fires off the same press.
          event.stopPropagation();
          onDecline();
        }}
      >
        <header className="agrid-ok__head">
          <span className="agrid-ok__class" data-testid="ai-approval-class">
            {CLASS_WORD[action.class]}
          </span>
          <h2 className="agrid-ok__title" data-testid="ai-approval-title">
            {action.label}
          </h2>
          <p className="agrid-ok__sum" data-testid="ai-approval-summary">
            {action.intent.summary}
          </p>
        </header>

        <div className="agrid-ok__body">
          <span className="agrid-ok__cap">Operation</span>
          <span className="agrid-ok__op" data-testid="ai-approval-operation">
            {action.intent.operation}
          </span>

          <span className="agrid-ok__cap">Intent</span>
          {/* Every field the action declared, in its own order and its own
              words. Nothing here is summarised or reordered: what is approved
              has to be readable as the same thing that gets executed. */}
          <dl className="agrid-ok__fields" data-testid="ai-approval-fields">
            {action.intent.fields.map((field, index) => (
              <div
                key={`${field.label}-${index}`}
                className="agrid-ok__field"
                data-testid={`ai-approval-field-${fieldSlug(field.label)}`}
              >
                <dt className="agrid-ok__flabel">{field.label}</dt>
                <dd className="agrid-ok__fvalue">{field.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <footer className="agrid-ok__foot">
          <span className="agrid-ok__note">{CLASS_PROMISE[action.class]}</span>
          <button
            ref={declineRef}
            type="button"
            className="agrid-ok__btn agrid-ok__decline"
            data-testid="ai-approval-decline"
            onClick={onDecline}
          >
            Decline
          </button>
          <button
            type="button"
            className="agrid-ok__btn agrid-ok__approve"
            data-testid="ai-approval-approve"
            onClick={onApprove}
          >
            Approve
          </button>
        </footer>
      </div>
    </div>
  );
}
