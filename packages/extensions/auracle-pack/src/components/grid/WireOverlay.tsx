/**
 * The sheet's live wires and its one pinned alert.
 *
 * The plan already says what every room is doing. This says how the rooms are
 * JOINED, and it makes one thing impossible to miss: the path a strategy takes
 * to production, and the point on that path where it has stopped. A red edge
 * with a pulse travelling down it, plus a chip naming the deployment, answers
 * "what is wrong and where" before anything is clicked.
 *
 * ## Where it draws, and where it does not
 * Only at the FULL TREE tier. Below the sheet's {@link TREE_MIN_WIDTH} container
 * breakpoint the districts stack into a column, so the single room rank the
 * lanes hang under does not exist and there is nothing coherent to route; the
 * overlay measures its own width against the same constant the sheet's
 * `@container` rule uses and draws nothing under it. The pinned chip is hidden
 * by that same query. The stacked tiers are not left silent — they carry the
 * identical readings on the room dot, the district flag and the root node's
 * count, which is where they came from in the first place.
 *
 * ## Measurement
 * Positions come from the DOM (`[data-room]`, the cards the sheet already
 * marks), measured against the plan's own box, because the tree's geometry is
 * CSS's to decide and duplicating it in JS would be a second layout engine to
 * keep in sync. Re-measured on exactly three things: the plan resizing
 * (ResizeObserver), the readings moving (new vitals), and a district folding
 * ({@link gridFoldStore}). Never on a timer, never on scroll.
 *
 * The fold is read through `useSyncExternalStore` rather than a bare
 * subscription on purpose: that way the re-measure is a LAYOUT EFFECT of the
 * same commit that took the folded district's cards out of the DOM, so there is
 * never a frame in which a wire points at a card that has left. Rooms inside a
 * folded district simply stop being measurable, and every edge that touched one
 * drops out of the routing.
 *
 * ## One source for the state
 * Nothing here decides that something is broken. The edges take their colour
 * from `gridVitals` through {@link wireKind}, and the chip takes both its state
 * and the name it prints from the same reading the sheet's red dot came from.
 *
 * ## Motion
 * The pulse is an SVG `animateMotion` — a NODE, not a CSS property, so a media
 * query cannot switch it off honestly. Under `prefers-reduced-motion` it is not
 * rendered at all (and the stylesheet hides it too, in case a session's
 * preference changes after the render).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { GridVitals } from '../../engine/gridVitals';
import { prefersReducedMotion, tint, tone } from '../panelkit';
import { gridFoldStore } from './gridFoldStore';
import { GRID_ACCENT } from './gridTheme';
import { openRoom, zoomOriginFrom } from './gridNav';
import {
  TREE_MIN_WIDTH,
  WIRED_ROOMS,
  layoutWires,
  leaderPath,
  sheetAlert,
  type Anchor,
  type RoomBox,
  type Wire,
  type WireKind,
} from './gridWires';
import type { RoomId } from './rooms';

const STYLE_ID = 'auracle-grid-wires-styles';

/** Ink per wire kind — health colours, straight from the token table. */
const WIRE_INK: Record<WireKind, string> = {
  norm: tone.text3,
  warn: tone.caution,
  err: tone.danger,
};

const KINDS: WireKind[] = ['norm', 'warn', 'err'];

const SHEET = `
.agrid__wires { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: visible; }
.agrid__wire { fill: none; stroke-width: 1.1; stroke-linecap: round; }
.agrid__wire[data-kind='norm'] { stroke: ${WIRE_INK.norm}; stroke-dasharray: 3 5; opacity: 0.55; }
.agrid__wire[data-kind='warn'] { stroke: ${WIRE_INK.warn}; stroke-dasharray: 3 5; stroke-width: 1.3; opacity: 0.85; }
.agrid__wire[data-kind='err'] { stroke: ${WIRE_INK.err}; stroke-width: 1.5; }
.agrid__leader { fill: none; stroke: ${tone.danger}; stroke-width: 1; stroke-dasharray: 4 5; opacity: 0.75; }
.agrid__pulse { fill: ${tone.danger}; }

/* The chip is pinned to a leader line only the full tree draws, so it keeps
   that tier's company — see the file header. */
.agrid__annot { display: none; }
@container auracle-grid (min-width: ${TREE_MIN_WIDTH}px) {
  .agrid__annot { position: absolute; top: 16px; right: 22px; z-index: 6; display: inline-flex; align-items: center; gap: 8px; appearance: none; font: inherit; font-size: 11.5px; font-variant-numeric: tabular-nums; border-radius: 999px; padding: 5px 12px; background: ${tone.surface}; }
}
.agrid__annot[data-state='alert'] { color: ${tone.danger}; border: 1px solid ${tint(tone.danger, 50)}; box-shadow: 0 0 0 3px ${tint(tone.danger, 9)}; cursor: pointer; }
.agrid__annot[data-state='clear'] { color: ${tone.text2}; border: 1px solid ${tone.border}; cursor: default; }
.agrid__annot[data-state='clear'] .agrid__annotico { color: ${tone.ok}; }
.agrid__annot:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 2px; }
.agrid__annotico { font-size: 13px; line-height: 1; flex: none; }

@media (prefers-reduced-motion: reduce) {
  .agrid__pulse { display: none; }
}
`;

function ensureWireStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** Everything one measurement produced. Null = nothing to draw at this width. */
interface Geometry {
  width: number;
  height: number;
  wires: Wire[];
  faultPath: string;
  leader: string;
}

