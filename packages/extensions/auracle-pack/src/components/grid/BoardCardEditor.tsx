/**
 * The inline editor — the whole of configuring a card, on the Board.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: configuring something never navigates.
 * Describing a provider, keying it, writing a question, cutting a wire and
 * removing a card all happen here, anchored to the card being edited, with the
 * Board still on screen behind it. Nothing in this module imports the router;
 * full pages remain for reading an artifact, never for setting one up.
 *
 * ## Anchored rather than expanded, and why
 * The card could have grown in place. It does not, for one concrete reason: the
 * Board's cards are laid out at a KNOWN box ({@link ./boardLayout}) and its
 * wires are routed against those boxes. A card that changed height under an
 * open editor would move every wire on the plane while somebody was typing. So
 * the editor floats beside the card in the peek's visual language — same
 * surface, same border, same shadow — and the arrangement behind it holds
 * still. Unlike the peek it is interactive, so it takes pointer events, closes
 * on Escape, and closes when a click lands outside it.
 *
 * ## Every keystroke is a write, and the secret is not
 * Field edits go straight through `boardGraphStore.updateNode`, which is the
 * canvas's one truth and carries them to the settings lane on its own debounce.
 * There is no Save button for them and no local draft to lose.
 *
 * The SECRET is the exception, and deliberately: it is the one value that never
 * enters the graph. It is typed into an input that is never seeded from
 * anything, posted to the engine's vault by name, and cleared on the way out.
 * What comes back — and all that is ever shown — is whether the slot HOLDS
 * something. There is no way to read a stored secret back through this surface,
 * because there is no way to read one back at all.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import type { BoardDeletePlan, BoardGraph, BoardNode } from '../../engine/boardGraph';
import { boardGraphStore } from '../../engine/boardGraphStore';
import { isBuiltInNode } from '../../engine/boardBuiltins';
import {
  clearCredentialSecret,
  credentialSlotState,
  putCredentialSecret,
  saveBoardSource,
  CONNECTOR_KINDS,
  CONNECTOR_KIND_LABEL,
  isConnectorKind,
  type CredentialSlot,
} from '../../engine/boardSources';
import { Button, tone } from '../panelkit';
import { deleteSentence } from './boardCards';
import { kindWord } from './BoardCard';

/* ── small parts ─────────────────────────────────────────────────────────── */

const LABEL: CSSProperties = { fontSize: 11.5, fontWeight: 500, color: tone.text2 };

const INPUT: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 6,
  fontSize: 12.5,
  border: `1px solid ${tone.borderStrong}`,
  background: tone.sunken,
  color: tone.text,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

function EditorField({
  label,
  testId,
  value,
  placeholder,
  onChange,
  onBlur,
  type = 'text',
  autoComplete,
}: {
  label: string;
  testId: string;
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  type?: 'text' | 'password';
  autoComplete?: string;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={LABEL}>{label}</span>
      <input
        className="apk-input"
        style={INPUT}
        type={type}
        autoComplete={autoComplete}
        data-testid={testId}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </label>
  );
}

/** A line the editor says back to the person — the engine's own words when it
 *  spoke, never a code, and never a claim the engine did not make. */
function StatusLine({ testId, text, kind }: { testId: string; text: string; kind: 'ok' | 'err' | 'quiet' }): JSX.Element {
  const color = kind === 'err' ? tone.danger : kind === 'ok' ? tone.text2 : tone.text3;
  return (
    <span data-testid={testId} role={kind === 'err' ? 'alert' : 'status'} style={{ fontSize: 11, color }}>
      {text}
    </span>
  );
}

/* ── the editor ──────────────────────────────────────────────────────────── */

export interface BoardCardEditorProps {
  node: BoardNode;
  graph: BoardGraph;
  /** The card this editor belongs to — what it is positioned against, and what
   *  a click may land on without dismissing it. */
  anchor: HTMLElement;
  onClose: () => void;
  /** Raised after a card is removed, so the Board can drop the editor and say
   *  what was kept. */
  onDeleted: (plan: BoardDeletePlan) => void;
}

