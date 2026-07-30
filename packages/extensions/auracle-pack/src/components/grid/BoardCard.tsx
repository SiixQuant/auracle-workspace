/**
 * A card on the Board: what it is, how it is doing, and the two gestures it
 * answers — open me, and wire me to something.
 *
 * Drawn in the Grid's own language rather than a second one: the panelkit tone
 * tokens, the health dot and its colour table from {@link ./districts}, the
 * accent reserved for STRUCTURE (a hovered or open card's ring) and never for
 * state, and the same hover peek the Plan's room cards raise.
 *
 * ## The dot says the connections feed, and nothing else
 * A source card's reading comes from the connector registry the pack already
 * polls ({@link ./boardReadings}), so a provider cannot read healthy here and
 * broken in the Connections room. A card whose described source has no live
 * counterpart draws a HOLLOW dot — honest ignorance, not a fault — and says so
 * in words beside it.
 *
 * ## Why the face is a button and the verbs are not inside it
 * Clicking a card opens its editor, so the face has to be a real button: a div
 * with a click handler is not reachable from a keyboard and announces nothing.
 * The verbs (the wire handle, the scan verb and its badge) sit in a row BELOW
 * that button rather than inside it, because a button inside a button is
 * invalid markup and browsers resolve it by dropping one of them.
 *
 * ## Geometry comes from the layout, never from CSS
 * At the canvas tier a card is absolutely positioned at coordinates
 * {@link ./boardLayout} computed; below it, the same markup is an ordinary
 * block in a flowing grid and the coordinates are simply not applied. That is
 * what lets the Board be a plane on a wide pane and a list on a narrow one
 * without two sets of markup.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { FloatingPortal, flip, offset, shift, useFloating } from '@floating-ui/react';
import type { BoardNode } from '../../engine/boardGraph';
import { tint, tone } from '../panelkit';
import { HEALTH_COLOR } from './districts';
import { GRID_ACCENT, GRID_ACCENT_DIM } from './gridTheme';
import { CARD_HEIGHT, CARD_WIDTH, LABEL_BAND, type PlacedCard } from './boardLayout';
import type { CardVerb } from './boardScan';
import { TREE_MIN_WIDTH } from './gridWires';
import {
  cardFullTitle,
  cardNote,
  cardTitle,
  NEUTRAL_READING,
  type CardHealth,
  type CardReading,
} from './boardReadings';

// Distinct from the materialized cards' sheet id: two layers, two
// stylesheets, and an id collision would silently drop one of them.
const STYLE_ID = 'auracle-board-usercard-styles';

/** The icon each kind wears. Only the two a person places are drawn here — the
 *  cards the system writes have their own layer, and their own marks. */
const CARD_ICONS: Record<string, string> = {
  source: 'database',
  research: 'help',
};

/** What a card is called out loud — the peek's heading and the aria label. */
const KIND_WORD: Record<string, string> = {
  source: 'Source',
  research: 'Question',
  quote: 'Live quote',
};

export function kindWord(kind: string): string {
  return KIND_WORD[kind] ?? 'Card';
}

