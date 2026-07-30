/**
 * The Board — the panel's second face, and the one a new workspace opens on.
 *
 * The Plan draws the platform as it IS: every room, every reading, laid out at
 * uniform depth. The Board draws what a person is WORKING ON: the sources they
 * pointed at, the questions they asked, and the strategies, tests and
 * deployments that materialized out of answering them. Same surface, same
 * canvas, different subject.
 *
 * CANVAS: the same machinery, not a copy of it — {@link useGridCanvas} moves
 * both faces, so a pan, a wheel-zoom, a double-click to refit and the controls
 * in the corner behave identically whichever face is up, and neither can drift
 * from the other. Where the two differ is what they hand the fit: the Plan is a
 * drawing of a known thing and pins itself to a fixed width; the board is
 * whatever a person put on it, so it takes its content's width and the fit
 * scales THAT — an empty board therefore sits at 1:1 rather than being shrunk
 * to fill a frame it never asked for.
 *
 * TIERS: `@container`, never `@media`, for the reason the Plan gives — the
 * panel's width has nothing to do with the window's. Three of them, mobile
 * first: one stacked column; the empty state's slots in a row once there is
 * room; and the canvas engaged at the same {@link TREE_MIN_WIDTH} the Plan
 * switches to its tree at. Below that the board is an ordinary scrolling column
 * of cards and the wire overlay is not drawn, because the coordinates it routes
 * against are only true on the plane.
 *
 * EMPTY STATE: three ghost slots, and they are the onboarding. Two name the
 * only moves a person makes — point it at something to read, ask it something —
 * and they now PERFORM those moves: pressing one lays a card down and opens its
 * editor on the spot. The third is the model's last step rather than a move:
 * material gathers on its own and for nothing, a verb spends a session when
 * somebody chooses to, and the cards downstream of that work place themselves.
 * It is a label rather than a control because there is nothing for it to do.
 * The words themselves live in {@link ./boardCopy}.
 *
 * AND THE STATE AFTER IT: the ghosts come down the moment the keyless sources
 * land, which on a connected desk is seconds after the first open — so the line
 * above the cards is a STATE MACHINE over what the board is missing rather than
 * a caption ({@link boardHintState}): sources with no question named, a question
 * with no words in it, and only then the neutral working line. Without it the
 * only board that ever explained itself would be one with no engine behind it,
 * and the person who most needs the next move named — cards in front of them,
 * no idea what to do with them — would be the one it went quiet on. The chip
 * that performs the outstanding move is dressed as the answer while it is the
 * answer, so the sentence and the button always agree.
 *
 * AND NOTHING ABANDONED: a card is laid down BEFORE it is described, because
 * the editor has to open on something real. That is only honest if the reverse
 * holds too, so a card this session placed and nobody typed into is taken back
 * when its editor closes, however it closes — the close button, Escape, a click
 * elsewhere, the next move, or the face going away. Silently, because there is
 * nothing to lose and nothing a confirm could tell them. A card carrying one
 * typed field is work and keeps every ordinary protection.
 *
 * NOTHING HERE NAVIGATES. Describing a source, keying it, writing a question,
 * wiring two cards together and removing one all happen on this face, in the
 * editor anchored to the card. The router is not imported. Full pages remain
 * for reading an artifact, never for configuring one.
 *
 * WHAT IS READ FROM WHERE: the graph is a store outside React
 * ({@link boardGraphStore}) and layout there is SPARSE — a card the system
 * materialized may have no position, so {@link layoutBoard} places it rather
 * than anything here assuming one. A source card's health is the connector
 * registry the pack already polls ({@link engineFeeds}), so the Board and the
 * Connections room can never disagree about a provider.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import type { PanelHost } from '@nimbalyst/extension-sdk';
import { tint, tone } from '../panelkit';
import type { BoardDeletePlan, BoardNode } from '../../engine/boardGraph';
import { boardGraph, boardGraphStore } from '../../engine/boardGraphStore';
import { bootstrapBuiltInSources } from '../../engine/boardBuiltins';
import { engineFeeds } from '../../engine/gridVitals';
import { BoardCardList } from './BoardCards';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './gridCanvas';
import { GRID_ACCENT } from './gridTheme';
import { TREE_MIN_WIDTH } from './gridWires';
import { CANVAS_WIDTH, useGridCanvas } from './useGridCanvas';
import { BoardCard, ensureBoardCardStyles, useBoardPeek, type DropState } from './BoardCard';
import { QuoteCard, ensureQuoteCardStyles } from './QuoteCard';
import { BoardCardEditor } from './BoardCardEditor';
import { useBoardCardAiContext } from './gridFocus';
import { BoardWires } from './BoardWires';
import { layoutBoard, userSubgraph, type PlacedCard } from './boardLayout';
import { cardVerb, dispatchBoardScan, useBoardResearchLoop, type CardVerb } from './boardScan';
import { aiRunStore, resultLine } from './gridAiActions';
import { keptSentence, researchReading, sourceReading, type CardReading } from './boardReadings';
import { BOARD_HINT, boardHintState, BOARD_SYNC_NOTE, GHOSTS, QUOTE_ADD, RESEARCH_GHOST, SOURCE_GHOST } from './boardCopy';

const STYLE_ID = 'auracle-grid-board-styles';

const SHEET = `
/* A column, matching the Plan's frame: the stage takes whatever height is left
   so the board is always the full height of the pane. */
