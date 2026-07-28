/**
 * The plan as a CANVAS — where the sheet is looking, and how far in.
 *
 * The Grid draws a floor plan of the whole platform, and a floor plan is
 * something a person moves around on: at a wide pane the tree is bigger than
 * the room a host pane can give it, and at a tall one it used to sit pinned to
 * the top with dead space underneath. So the plan is a layer with ONE transform
 * on it, and this module is the arithmetic behind that transform.
 *
 * ## Why one transform on one layer
 * The wire overlay measures room cards against the plan's own box, so anything
 * that moved the cards independently of the overlay would tear the wires off
 * the rooms. A single `translate(...) scale(...)` on the layer they BOTH live in
 * cannot: it moves the overlay by exactly as much as the cards it points at.
 * The overlay's own reading only has to divide the measured pixels by the scale
 * to get back to plan-local coordinates, which is what keeps the SVG's
 * coordinate space the same one the routing was written in.
 *
 * ## Why the arithmetic is here rather than in the component
 * Layout is the browser's to do — jsdom has none — so the component's own
 * behaviour cannot be asserted below a real engine. These functions take
 * measurements as plain numbers and return a view, so the fit, the clamp and
 * the zoom-about-a-point are testable exactly, and the component is left
 * holding nothing but the measuring and the event plumbing.
 *
 * NOTHING HERE IS PERSISTED. The view is React state on the sheet: every open
 * starts fitted. A remembered pan could put the faulted room off screen, and a
 * plan whose fault you cannot see is worse than no plan.
 */

/** The plan layer's transform: a translation in stage pixels, then a scale. */
export interface View {
  x: number;
  y: number;
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Edges of the stage the fitted plan must stay clear of. */
export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * How far the canvas zooms. Deliberately a narrow band: this is a schematic
 * whose type has one legible size, so the zoom is for taking in a wide plan or
 * leaning into one district, never for reading it at either extreme.
 *
 * The floor must clear what fit needs at the narrowest tree-tier stage: the
 * plan lays out at a fixed width (~1720px with padding), the tier starts at
 * 960px of stage, and the fit insets take their share — so fit legitimately
 * asks for about (960 − insets) / 1720 ≈ 0.54 there. A floor above that
 * beats fit and the plan clips at both edges instead of shrinking.
 */
export const ZOOM_MIN = 0.53;
export const ZOOM_MAX = 1.5;

/** One press of a zoom control. */
export const ZOOM_STEP = 1.2;

/** The plan at rest in the corner, unscaled — what an unmeasurable stage gets. */
export const IDENTITY: View = { x: 0, y: 0, scale: 1 };

/**
 * What the fit leaves free. The bottom is the deepest because the zoom controls
 * are pinned in that corner and a fitted tree must not end up underneath them;
 * the top clears the pinned alert chip's shadow. These are the only two pieces
 * of chrome the stage draws over the plan, so they are the only two the fit has
 * to account for.
 */
export const FIT_INSET: Inset = { top: 14, right: 18, bottom: 52, left: 18 };

/** Zoom, held inside the band. A non-finite input reads as no zoom at all. */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/**
 * Zoom by `factor` about a point in STAGE coordinates, so whatever is under the
 * cursor stays under the cursor. With `transform-origin: 0 0` a plan point maps
 * to `view.x + scale * p`, so holding the stage point fixed while the scale
 * moves by `k` gives `x' = px - k * (px - x)`.
 *
 * A factor that would leave the band returns the view UNCHANGED rather than a
 * clamped one that has also slid sideways — a zoom that cannot happen must not
 * pan the plan as a consolation.
 */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const scale = clampScale(view.scale * factor);
  if (scale === view.scale) return view;
  const k = scale / view.scale;
  return { x: px - k * (px - view.x), y: py - k * (py - view.y), scale };
}

/** Slide the plan under the stage. Panning never changes the zoom. */
export function panBy(view: View, dx: number, dy: number): View {
  return { x: view.x + dx, y: view.y + dy, scale: view.scale };
}

/**
 * The whole plan, centred in the stage — the view every open starts at and the
 * one the fit control returns to.
 *
 * It never zooms IN to fill the stage: a plan smaller than its viewport is
 * drawn at 1:1 and CENTRED, which is what puts an end to the tree hanging off
 * the top of a tall pane with dead space under it. It does zoom out, as far as
 * the band allows; a plan too big for even that is left clipped and pannable
 * rather than shrunk to illegibility.
 */
export function fitView(plan: Size, stage: Size, inset: Inset = FIT_INSET): View {
  const availWidth = stage.width - inset.left - inset.right;
  const availHeight = stage.height - inset.top - inset.bottom;
  if (plan.width <= 0 || plan.height <= 0 || availWidth <= 0 || availHeight <= 0) {
    return IDENTITY;
  }
  const scale = clampScale(Math.min(1, availWidth / plan.width, availHeight / plan.height));
  return {
    x: inset.left + (availWidth - plan.width * scale) / 2,
    y: inset.top + (availHeight - plan.height * scale) / 2,
    scale,
  };
}

/**
 * Controls a press must reach rather than a drag: everything the plan draws
 * that a person clicks. A drag starting on one of these is that control's, and
 * a room card must still open when the pointer wobbles on the way down.
 */
const CONTROLS = 'button, a[href], input, select, textarea, [role="button"], [contenteditable="true"]';

/**
 * Whether a press landed on empty ground — the only place a pan may start.
 * Anything inside a control belongs to the control.
 */
export function isGround(target: EventTarget | null): boolean {
  if (target === null || typeof (target as Element).closest !== 'function') return true;
  return (target as Element).closest(CONTROLS) === null;
}
