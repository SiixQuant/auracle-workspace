/**
 * The plan as something a person moves around on.
 *
 * Two kinds of claim, kept apart on purpose:
 *
 *  - the ARITHMETIC is pure, so it is asserted directly — the zoom band, the
 *    zoom that holds a point still under the cursor, and the fit that centres a
 *    plan rather than hanging it off the top of a tall pane;
 *  - the WIRING is asserted through the sheet — a drag on empty ground pans, a
 *    drag on a card does not and still opens the room, the controls move the
 *    view they claim to, and the stacked tiers get no canvas at all.
 *
 * jsdom lays nothing out, so the stage and the plan are given sizes here the
 * way the wire tests give the tree its geometry. What CANNOT be asserted below
 * a real engine is anything that depends on the browser actually applying the
 * transform: that a wire still meets the card it points at once the plan is
 * zoomed is a claim about composited pixels, and the closest this suite can get
 * is the routing's own arithmetic (see gridWires.test.tsx) plus the fact that
 * the overlay divides its measurements by the same scale the layer carries.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const stub = vi.hoisted(() => ({ feeds: {} as Record<string, unknown> }));

vi.mock('../../engine/client', () => ({
  getJson: vi.fn(async (path: string) => {
    for (const [prefix, body] of Object.entries(stub.feeds)) {
      if (path.startsWith(prefix)) return body;
    }
    return null;
  }),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import { GridSheet } from '../grid/GridSheet';
import { getActiveRoom, openGridHome } from '../grid/gridNav';
import {
  FIT_INSET,
  FIT_MAX,
  IDENTITY,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampScale,
  fitView,
  isGround,
  panBy,
  zoomAt,
  type View,
} from '../grid/gridCanvas';
import { TREE_MIN_WIDTH } from '../grid/gridWires';
import { alertStore } from '../../engine/alertStore';
import { gridVitals } from '../../engine/gridVitals';

/* ── a stage and a plan, described because jsdom lays nothing out ───── */

const STAGE = { width: 1500, height: 700 };
const PLAN = { width: 1464, height: 600 };
/** Narrower than the tier gate — the stacked sheet, which has no canvas. */
const NARROW = TREE_MIN_WIDTH - 380;

let restore: (() => void) | null = null;

/** Replace a layout property with one this environment can answer. */
function stubProperty(proto: object, name: string, read: (el: HTMLElement) => number): () => void {
  const original = Object.getOwnPropertyDescriptor(proto, name);
  Object.defineProperty(proto, name, {
    configurable: true,
    get(this: HTMLElement) {
      return read(this);
    },
  });
  return () => {
    if (original) Object.defineProperty(proto, name, original);
  };
}

function has(el: Element, className: string): boolean {
  return el.classList?.contains(className) === true;
}

