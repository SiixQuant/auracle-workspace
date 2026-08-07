/**
 * The connection credential form — the write-only inputs a keyed connect asks
 * for, and write-only in earnest.
 *
 * It mirrors {@link ./CredentialPaste}: a secret cannot travel through an agent
 * tool, so `connect_source` arms a pending connection and the panel shows THIS
 * form for the person to fill. A connector names its own fields (Alpaca wants a
 * key, a secret, and a paper/live mode; Tradier a token and a mode), so the
 * form renders one input per field and hands them all in with a SINGLE save —
 * never one field per round trip through the agent.
 *
 * Each value is held in component state only long enough to post it, then
 * cleared; it is never read back, never masked-previewed, never logged. A blank
 * field is left out of the save entirely, so re-connecting a source and leaving
 * its stored secret untouched keeps that secret rather than wiping it. The form
 * writes straight to the connections registry (`POST
 * /ui/api/connections/{id}/save` with the named fields), the same seam the
 * connect sheet uses, and clears the pending signal on success so it appears
 * only while a connect is pending and then vanishes.
 */
import { useCallback, useState } from 'react';

import { bumpConnectGeneration, postJson } from '../../engine/client';
import { clearPendingConnection, type PendingField } from '../../engine/connectionTools';
import { ensurePanelKitStyles, tone } from '../panelkit';
import { GRID_ACCENT } from './gridTheme';

const STYLE_ID = 'auracle-connsecret-styles';

const SHEET = `
.auracle-connsecret { display: flex; flex-direction: column; gap: 10px; padding: 12px 13px; border: 1px solid ${tone.border}; border-radius: 10px; background: ${tone.surface}; }
.auracle-connsecret__head { display: flex; align-items: baseline; gap: 8px; }
.auracle-connsecret__name { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 600; color: ${tone.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.auracle-connsecret__state { flex: none; font-size: 10px; font-weight: 600; letter-spacing: 0.02em; color: ${tone.text3}; }
.auracle-connsecret__ask { margin: 0; font-size: 11.5px; color: ${tone.text2}; }
.auracle-connsecret__fields { display: flex; flex-direction: column; gap: 9px; }
.auracle-connsecret__field { display: flex; flex-direction: column; gap: 4px; }
.auracle-connsecret__label { font-size: 10.5px; font-weight: 600; letter-spacing: 0.01em; color: ${tone.text2}; }
.auracle-connsecret__req { color: ${tone.danger}; margin-left: 3px; }
.auracle-connsecret__input, .auracle-connsecret__select { width: 100%; box-sizing: border-box; font: inherit; font-size: 12px; padding: 6px 9px; border: 1px solid ${tone.border}; border-radius: 7px; background: ${tone.bg}; color: ${tone.text}; }
.auracle-connsecret__input:focus-visible, .auracle-connsecret__select:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.auracle-connsecret__check { display: flex; align-items: center; gap: 7px; font-size: 12px; color: ${tone.text}; }
.auracle-connsecret__foot { display: flex; align-items: center; gap: 10px; }
.auracle-connsecret__save { flex: none; appearance: none; font: inherit; font-size: 12px; font-weight: 600; padding: 6px 15px; border: 0; border-radius: 7px; background: ${GRID_ACCENT}; color: ${tone.accentInk}; cursor: pointer; }
.auracle-connsecret__save:disabled { opacity: 0.4; cursor: default; }
.auracle-connsecret__safe { flex: 1; min-width: 0; margin: 0; font-size: 10px; color: ${tone.text3}; }
.auracle-connsecret__note { margin: 0; font-size: 10.5px; }
.auracle-connsecret__note[data-kind='error'] { color: ${tone.danger}; }
.auracle-connsecret__note[data-kind='ok'] { color: ${tone.text3}; }
`;

function ensureConnSecretStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** A masked field: a password, or a text field the engine flagged secret. */
function isMasked(field: PendingField): boolean {
  return field.kind === 'password' || field.kind === 'secret' || Boolean(field.sensitive);
}

/** The starting value per field. A select carries its first option so a
 *  required select is satisfied without a click (and paper leads live, the safe
 *  default); every other field starts empty. */
function initialValues(fields: PendingField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    out[field.name] =
      field.kind === 'select' && field.options && field.options.length > 0 ? field.options[0] : '';
  }
  return out;
}

