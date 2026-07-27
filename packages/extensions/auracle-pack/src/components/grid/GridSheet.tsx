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
 * district once there is room for them; and the full tree — root on top,
 * districts in a rank, rooms ranked under each — only when the pane is wide
 * enough to draw it without scrolling sideways. The tree's rails are drawn
 * with border-box pseudo-elements, so the geometry costs no dependency.
 *
 * WIRES: the full tree tier also carries a wire overlay and one pinned alert
 * ({@link WireOverlay}). Both are that tier's alone — the stacked tiers have no
 * single room rank for the lanes to hang under — so the plan reserves the lane
 * band as bottom padding there and nowhere else.
 */
import { useSyncExternalStore, type CSSProperties } from 'react';
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
import { gridFoldStore, type FoldedDistricts } from './gridFoldStore';
import { GRID_ACCENT, GRID_ACCENT_DIM, GRID_ACCENT_SOFT } from './gridTheme';
import { GridAiStrip } from './GridAiStrip';
import { TREE_MIN_WIDTH } from './gridWires';
import { useRoomPeek, type PeekHandlers } from './RoomPeek';
import { WireOverlay } from './WireOverlay';
import { ROOMS, ROOM_IDS, type RoomId } from './rooms';

const STYLE_ID = 'auracle-grid-sheet-styles';

/** Rail hairline — one step up from the card border so the tree stays legible
 *  against the canvas without competing with the cards it connects. */
const RAIL = tone.borderStrong;

const SHEET = `
/* A column so the AI strip can sit along the bottom of the plan and stay
   there: it is sticky against this sheet's own scroll box, and the plan takes
   whatever height is left. */
.agrid { min-height: 100%; display: flex; flex-direction: column; }
.agrid__plan { position: relative; flex: 1 1 auto; display: flex; flex-direction: column; padding: 18px 20px 44px; }
.agrid__hint { margin: 0 0 14px; font-size: 11.5px; line-height: 1.5; color: ${tone.text3}; }
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
.agrid__ltop { display: flex; align-items: center; gap: 9px; }
.agrid__num { font-family: ${tone.mono}; font-size: 11px; font-weight: 650; color: ${GRID_ACCENT}; }
.agrid__name { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.13em; color: ${tone.text2}; white-space: nowrap; }
.agrid__flag { font-size: 13px; line-height: 1; }
.agrid__fold { appearance: none; margin-left: auto; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: ${tone.text3}; cursor: pointer; transition: background-color 150ms ease-out, color 150ms ease-out; }
.agrid__fold:hover { background: ${tone.surface2}; color: ${tone.text}; }
.agrid__fold:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.agrid__fold .material-symbols-outlined { font-size: 17px; line-height: 1; }
.agrid__sum { font-size: 11px; color: ${tone.text3}; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
.agrid__rnote { font-size: 11px; color: ${tone.text3}; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agrid__room[data-health='fault'] .agrid__rnote { color: ${tone.danger}; }

@container auracle-grid (min-width: 640px) {
  .agrid__rooms { grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); }
}

@container auracle-grid (min-width: ${TREE_MIN_WIDTH}px) {
  /* The bottom padding is the LANE BAND: the wire overlay hangs its three
     lanes below the room rank, and only this tier draws them. */
  .agrid__plan { align-items: center; padding-top: 22px; padding-bottom: 92px; }
  .agrid__hint { text-align: center; }
  .agrid__root { width: 218px; }
  .agrid__stem { display: block; height: 18px; }
  .agrid__districts { flex-direction: row; align-items: flex-start; justify-content: center; gap: 0; margin-top: 0; width: 100%; }
  .agrid__district { flex: var(--agrid-span, 1) 1 0; align-items: center; gap: 0; position: relative; padding: 18px 10px 0; }
  .agrid__district::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: ${RAIL}; }
  .agrid__district:first-child::before { left: 50%; }
  .agrid__district:last-child::before { right: 50%; }
  .agrid__district::after { content: ''; position: absolute; top: 0; left: 50%; width: 1px; height: 18px; background: ${RAIL}; }
  .agrid__rooms { display: flex; flex-direction: row; align-items: stretch; gap: 0; width: 100%; }
  .agrid__slot { flex: 1 1 0; position: relative; padding: 16px 5px 0; }
  .agrid__slot::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: ${RAIL}; }
  .agrid__slot:first-child::before { left: 50%; }
  .agrid__slot:last-child::before { right: 50%; }
  .agrid__slot:only-child::before { display: none; }
  .agrid__slot::after { content: ''; position: absolute; top: 0; left: 50%; width: 1px; height: 16px; background: ${RAIL}; }
  /* Centred under the district's rail, which drops straight into it. */
  .agrid__count { align-self: center; }
}

@media (prefers-reduced-motion: reduce) {
  .agrid__fold, .agrid__room { transition: none; }
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
}: {
  id: RoomId;
  vital: RoomVital;
  peek: PeekHandlers;
}): JSX.Element {
  const room = ROOMS[id];
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
        aria-label={label}
        // No `title`: the peek says the same thing sooner and says more, and a
        // native tooltip firing a second later would land on top of it.
        // The room page zooms out of the card that was pressed, so the press
        // and the arrival read as one gesture rather than a screen swap.
        onClick={(event) => openRoomFocused(id, undefined, zoomOriginFrom(event.currentTarget))}
        {...peek}
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
}: {
  district: District;
  vitals: GridVitals;
  folded: boolean;
  peek: (id: RoomId) => PeekHandlers;
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
      // A folded district stops claiming its rooms' share of the rank.
      style={{ '--agrid-span': folded ? 1 : district.rooms.length } as CSSProperties}
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
            <RoomCard key={id} id={id} vital={vitals[id]} peek={peek(id)} />
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

  return (
    <div className="agrid" data-testid="auracle-grid-home">
      <div className="agrid__plan">
        <p className="agrid__hint">
          The system as a floor plan — every surface, and what it is doing right now.
        </p>
        {/* Covers and measures the plan it sits in, so it goes inside it.
            Draws only at the full tree tier — see WireOverlay. */}
        <WireOverlay vitals={vitals} />
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
            />
          ))}
        </div>
      </div>
      {/* The assistant sits UNDER the plan, not over it: it speaks about what
          the plan is showing, so it must never cover the thing it is naming. */}
      <GridAiStrip />
      {peek}
    </div>
  );
}