const SHEET = `
.aboard__cards { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
/* THE SECTION LABEL over a rank's column. Quiet by construction — small,
   tracked, in the dimmest text tier — because it is a caption on a group, not
   a thing to read. Only the plane can position it: below the canvas tier the
   cards flow and the coordinate it sits at points at nothing. */
.aboard__col { display: none; }
/* MATERIAL: a card is lifted off the ground rather than outlined on it. One
   step of surface, and a top edge a shade brighter than the other three, as if
   the light came from above the board. No shadow and no gradient — the lift is
   the point, not the effect. */
.acard { display: flex; flex-direction: column; min-width: 0; border-radius: 7px; border: 1px solid ${tone.border}; border-top-color: ${tone.borderStrong}; background: ${tone.surface2}; transition: border-color 150ms ease-out, box-shadow 150ms ease-out, background-color 150ms ease-out; }
.acard:hover { border-color: ${tone.borderStrong}; background: ${tone.surface3}; }
/* Open, or the far end of a wire being drawn: the accent is STRUCTURE — which
   card this gesture is about — never a reading. These two states, the focus
   ring and the waiting badge are the whole of the accent's licence on this
   face; a hover is neutral, because everything the pointer crosses is not
   something the eye should be sent to. */
.acard[data-editing='true'] { border-color: ${GRID_ACCENT_DIM}; box-shadow: 0 0 0 3px ${tint(GRID_ACCENT, 10)}; }
.acard[data-drop='ok'] { border-color: ${GRID_ACCENT}; }
.acard[data-drop='no'] { opacity: 0.45; }
.acard__face { display: flex; flex-direction: column; gap: 5px; min-width: 0; padding: 12px 14px 8px; appearance: none; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.acard__face:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 2px; border-radius: 7px; }
/* Top-aligned, because a title is allowed two lines and a mark centred against
   a box that changes height would drift. */
.acard__top { display: flex; align-items: flex-start; gap: 9px; min-width: 0; }
.acard__ico { flex: none; margin-top: 2px; font-size: 15px; line-height: 1; color: ${tone.text3}; }
/* TWO LINES, then an ellipsis — and \`anywhere\` because the names that overrun
   are single unbroken words, which no ordinary wrap would ever break. The full
   name is on the element's own title and in the peek. */
.acard__title { flex: 1; min-width: 0; font-size: 14px; font-weight: 500; line-height: 1.3; color: ${tone.text}; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.acard__dot { flex: none; margin-top: 5px; width: 7px; height: 7px; border-radius: 50%; }
.acard__dot[data-health='unknown'] { background: transparent; box-shadow: inset 0 0 0 1.5px ${tone.text3}; }
.acard__dot[data-health='nominal'] { background: ${HEALTH_COLOR.nominal}; }
.acard__dot[data-health='degraded'] { background: ${HEALTH_COLOR.degraded}; }
.acard__dot[data-health='fault'] { background: ${HEALTH_COLOR.fault}; }
/* Metadata, a full tier below the title in size, weight and ink — the whole of
   the hierarchy this card needs. */
.acard__note { font-size: 11px; font-weight: 400; line-height: 1.45; color: ${tone.text3}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acard__verbs { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0 12px 10px; }
.acard__verb { display: inline-flex; align-items: center; gap: 5px; appearance: none; font: inherit; font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid ${tone.border}; background: transparent; color: ${tone.text2}; cursor: pointer; }
.acard__verb:hover:not(:disabled) { border-color: ${tone.borderStrong}; color: ${tone.text}; }
.acard__verb:disabled { opacity: 0.45; cursor: default; }
.acard__verb:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.acard__verb .material-symbols-outlined { font-size: 13px; line-height: 1; }
.acard__count { margin-left: auto; font-size: 10.5px; color: ${tone.text3}; white-space: nowrap; }
/* The badge rides ON the verb, because the number is what the verb is about:
   it is how much there is to read, and pressing it is what reads it. The
   accent is STRUCTURE here in the same sense as elsewhere — this is the one
   control on the card with something waiting behind it. */
.acard__badge { display: inline-flex; align-items: center; justify-content: center; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px; font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; background: ${tint(GRID_ACCENT, 22)}; color: ${GRID_ACCENT}; }
/* A stall somebody has to know about, said in words on the card rather than
   left as a verb that quietly does nothing. */
.acard__flag { margin: 0 12px 10px; font-size: 10.5px; line-height: 1.45; color: ${tone.caution}; }

@container auracle-grid (min-width: 640px) {
  .aboard__cards { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
}

@container auracle-grid (min-width: ${TREE_MIN_WIDTH}px) {
  /* The plane. Cards take the coordinates the layout computed, and the box
     takes the arrangement's own extent so the canvas has something to fit. */
  .aboard__cards { display: block; width: var(--aboard-w); height: var(--aboard-h); }
  .acard { position: absolute; width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; }
  /* The band the layout reserved above each column's first card. */
  .aboard__col { position: absolute; top: 0; display: flex; align-items: flex-end; height: ${LABEL_BAND}px; padding-bottom: 7px; font-size: 9.5px; font-weight: 600; line-height: 1; letter-spacing: 0.09em; text-transform: uppercase; color: ${tone.text3}; pointer-events: none; }
}

@media (prefers-reduced-motion: reduce) {
  .acard { transition: none; }
}
`;

export function ensureBoardCardStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** How this card stands in the wire gesture happening right now. */
export type DropState = 'none' | 'ok' | 'no' | 'origin';

export interface BoardCardProps {
  node: BoardNode;
  /** Where the layout put it. */
  card: PlacedCard;
  reading: CardReading;
  /** How many wires touch this card — said in words, because at narrow widths
   *  the overlay that would show them is not drawn. */
  wires: number;
  editing: boolean;
  drop: DropState;
  /** How a question card's verb reads: which word it wears, how much is
   *  waiting behind it, and whether the budget has stopped the loop. Null on
   *  every card that carries no verb. */
  verb?: CardVerb | null;
  /** A dispatch for this card is out. */
  scanning?: boolean;
  onOpen: (node: BoardNode, anchor: HTMLElement) => void;
  onWireStart: (nodeId: string) => void;
  onWireEnd: (nodeId: string) => void;
  onScan?: (nodeId: string) => void;
  onPeek: (node: BoardNode, anchor: HTMLElement) => void;
  onPeekEnd: () => void;
}