.aboard { min-height: 100%; display: flex; flex-direction: column; }
/* The STAGE is the viewport the board is seen through. Below the canvas tier it
   is an ordinary scrolling column; at it, it clips and the board becomes a
   layer with one transform on it. */
.aboard__stage { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; }
/* BORDER-BOX: the layer is 100% wide AND padded, so without this its own
   padding pushes 40px of every card past the right edge of a narrow pane —
   where the stage scrolls rather than the canvas panning, that is content a
   person has to go looking for. */
.aboard__layer { position: relative; box-sizing: border-box; display: flex; flex-direction: column; width: 100%; max-width: ${CANVAS_WIDTH}px; margin: 0 auto; padding: 18px 20px 44px; }
.aboard__hint { margin: 0 0 14px; font-size: 11.5px; line-height: 1.5; color: ${tone.text3}; }
/* Pinned to the stage rather than the board, so the controls that move the
   board do not move with it. */
.aboard__zoom { position: absolute; right: 14px; bottom: 12px; z-index: 7; display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px; border: 1px solid ${tone.border}; background: ${tone.surface}; box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
.aboard__zbtn { appearance: none; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: ${tone.text3}; cursor: pointer; transition: background-color 150ms ease-out, color 150ms ease-out; }
.aboard__zbtn:hover:not(:disabled) { background: ${tone.surface2}; color: ${tone.text}; }
.aboard__zbtn:disabled { opacity: 0.35; cursor: default; }
.aboard__zbtn:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.aboard__zbtn .material-symbols-outlined { font-size: 17px; line-height: 1; }
/* The two moves, kept within reach once the empty state's ghosts are gone. */
.aboard__adds { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; }
.aboard__add { display: inline-flex; align-items: center; gap: 6px; appearance: none; font: inherit; font-size: 11.5px; padding: 4px 10px; border-radius: 999px; border: 1px solid ${tone.border}; background: transparent; color: ${tone.text2}; cursor: pointer; }
.aboard__add:hover { border-color: ${tone.borderStrong}; color: ${tone.text}; }
.aboard__add:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.aboard__add .material-symbols-outlined { font-size: 14px; line-height: 1; }
/* The move that is outstanding, dressed in the pack's own primary language —
   the launcher's filled pill, tokens unchanged. Keyed on the BOARD's state
   rather than on which control it is, so at most one chip is ever wearing it
   and only while it is the answer to what the board is missing. */
.aboard__add[data-primary='true'] { border-color: transparent; background: ${tone.accent}; color: ${tone.accentInk}; font-weight: 600; box-shadow: inset 0 1px 0 rgba(255,255,255,0.14); }
.aboard__add[data-primary='true']:hover { border-color: transparent; background: ${tone.accentHover}; color: ${tone.accentInk}; }
.aboard__notice { margin: 0 0 12px; font-size: 11.5px; line-height: 1.5; color: ${tone.text2}; }
.aboard__notice[data-kind='err'] { color: ${tone.danger}; }
/* WAITING is not failing. The sync note reports where the board is kept, and
   the board is never at risk, so it takes the caution tone and never the
   danger one — red here reads as lost work to somebody on their first run. */
.aboard__notice[data-kind='wait'] { color: ${tone.caution}; }
/* The empty state. A list, because that is what it is: the moves, in order. */
.aboard__ghosts { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin: 0; padding: 0; list-style: none; }
/* DASHED, and the one place on either face a dash does not mean a data wire:
   nothing is here yet, and the outline says so before a word is read. */
.aboard__ghost { display: flex; flex-direction: column; gap: 5px; min-width: 0; padding: 14px 16px; border-radius: 10px; border: 1px dashed ${tone.borderStrong}; background: ${tint(tone.surface, 55)}; }
/* The button IS the slot: the ghost was always shaped like the card it makes,
   so the control fills it rather than sitting inside it. */
.aboard__gbtn { display: flex; flex-direction: column; gap: 5px; min-width: 0; width: 100%; appearance: none; border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.aboard__gbtn:hover .aboard__gtitle { color: ${tone.text}; }
.aboard__gbtn:hover .aboard__gico { color: ${GRID_ACCENT}; }
.aboard__gbtn:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 4px; border-radius: 4px; }
.aboard__gtop { display: flex; align-items: center; gap: 9px; min-width: 0; }
.aboard__gico { flex: none; font-size: 15px; line-height: 1; color: ${tone.text3}; }
.aboard__gtitle { min-width: 0; font-size: 12.5px; font-weight: 600; color: ${tone.text2}; }
.aboard__gbody { font-size: 11.5px; line-height: 1.5; color: ${tone.text3}; }
/* The last ghost is not a move a person makes, so it is quieter still: no
   border at all, and it reads as the note under the two that are. */
.aboard__ghost[data-ghost='materialized'] { border-style: solid; border-color: ${tone.border}; background: transparent; }

@container auracle-grid (min-width: 640px) {
  .aboard__ghosts { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
}

@container auracle-grid (min-width: ${TREE_MIN_WIDTH}px) {
  /* The board is a LAYER now: one transform moves it inside the stage, which
     clips. Same gate as the Plan's tree, so flipping faces never changes
     whether the pane is pannable. */
  .aboard__stage { overflow: hidden; cursor: grab; user-select: none; }
  .aboard__stage[data-panning='true'] { cursor: grabbing; }
  /* The board does not squeeze to the stage: it lays out at its CONTENT's
     width and the canvas fit-scales the result, which is what keeps a board
     wider than the pane legible — and, just as importantly, keeps a board
     NARROWER than the pane at 1:1 instead of shrinking an empty state nobody
     needed shrunk. (The Plan pins itself to a fixed width instead, because its
     tree genuinely is that wide whatever is on it.) */
  .aboard__layer { position: absolute; top: 0; left: 0; margin: 0; transform-origin: 0 0; align-items: center; padding: 22px 20px 44px; width: max-content; max-width: none; }
  .aboard__hint { text-align: center; }
  /* Fixed pitch rather than auto-fit: the layer is at its own width here, so
     three equal columns are three equal columns whatever the pane is doing. */
  .aboard__ghosts { grid-template-columns: repeat(3, 300px); gap: 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .aboard__zbtn { transition: none; }
}
`;

function ensureBoardStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** A source card starts blank: the editor opens on it immediately, and an
 *  invented placeholder name would be the first thing to delete. */
const BLANK_SOURCE = { name: '', connectorKind: '', endpoint: '', payloadType: '' };

/** What the board is saying back right now — a refused wire, a removal's
 *  receipt. Never an error code. */
interface Notice {
  text: string;
  kind: 'ok' | 'err';
}

export function GridBoard({ host }: { host?: PanelHost }): JSX.Element {
  ensureBoardStyles();
  ensureBoardCardStyles();
  ensureQuoteCardStyles();
  const graph = useSyncExternalStore(
    boardGraph.subscribe,
    boardGraph.getSnapshot,
    boardGraph.getSnapshot
  );
  const status = useSyncExternalStore(
    boardGraphStore.subscribe,
    () => boardGraphStore.getSnapshot().status,
    () => boardGraphStore.getSnapshot().status
  );
  // WHY the board is not on the engine, which is a different question from what
  // the store is doing — see BoardSnapshot.sync.
  const sync = useSyncExternalStore(
    boardGraphStore.subscribe,
    () => boardGraphStore.getSnapshot().sync,
    () => boardGraphStore.getSnapshot().sync
  );
  const feeds = useSyncExternalStore(
    engineFeeds.subscribe,
    engineFeeds.getSnapshot,
    engineFeeds.getSnapshot
  );
  const connectors = feeds.connections;
  const canvas = useGridCanvas();
  const peek = useBoardPeek();
  // The research loop — standing questions and, for the cards that armed it,
  // the automatic pass — runs exactly as long as the Board is on screen.
  useBoardResearchLoop();
  const ai = useSyncExternalStore(aiRunStore.subscribe, aiRunStore.getSnapshot, aiRunStore.getSnapshot);

  const cardsRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<{ nodeId: string; anchor: HTMLElement } | null>(null);
  /** A card just laid down, whose editor opens as soon as it is on screen. */
  const [pending, setPending] = useState<string | null>(null);
  /**
   * The cards this session laid down that nobody has typed into yet.
   *
   * A card is only ever taken back if it is in here: the add row creates it
   * before it has been described, so an editor closed on an untouched one is an
   * abandoned click rather than work. A card that already existed when the
   * Board opened is somebody's, blank or not, and is only removed the ordinary
   * way, through the confirm that says what stays behind.
   */
  const fresh = useRef<Set<string>>(new Set());
  /** The close, reachable from the teardown below before it is defined. */
  const closeRef = useRef<() => void>(() => {});
  const [wiring, setWiring] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const empty = graph.nodes.length === 0;
  // The PLANE is the half of the graph a person placed. The cards the system
  // wrote are drawn by their own layer underneath it, so laying them out here
  // as well would draw every strategy and deployment twice.
  const layout = useMemo(() => layoutBoard(userSubgraph(graph)), [graph]);

  /**
   * The workspace whose Board this is. An install with no workspace open still
   * gets one — the empty string is a perfectly good key, and a Board that
   * refused to persist because a host did not name its folder would lose work
   * for a reason nobody could see.
   */
  const workspaceId = host?.workspacePath ?? '';

  useEffect(() => {
    void boardGraphStore.open(workspaceId);
    // The Board going off screen is the moment a pending edit has to reach the
    // lane: the debounce is measured in hundreds of milliseconds and a closing
    // panel does not wait them out.
    return () => {
      // The editor leaves with the face, so it leaves the way it does anywhere
      // else — taking an untouched card with it. Before the flush, so the
      // removal is in the graph the flush carries out.
      closeRef.current();
      void boardGraphStore.flush();
    };
  }, [workspaceId]);

  // The keyless sources, laid down once on a Board nobody has touched. Runs
  // whenever the registry answers because it is idempotent by construction —
  // see boardBuiltins.
  useEffect(() => {
    if (status !== 'idle') return;
    bootstrapBuiltInSources(connectors);
  }, [connectors, status]);

  // Open the editor on a card that did not exist when it was asked for.
  useEffect(() => {
    if (pending === null) return;
    const el = cardsRef.current?.querySelector<HTMLElement>(`[data-node="${pending}"]`) ?? null;
    if (el) setEditing({ nodeId: pending, anchor: el });
    setPending(null);
  }, [pending, graph]);

  // A card that left the Board takes its editor with it. Read through the
  // updater rather than off this render, because the card may have left in the
  // same pass that opened an editor on a different one.
  useEffect(() => {
    setEditing((current) =>
      current && !graph.nodes.some((node) => node.id === current.nodeId) ? null : current
    );
  }, [graph]);

  // The selected card, told to the chat: what it is, what feeds it, what came
  // of it. Selection here IS the open card — there is no second notion of it on
  // this face — and dropping it clears the envelope again (see gridFocus).
  useBoardCardAiContext(host, graph, editing?.nodeId ?? null);

  /** The open card, readable from a handler without making every callback
   *  depend on it. */
  const openRef = useRef<string | null>(null);
  openRef.current = editing?.nodeId ?? null;

  /**
   * Leave a card, and take it back if this session laid it down and nobody ever
   * typed into it.
   *
   * Silent, and deliberately: the confirm on the delete button exists to say
   * what a removal leaves behind, and an untouched card leaves nothing behind
   * to say. Asking would be asking somebody to approve undoing their own
   * mis-click. The store keeps the rule (see `discardBlankNode`); this only
   * decides that the card is one of ours to take back, and stops treating it as
   * fresh either way — a card that survived one close is the person's from then
   * on, whatever they later empty out of it.
   */
  const leave = useCallback((nodeId: string | null): void => {
    if (nodeId === null || !fresh.current.has(nodeId)) return;
    fresh.current.delete(nodeId);
    boardGraphStore.discardBlankNode(nodeId);
  }, []);

  /** Close whatever is open, reaping it if it was never written into. */
  const closeEditor = useCallback((): void => {
    const open = openRef.current;
    setEditing(null);
    leave(open);
  }, [leave]);
  closeRef.current = closeEditor;

  const place = useCallback(
    (kind: 'source' | 'research' | 'quote'): void => {
      peek.close();
      setNotice(null);
      // Whatever was open is being left for this new card, so it is left
      // properly: an untouched one does not survive the next move either.
      closeEditor();
      let id: string;
      if (kind === 'source') {
        id = boardGraphStore.createNode({ kind: 'source', source: { ...BLANK_SOURCE } });
      } else if (kind === 'research') {
        id = boardGraphStore.createNode({ kind: 'research', research: { hypothesis: '' } });
      } else {
        id = boardGraphStore.createNode({ kind: 'quote', quote: { contracts: [] } });
      }
      fresh.current.add(id);
      setPending(id);
    },
    [closeEditor, peek]
  );

  /* ── the wire gesture ──────────────────────────────────────────────────
     Pressed on a source card's handle, released on whatever card is under the
     pointer. The store decides whether that pairing is a wire and hands back
     the sentence to show when it is not — this component never re-implements
     the rule, it only carries the gesture. */
  const wiringRef = useRef<string | null>(null);
  wiringRef.current = wiring;

  const planePoint = useCallback(
    (event: MouseEvent): { x: number; y: number } | null => {
      const box = cardsRef.current?.getBoundingClientRect();
      if (!box) return null;
      const scale = canvas.engaged ? canvas.view.scale : 1;
      return { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale };
    },
    [canvas.engaged, canvas.view.scale]
  );

  useEffect(() => {
    if (wiring === null) return;
    const onMove = (event: MouseEvent): void => setGhost(planePoint(event));
    // The release is the WINDOW's as well as the card's: a wire dropped on
    // empty ground has to end the gesture rather than leave the board armed.
    const onUp = (): void => {
      setWiring(null);
      setGhost(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [planePoint, wiring]);

  const startWire = useCallback(
    (nodeId: string): void => {
      peek.close();
      setNotice(null);
      setWiring(nodeId);
    },
    [peek]
  );

  const endWire = useCallback((nodeId: string): void => {
    const from = wiringRef.current;
    if (from === null) return;
    wiringRef.current = null;
    setWiring(null);
    setGhost(null);
    if (from === nodeId) return;
    const result = boardGraphStore.wire(from, nodeId);
    setNotice(result.ok ? { text: 'Wired.', kind: 'ok' } : { text: result.reason, kind: 'err' });
  }, []);

  const cutWire = useCallback((edgeId: string): void => {
    const result = boardGraphStore.unwire(edgeId);
    setNotice(result.ok ? { text: 'Wire cut.', kind: 'ok' } : { text: result.reason, kind: 'err' });
  }, []);

  const openCard = useCallback(
    (node: BoardNode, anchor: HTMLElement): void => {
      peek.close();
      // A second press on the card already open closes it — the same control,
      // the same meaning, both ways.
      const open = openRef.current;
      if (open === node.id) {
        closeEditor();
        return;
      }
      setEditing({ nodeId: node.id, anchor });
      // Moving to another card leaves the last one, which is a close like any
      // other: an untouched card does not stay behind because the pointer went
      // somewhere else.
      leave(open);
    },
    [closeEditor, leave, peek]
  );

  const onDeleted = useCallback((plan: BoardDeletePlan): void => {
    setEditing(null);
    setNotice({ text: keptSentence(plan), kind: 'ok' });
  }, []);

  /** A question card's verb, from the counters and the allowance the shared
   *  lane already carries. Null for every card that has no verb. */
  const verbOf = (node: BoardNode): CardVerb | null =>
    node.kind === 'research' ? cardVerb(node, feeds.material, feeds.budget) : null;

  const readingOf = (node: BoardNode): CardReading =>
    node.kind === 'source'
      ? sourceReading(node.source ?? BLANK_SOURCE, connectors)
      : researchReading(verbOf(node)?.newMaterial ?? null);

  /** Press the verb on one card. The lane runs one action at a time, so a press
   *  that lands on a busy lane says so rather than appearing to do nothing. */
  const scanCard = useCallback(
    (nodeId: string): void => {
      const node = graph.nodes.find((row) => row.id === nodeId);
      if (!node) return;
      const verb = cardVerb(node, feeds.material, feeds.budget);
      setNotice(null);
      void dispatchBoardScan(graph, nodeId, verb.kind, verb.newMaterial ?? 0).then((result) => {
        setNotice(
          result === null
            ? { text: 'Something else is already running. Try again in a moment.', kind: 'ok' }
            : { text: resultLine(result), kind: result.kind === 'failed' ? 'err' : 'ok' }
        );
      });
    },
    [feeds.budget, feeds.material, graph]
  );

  const dropOf = (node: BoardNode): DropState => {
    if (wiring === null) return 'none';
    if (wiring === node.id) return 'origin';
    return node.kind === 'research' ? 'ok' : 'no';
  };

  const wireCountOf = (nodeId: string): number =>
    graph.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId).length;

  const editingNode = editing ? graph.nodes.find((node) => node.id === editing.nodeId) : undefined;
  const ghostLine = ghostPath(wiring, layout.cards, ghost);
  // What the board is missing, which is both what the line says and which of
  // the two chips is dressed as the answer. One reading, so the sentence and
  // the button can never point at different moves.
  const hintState = boardHintState(graph.nodes);

  return (
    <div className="aboard" data-testid="auracle-grid-board" data-nodes={graph.nodes.length}>
      <div
        ref={canvas.stageRef}
        className="aboard__stage"
        data-testid="board-stage"
        data-canvas={canvas.engaged ? 'on' : 'off'}
        data-panning={canvas.panning ? 'true' : 'false'}
        data-wiring={wiring === null ? 'false' : 'true'}
        onMouseDown={canvas.onMouseDown}
        onDoubleClick={canvas.onDoubleClick}
      >
        <div
          ref={canvas.planRef}
          className="aboard__layer"
          data-testid="board-layer"
          // Only while the canvas is engaged: below the tier the board is an
          // ordinary column in an ordinary scroll box, and a transform there
          // would move something that has nowhere to be moved to.
          style={
            canvas.engaged
              ? {
                  transform: `translate(${canvas.view.x}px, ${canvas.view.y}px) scale(${canvas.view.scale})`,
                }
              : undefined
          }
        >
          <p className="aboard__hint" data-testid="board-hint" data-state={hintState}>
            {BOARD_HINT[hintState]}
          </p>
          {empty ? (
            <GhostSlots onPlace={place} />
          ) : (
            <div className="aboard__adds">
              {/* The same two moves under the same two names the ghosts gave
                  them: a person who read the empty state should not have to
                  learn a second vocabulary once it is gone. */}
              <button
                type="button"
                className="aboard__add"
                data-testid="board-add-source"
                onClick={() => place('source')}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  {SOURCE_GHOST.icon}
                </span>
                {SOURCE_GHOST.title}
              </button>
              {/* Filled only while the board has something to read and nothing
                  to read it against: that is the one situation where a person
                  can be stuck with cards in front of them and no idea what the
                  next move is. Everywhere else both chips are peers. */}
              <button
                type="button"
                className="aboard__add"
                data-testid="board-add-research"
                data-primary={hintState === 'askQuestion' ? 'true' : 'false'}
                onClick={() => place('research')}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  {RESEARCH_GHOST.icon}
                </span>
                {RESEARCH_GHOST.title}
              </button>
              {/* The third move, additive: watch a live quote. A card a person
                  places, streaming on the canvas, released when it comes off. */}
              <button
                type="button"
                className="aboard__add"
                data-testid="board-add-quote"
                onClick={() => place('quote')}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  {QUOTE_ADD.icon}
                </span>
                {QUOTE_ADD.title}
              </button>
            </div>
          )}
          {notice ? (
            <p className="aboard__notice" data-testid="board-notice" data-kind={notice.kind} role="status">
              {notice.text}
            </p>
          ) : null}
          {/* Not an error, and never drawn as one: the board is kept on this
              machine whatever the engine does, so this line reports a sync and
              names the one thing that would change it. The two readings live in
              boardCopy. */}
          {sync === 'synced' ? null : (
            <p
              className="aboard__notice"
              data-testid="board-sync-note"
              data-kind="wait"
              data-state={sync}
              role="status"
            >
              {BOARD_SYNC_NOTE[sync]}
            </p>
          )}
          {empty ? null : (
            <div
              ref={cardsRef}
              className="aboard__cards"
              data-testid="board-cards"
              style={
                {
                  '--aboard-w': `${layout.width}px`,
                  '--aboard-h': `${layout.height}px`,
                } as CSSProperties
              }
            >
              {/* The overlay is only true on the plane — see the file header. */}
              {canvas.engaged ? (
                <BoardWires
                  wires={layout.wires}
                  width={layout.width}
                  height={layout.height}
                  ghost={ghostLine}
                  onCut={cutWire}
                />
              ) : null}
              {layout.cards.map((card) => {
                const node = graph.nodes.find((row) => row.id === card.id);
                if (!node) return null;
                // The live-quote card runs its own stream and draws its own body,
                // so it is its own component beside the shared one.
                if (node.kind === 'quote') {
                  return (
                    <QuoteCard
                      key={node.id}
                      node={node}
                      card={card}
                      editing={editing?.nodeId === node.id}
                      drop={dropOf(node)}
                      onOpen={openCard}
                      onWireEnd={endWire}
                    />
                  );
                }
                const reading = readingOf(node);
                return (
                  <BoardCard
                    key={node.id}
                    node={node}
                    card={card}
                    reading={reading}
                    wires={wireCountOf(node.id)}
                    editing={editing?.nodeId === node.id}
                    drop={dropOf(node)}
                    verb={verbOf(node)}
                    scanning={ai.running?.id === `board-scan-${node.id}`}
                    onOpen={openCard}
                    onWireStart={startWire}
                    onWireEnd={endWire}
                    onScan={scanCard}
                    onPeek={(target, el) => peek.open(target, el, reading)}
                    onPeekEnd={peek.close}
                  />
                );
              })}
            </div>
          )}
          {/* The cards the system writes, drawn by their own layer below the
              plane. Mounted whatever the graph holds, because it is that layer
              which ARMS materialization: an empty board is exactly the board
              that most needs it running. */}
          <BoardCardList graph={graph} />
        </div>
        {/* Small, pinned to the stage, and only where there is a canvas to
            drive — the same rule the Plan follows. */}
        {canvas.engaged ? (
          <div className="aboard__zoom" data-testid="board-zoom" role="group" aria-label="Board view">
            <button
              type="button"
              className="aboard__zbtn"
              data-testid="board-zoom-out"
              aria-label="Zoom out"
              disabled={canvas.view.scale <= ZOOM_MIN}
              onClick={() => canvas.zoomBy(1 / ZOOM_STEP)}
            >
              <span className="material-symbols-outlined" aria-hidden>
                remove
              </span>
            </button>
            <button
              type="button"
              className="aboard__zbtn"
              data-testid="board-zoom-fit"
              aria-label="Fit the board"
              onClick={() => canvas.fit()}
            >
              <span className="material-symbols-outlined" aria-hidden>
                fit_screen
              </span>
            </button>
            <button
              type="button"
              className="aboard__zbtn"
              data-testid="board-zoom-in"
              aria-label="Zoom in"
              disabled={canvas.view.scale >= ZOOM_MAX}
              onClick={() => canvas.zoomBy(ZOOM_STEP)}
            >
              <span className="material-symbols-outlined" aria-hidden>
                add
              </span>
            </button>
          </div>
        ) : null}
      </div>
      {editing && editingNode ? (
        <BoardCardEditor
          node={editingNode}
          graph={graph}
          anchor={editing.anchor}
          onClose={closeEditor}
          onDeleted={onDeleted}
        />
      ) : null}
      {peek.peek}
    </div>
  );
}

/** The onboarding, drawn as the shape of the board a person is about to build —
 *  and, for the two moves that are theirs to make, the control that makes it. */
function GhostSlots({ onPlace }: { onPlace: (kind: 'source' | 'research') => void }): JSX.Element {
  return (
    <ul className="aboard__ghosts" data-testid="board-ghosts">
      {GHOSTS.map((ghost) => {
        const body = (
          <>
            <span className="aboard__gtop">
              <span className="material-symbols-outlined aboard__gico" aria-hidden>
                {ghost.icon}
              </span>
              <span className="aboard__gtitle">{ghost.title}</span>
            </span>
            <span className="aboard__gbody">{ghost.body}</span>
          </>
        );
        return (
          <li
            key={ghost.id}
            className="aboard__ghost"
            data-ghost={ghost.id}
            data-testid={ghost.acts ? undefined : `board-ghost-${ghost.id}`}
          >
            {ghost.acts ? (
              <button
                type="button"
                className="aboard__gbtn"
                data-testid={`board-ghost-${ghost.id}`}
                onClick={() => onPlace(ghost.id === 'source' ? 'source' : 'research')}
              >
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The line that follows the pointer while a wire is being drawn — from the
 * bottom of the card it started on to wherever the pointer is. Straight rather
 * than routed: it is a gesture in progress, not a wire yet, and routing it
 * through a trunk would claim a destination nobody has chosen.
 */
function ghostPath(
  from: string | null,
  cards: readonly PlacedCard[],
  point: { x: number; y: number } | null
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (from === null || point === null) return null;
  const card = cards.find((row) => row.id === from);
  if (!card) return null;
  return { x1: card.x + card.width / 2, y1: card.y + card.height, x2: point.x, y2: point.y };
}