export function BoardCardEditor({
  node,
  graph,
  anchor,
  onClose,
  onDeleted,
}: BoardCardEditorProps): JSX.Element {
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    open: true,
    elements: { reference: anchor },
    placement: 'right-start',
    // The board underneath can be panned and zoomed while this is open, and the
    // editor belongs to a CARD rather than to a spot on the screen. autoUpdate
    // is also what makes the FIRST placement land: the anchor exists before the
    // editor is measured, so without it the one computed position is the one
    // taken before there was a box to place.
    whileElementsMounted: autoUpdate,
    // Beside the card where there is room, and never off the pane where there
    // is not: a narrow panel has no space to the right of a card that is nearly
    // as wide as the panel, and a tall editor on a short one would otherwise
    // run off the bottom. Both axes shift, so the editor stays reachable
    // instead of being technically placed somewhere nobody can see.
    middleware: [
      offset(12),
      flip({ padding: 12, crossAxis: true }),
      shift({ padding: 12, crossAxis: true }),
    ],
  });

  // Escape, and a click on anything that is neither the editor nor the card it
  // belongs to. Both close; neither saves, because every field already did.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (floatingRef.current?.contains(target)) return;
      if (anchor.contains(target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [anchor, onClose]);

  return (
    <FloatingPortal>
      <div
        ref={(el) => {
          floatingRef.current = el;
          refs.setFloating(el);
        }}
        className="apk-enter"
        data-testid="board-editor"
        data-node={node.id}
        data-kind={node.kind}
        role="dialog"
        aria-label={`Configure ${kindWord(node.kind).toLowerCase()}`}
        style={{
          ...floatingStyles,
          zIndex: 60,
          // Narrower than the pane, whatever the pane is: the editor is a
          // surface a person types into, not a sheet that covers the board.
          width: 'min(320px, calc(100vw - 24px))',
          maxHeight: 'min(80vh, 620px)',
          boxSizing: 'border-box',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '12px 14px 14px',
          borderRadius: 10,
          border: `1px solid ${tone.borderStrong}`,
          background: tone.surface2,
          boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
          color: tone.text,
          font: `13px/1.5 ${tone.font}`,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: tone.text2 }}>
            {kindWord(node.kind)}
          </span>
          <button
            type="button"
            data-testid="board-editor-close"
            aria-label="Close"
            onClick={onClose}
            style={{
              appearance: 'none',
              border: 0,
              background: 'transparent',
              color: tone.text3,
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
            }}
          >
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 16 }}>
              close
            </span>
          </button>
        </header>

        {node.kind === 'source' ? <SourceFields node={node} /> : null}
        {node.kind === 'research' ? <ResearchFields node={node} /> : null}
        {node.kind !== 'source' && node.kind !== 'research' ? (
          <StatusLine
            testId="board-editor-readonly"
            kind="quiet"
            text="This card was written by the system. Its settings live with the work that produced it."
          />
        ) : null}

        <WireList node={node} graph={graph} />
        <DeleteRow node={node} onDeleted={onDeleted} />
      </div>
    </FloatingPortal>
  );
}

/* ── source ──────────────────────────────────────────────────────────────── */

function SourceFields({ node }: { node: BoardNode }): JSX.Element {
  const source = node.source ?? { name: '', connectorKind: '', endpoint: '', payloadType: '' };
  const slot = source.credentialSlot ?? '';
  const [connectState, setConnectState] = useState<{ text: string; kind: 'ok' | 'err' | 'quiet' } | null>(
    null
  );
  const [connecting, setConnecting] = useState(false);

  const patch = (next: Partial<typeof source>): void => {
    boardGraphStore.updateNode(node.id, { source: next });
  };

  const connect = async (): Promise<void> => {
    setConnecting(true);
    const result = await saveBoardSource({
      id: node.id,
      name: source.name,
      connectorKind: source.connectorKind,
      endpoint: source.endpoint,
      payloadType: source.payloadType,
      credentialSlot: slot === '' ? undefined : slot,
    });
    setConnecting(false);
    setConnectState(
      result.ok
        ? { text: 'Described to the engine. The dot follows what it reads.', kind: 'ok' }
        : {
            text:
              result.message ??
              (result.status === 0
                ? 'The engine did not answer.'
                : `The engine refused this (${result.status}).`),
            kind: 'err',
          }
    );
  };

  return (
    <>
      <EditorField
        label="Name"
        testId="board-editor-name"
        value={source.name}
        placeholder="What you call this source"
        onChange={(value) => patch({ name: value })}
      />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={LABEL}>How it arrives</span>
        <select
          className="apk-input"
          data-testid="board-editor-connector"
          style={{ ...INPUT, cursor: 'pointer' }}
          value={source.connectorKind}
          onChange={(event) => patch({ connectorKind: event.target.value })}
        >
          <option value="">Choose…</option>
          {CONNECTOR_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {CONNECTOR_KIND_LABEL[kind]}
            </option>
          ))}
          {/* A kind this build does not know (an older card, a newer engine) is
              still shown as itself rather than silently reset to blank. */}
          {source.connectorKind !== '' && !isConnectorKind(source.connectorKind) ? (
            <option value={source.connectorKind}>{source.connectorKind}</option>
          ) : null}
        </select>
      </label>
      <EditorField
        label="Where from"
        testId="board-editor-endpoint"
        value={source.endpoint}
        placeholder="URL, host, or folder"
        onChange={(value) => patch({ endpoint: value })}
      />
      <EditorField
        label="What it carries"
        testId="board-editor-payload"
        value={source.payloadType}
        placeholder="bars, filings, news…"
        onChange={(value) => patch({ payloadType: value })}
      />

      <CredentialSection nodeId={node.id} slot={slot} onSlotChange={(value) => patch({ credentialSlot: value })} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button variant="ghost" testId="board-editor-connect" busy={connecting} onClick={() => void connect()}>
          Connect
        </Button>
        {isBuiltInNode(node.id) ? (
          <StatusLine testId="board-editor-builtin" kind="quiet" text="Keyless — ready as it is." />
        ) : null}
      </div>
      {connectState ? (
        <StatusLine testId="board-editor-connect-state" kind={connectState.kind} text={connectState.text} />
      ) : null}
    </>
  );
}

