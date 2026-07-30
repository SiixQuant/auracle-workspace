/**
 * The Grid sheet — the system drawn as a floor plan.
 *
 * A root node, four districts under it, and every room laid out at UNIFORM
 * depth beneath its district. The point of the uniform depth is that the sheet
 * reads as one plan rather than a menu: no room is buried, so the state of the
 * whole platform is one glance, and the room that needs a person is identified
 * with zero clicks (its dot, its note, and the flag on its district's label).
 *
 * WHERE THE VALUES COME FROM: {@link gridVitals}, which composes the readings
 * from the sources the pre-Grid panels already read. A source that has not
 * answered renders QUIET — the note line is simply absent — never a number
 * held over from an earlier fetch.
 *
 * FIRST PAINT: the vitals snapshot is read with `useSyncExternalStore` off a
 * module-level object, so the whole plan paints on the first frame (quiet on a
 * cold start, populated on any later visit) and fills in as fetches land.
 * Nothing here awaits before rendering.
 *
 * READING WITHOUT CLICKING: two things keep the plan a plan as it fills up.
 * Resting on a room lifts a peek ({@link useRoomPeek}) carrying that room's
 * reading and what it is for, so a card can be understood without opening it.
 * A district folds to a count chip ({@link gridFoldStore}), so the floors a
 * person is not working on can be put away without leaving the plan — and
 * because the fold lives in a store rather than in this component's state,
 * anything else drawn off the plan's shape redraws with it.
 *
 * LAYOUT: `@container`, never `@media`. The Grid renders inside a host pane
 * whose width has nothing to do with the window's. Three tiers, written
 * mobile-first: a single stacked column by default; rooms in a row under each
 * district once there is room for them; and the full plan — root on top, the
 * four districts side by side, each one's rooms stacked in a COLUMN under its
 * own header — only when the pane is wide enough to draw it without scrolling
 * sideways. The rails are drawn with border-box pseudo-elements, so the
 * geometry costs no dependency.
 *
 * ALIGNMENT: the plan tier gives every district ONE column of equal width and
 * stacks its rooms down it. That is what makes the grouping the headers declare
 * an actual property of the layout: a room is under the group it belongs to
 * rather than somewhere along a rank of eleven. It also buys every card most of
 * a column's width, so a room's name is written out rather than truncated, and
 * it turns the plan from a strip into a block that has some height to it.
 *
 * The rank of eleven this replaced put every room at the same depth, which was
 * the point — but at any real pane width eleven cards in a row is a crush, and
 * scaling the crush up only makes it bigger. Uniform depth is kept: every room
 * is exactly one step under its district, and no room is buried.
 *
 * CANVAS: at the tree tier the plan is a layer with one transform on it
 * ({@link gridCanvas}) inside a stage that clips. Drag empty ground to pan,
 * wheel to pan, ctrl/cmd-wheel to zoom about the pointer, and the controls in
 * the corner (or a double-click on empty ground) to return to the fitted view.
 * Nothing is persisted: every open starts fitted, because a remembered pan
 * could put a faulted room off screen. Pressing a card is untouched — a drag
 * only pans when it starts on ground rather than on a control.
 *
 * WIRES: the full plan tier also carries a wire overlay and one pinned alert
 * ({@link WireOverlay}), both INSIDE the transformed layer so a pan or a zoom
 * moves the wires and the cards they join by exactly the same pixels. Both are
 * that tier's alone — the stacked tiers have no group columns for the trunks to
 * stand between — so the plan reserves the gutters ({@link GROUP_GAP}) and the
 * leader's channel ({@link LEADER_CHANNEL}) there and nowhere else. At rest only
 * the edges that are saying something are drawn; resting on a wired card or on
 * the alert chip reveals the rest of the flow.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { gridVitals, type GridVitals, type RoomVital } from '../../engine/gridVitals';
import { tint, tone } from '../panelkit';
import { PALETTE_HINT, openPalette } from './gridCommands';
import { openRoomFocused, zoomOriginFrom } from './gridNav';
import {
  DISTRICTS,
  HEALTH_COLOR,
  HEALTH_WORD,
  ROOM_ICONS,
  districtHealth,
  districtSummary,
  roomsNeedingAttention,
  type District,
} from './districts';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './gridCanvas';
import { CANVAS_WIDTH, useGridCanvas } from './useGridCanvas';
import { gridFoldStore, type FoldedDistricts } from './gridFoldStore';
import { GRID_ACCENT, GRID_ACCENT_DIM, GRID_ACCENT_SOFT } from './gridTheme';
import { GridAiStrip } from './GridAiStrip';
import { GROUP_GAP, LEADER_CHANNEL, TREE_MIN_WIDTH, WIRED_ROOMS } from './gridWires';
import { useRoomPeek, type PeekHandlers } from './RoomPeek';
import { WireOverlay } from './WireOverlay';
import { ROOMS, ROOM_IDS, type RoomId } from './rooms';

const STYLE_ID = 'auracle-grid-sheet-styles';

/**
 * Rail hairline — one step up from the card border so the tree stays legible
 * against the canvas without competing with the cards it connects.
 *
 * SOLID, always. A dash on this sheet means one thing only, and that is a data
 * wire; the structure of the tree is not data and never speaks in the same
 * pattern. Faint, but not fainter: dropped to the card-border weight it stopped
 * reading as a tree at all once the plan could be zoomed out.
 */
