/**
 * The canvas, as a hook — what a stage is showing, and every way a person moves
 * it. Shared by both of the panel's faces.
 *
 * It began inside the Plan's sheet, because the Plan was the only thing drawn
 * on a canvas. The Board is drawn on the same one: a layer with a single
 * transform, dragged by empty ground, panned by wheel, zoomed about the
 * pointer, and returned to a fitted view by a double-click or by the controls
 * in the corner. Two faces meant either two copies of that behaviour or one
 * shared hook, and a second copy would have drifted the moment either face
 * changed how it frames itself.
 *
 * All of it is gated on the TREE tier, measured against the same constant the
 * faces' `@container` rules use — below it a face is an ordinary scrolling
 * column, and turning that into a pannable plane would take away the scrollbar
 * and give nothing back.
 *
 * The arithmetic lives in {@link gridCanvas} so it can be asserted without a
 * layout engine; what is left here is measuring, and listening. Nothing is
 * persisted: every open starts fitted.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from 'react';
import { IDENTITY, fitView, isGround, panBy, zoomAt, type View } from './gridCanvas';
import { TREE_MIN_WIDTH } from './gridWires';

/**
 * The width a face lays out at before the canvas scales it — capped so the
 * drawing does not stretch into a smear on a very wide pane, and centred by the
 * fit. Above it the canvas simply has room to spare around a face drawn at its
 * best size. One number for both faces, so a person flipping between them is
 * looking at the same plane at the same pitch.
 */
export const CANVAS_WIDTH = 1680;

/** How far one wheel notch zooms. Divisor rather than a step so a trackpad's
 *  fine deltas zoom smoothly and a mouse's coarse ones still move. */
const WHEEL_ZOOM_DIVISOR = 260;

export function useGridCanvas(): {
  stageRef: MutableRefObject<HTMLDivElement | null>;
  planRef: MutableRefObject<HTMLDivElement | null>;
  view: View;
  engaged: boolean;
  panning: boolean;
  onMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => void;
  zoomBy: (factor: number) => void;
  fit: () => void;
} {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const planRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>(IDENTITY);
  const [engaged, setEngaged] = useState(false);
  const [panning, setPanning] = useState(false);
  // Read by listeners that are registered once and must not be torn down every
  // time the view moves.
  const engagedRef = useRef(false);
  const viewRef = useRef(view);
  const drag = useRef<{ x: number; y: number; from: View } | null>(null);
  // Whether the reader has framed the plan themselves. A plan that changes size
  // under an untouched view is re-fitted; one somebody has moved is left where
  // they left it.
  const touched = useRef(false);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const fit = useCallback((): void => {
    const stage = stageRef.current;
    const plan = planRef.current;
    if (!stage || !plan) return;
    const stageSize = { width: stage.clientWidth, height: stage.clientHeight };
    const on = stageSize.width >= TREE_MIN_WIDTH;
    engagedRef.current = on;
    setEngaged(on);
    touched.current = false;
    // offsetWidth/Height, not the client rect: those are the plan's LAYOUT box,
    // which a transform does not touch — measuring the rect would fold the
    // current zoom back into the fit that is meant to replace it.
    setView(on ? fitView({ width: plan.offsetWidth, height: plan.offsetHeight }, stageSize) : IDENTITY);
  }, []);

  // A layout effect, and re-run on either box moving. The stage changing size
  // invalidates the framing outright; the plan changing size (a district
  // folding) re-frames only a view nobody has moved.
  useLayoutEffect(() => {
    fit();
    const stage = stageRef.current;
    const plan = planRef.current;
    if (!stage || !plan || typeof ResizeObserver === 'undefined') return;
    const onStage = new ResizeObserver(() => fit());
    onStage.observe(stage);
    const onPlan = new ResizeObserver(() => {
      if (!touched.current) fit();
    });
    onPlan.observe(plan);
    return () => {
      onStage.disconnect();
      onPlan.disconnect();
    };
  }, [fit]);

  // Native and NON-PASSIVE: React registers wheel handlers passively at its own
  // root, where `preventDefault` is ignored — and without it a ctrl-wheel is the
  // host application's zoom rather than the plan's.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent): void => {
      if (!engagedRef.current) return;
      event.preventDefault();
      touched.current = true;
      const box = stage.getBoundingClientRect();
      const px = event.clientX - box.left;
      const py = event.clientY - box.top;
      setView((current) =>
        event.ctrlKey || event.metaKey
          ? zoomAt(current, Math.exp(-event.deltaY / WHEEL_ZOOM_DIVISOR), px, py)
          : panBy(current, -event.deltaX, -event.deltaY)
      );
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  // The move and the release are the WINDOW's, so a drag that leaves the stage
  // keeps panning and a button released outside it still ends the gesture.
  useEffect(() => {
    if (!panning) return;
    const onMove = (event: MouseEvent): void => {
      const start = drag.current;
      if (!start) return;
      touched.current = true;
      setView(panBy(start.from, event.clientX - start.x, event.clientY - start.y));
    };
    const onUp = (): void => {
      drag.current = null;
      setPanning(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [panning]);

  // Ground only, primary button only: a press that starts anywhere on a control
  // belongs to that control, so dragging a room card still opens the room.
  const onMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>): void => {
    if (!engagedRef.current || event.button !== 0 || !isGround(event.target)) return;
    drag.current = { x: event.clientX, y: event.clientY, from: viewRef.current };
    setPanning(true);
  }, []);

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>): void => {
      if (!engagedRef.current || !isGround(event.target)) return;
      fit();
    },
    [fit]
  );

  /** The controls zoom about the middle of the stage — there is no pointer to
   *  zoom about, and the middle is what a reader is looking at. */
  const zoomBy = useCallback((factor: number): void => {
    const stage = stageRef.current;
    if (!stage) return;
    touched.current = true;
    setView((current) => zoomAt(current, factor, stage.clientWidth / 2, stage.clientHeight / 2));
  }, []);

  return { stageRef, planRef, view, engaged, panning, onMouseDown, onDoubleClick, zoomBy, fit };
}