/**
 * The key: a name for the slot, a box to type the secret into once, and the
 * only thing this surface will ever tell anyone about it afterwards — whether
 * something is in there.
 */
function CredentialSection({
  nodeId,
  slot,
  onSlotChange,
}: {
  nodeId: string;
  slot: string;
  onSlotChange: (next: string) => void;
}): JSX.Element {
  // Never seeded from a fetch, cleared the instant the write lands: the value
  // exists in this component for exactly as long as it takes to post it.
  const [secret, setSecret] = useState('');
  const [state, setState] = useState<CredentialSlot | null>(null);
  const [unknown, setUnknown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; kind: 'ok' | 'err' | 'quiet' } | null>(null);

  const read = useCallback(async (name: string): Promise<void> => {
    if (name === '') {
      setState(null);
      setUnknown(false);
      return;
    }
    const answered = await credentialSlotState(name);
    setState(answered);
    setUnknown(answered === null);
  }, []);

  // The slot the editor opened on, read through a ref so a keystroke in the
  // slot field does not fire a request per character — typing re-reads on blur
  // instead. Effect keyed on the CARD, because a slot's state belongs to the
  // slot rather than to the editor session.
  const opened = useRef(slot);
  opened.current = slot;
  useEffect(() => {
    void read(opened.current);
  }, [nodeId, read]);

  const store = async (): Promise<void> => {
    setBusy(true);
    const result = await putCredentialSecret(slot, secret);
    setBusy(false);
    if (result.ok) {
      // The one value the pack ever holds, dropped as soon as it is sent.
      setSecret('');
      setState(result.slot);
      setUnknown(result.slot === null);
      setNote({ text: 'Stored. It cannot be read back from here.', kind: 'ok' });
      return;
    }
    setNote({
      text: result.message ?? (result.status === 0 ? 'The engine did not answer.' : `Refused (${result.status}).`),
      kind: 'err',
    });
  };

  const clear = async (): Promise<void> => {
    setBusy(true);
    const result = await clearCredentialSecret(slot);
    setBusy(false);
    if (result.ok) {
      setState({ name: slot, set: false, updatedAt: null });
      setUnknown(false);
      setNote({ text: 'Slot emptied.', kind: 'ok' });
      return;
    }
    setNote({ text: result.message ?? 'That could not be cleared.', kind: 'err' });
  };

  const stateText = unknown
    ? 'Not asked yet.'
    : slot === ''
      ? 'No slot named — this source needs no key.'
      : state?.set
        ? 'A secret is stored in this slot.'
        : 'No secret stored in this slot.';

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${tone.border}`,
        background: tone.surface,
      }}
    >
      <EditorField
        label="Key slot"
        testId="board-editor-slot"
        value={slot}
        placeholder="name for the vault slot"
        onChange={onSlotChange}
        onBlur={() => void read(slot)}
      />
      <EditorField
        label="Secret"
        testId="board-editor-secret"
        type="password"
        autoComplete="off"
        value={secret}
        placeholder={state?.set ? '(stored — type to replace)' : 'write only'}
        onChange={setSecret}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Button
          variant="quiet"
          testId="board-editor-secret-store"
          busy={busy}
          disabled={slot === '' || secret === ''}
          onClick={() => void store()}
        >
          Store secret
        </Button>
        {state?.set ? (
          <Button variant="quiet" testId="board-editor-secret-clear" busy={busy} onClick={() => void clear()}>
            Clear
          </Button>
        ) : null}
      </div>
      <StatusLine testId="board-editor-secret-state" kind="quiet" text={stateText} />
      {note ? <StatusLine testId="board-editor-secret-note" kind={note.kind} text={note.text} /> : null}
    </section>
  );
}

/* ── research ────────────────────────────────────────────────────────────── */

function ResearchFields({ node }: { node: BoardNode }): JSX.Element {
  const hypothesis = node.research?.hypothesis ?? '';
  return (
    <>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={LABEL}>The question, in plain words</span>
        <textarea
          className="apk-input"
          data-testid="board-editor-hypothesis"
          rows={5}
          style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }}
          value={hypothesis}
          placeholder="What do you think is true, and what would show it?"
          onChange={(event) =>
            boardGraphStore.updateNode(node.id, { research: { hypothesis: event.target.value } })
          }
        />
      </label>
      {/* The verb this card will eventually carry, present and honest about
          not being wired yet — the later change drops its handler in here and
          on the card's own row, and nothing around it has to move. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button
          variant="ghost"
          testId="board-editor-scan"
          disabled
          title="wires to the engine in a later change"
        >
          Scan for evidence
        </Button>
        <StatusLine testId="board-editor-scan-note" kind="quiet" text="Wires to the engine in a later change." />
      </div>
    </>
  );
}

/* ── wires ───────────────────────────────────────────────────────────────── */

function WireList({ node, graph }: { node: BoardNode; graph: BoardGraph }): JSX.Element | null {
  const [refusal, setRefusal] = useState<string | null>(null);
  const touching = graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id);
  if (touching.length === 0) return null;

  const nameOf = (id: string): string => {
    const other = graph.nodes.find((row) => row.id === id);
    if (!other) return 'a card';
    if (other.kind === 'source') return other.source?.name || 'unnamed source';
    if (other.kind === 'research') return (other.research?.hypothesis || 'a question').split('\n')[0];
    return other.label || other.ref?.kind || other.kind;
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 5 }} data-testid="board-editor-wires">
      <span style={LABEL}>Wires</span>
      {touching.map((edge) => {
        const otherId = edge.from === node.id ? edge.to : edge.from;
        const direction = edge.from === node.id ? 'to' : 'from';
        return (
          <div key={edge.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 11.5,
                color: tone.text3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {direction} {nameOf(otherId)}
            </span>
            <Button
              variant="quiet"
              testId={`board-wire-cut-${edge.id}`}
              onClick={() => {
                const result = boardGraphStore.unwire(edge.id);
                setRefusal(result.ok ? null : result.reason);
              }}
            >
              Cut
            </Button>
          </div>
        );
      })}
      {refusal ? <StatusLine testId="board-wire-refusal" kind="err" text={refusal} /> : null}
    </section>
  );
}

/* ── delete ──────────────────────────────────────────────────────────────── */

function DeleteRow({
  node,
  onDeleted,
}: {
  node: BoardNode;
  onDeleted: (plan: BoardDeletePlan) => void;
}): JSX.Element {
  const [plan, setPlan] = useState<BoardDeletePlan | null>(null);

  if (plan === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: `1px solid ${tone.border}`, paddingTop: 10 }}>
        <Button
          variant="danger"
          testId="board-editor-delete"
          // The PLAN first, always: the confirm has to be able to state what
          // stays behind, and only the store can say.
          onClick={() => setPlan(boardGraphStore.previewDelete(node.id))}
        >
          Remove card
        </Button>
      </div>
    );
  }

  return (
    <section
      data-testid="board-delete-confirm"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '9px 10px',
        borderRadius: 8,
        border: `1px solid color-mix(in srgb, ${tone.danger} 40%, transparent)`,
        background: tone.surface,
      }}
    >
      <span data-testid="board-delete-detail" style={{ fontSize: 11.5, color: tone.text2 }}>
        {deleteSentence(plan, kindWord(node.kind))}
      </span>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="quiet" testId="board-delete-cancel" onClick={() => setPlan(null)}>
          Keep it
        </Button>
        <Button
          variant="danger"
          testId="board-delete-apply"
          onClick={() => onDeleted(boardGraphStore.deleteNode(node.id))}
        >
          Remove
        </Button>
      </div>
    </section>
  );
}