const RAIL = tone.borderStrong;

/**
 * The plan's ceiling below the canvas tier, so the stacked sheet does not
 * stretch into a smear on a very wide pane. Held with the canvas rather than
 * here, because both of the panel's faces are cut to it — see
 * {@link CANVAS_WIDTH}.
 */
const PLAN_MAX_WIDTH = CANVAS_WIDTH;

/**
 * How wide the plan lays itself out ON THE CANVAS, before the fit scales it.
 *
 * Four group columns rather than one rank of eleven, so the width the drawing
 * asks for is a quarter of what it was — and the fit, which scales UP as well as
 * down, takes it back to filling the pane at a size where the type is BIGGER
 * than the crushed rank ever managed. Chosen so a column carries a room card of
 * about the Board's own card width: the two faces are drawn at one pitch, and a
 * room's name fits on one line at every reading size.
 */
const PLAN_TREE_WIDTH = 1080;

/** The room column's indent inside its group, and where the group's spine is
 *  drawn in it — the rail sits in the indent, the stub crosses the rest. */
const ROOM_INDENT = 18;
const SPINE_X = 8;

/** Between two rooms stacked in one group column. Also the length of the bridge
 *  each card's rail runs back up through, so the spine is unbroken — and the
 *  room a wire between two neighbours has to be drawn in, which is why it is
 *  not the tightest gap that would still read as a group. */
const ROOM_STEP = 16;

/** The rooms an edge touches — resting on one of these reveals the flow. */
const WIRED = new Set<RoomId>(WIRED_ROOMS);