function wireCount(n: number, kind: string): string {
  if (n === 0) return kind === 'source' ? 'not wired yet' : 'no sources';
  return n === 1 ? '1 wire' : `${n} wires`;
}

/** The paused-by-budget sentence — one line, in the same words the editor and
 *  the card's own label use, so nobody has to reconcile two phrasings. */
export const BUDGET_PAUSED_LINE =
  'Automatic synthesis is paused: the monthly dispatch budget is spent.';

export function BoardCard({
  node,
  card,
  reading,
  wires,
  editing,
  drop,
  verb,
  scanning = false,
  onOpen,
  onWireStart,
  onWireEnd,
  onScan,
  onPeek,
  onPeekEnd,
}: BoardCardProps): JSX.Element {
  const title = cardTitle(node);
  const note = cardNote(node);
  const icon = CARD_ICONS[node.kind] ?? 'crop_square';
  const waiting = verb && verb.newMaterial !== null && verb.newMaterial > 0 ? verb.newMaterial : 0;
  // Everything the verb row says, on the face's own label: the badge is a
  // number in a pill and the paused line sits below the buttons, and a screen
  // reader gets neither by reading the card's heading.
  const label = [
    `${kindWord(node.kind)}: ${title}`,
    reading.word,
    waiting > 0 ? `${waiting} new ${waiting === 1 ? 'item' : 'items'} waiting` : null,
    verb?.paused ? BUDGET_PAUSED_LINE.replace(/\.$/, '') : null,
    'Configure',
  ]
    .filter((part): part is string => part !== null)
    .join('. ');

  return (
    <div
      className="acard"
      data-testid={`board-card-${node.id}`}
      data-node={node.id}
      data-kind={node.kind}
      data-health={reading.health}
      data-editing={editing ? 'true' : 'false'}
      data-drop={drop === 'none' ? undefined : drop}
      style={{ left: card.x, top: card.y }}
      // The far end of a wire: the release lands on whatever card is under the
      // pointer, and the store decides whether that pairing is allowed.
      onMouseUp={() => onWireEnd(node.id)}
      onMouseEnter={(event: ReactMouseEvent<HTMLElement>) => onPeek(node, event.currentTarget)}
      onMouseLeave={onPeekEnd}
    >
      <button
        type="button"
        className="acard__face"
        data-testid={`board-card-face-${node.id}`}
        aria-label={label}
        onClick={(event) => onOpen(node, event.currentTarget.parentElement ?? event.currentTarget)}
      >
        <span className="acard__top">
          <span className="material-symbols-outlined acard__ico" aria-hidden>
            {icon}
          </span>
          {/* The clamp keeps a long name to two lines; the title attribute is
              where the whole of it stays reachable without one. */}
          <span
            className="acard__title"
            data-testid={`board-card-title-${node.id}`}
            title={cardFullTitle(node)}
          >
            {title}
          </span>
          <span
            className="acard__dot"
            data-testid={`board-card-dot-${node.id}`}
            data-health={reading.health}
            aria-hidden
          />
        </span>
        {note ? (
          <span className="acard__note" data-testid={`board-card-note-${node.id}`}>
            {note}
          </span>
        ) : null}
      </button>
      <div className="acard__verbs">
        {node.kind === 'source' ? (
          <button
            type="button"
            className="acard__verb"
            data-testid={`board-wire-handle-${node.id}`}
            title="Drag to a question to wire this source into it"
            // MOUSE DOWN, not click: this is the start of a drag, and a click
            // would only fire after a release the gesture has already used.
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onWireStart(node.id);
            }}
          >
            <span className="material-symbols-outlined" aria-hidden>
              conversion_path
            </span>
            Wire
          </button>
        ) : null}
        {node.kind === 'research' && verb ? (
          <button
            type="button"
            className="acard__verb"
            data-testid={`board-scan-${node.id}`}
            data-kind={verb.kind}
            // Only a card with nothing written on it, and a card whose dispatch
            // is already out. A PAUSED budget does not disable it: the cap stops
            // the loop from spending on its own, not a person asking for their
            // own evidence.
            disabled={!verb.ready || scanning}
            title={
              verb.ready
                ? 'Open an agent session on the evidence gathered for this question'
                : 'Write the question first'
            }
            onClick={(event) => {
              event.stopPropagation();
              onScan?.(node.id);
            }}
          >
            <span className="material-symbols-outlined" aria-hidden>
              travel_explore
            </span>
            {verb.label}
            {waiting > 0 ? (
              <span className="acard__badge" data-testid={`board-material-${node.id}`} aria-hidden>
                {waiting}
              </span>
            ) : null}
          </button>
        ) : null}
        <span className="acard__count" data-testid={`board-card-wires-${node.id}`}>
          {wireCount(wires, node.kind)}
        </span>
      </div>
      {verb?.paused ? (
        <p className="acard__flag" data-testid={`board-budget-paused-${node.id}`}>
          {BUDGET_PAUSED_LINE}
        </p>
      ) : null}
    </div>
  );
}