export function ConnectionSecretField({
  id,
  sourceName,
  fields,
}: {
  id: string;
  sourceName?: string;
  fields: PendingField[];
}): JSX.Element {
  ensurePanelKitStyles();
  ensureConnSecretStyles();
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(fields));
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const label = sourceName?.trim() || id;
  // Every required field must carry a value before the form can be stored. A
  // select always has one; a text/password field must be typed.
  const requiredUnmet = fields.some(
    (field) => field.required && (values[field.name] ?? '').trim() === ''
  );
  const canSave = fields.length > 0 && !requiredUnmet && !saving;

  const setField = useCallback((name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const onSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setNote(null);
    // Only non-empty values travel: a blank masked field leaves the stored
    // secret in place rather than overwriting it with nothing.
    const payload: Record<string, string> = {};
    for (const field of fields) {
      const value = values[field.name] ?? '';
      if (value !== '') payload[field.name] = value;
    }
    const res = await postJson(`/ui/api/connections/${id}/save`, payload);
    // Cleared the instant it is posted: a value lives in the form for no longer
    // than the request that carries it.
    setValues(initialValues(fields));
    setSaving(false);
    if (res.ok) {
      setNote({ kind: 'ok', text: 'Stored.' });
      // Re-poll every pack surface so the row + hide predicate catch up, and
      // drop the pending signal so this form vanishes — a connect is no longer
      // pending.
      bumpConnectGeneration();
      clearPendingConnection(id);
    } else {
      setNote({
        kind: 'error',
        text: `That did not store (${res.status || 'engine unreachable'}).`,
      });
    }
  }, [canSave, fields, values, id]);

  const single = fields.length === 1;

  return (
    <div className="auracle-connsecret" data-testid={`connsecret-${id}`}>
      <div className="auracle-connsecret__head">
        <span className="auracle-connsecret__name" title={label}>
          {label}
        </span>
        <span className="auracle-connsecret__state" data-testid={`connsecret-state-${id}`}>
          key needed
        </span>
      </div>
      <p className="auracle-connsecret__ask">
        {single
          ? 'Enter the credential below. It is stored write-only.'
          : 'Enter the credentials below. They are stored write-only.'}
      </p>
      <div className="auracle-connsecret__fields">
        {fields.map((field) => {
          const inputId = `connsecret-input-${id}-${field.name}`;
          const value = values[field.name] ?? '';
          if (field.kind === 'select') {
            const options = field.options && field.options.length > 0 ? field.options : [''];
            return (
              <label className="auracle-connsecret__field" key={field.name}>
                <span className="auracle-connsecret__label">
                  {field.label}
                  {field.required ? <span className="auracle-connsecret__req">*</span> : null}
                </span>
                <select
                  className="auracle-connsecret__select"
                  data-testid={inputId}
                  value={value}
                  aria-label={field.label}
                  onChange={(event) => setField(field.name, event.currentTarget.value)}
                >
                  {options.map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          if (field.kind === 'checkbox') {
            return (
              <label className="auracle-connsecret__check" key={field.name}>
                <input
                  type="checkbox"
                  data-testid={inputId}
                  checked={value === 'true'}
                  aria-label={field.label}
                  onChange={(event) => setField(field.name, event.currentTarget.checked ? 'true' : '')}
                />
                <span>
                  {field.label}
                  {field.required ? <span className="auracle-connsecret__req">*</span> : null}
                </span>
              </label>
            );
          }
          const masked = isMasked(field);
          return (
            <label className="auracle-connsecret__field" key={field.name}>
              <span className="auracle-connsecret__label">
                {field.label}
                {field.required ? <span className="auracle-connsecret__req">*</span> : null}
              </span>
              <input
                className="auracle-connsecret__input"
                data-testid={inputId}
                type={masked ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                value={value}
                placeholder={field.placeholder || (masked ? 'write only' : '')}
                aria-label={field.label}
                onChange={(event) => setField(field.name, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void onSave();
                }}
              />
            </label>
          );
        })}
      </div>
      <div className="auracle-connsecret__foot">
        <button
          type="button"
          className="auracle-connsecret__save"
          data-testid={`connsecret-save-${id}`}
          disabled={!canSave}
          onClick={() => void onSave()}
        >
          {single ? 'Store' : 'Connect'}
        </button>
        <p className="auracle-connsecret__safe">Stored write-only in the engine vault, never in chat.</p>
      </div>
      {note ? (
        <p className="auracle-connsecret__note" data-testid={`connsecret-note-${id}`} data-kind={note.kind}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
