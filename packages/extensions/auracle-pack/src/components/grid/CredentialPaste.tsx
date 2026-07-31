/**
 * The one surviving input in the whole panel: pasting a key.
 *
 * Every other form is gone — the agent stands up a source and describes the
 * connector itself. The only thing left for a person to type is the secret,
 * because a secret provably cannot travel through an agent tool: it has to be
 * handed in by the one holding it. So this is not a card and not a form, it is
 * a small write-only prompt that appears beside a source the agent set up when
 * that source is still waiting for its key.
 *
 * Write only, and it means it. The value is held in component state only long
 * enough to post it, then cleared; it is never read back, never masked-previewed,
 * never logged. The engine stores it in its own vault and answers, forever
 * after, with state and not value — {@link credentialSlotState} returns whether
 * a slot is set, never what it holds.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  clearCredentialSecret,
  credentialSlotState,
  putCredentialSecret,
  type CredentialSlot,
} from '../../engine/boardSources';
import { ensurePanelKitStyles, tone } from '../panelkit';
import { GRID_ACCENT } from './gridTheme';

const STYLE_ID = 'auracle-credential-paste-styles';

const SHEET = `
.acred { display: flex; flex-direction: column; gap: 7px; padding: 11px 13px; border: 1px solid ${tone.border}; border-radius: 10px; background: ${tone.surface}; }
.acred__head { display: flex; align-items: baseline; gap: 8px; }
.acred__name { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 600; color: ${tone.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acred__state { flex: none; font-size: 10px; font-weight: 600; letter-spacing: 0.02em; color: ${tone.text3}; }
.acred__ask { margin: 0; font-size: 11.5px; color: ${tone.text2}; }
.acred__row { display: flex; gap: 8px; }
.acred__field { flex: 1; min-width: 0; font: inherit; font-size: 12px; padding: 6px 9px; border: 1px solid ${tone.border}; border-radius: 7px; background: ${tone.bg}; color: ${tone.text}; }
.acred__field:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.acred__save { flex: none; appearance: none; font: inherit; font-size: 12px; font-weight: 600; padding: 6px 13px; border: 0; border-radius: 7px; background: ${GRID_ACCENT}; color: ${tone.accentInk}; cursor: pointer; }
.acred__save:disabled { opacity: 0.4; cursor: default; }
.acred__clear { appearance: none; font: inherit; font-size: 11px; align-self: flex-start; padding: 3px 0; border: 0; background: transparent; color: ${tone.text3}; cursor: pointer; text-decoration: underline; }
.acred__note { margin: 0; font-size: 10.5px; }
.acred__note[data-kind='error'] { color: ${tone.danger}; }
.acred__note[data-kind='ok'] { color: ${tone.text3}; }
`;

function ensureCredentialStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; slot: CredentialSlot }
  | { phase: 'unknown' };

export function CredentialPaste({
  slot,
  sourceName,
}: {
  slot: string;
  sourceName?: string;
}): JSX.Element | null {
  ensurePanelKitStyles();
  ensureCredentialStyles();
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [secret, setSecret] = useState('');
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const read = useCallback(() => {
    let live = true;
    void credentialSlotState(slot).then((result) => {
      if (!live) return;
      setState(result ? { phase: 'ready', slot: result } : { phase: 'unknown' });
    });
    return () => {
      live = false;
    };
  }, [slot]);

  useEffect(() => read(), [read]);

  const onSave = useCallback(async () => {
    if (secret === '' || saving) return;
    setSaving(true);
    setNote(null);
    const result = await putCredentialSecret(slot, secret);
    // Cleared the instant it is posted: the value lives in this field for no
    // longer than the request that carries it.
    setSecret('');
    setSaving(false);
    if (result.ok) {
      setNote({ kind: 'ok', text: 'Stored.' });
      setState(result.slot ? { phase: 'ready', slot: result.slot } : { phase: 'loading' });
    } else {
      setNote({ kind: 'error', text: result.message ?? 'That did not store.' });
    }
  }, [secret, saving, slot]);

  const onClear = useCallback(async () => {
    setNote(null);
    const result = await clearCredentialSecret(slot);
    if (result.ok) {
      setState({ phase: 'ready', slot: { name: slot, set: false, updatedAt: null } });
    } else {
      setNote({ kind: 'error', text: result.message ?? 'That did not clear.' });
    }
  }, [slot]);

  if (state.phase === 'loading' || state.phase === 'unknown') return null;

  const stored = state.slot.set;
  const label = sourceName?.trim() || slot;

  return (
    <div className="acred" data-testid={`credential-${slot}`} data-set={stored ? 'set' : 'empty'}>
      <div className="acred__head">
        <span className="acred__name" title={label}>
          {label}
        </span>
        <span className="acred__state" data-testid={`credential-state-${slot}`}>
          {stored ? 'key stored' : 'key needed'}
        </span>
      </div>
      {stored ? (
        <button
          type="button"
          className="acred__clear"
          data-testid={`credential-clear-${slot}`}
          onClick={() => void onClear()}
        >
          Replace or remove the stored key
        </button>
      ) : (
        <>
          <p className="acred__ask">Paste the key for this source. It is stored write-only.</p>
          <div className="acred__row">
            <input
              className="acred__field"
              data-testid={`credential-input-${slot}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secret}
              placeholder="write only"
              aria-label={`Key for ${label}`}
              onChange={(event) => setSecret(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void onSave();
              }}
            />
            <button
              type="button"
              className="acred__save"
              data-testid={`credential-save-${slot}`}
              disabled={secret === '' || saving}
              onClick={() => void onSave()}
            >
              Store
            </button>
          </div>
        </>
      )}
      {note ? (
        <p className="acred__note" data-testid={`credential-note-${slot}`} data-kind={note.kind}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