const SHEET = `
/* A column so the AI strip can sit along the bottom of the plan and stay
   there: the stage above it takes whatever height is left, so the strip is
   always at the foot of the pane whatever the plan is doing inside it. */
.agrid { min-height: 100%; display: flex; flex-direction: column; }
/* The STAGE is the viewport the plan is seen through. Below the tree tier it is
   an ordinary scrolling column and the plan sits in it in flow; at the tree
   tier it clips and the plan becomes a layer with one transform on it. */
.agrid__stage { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; }
.agrid__plan { position: relative; display: flex; flex-direction: column; width: 100%; max-width: ${PLAN_MAX_WIDTH}px; margin: 0 auto; padding: 18px 20px 44px; }
.agrid__hint { margin: 0 0 14px; font-size: 11.5px; line-height: 1.5; color: ${tone.text3}; }
/* Pinned to the stage rather than the plan, so the controls that move the plan
   do not move with it. */
.agrid__zoom { position: absolute; right: 14px; bottom: 12px; z-index: 7; display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px; border: 1px solid ${tone.border}; background: ${tone.surface}; box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
.agrid__zbtn { appearance: none; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: ${tone.text3}; cursor: pointer; transition: background-color 150ms ease-out, color 150ms ease-out; }
.agrid__zbtn:hover:not(:disabled) { background: ${tone.surface2}; color: ${tone.text}; }
.agrid__zbtn:disabled { opacity: 0.35; cursor: default; }
.agrid__zbtn:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.agrid__zbtn .material-symbols-outlined { font-size: 17px; line-height: 1; }
.agrid__root { position: relative; z-index: 1; appearance: none; font: inherit; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 3px; padding: 10px 13px; border-radius: 10px; border: 1px solid ${GRID_ACCENT_DIM}; background: ${GRID_ACCENT_SOFT}; transition: border-color 150ms ease-out, background-color 150ms ease-out; }
.agrid__root:hover { border-color: ${GRID_ACCENT}; background: ${tone.surface3}; }
.agrid__root:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.agrid__rootrow { display: flex; align-items: center; gap: 10px; }
.agrid__rootname { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: -0.01em; color: ${tone.text}; }
.agrid__rootkey { margin-left: auto; font-family: ${tone.mono}; font-size: 10px; letter-spacing: 0.04em; color: ${tone.text3}; border: 1px solid ${tone.border}; border-radius: 5px; padding: 1px 5px; }
.agrid__rootnote { font-size: 11.5px; color: ${tone.text2}; }
@media (prefers-reduced-motion: reduce) { .agrid__root { transition: none; } }
.agrid__stem { display: none; flex: none; width: 1px; background: ${RAIL}; }
.agrid__districts { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 16px; margin-top: 16px; }
.agrid__district { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.agrid__label { display: flex; flex-direction: column; gap: 3px; max-width: 100%; min-width: 0; padding: 8px 12px; border-radius: 8px; border: 1px solid ${tone.border}; background: ${tone.surface}; }
.agrid__ltop { display: flex; align-items: center; gap: 9px; min-width: 0; }
.agrid__num { flex: none; font-family: ${tone.mono}; font-size: 11px; font-weight: 650; color: ${GRID_ACCENT}; }
.agrid__name { min-width: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.13em; color: ${tone.text2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.agrid__flag { font-size: 13px; line-height: 1; }
.agrid__fold { appearance: none; margin-left: auto; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: ${tone.text3}; cursor: pointer; transition: background-color 150ms ease-out, color 150ms ease-out; }
.agrid__fold:hover { background: ${tone.surface2}; color: ${tone.text}; }
.agrid__fold:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.agrid__fold .material-symbols-outlined { font-size: 17px; line-height: 1; }
/* Width 0 + min-width 100%: the summary fills its label but contributes
   NOTHING to the plan's intrinsic width, so a district that happens to have a
   lot to report cannot widen the rank it sits over. */
.agrid__sum { width: 0; min-width: 100%; font-size: 11px; color: ${tone.text3}; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agrid__count { align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; border: 1px solid ${tone.border}; background: ${tone.surface}; font-size: 11.5px; color: ${tone.text2}; }
.agrid__cdot { flex: none; width: 6px; height: 6px; border-radius: 50%; }
.agrid__rooms { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.agrid__slot { display: flex; min-width: 0; }
.agrid__room { appearance: none; flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; text-align: left; font: inherit; cursor: pointer; padding: 9px 12px; border-radius: 9px; border: 1px solid ${tone.border}; background: ${tone.surface}; transition: border-color 150ms ease-out, background-color 150ms ease-out; }
.agrid__room[data-health='degraded'] { border-color: ${tint(tone.caution, 45)}; }
.agrid__room[data-health='fault'] { border-color: ${tint(tone.danger, 55)}; }
/* Hover raises the plane on every card, but only a NOMINAL card takes the
   Grid accent on its border — a room reporting trouble keeps its own colour
   under the pointer, or hovering would erase the reading. */
.agrid__room:hover { background: ${tone.surface2}; }
.agrid__room[data-health='nominal']:hover { border-color: ${GRID_ACCENT_DIM}; }
.agrid__room[data-health='nominal']:active { border-color: ${GRID_ACCENT}; }
.agrid__room:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.agrid__rtop { display: flex; align-items: center; gap: 8px; min-width: 0; }
.agrid__rico { font-size: 14px; line-height: 1; flex: none; color: ${tone.text3}; }
.agrid__room[data-health='degraded'] .agrid__rico { color: ${tone.caution}; }
.agrid__room[data-health='fault'] .agrid__rico { color: ${tone.danger}; }
.agrid__rtitle { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 600; color: ${tone.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agrid__rdot { flex: none; width: 6px; height: 6px; border-radius: 50%; }
.agrid__rnote { width: 0; min-width: 100%; font-size: 11px; color: ${tone.text3}; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agrid__room[data-health='fault'] .agrid__rnote { color: ${tone.danger}; }

@container auracle-grid (min-width: 640px) {
  .agrid__rooms { grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); }
}

@container auracle-grid (min-width: ${TREE_MIN_WIDTH}px) {
  /* The plan is a LAYER now: one transform moves it inside the stage, which
     clips. Everything the wires measure lives in here with it, so a pan or a
     zoom moves the schematic without disturbing the geometry drawn on it.
     The right padding is the LEADER'S CHANNEL: the alert's leader comes down
     the plan's own margin, so the margin has to be wide enough to hold it and
     clear of the last column's cards. Symmetric, because the fit centres the
     plan by its BOX and a strip along one edge is an offset it cannot see. */
  .agrid__stage { overflow: hidden; cursor: grab; user-select: none; }
  .agrid__stage[data-panning='true'] { cursor: grabbing; }
  /* The plan does not squeeze to the stage: it lays out at its own ideal
     width — four columns wide enough that every name fits — and the canvas
     fit-scales the whole schematic to whatever stage it is given, up as well
     as down. That is what lets the plan survive containers far narrower than
     its natural size AND fill ones with room to spare. */
  .agrid__plan { position: absolute; top: 0; left: 0; margin: 0; transform-origin: 0 0; align-items: center; padding: 24px ${LEADER_CHANNEL * 2}px 30px; width: max-content; min-width: ${PLAN_TREE_WIDTH}px; max-width: none; }
  .agrid__hint { text-align: center; }
  .agrid__root { width: 218px; }
  .agrid__stem { display: block; height: 18px; }
  /* ONE column per district, all of them equal, with the gutter between them
     wide enough for the wires' trunks to stand in ({@link GROUP_GAP}).
     minmax(0, 1fr) rather than a bare 1fr: a bare fr track takes its content's
     min-content as a floor, so one long district name would widen its column
     and shove every column to its right out of alignment. */
  .agrid__districts { display: grid; grid-template-columns: repeat(${DISTRICTS.length}, minmax(0, 1fr)); align-items: start; gap: 0 ${GROUP_GAP}px; margin-top: 0; width: 100%; }
  /* The rank rail runs across the tops of the four columns and drops a stub
     into each header — the one horizontal in the drawing, and what says the
     four groups are four parts of one plan. */
  .agrid__district { min-width: 0; align-items: stretch; gap: 0; position: relative; padding: 18px 0 0; }
  .agrid__district::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: ${RAIL}; }
  .agrid__district:first-child::before { left: 50%; }
  .agrid__district:last-child::before { right: 50%; }
  .agrid__district::after { content: ''; position: absolute; top: 0; left: 50%; width: 1px; height: 18px; background: ${RAIL}; }
  /* THE GROUP'S ROOMS, stacked under its header. The spine runs down the
     indent and each card is joined to it by a stub at its own centreline, so
     the group reads as a bracketed list however many rooms it holds and
     however tall the cards run. */
  .agrid__rooms { display: grid; grid-template-columns: minmax(0, 1fr); grid-auto-flow: row; align-items: stretch; gap: ${ROOM_STEP}px; margin-top: ${ROOM_STEP}px; width: 100%; }
  .agrid__slot { min-width: 0; position: relative; padding: 0 0 0 ${ROOM_INDENT}px; }
  /* Up through the gap to the card above (or to the header, for the first),
     and down to this card's own centreline — which is where the stub leaves. */
  .agrid__slot::before { content: ''; position: absolute; left: ${SPINE_X}px; top: -${ROOM_STEP}px; height: calc(50% + ${ROOM_STEP}px); width: 1px; background: ${RAIL}; }
  .agrid__slot::after { content: ''; position: absolute; left: ${SPINE_X}px; top: 50%; width: ${ROOM_INDENT - SPINE_X}px; height: 1px; background: ${RAIL}; }
  .agrid__room { margin: 0; }
  /* Under the header rather than under a rail: a folded group has no spine to
     hang the chip off. */
  .agrid__count { align-self: flex-start; margin-top: ${ROOM_STEP}px; }
}

@media (prefers-reduced-motion: reduce) {
  .agrid__fold, .agrid__room, .agrid__zbtn { transition: none; }
}
`;

function ensureSheetStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** One room: icon, title, health dot, and the one line it can currently back. */
function RoomCard({
  id,
  vital,
  peek,
  onReveal,
}: {
  id: RoomId;
  vital: RoomVital;
  peek: PeekHandlers;
  /** Raised while the pointer rests on a room an edge touches. */
  onReveal: (revealed: boolean) => void;
}): JSX.Element {
  const room = ROOMS[id];
  const wired = WIRED.has(id);
  const label = vital.note
    ? `${room.title} — ${HEALTH_WORD[vital.health]}, ${vital.note}`
    : `${room.title} — ${HEALTH_WORD[vital.health]}`;
  return (
    <div className="agrid__slot">
      <button
        type="button"
        className="apk-card agrid__room"
        data-testid={`grid-home-room-${id}`}
        data-room={id}
        data-health={vital.health}
        data-wired={wired ? 'true' : 'false'}
        aria-label={label}
        // No `title`: the peek says the same thing sooner and says more, and a
        // native tooltip firing a second later would land on top of it.
        // The room page zooms out of the card that was pressed, so the press
        // and the arrival read as one gesture rather than a screen swap.
        onClick={(event) => openRoomFocused(id, undefined, zoomOriginFrom(event.currentTarget))}
        // The peek's handlers and the wire reveal answer the same rest on the
        // same card, so they are composed here rather than spread: one of them
        // would otherwise quietly replace the other.
        onMouseEnter={(event) => {
          peek.onMouseEnter(event);
          if (wired) onReveal(true);
        }}
        onMouseLeave={() => {
          peek.onMouseLeave();
          if (wired) onReveal(false);
        }}
      >
        <span className="agrid__rtop">
          <span className="material-symbols-outlined agrid__rico" aria-hidden>
            {ROOM_ICONS[id]}
          </span>
          <span className="agrid__rtitle">{room.title}</span>
          <span
            aria-hidden
            className="agrid__rdot"
            data-testid={`grid-home-dot-${id}`}
            data-health={vital.health}
            style={{ background: HEALTH_COLOR[vital.health] }}
          />
        </span>
        {/* Absent, not blank: a room whose source has not answered shows no
            note rather than a placeholder that could be read as a reading. */}
        {vital.note ? (
          <span className="agrid__rnote" data-testid={`grid-home-note-${id}`}>
            {vital.note}
          </span>
        ) : null}
      </button>
    </div>
  );
}

