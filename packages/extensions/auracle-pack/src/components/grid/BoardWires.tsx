/**
 * The wires between the Board's cards — the Plan's line language, on the
 * Board's own geometry.
 *
 * Two kinds of line, and the distinction is the Plan's, kept intact:
 *
 *  - a DASH means DATA. A wire a person drew from a source into a question is
 *    dashed, quiet at rest, and reads as something flowing.
 *  - a SOLID HAIRLINE means STRUCTURE. A provenance wire — written by the
 *    system when work materialized an artifact — is not a flow, it is a record
 *    of where something came from, so it is drawn the way the Plan draws its
 *    root-to-room joins and never mistaken for a feed.
 *
 * Bus discipline comes from {@link ./boardLayout}: every edge crossing one rank
 * gap shares one trunk, so a Board with a dozen wires is a few lines with drops
 * off them rather than a dozen diagonals. Nothing is measured here — the paths
 * arrive computed, which is what makes them assertable.
 *
 * ## Calm at rest
 * The wires sit at low contrast and carry no arrowhead traffic of their own
 * beyond the terminal one. The CUT affordance is not drawn until the pointer is
 * on the plane or the button itself is focused: a row of buttons hanging in the
 * middle of every wire would be the loudest thing on a surface whose whole job
 * is to be readable at a glance.
 *
 * ## Only where there is a plane
 * The overlay is drawn at the canvas tier and nowhere else, exactly as the
 * Plan's is: below that tier the cards are an ordinary flowing list and these
 * coordinates would point at nothing. What the wires say is still available
 * there — every card counts its own wires, and the editor lists them by name
 * with the same cut.
 */
import { tint, tone } from '../panelkit';
import { GRID_ACCENT } from './gridTheme';
import type { BoardWirePath } from './boardLayout';

const STYLE_ID = 'auracle-board-wire-styles';

const SHEET = `
.aboard__wires { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: visible; }
.aboard__wire { fill: none; stroke-width: 1.1; stroke-linecap: round; }
/* A dash means data — a source feeding a question. */
.aboard__wire[data-origin='user'] { stroke: ${tone.text3}; stroke-dasharray: 3 5; opacity: 0.55; }
/* Solid and fainter: provenance is structure, not flow. */
.aboard__wire[data-origin='system'] { stroke: ${tone.text3}; opacity: 0.3; }
.aboard__ghost { fill: none; stroke: ${GRID_ACCENT}; stroke-width: 1.2; stroke-dasharray: 4 4; opacity: 0.9; }
.aboard__cut { position: absolute; z-index: 3; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0; transform: translate(-50%, -50%); appearance: none; border-radius: 999px; border: 1px solid ${tone.border}; background: ${tone.surface}; color: ${tone.text3}; cursor: pointer; opacity: 0; transition: opacity 140ms ease-out, color 140ms ease-out; }
.aboard__cards:hover .aboard__cut { opacity: 1; }
.aboard__cut:hover { color: ${tone.danger}; border-color: ${tint(tone.danger, 50)}; }
.aboard__cut:focus-visible { opacity: 1; outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.aboard__cut .material-symbols-outlined { font-size: 12px; line-height: 1; }

@media (prefers-reduced-motion: reduce) {
  .aboard__cut { transition: none; }
}
`;

export function ensureBoardWireStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

export interface BoardWiresProps {
  wires: readonly BoardWirePath[];
  width: number;
  height: number;
  /** The wire being drawn right now, in plane coordinates. Null at rest. */
  ghost: { x1: number; y1: number; x2: number; y2: number } | null;
  onCut: (edgeId: string) => void;
}

export function BoardWires({ wires, width, height, ghost, onCut }: BoardWiresProps): JSX.Element {
  ensureBoardWireStyles();
  return (
    <>
      <svg
        className="aboard__wires"
        data-testid="board-wires"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden
        focusable="false"
      >
        <defs>
          <marker id="aboard-arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0.5,0.5 L5.5,3 L0.5,5.5 z" fill={tone.text3} />
          </marker>
        </defs>
        {wires.map((wire) => (
          <path
            key={wire.id}
            className="aboard__wire"
            data-testid="board-wire"
            data-edge={wire.id}
            data-origin={wire.origin}
            d={wire.d}
            markerEnd="url(#aboard-arrow)"
          />
        ))}
        {ghost ? (
          <path
            className="aboard__ghost"
            data-testid="board-wire-ghost"
            d={`M ${ghost.x1} ${ghost.y1} L ${ghost.x2} ${ghost.y2}`}
          />
        ) : null}
      </svg>
      {/* Only a person's own wires can be cut. A provenance wire has no button,
          rather than a button that refuses — the store would say no, and
          offering the gesture at all would suggest the Board could forget where
          something came from. */}
      {wires
        .filter((wire) => wire.origin === 'user')
        .map((wire) => (
          <button
            key={wire.id}
            type="button"
            className="aboard__cut"
            data-testid={`board-wire-snip-${wire.id}`}
            aria-label="Cut this wire"
            title="Cut this wire"
            style={{ left: wire.cutX, top: wire.cutY }}
            onClick={() => onCut(wire.id)}
          >
            <span className="material-symbols-outlined" aria-hidden>
              content_cut
            </span>
          </button>
        ))}
    </>
  );
}
