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
 * editor on the spot. The third says plainly that nothing else on this board is
 * placed by hand, and is a label rather than a control because there is nothing
 * for it to do.
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
import { BoardCardEditor } from './BoardCardEditor';
import { BoardWires } from './BoardWires';
import { layoutBoard, userSubgraph, type PlacedCard } from './boardLayout';
import { keptSentence, RESEARCH_READING, sourceReading, type CardReading } from './boardReadings';

const STYLE_ID = 'auracle-grid-board-styles';

/** The three ghosts, in the order a person meets them. The first two are
 *  buttons now: they lay the card down and open it. */
const GHOSTS = [
  {
    id: 'source',
    icon: 'database',
    title: 'Connect data',
    body: 'Point the board at something worth reading — a paper feed, a filings stream, a broker account.',
    acts: true,
  },
  {
    id: 'research',
    icon: 'help',
    title: 'Pose a question',
    body: 'Write the hypothesis in plain words. What arrives afterwards is read against it, and kept.',
    acts: true,
  },
  {
    id: 'materialized',
    icon: 'auto_awesome',
    title: 'The rest arrives on its own',
    body: 'Strategies, tests and deployments appear here as real work produces them. Nothing to place by hand.',
    acts: false,
  },
] as const;

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
.aboard__notice { margin: 0 0 12px; font-size: 11.5px; line-height: 1.5; color: ${tone.text2}; }
.aboard__notice[data-kind='err'] { color: ${tone.danger}; }
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
  const feeds = useSyncExternalStore(
    engineFeeds.subscribe,
    engineFeeds.getSnapshot,
    engineFeeds.getSnapshot
  );
  const connectors = feeds.connections;
  const canvas = useGridCanvas();
  const peek = useBoardPeek();

  const cardsRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<{ nodeId: string; anchor: HTMLElement } | null>(null);
  /** A card just laid down, whose editor opens as soon as it is on screen. */
  const [pending, setPending] = useState<string | null>(null);
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

  // A card that left the Board takes its editor with it.
  useEffect(() => {
    if (editing && !graph.nodes.some((node) => node.id === editing.nodeId)) setEditing(null);
  }, [editing, graph]);

  const place = useCallback(
    (kind: 'source' | 'research'): void => {
      peek.close();
      setNotice(null);
      const id =
        kind === 'source'
          ? boardGraphStore.createNode({ kind: 'source', source: { ...BLANK_SOURCE } })
          : boardGraphStore.createNode({ kind: 'research', research: { hypothesis: '' } });
      setPending(id);
    },
    [peek]
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
      setEditing((current) =>
        current?.nodeId === node.id ? null : { nodeId: node.id, anchor }
      );
    },
    [peek]
  );

  const onDeleted = useCallback((plan: BoardDeletePlan): void => {
    setEditing(null);
    setNotice({ text: keptSentence(plan), kind: 'ok' });
  }, []);

  const readingOf = (node: BoardNode): CardReading =>
    node.kind === 'source' ? sourceReading(node.source ?? BLANK_SOURCE, connectors) : RESEARCH_READING;

  const dropOf = (node: BoardNode): DropState => {
    if (wiring === null) return 'none';
    if (wiring === node.id) return 'origin';
    return node.kind === 'research' ? 'ok' : 'no';
  };

  const wireCountOf = (nodeId: string): number =>
    graph.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId).length;

  const editingNode = editing ? graph.nodes.find((node) => node.id === editing.nodeId) : undefined;
  const ghostLine = ghostPath(wiring, layout.cards, ghost);

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
          <p className="aboard__hint">
            {empty
              ? 'An empty board. Two moves start it — the rest follows from the work.'
              : 'What you are working on — the sources, the questions, and what came of them.'}
          </p>
          {empty ? (
            <GhostSlots onPlace={place} />
          ) : (
            <div className="aboard__adds">
              <button
                type="button"
                className="aboard__add"
                data-testid="board-add-source"
                onClick={() => place('source')}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  database
                </span>
                Connect data
              </button>
              <button
                type="button"
                className="aboard__add"
                data-testid="board-add-research"
                onClick={() => place('research')}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  help
                </span>
                Pose a question
              </button>
            </div>
          )}
          {notice ? (
            <p className="aboard__notice" data-testid="board-notice" data-kind={notice.kind} role="status">
              {notice.text}
            </p>
          ) : null}
          {status === 'error' ? (
            <p className="aboard__notice" data-testid="board-sync-state" data-kind="err" role="status">
              Not synced with the engine. The board is safe here; it will save when the engine answers.
            </p>
          ) : null}
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
                    onOpen={openCard}
                    onWireStart={startWire}
                    onWireEnd={endWire}
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
          onClose={() => setEditing(null)}
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
