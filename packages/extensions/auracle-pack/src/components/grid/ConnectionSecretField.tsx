/**
 * The connection secret paste — the one write-only input a keyed connect asks
 * for, and write-only in earnest.
 *
 * It mirrors {@link ./CredentialPaste}: a secret cannot travel through an agent
 * tool, so `connect_source` arms a pending connection and the panel shows THIS
 * field for the person to fill. The value is held in component state only long
 * enough to post it, then cleared; it is never read back, never masked-previewed,
 * never logged. The difference from CredentialPaste is only the transport — it
 * writes straight to the connections registry (`POST /ui/api/connections/{id}/save`
 * with the one field the tool named), the same seam the connect sheet uses — and
 * that it clears the pending signal on success, so the field appears only while a
 * connect is pending and then vanishes.
 */
import { useCallback, useState } from 'react';

import { bumpConnectGeneration, postJson } from '../../engine/client';
import { clearPendingConnection } from '../../engine/connectionTools';
import { ensurePanelKitStyles, tone } from '../panelkit';
import { GRID_ACCENT } from './gridTheme';

const STYLE_ID = 'auracle-connsecret-styles';

const SHEET = `
.auracle-connsecret { display: flex; flex-direction: column; gap: 7px; padding: 11px 13px; border: 1px solid ${tone.border}; border-radius: 10px; background: ${tone.surface}; }
.auracle-connsecret__head { display: flex; align-items: baseline; gap: 8px; }
.auracle-connsecret__name { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 600; color: ${tone.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.auracle-connsecret__state { flex: none; font-size: 10px; font-weight: 600; letter-spacing: 0.02em; color: ${tone.text3}; }
.auracle-connsecret__ask { margin: 0; font-size: 11.5px; color: ${tone.text2}; }
.auracle-connsecret__row { display: flex; gap: 8px; }
.auracle-connsecret__field { flex: 1; min-width: 0; font: inherit; font-size: 12px; padding: 6px 9px; border: 1px solid ${tone.border}; border-radius: 7px; background: ${tone.bg}; color: ${tone.text}; }
.auracle-connsecret__field:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.auracle-connsecret__save { flex: none; appearance: none; font: inherit; font-size: 12px; font-weight: 600; padding: 6px 13px; border: 0; border-radius: 7px; background: ${GRID_ACCENT}; color: ${tone.accentInk}; cursor: pointer; }
.auracle-connsecret__save:disabled { opacity: 0.4; cursor: default; }
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

export function ConnectionSecretField({
  id,
  sourceName,
  fieldName,
}: {
  id: string;
  sourceName?: string;
  fieldName: string;
}): JSX.Element {
  ensurePanelKitStyles();
  ensureConnSecretStyles();
  const [secret, setSecret] = useState('');
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const label = sourceName?.trim() || id;

  const onSave = useCallback(async () => {
    if (secret === '' || saving) return;
    setSaving(true);
    setNote(null);
    const res = await postJson(`/ui/api/connections/${id}/save`, { [fieldName]: secret });
    // Cleared the instant it is posted: the value lives in this field for no
    // longer than the request that carries it.
    setSecret('');
    setSaving(false);
    if (res.ok) {
      setNote({ kind: 'ok', text: 'Stored.' });
      // Re-poll every pack surface so the row + hide predicate catch up, and drop
      // the pending signal so this field vanishes — a connect is no longer pending.
      bumpConnectGeneration();
      clearPendingConnection(id);
    } else {
      setNote({
        kind: 'error',
        text: `That did not store (${res.status || 'engine unreachable'}).`,
      });
    }
  }, [secret, saving, id, fieldName]);

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
      <p className="auracle-connsecret__ask">Paste the key for this connection. It is stored write-only.</p>
      <div className="auracle-connsecret__row">
        <input
          className="auracle-connsecret__field"
          data-testid={`connsecret-input-${id}`}
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
          className="auracle-connsecret__save"
          data-testid={`connsecret-save-${id}`}
          disabled={secret === '' || saving}
          onClick={() => void onSave()}
        >
          Store
        </button>
      </div>
      {note ? (
        <p className="auracle-connsecret__note" data-testid={`connsecret-note-${id}`} data-kind={note.kind}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