/**
 * One district: its number, its name, what its rooms add up to, and a flag the
 * moment any room inside it stops being nominal.
 *
 * FOLDED, the rooms are replaced by a count chip carrying the same worst-case
 * reading the flag reports — so a put-away floor still says how it is, and a
 * fault can never hide behind a fold. The chip and the room row share one
 * element id, so the toggle's `aria-controls` always names the live region.
 */
function DistrictBlock({
  district,
  vitals,
  folded,
  peek,
  onReveal,
}: {
  district: District;
  vitals: GridVitals;
  folded: boolean;
  peek: (id: RoomId) => PeekHandlers;
  onReveal: (revealed: boolean) => void;
}): JSX.Element {
  const health = districtHealth(district, vitals);
  const bodyId = `agrid-rooms-${district.id}`;
  return (
    <section
      className="agrid__district"
      data-testid={`grid-district-${district.id}`}
      data-district={district.number}
      data-health={health}
      data-folded={folded ? 'true' : 'false'}
    >
      <div className="agrid__label">
        <span className="agrid__ltop">
          <span className="agrid__num">{district.number}</span>
          <span className="agrid__name">{district.name}</span>
          {health === 'nominal' ? null : (
            <span
              className="material-symbols-outlined agrid__flag"
              data-testid={`grid-district-flag-${district.id}`}
              data-health={health}
              role="img"
              aria-label={`${district.name} ${HEALTH_WORD[health]}`}
              style={{ color: HEALTH_COLOR[health] }}
            >
              flag
            </span>
          )}
          <button
            type="button"
            className="agrid__fold"
            data-testid={`grid-district-fold-${district.id}`}
            aria-expanded={!folded}
            aria-controls={bodyId}
            aria-label={`${folded ? 'Expand' : 'Collapse'} the ${district.name} district`}
            onClick={() => gridFoldStore.set(district.id, !folded)}
          >
            <span className="material-symbols-outlined" aria-hidden>
              {folded ? 'chevron_right' : 'expand_more'}
            </span>
          </button>
        </span>
        <span className="agrid__sum" data-testid={`grid-district-summary-${district.id}`}>
          {districtSummary(district, vitals)}
        </span>
      </div>
      <span className="agrid__stem" aria-hidden />
      {folded ? (
        <div
          id={bodyId}
          className="agrid__count"
          data-testid={`grid-district-count-${district.id}`}
          data-health={health}
        >
          <span>{district.rooms.length} rooms</span>
          <span aria-hidden>·</span>
          <span
            className="agrid__cdot"
            data-testid={`grid-district-countdot-${district.id}`}
            data-health={health}
            role="img"
            aria-label={HEALTH_WORD[health]}
            style={{ background: HEALTH_COLOR[health] }}
          />
        </div>
      ) : (
        <div id={bodyId} className="agrid__rooms">
          {district.rooms.map((id) => (
            <RoomCard key={id} id={id} vital={vitals[id]} peek={peek(id)} onReveal={onReveal} />
          ))}
        </div>
      )}
    </section>
  );
}

