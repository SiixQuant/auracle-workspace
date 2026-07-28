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
 * and the zoom controls are not drawn, because there is nothing for them to do.
 *
 * EMPTY STATE: three ghost slots, and they are the onboarding. Two name the
 * only moves a person makes — point it at something to read, ask it something —
 * and the third says plainly that nothing else on this board is placed by hand.
 * They are drawn as ghosts rather than buttons on purpose: at this stage they
 * describe the two moves, they do not yet perform them, and a control that does
 * nothing when pressed is worse than a label that never claimed it would.
 *
 * A POPULATED BOARD draws its nodes in the layer below — the cards themselves
 * arrive with the node work; this file owns the face they are drawn on. Two
 * things it already has to honour: the graph is READ from a store outside React
 * ({@link boardGraph}, standing in until the real one merges), and layout there
 * is SPARSE — a card the system materialized may have no position yet, so
 * nothing here may assume one.
 */
import { useSyncExternalStore } from 'react';
import { tint, tone } from '../panelkit';
import { boardGraph } from './boardGraphPlaceholder';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './gridCanvas';
import { GRID_ACCENT } from './gridTheme';
import { TREE_MIN_WIDTH } from './gridWires';
import { CANVAS_WIDTH, useGridCanvas } from './useGridCanvas';

const STYLE_ID = 'auracle-grid-board-styles';

/** The three ghosts, in the order a person meets them. */
const GHOSTS = [
  {
    id: 'source',
    icon: 'database',
    title: 'Connect data',
    body: 'Point the board at something worth reading — a paper feed, a filings stream, a broker account.',
  },
  {
    id: 'research',
    icon: 'help',
    title: 'Pose a question',
    body: 'Write the hypothesis in plain words. What arrives afterwards is read against it, and kept.',
  },
  {
    id: 'materialized',
    icon: 'auto_awesome',
    title: 'The rest arrives on its own',
    body: 'Strategies, tests and deployments appear here as real work produces them. Nothing to place by hand.',
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
.aboard__layer { position: relative; display: flex; flex-direction: column; width: 100%; max-width: ${CANVAS_WIDTH}px; margin: 0 auto; padding: 18px 20px 44px; }
.aboard__hint { margin: 0 0 14px; font-size: 11.5px; line-height: 1.5; color: ${tone.text3}; }
/* Pinned to the stage rather than the board, so the controls that move the
   board do not move with it. */
.aboard__zoom { position: absolute; right: 14px; bottom: 12px; z-index: 7; display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px; border: 1px solid ${tone.border}; background: ${tone.surface}; box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
.aboard__zbtn { appearance: none; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: ${tone.text3}; cursor: pointer; transition: background-color 150ms ease-out, color 150ms ease-out; }
.aboard__zbtn:hover:not(:disabled) { background: ${tone.surface2}; color: ${tone.text}; }
.aboard__zbtn:disabled { opacity: 0.35; cursor: default; }
.aboard__zbtn:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.aboard__zbtn .material-symbols-outlined { font-size: 17px; line-height: 1; }
/* The empty state. A list, because that is what it is: the moves, in order. */
.aboard__ghosts { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin: 0; padding: 0; list-style: none; }
/* DASHED, and the one place on either face a dash does not mean a data wire:
   nothing is here yet, and the outline says so before a word is read. */
.aboard__ghost { display: flex; flex-direction: column; gap: 5px; min-width: 0; padding: 14px 16px; border-radius: 10px; border: 1px dashed ${tone.borderStrong}; background: ${tint(tone.surface, 55)}; }
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

/** The onboarding, drawn as the shape of the board a person is about to build. */
function GhostSlots(): JSX.Element {
  return (
    <ul className="aboard__ghosts" data-testid="board-ghosts">
      {GHOSTS.map((ghost) => (
        <li
          key={ghost.id}
          className="aboard__ghost"
          data-testid={`board-ghost-${ghost.id}`}
          data-ghost={ghost.id}
        >
          <span className="aboard__gtop">
            <span className="material-symbols-outlined aboard__gico" aria-hidden>
              {ghost.icon}
            </span>
            <span className="aboard__gtitle">{ghost.title}</span>
          </span>
          <span className="aboard__gbody">{ghost.body}</span>
        </li>
      ))}
    </ul>
  );
}

export function GridBoard(): JSX.Element {
  ensureBoardStyles();
  const graph = useSyncExternalStore(
    boardGraph.subscribe,
    boardGraph.getSnapshot,
    boardGraph.getSnapshot
  );
  const canvas = useGridCanvas();
  const empty = graph.nodes.length === 0;

  return (
    <div className="aboard" data-testid="auracle-grid-board" data-nodes={graph.nodes.length}>
      <div
        ref={canvas.stageRef}
        className="aboard__stage"
        data-testid="board-stage"
        data-canvas={canvas.engaged ? 'on' : 'off'}
        data-panning={canvas.panning ? 'true' : 'false'}
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
          {empty ? <GhostSlots /> : null}
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
    </div>
  );
}