function rect(width: number, height: number): DOMRect {
  return {
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function installLayout(stageWidth = STAGE.width): void {
  const undo = [
    stubProperty(Element.prototype, 'clientWidth', (el) => (has(el, 'agrid__stage') ? stageWidth : 0)),
    stubProperty(Element.prototype, 'clientHeight', (el) =>
      has(el, 'agrid__stage') ? STAGE.height : 0
    ),
    stubProperty(HTMLElement.prototype, 'offsetWidth', (el) =>
      has(el, 'agrid__plan') ? PLAN.width : 0
    ),
    stubProperty(HTMLElement.prototype, 'offsetHeight', (el) =>
      has(el, 'agrid__plan') ? PLAN.height : 0
    ),
  ];
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function measured(this: Element): DOMRect {
    if (has(this, 'agrid__stage')) return rect(stageWidth, STAGE.height);
    if (has(this, 'agrid__plan')) return rect(PLAN.width, PLAN.height);
    return rect(0, 0);
  };
  undo.push(() => {
    Element.prototype.getBoundingClientRect = original;
  });
  restore = () => undo.forEach((fn) => fn());
}

/** The transform the plan layer is actually carrying. */
function viewOf(): View {
  const transform = screen.getByTestId('grid-plan').style.transform;
  const read = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(transform);
  if (!read) throw new Error(`no view in transform: "${transform}"`);
  return { x: Number(read[1]), y: Number(read[2]), scale: Number(read[3]) };
}

function stage(): HTMLElement {
  return screen.getByTestId('grid-stage');
}

beforeEach(() => {
  stub.feeds = {};
  gridVitals.reset();
  installLayout();
});

afterEach(async () => {
  cleanup();
  restore?.();
  restore = null;
  openGridHome();
  stub.feeds = {};
  await alertStore.refresh();
  gridVitals.reset();
});

/* ── the arithmetic (pure) ──────────────────────────────────────────── */

describe('the zoom is held inside its band', () => {
  it('clamps at both ends, and treats a non-number as no zoom', () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(0.1)).toBe(ZOOM_MIN);
    expect(clampScale(9)).toBe(ZOOM_MAX);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it('holds the point under the cursor still while it zooms', () => {
    const before: View = { x: 40, y: 20, scale: 1 };
    const after = zoomAt(before, 1.25, 300, 200);

    expect(after.scale).toBeCloseTo(1.25, 6);
    // The same plan point sits under the same stage point, before and after.
    expect((300 - after.x) / after.scale).toBeCloseTo((300 - before.x) / before.scale, 6);
    expect((200 - after.y) / after.scale).toBeCloseTo((200 - before.y) / before.scale, 6);
  });

  it('refuses a zoom it cannot make rather than panning as a consolation', () => {
    const atMax: View = { x: 12, y: 12, scale: ZOOM_MAX };
    expect(zoomAt(atMax, 2, 300, 200)).toBe(atMax);
    const atMin: View = { x: 12, y: 12, scale: ZOOM_MIN };
    expect(zoomAt(atMin, 0.5, 300, 200)).toBe(atMin);
  });

  it('never changes the zoom while panning', () => {
    expect(panBy({ x: 10, y: 20, scale: 1.4 }, -5, 7)).toEqual({ x: 5, y: 27, scale: 1.4 });
  });
});

describe('the fit frames the whole plan', () => {
  it('centres a plan shorter than the stage instead of hanging it off the top', () => {
    const view = fitView(PLAN, STAGE);
    expect(view.scale).toBe(1);

    const free = {
      width: STAGE.width - FIT_INSET.left - FIT_INSET.right - PLAN.width,
      height: STAGE.height - FIT_INSET.top - FIT_INSET.bottom - PLAN.height,
    };
    expect(view.x).toBeCloseTo(FIT_INSET.left + free.width / 2, 6);
    expect(view.y).toBeCloseTo(FIT_INSET.top + free.height / 2, 6);
    // Centred means equal margins, which is the whole of the complaint about
    // dead space: what is left over is shared, never all left underneath.
    expect(STAGE.height - FIT_INSET.bottom - (view.y + PLAN.height)).toBeCloseTo(free.height / 2, 6);
  });

  it('zooms out for a plan too big for the stage', () => {
    const wide = fitView({ width: 2000, height: 600 }, STAGE);
    expect(wide.scale).toBeLessThan(1);
    expect(wide.scale).toBeCloseTo((STAGE.width - FIT_INSET.left - FIT_INSET.right) / 2000, 6);
  });

  it('fills the frame with a plan that has room to spare, up to the ceiling', () => {
    // A sparse board: comfortably inside the frame both ways, and drawn at 1:1
    // it was a stamp in the middle of an empty pane. The fit takes it up until
    // one edge runs out or the ceiling stops it.
    const roomy = fitView({ width: 300, height: 200 }, STAGE);
    expect(roomy.scale).toBe(FIT_MAX);

    // Whichever edge runs out FIRST decides — filling one way must never push
    // the plan past the frame the other way.
    const tall = fitView({ width: 300, height: 560 }, STAGE);
    const availHeight = STAGE.height - FIT_INSET.top - FIT_INSET.bottom;
    expect(tall.scale).toBeCloseTo(availHeight / 560, 6);
    expect(tall.scale).toBeLessThan(FIT_MAX);
    expect(560 * tall.scale).toBeLessThanOrEqual(availHeight + 0.001);

    // And a plan already filling its frame is left where it is.
    expect(fitView(PLAN, STAGE).scale).toBe(1);
  });

  it('leaves the reader a step of zoom past a filled fit', () => {
    // The ceiling is the STARTING scale, not the band: a board the fit filled
    // must still answer the zoom control.
    expect(FIT_MAX).toBeLessThan(ZOOM_MAX);
    expect(zoomAt({ x: 0, y: 0, scale: FIT_MAX }, ZOOM_STEP, 0, 0).scale).toBeGreaterThan(FIT_MAX);
  });

  it('reaches the whole tree at the narrowest tree-tier stage', () => {
    // The plan lays out at a fixed width (~1720px with padding) and the tree
    // tier starts at 960px of stage, so the fit the floor must not beat is
    // avail/1720. A ZOOM_MIN above that clipped both edges of the rank on
    // narrow panels instead of shrinking the schematic to fit.
    const plan = { width: 1720, height: 394 };
    for (const stageWidth of [960, 1000, 1300]) {
      const stage = { width: stageWidth, height: 850 };
      const view = fitView(plan, stage);
      expect(view.scale * plan.width).toBeLessThanOrEqual(
        stageWidth - FIT_INSET.left - FIT_INSET.right + 0.001
      );
      expect(view.scale).toBeGreaterThanOrEqual(ZOOM_MIN);
    }
  });

  it('keeps the plan clear of the chip and the controls', () => {
    // A plan exactly as tall as the stage still has to scale down: the corner
    // controls and the pinned chip are drawn over it, not beside it.
    const view = fitView({ width: 400, height: STAGE.height }, STAGE);
    expect(view.scale).toBeLessThan(1);
    expect(view.y).toBeGreaterThanOrEqual(FIT_INSET.top);
    expect(view.y + STAGE.height * view.scale).toBeLessThanOrEqual(STAGE.height - FIT_INSET.bottom);
  });

  it('asks for nothing it cannot measure', () => {
    expect(fitView({ width: 0, height: 0 }, STAGE)).toEqual(IDENTITY);
    expect(fitView(PLAN, { width: 0, height: 0 })).toEqual(IDENTITY);
  });
});

describe('a press that lands on a control belongs to it', () => {
  it('reads only empty ground as ground', () => {
    document.body.innerHTML = `
      <div id="ground"><span id="text">plan</span><button id="card"><span id="ico">x</span></button></div>
    `;
    expect(isGround(document.getElementById('ground'))).toBe(true);
    expect(isGround(document.getElementById('text'))).toBe(true);
    // Including a press that lands on something INSIDE a control.
    expect(isGround(document.getElementById('card'))).toBe(false);
    expect(isGround(document.getElementById('ico'))).toBe(false);
    expect(isGround(null)).toBe(true);
    document.body.innerHTML = '';
  });
});

/* ── the canvas on the sheet ────────────────────────────────────────── */

describe('the sheet opens fitted', () => {
  it('frames the whole plan, centred, on the first paint', () => {
    render(<GridSheet />);

    expect(stage().getAttribute('data-canvas')).toBe('on');
    expect(viewOf()).toEqual(fitView(PLAN, STAGE));
  });
});

describe('the plan can be moved', () => {
  it('pans with a drag across empty ground', () => {
    render(<GridSheet />);
    const start = viewOf();

    fireEvent.mouseDown(stage(), { button: 0, clientX: 400, clientY: 300 });
    expect(stage().getAttribute('data-panning')).toBe('true');

    // Spelled out rather than run back through panBy: an assertion that reuses
    // the arithmetic it is checking would agree with any arithmetic at all.
    const moved = { x: start.x + 60, y: start.y + 40, scale: start.scale };
    fireEvent.mouseMove(window, { clientX: 460, clientY: 340 });
    expect(viewOf()).toEqual(moved);

    fireEvent.mouseUp(window);
    expect(stage().getAttribute('data-panning')).toBe('false');
    // The release ends the gesture; the plan stays where it was left.
    fireEvent.mouseMove(window, { clientX: 900, clientY: 900 });
    expect(viewOf()).toEqual(moved);
  });

  it('leaves the view alone when the drag starts on a card, and still opens it', () => {
    render(<GridSheet />);
    const start = viewOf();
    const card = screen.getByTestId('grid-home-room-deploys');

    fireEvent.mouseDown(card, { button: 0, clientX: 300, clientY: 400 });
    expect(stage().getAttribute('data-panning')).toBe('false');
    fireEvent.mouseMove(window, { clientX: 360, clientY: 430 });
    expect(viewOf()).toEqual(start);

    fireEvent.click(card);
    expect(getActiveRoom()).toBe('deploys');
  });

  it('ignores a press that is not the primary button', () => {
    render(<GridSheet />);
    fireEvent.mouseDown(stage(), { button: 2, clientX: 400, clientY: 300 });
    expect(stage().getAttribute('data-panning')).toBe('false');
  });

  it('pans on a plain wheel', () => {
    render(<GridSheet />);
    const start = viewOf();

    fireEvent.wheel(stage(), { deltaX: 30, deltaY: 50 });
    expect(viewOf()).toEqual({ x: start.x - 30, y: start.y - 50, scale: start.scale });
  });
});

describe('the plan can be zoomed', () => {
  it('zooms about the pointer on a ctrl-wheel', () => {
    render(<GridSheet />);
    const before = viewOf();

    fireEvent.wheel(stage(), { deltaY: -120, ctrlKey: true, clientX: 500, clientY: 300 });
    const after = viewOf();

    expect(after.scale).toBeGreaterThan(before.scale);
    expect((500 - after.x) / after.scale).toBeCloseTo((500 - before.x) / before.scale, 5);
    expect((300 - after.y) / after.scale).toBeCloseTo((300 - before.y) / before.scale, 5);
  });

  it('steps with the controls and stops at both ends of the band', () => {
    render(<GridSheet />);
    const fitted = viewOf();

    fireEvent.click(screen.getByTestId('grid-zoom-in'));
    expect(viewOf().scale).toBeCloseTo(fitted.scale * ZOOM_STEP, 6);

    for (let press = 0; press < 8; press += 1) {
      fireEvent.click(screen.getByTestId('grid-zoom-in'));
    }
    expect(viewOf().scale).toBe(ZOOM_MAX);
    expect((screen.getByTestId('grid-zoom-in') as HTMLButtonElement).disabled).toBe(true);

    for (let press = 0; press < 12; press += 1) {
      fireEvent.click(screen.getByTestId('grid-zoom-out'));
    }
    expect(viewOf().scale).toBe(ZOOM_MIN);
    expect((screen.getByTestId('grid-zoom-out') as HTMLButtonElement).disabled).toBe(true);
  });

  it('goes back to the fitted view from the control and from a double-click', () => {
    render(<GridSheet />);
    const fitted = viewOf();

    fireEvent.click(screen.getByTestId('grid-zoom-in'));
    expect(viewOf()).not.toEqual(fitted);
    fireEvent.click(screen.getByTestId('grid-zoom-fit'));
    expect(viewOf()).toEqual(fitted);

    fireEvent.mouseDown(stage(), { button: 0, clientX: 400, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 500, clientY: 380 });
    fireEvent.mouseUp(window);
    expect(viewOf()).not.toEqual(fitted);

    fireEvent.doubleClick(stage());
    expect(viewOf()).toEqual(fitted);
  });

  it('does not refit on a double-click that landed on a card', () => {
    render(<GridSheet />);
    fireEvent.click(screen.getByTestId('grid-zoom-in'));
    const zoomed = viewOf();

    fireEvent.doubleClick(screen.getByTestId('grid-home-room-blotter'));
    expect(viewOf()).toEqual(zoomed);
  });
});

describe('the stacked tiers are left alone', () => {
  it('draws no canvas, no controls and no transform below the tree tier', () => {
    restore?.();
    installLayout(NARROW);
    render(<GridSheet />);

    expect(stage().getAttribute('data-canvas')).toBe('off');
    expect(screen.queryByTestId('grid-zoom')).toBeNull();
    expect(screen.getByTestId('grid-plan').style.transform).toBe('');

    // And the column still scrolls, because nothing here took that away.
    fireEvent.mouseDown(stage(), { button: 0, clientX: 100, clientY: 100 });
    expect(stage().getAttribute('data-panning')).toBe('false');
    expect(screen.getByTestId('grid-plan').style.transform).toBe('');
  });
});