export function GridSheet(): JSX.Element {
  ensureSheetStyles();
  const vitals = useSyncExternalStore(
    gridVitals.subscribe,
    gridVitals.getSnapshot,
    gridVitals.getSnapshot
  );
  // One subscription for the whole plan, not one per district: the fold store's
  // snapshot only changes reference when a district actually folds.
  const folded: FoldedDistricts = useSyncExternalStore(
    gridFoldStore.subscribe,
    gridFoldStore.getSnapshot,
    gridFoldStore.getSnapshot
  );
  const { handlers, peek } = useRoomPeek(vitals);
  const attention = roomsNeedingAttention(vitals);
  const canvas = useGridCanvas();
  // Whether the quiet wires are being asked for. Component state, not a store:
  // a hover belongs to the pointer that raised it and must not outlive the
  // mount, let alone the session.
  const [revealed, setRevealed] = useState(false);
  // A fold takes cards out of the DOM without their ever firing a mouseleave,
  // which would strand the reveal on: the same stranding the peek clears for
  // the same reason.
  useEffect(() => {
    setRevealed(false);
  }, [folded]);

  return (
    <div className="agrid" data-testid="auracle-grid-home">
      <div
        ref={canvas.stageRef}
        className="agrid__stage"
        data-testid="grid-stage"
        data-canvas={canvas.engaged ? 'on' : 'off'}
        data-panning={canvas.panning ? 'true' : 'false'}
        onMouseDown={canvas.onMouseDown}
        onDoubleClick={canvas.onDoubleClick}
      >
        <div
          ref={canvas.planRef}
          className="agrid__plan"
          data-testid="grid-plan"
          // Only while the canvas is engaged: below the tree tier the plan is
          // an ordinary column in an ordinary scroll box, and a transform there
          // would move a plan that has nowhere to be moved to.
          style={
            canvas.engaged
              ? {
                  transform: `translate(${canvas.view.x}px, ${canvas.view.y}px) scale(${canvas.view.scale})`,
                }
              : undefined
          }
        >
          <p className="agrid__hint">
            The system as a floor plan — every surface, and what it is doing right now.
          </p>
          {/* Covers and measures the plan it sits in, so it goes inside it —
              which is also what keeps it glued to the cards through a pan.
              Draws only at the full tree tier — see WireOverlay. */}
          <WireOverlay
            vitals={vitals}
            scale={canvas.view.scale}
            revealed={revealed}
            onReveal={setRevealed}
          />
          {/* The root node is the command post: pressing it (or the shortcut it
              advertises) opens the palette, so the top of the plan is also the
              way into every room without touching the plan at all. A button
              rather than a heading with a button inside it — the whole node is
              the target, and a heading may not contain one. */}
          <button
            type="button"
            className="agrid__root"
            data-testid="grid-root"
            data-attention={attention}
            aria-haspopup="dialog"
            onClick={() => openPalette()}
          >
            <span className="agrid__rootrow">
              <span className="agrid__rootname">Auracle</span>
              <span className="agrid__rootkey" aria-hidden>
                {PALETTE_HINT}
              </span>
            </span>
            <span className="agrid__rootnote">
              {attention === 0
                ? `${ROOM_IDS.length} rooms · nothing needs attention`
                : `${ROOM_IDS.length} rooms · ${attention} ${attention === 1 ? 'needs' : 'need'} attention`}
            </span>
          </button>
          <span className="agrid__stem" aria-hidden />
          <div className="agrid__districts">
            {DISTRICTS.map((district) => (
              <DistrictBlock
                key={district.id}
                district={district}
                vitals={vitals}
                folded={folded.has(district.id)}
                peek={handlers}
                onReveal={setRevealed}
              />
            ))}
          </div>
        </div>
        {/* Small, pinned to the stage, and only where there is a canvas to
            drive: below the tree tier the plan scrolls like any other column
            and there is nothing for these to do. */}
        {canvas.engaged ? (
          <div className="agrid__zoom" data-testid="grid-zoom" role="group" aria-label="Plan view">
            <button
              type="button"
              className="agrid__zbtn"
              data-testid="grid-zoom-out"
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
              className="agrid__zbtn"
              data-testid="grid-zoom-fit"
              aria-label="Fit the plan"
              onClick={() => canvas.fit()}
            >
              <span className="material-symbols-outlined" aria-hidden>
                fit_screen
              </span>
            </button>
            <button
              type="button"
              className="agrid__zbtn"
              data-testid="grid-zoom-in"
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
      {/* The assistant sits UNDER the plan, not over it: it speaks about what
          the plan is showing, so it must never cover the thing it is naming. */}
      <GridAiStrip />
      {peek}
    </div>
  );
}