/** A rect measured against the sheet, or null when there is no layout to read
 *  (jsdom, a hidden element, a card the plan has not placed). */
function boxOf(el: Element | null, sheet: DOMRect): RoomBox | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { cx: r.left - sheet.left + r.width / 2, top: r.top - sheet.top, bottom: r.bottom - sheet.top };
}

/**
 * The plan this overlay covers. Found from the chip rather than handed down as
 * a ref, because React attaches a parent's ref AFTER its children's layout
 * effects run — a ref from the sheet would still be null on the frame the
 * wires most need to be routed. The chip is this component's own child, so its
 * ref is attached by the time anything here reads it.
 */
const PLAN_SELECTOR = '.agrid__plan';

export function WireOverlay({ vitals }: { vitals: GridVitals }): JSX.Element {
  ensureWireStyles();
  const annotRef = useRef<HTMLButtonElement | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  // Not used in the markup — subscribed so a fold re-runs the measurement below
  // in the very commit that removes the folded district's cards.
  const folded = useSyncExternalStore(
    gridFoldStore.subscribe,
    gridFoldStore.getSnapshot,
    gridFoldStore.getSnapshot
  );
  const alert = sheetAlert(vitals);
  const quiet = prefersReducedMotion();

  const measure = useCallback((): void => {
    const chip = annotRef.current;
    const sheet = chip?.closest<HTMLElement>(PLAN_SELECTOR) ?? null;
    if (!sheet) {
      setGeometry(null);
      return;
    }
    const box = sheet.getBoundingClientRect();
    // The tier gate, against the same constant the sheet's @container uses.
    if (box.width < TREE_MIN_WIDTH) {
      setGeometry(null);
      return;
    }

    const boxes: Partial<Record<RoomId, RoomBox>> = {};
    for (const id of WIRED_ROOMS) {
      const measured = boxOf(sheet.querySelector(`[data-room="${id}"]`), box);
      if (measured) boxes[id] = measured;
    }

    const { wires, faultPath } = layoutWires(boxes, vitals);
    const chipBox = chip?.getBoundingClientRect();
    // The leader leaves the chip's lower-left, a little in from the corner.
    const anchor: Anchor | null =
      chipBox && (chipBox.width > 0 || chipBox.height > 0)
        ? { x: chipBox.left - box.left + 12, y: chipBox.bottom - box.top + 2 }
        : null;
    const leader = alert.active ? leaderPath(anchor, boxes.deploys ?? null) : '';

    setGeometry({ width: box.width, height: box.height, wires, faultPath, leader });
    // `folded` is a dependency rather than a value read here: the cards it
    // hides are simply not found by the query above.
  }, [alert.active, folded, vitals]);

  // A LAYOUT effect: the wires are routed against boxes this commit has just
  // laid out, and running after paint would show a frame of stale routing.
  // This is two of the three triggers — `measure` changes with the readings and
  // with the fold.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // The third: the plan's own box changing. Subscribed once, and reaching
  // `measure` through a ref, so a moved reading does not tear the observer
  // down and rebuild it.
  const latest = useRef(measure);
  useEffect(() => {
    latest.current = measure;
  }, [measure]);
  useEffect(() => {
    const sheet = annotRef.current?.closest<HTMLElement>(PLAN_SELECTOR) ?? null;
    if (!sheet || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => latest.current());
    observer.observe(sheet);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {geometry === null ? null : (
        <svg
          className="agrid__wires"
          data-testid="grid-wires"
          width={geometry.width}
          height={geometry.height}
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          aria-hidden
          focusable="false"
        >
          <defs>
            {KINDS.map((kind) => (
              <marker
                key={kind}
                id={`agrid-arrow-${kind}`}
                markerWidth="6"
                markerHeight="6"
                refX="3"
                refY="3"
                orient="auto"
              >
                <path d="M0.5,0.5 L5.5,3 L0.5,5.5 z" fill={WIRE_INK[kind]} />
              </marker>
            ))}
          </defs>
          {geometry.wires.map((wire) => (
            <path
              key={wire.key}
              className="agrid__wire"
              data-testid="grid-wire"
              data-kind={wire.kind}
              data-edge={wire.key}
              d={wire.d}
              markerEnd={`url(#agrid-arrow-${wire.kind})`}
            />
          ))}
          {geometry.leader ? (
            <path
              className="agrid__leader"
              data-testid="grid-alert-leader"
              d={geometry.leader}
              markerEnd="url(#agrid-arrow-err)"
            />
          ) : null}
          {geometry.faultPath && !quiet ? (
            <circle className="agrid__pulse" data-testid="grid-wire-pulse" r="3.2">
              <animateMotion path={geometry.faultPath} dur="2.4s" repeatCount="indefinite" />
            </circle>
          ) : null}
        </svg>
      )}
      <button
        type="button"
        ref={annotRef}
        className="agrid__annot"
        data-testid="grid-alert"
        data-state={alert.active ? 'alert' : 'clear'}
        disabled={!alert.active}
        title={alert.active ? 'Open Deployments' : undefined}
        onClick={(event) => openRoom('deploys', zoomOriginFrom(event.currentTarget))}
      >
        <span className="material-symbols-outlined agrid__annotico" aria-hidden>
          {alert.active ? 'bolt' : 'check_circle'}
        </span>
        {alert.text}
      </button>
    </>
  );
}