/* ── the hover peek ──────────────────────────────────────────────────────── */

/** Long enough that crossing the board does not flash cards, short enough that
 *  a deliberate rest is an answer. The Plan's number, for the same reason. */
export const BOARD_PEEK_DELAY_MS = 230;

interface PeekAnchor {
  node: BoardNode;
  el: HTMLElement;
  reading: CardReading;
  lines: string[];
}

function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Everything the peek says about a card that its one line could not. */
export function peekLines(node: BoardNode): string[] {
  if (node.kind === 'source') {
    const source = node.source;
    return [
      source?.connectorKind ? `Arrives as: ${source.connectorKind}` : 'No connector kind yet',
      source?.endpoint ? `From: ${source.endpoint}` : 'No endpoint yet',
      source?.payloadType ? `Carries: ${source.payloadType}` : 'No payload type yet',
      source?.credentialSlot ? `Key slot: ${source.credentialSlot}` : 'No key slot',
    ];
  }
  if (node.kind === 'research') {
    const text = (node.research?.hypothesis ?? '').trim();
    return text === '' ? ['Nothing written yet.'] : [text];
  }
  return node.ref ? [`${node.ref.kind} ${node.ref.id}`] : [];
}

/**
 * The Board's peek, as one hook — `handlers` on every card, `peek` rendered
 * once. Same contract as the Plan's: `pointer-events: none` so it can never
 * swallow the click meant for the card under it, gone on scroll, gone on
 * unmount, absent on a coarse pointer, and `aria-hidden` because everything it
 * says is already on the card's own label.
 */
export function useBoardPeek(): {
  open: (node: BoardNode, el: HTMLElement, reading: CardReading) => void;
  close: () => void;
  peek: JSX.Element | null;
} {
  const [anchor, setAnchor] = useState<PeekAnchor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setAnchor((current) => (current === null ? current : null));
  }, []);

  useEffect(() => {
    const onScroll = (): void => close();
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      close();
    };
  }, [close]);

  const open = useCallback(
    (node: BoardNode, el: HTMLElement, reading: CardReading): void => {
      if (isCoarsePointer()) return;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        setAnchor({ node, el, reading, lines: peekLines(node) });
      }, BOARD_PEEK_DELAY_MS);
    },
    []
  );

  const { refs, floatingStyles } = useFloating({
    open: anchor !== null,
    elements: { reference: anchor?.el ?? null },
    placement: 'right-start',
    middleware: [
      offset(10),
      flip({ padding: 12, crossAxis: true }),
      shift({ padding: 12, crossAxis: true }),
    ],
  });

  const reading = anchor?.reading ?? NEUTRAL_READING;
  const peek = anchor ? (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        className="apk-enter"
        data-testid="board-peek"
        data-node={anchor.node.id}
        data-health={reading.health}
        aria-hidden
        style={{
          ...floatingStyles,
          pointerEvents: 'none',
          zIndex: 50,
          width: 'min(258px, calc(100vw - 24px))',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          padding: '10px 12px',
          borderRadius: 10,
          border: `1px solid ${tone.borderStrong}`,
          background: tone.surface2,
          boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
          color: tone.text,
          font: `13px/1.5 ${tone.font}`,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            className="material-symbols-outlined"
            aria-hidden
            style={{ fontSize: 14, lineHeight: 1, flex: 'none', color: dotInk(reading.health) }}
          >
            {CARD_ICONS[anchor.node.kind] ?? 'crop_square'}
          </span>
          <span
            data-testid="board-peek-title"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12.5,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {cardTitle(anchor.node)}
          </span>
          <span
            data-testid="board-peek-health"
            style={{ flex: 'none', fontSize: 10.5, color: dotInk(reading.health) }}
          >
            {reading.word}
          </span>
        </span>
        {anchor.lines.map((line, index) => (
          <span
            key={index}
            data-testid="board-peek-line"
            style={{ fontSize: 11.5, color: index === 0 ? tone.text2 : tone.text3 }}
          >
            {line}
          </span>
        ))}
      </div>
    </FloatingPortal>
  ) : null;

  return { open, close, peek };
}

/** The dot's ink. `unknown` borrows the quiet tier: it is not a state, it is
 *  the absence of a reading, and it must not compete with one. */
export function dotInk(health: CardHealth): string {
  return health === 'unknown' ? tone.text3 : HEALTH_COLOR[health];
}
