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
 * LAYOUT: `@container`, never `@media`. The Grid renders inside a host pane
 * whose width has nothing to do with the window's. Three tiers, written
 * mobile-first: a single stacked column by default; rooms in a row under each
 * district once there is room for them; and the full tree — root on top,
 * districts in a rank, rooms ranked under each — only when the pane is wide
 * enough to draw it without scrolling sideways. The tree's rails are drawn
 * with border-box pseudo-elements, so the geometry costs no dependency.
 */
import { useSyncExternalStore, type CSSProperties } from 'react';
import { gridVitals, type GridVitals, type Health, type RoomVital } from '../../engine/gridVitals';
import { tint, tone } from '../panelkit';
import { openRoom } from './gridNav';
import { DISTRICTS, ROOM_ICONS, districtHealth, districtSummary, roomsNeedingAttention, type District } from './districts';
import { ROOMS, ROOM_IDS, type RoomId } from './rooms';

const STYLE_ID = 'auracle-grid-sheet-styles';

/** The dot, the flag, and a card's border all read from one table. `nominal`
 *  is GREY on purpose: a healthy room is not an achievement to celebrate, it
 *  is the absence of a problem, so only trouble takes a hue. */
const HEALTH_COLOR: Record<Health, string> = {
  nominal: tone.text3,
  degraded: tone.caution,
  fault: tone.danger,
};

const HEALTH_WORD: Record<Health, string> = {
  nominal: 'nominal',
  degraded: 'degraded',
  fault: 'needs attention',
};

/** Rail hairline — one step up from the card border so the tree stays legible
 *  against the canvas without competing with the cards it connects. */
const RAIL = tone.borderStrong;

const SHEET = `
.agrid { min-height: 100%; }
.agrid__plan { display: flex; flex-direction: column; padding: 18px 20px 44px; }
.agrid__hint { margin: 0 0 14px; font-size: 11.5px; line-height: 1.5; color: ${tone.text3}; }
.agrid__root { display: flex; flex-direction: column; gap: 3px; padding: 10px 13px; border-radius: 10px; border: 1px solid ${tone.accentDim}; background: ${tone.accentSoft}; }
.agrid__rootname { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: -0.01em; color: ${tone.text}; }
.agrid__rootnote { font-size: 11.5px; color: ${tone.text2}; }
.agrid__stem { display: none; flex: none; width: 1px; background: ${RAIL}; }
.agrid__districts { display: flex; flex-direction: column; gap: 16px; margin-top: 16px; }
.agrid__district { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.agrid__label { display: flex; flex-direction: column; gap: 3px; max-width: 100%; min-width: 0; padding: 8px 12px; border-radius: 8px; border: 1px solid ${tone.border}; background: ${tone.surface}; }
.agrid__ltop { display: flex; align-items: center; gap: 9px; }
.agrid__num { font-family: ${tone.mono}; font-size: 11px; font-weight: 650; color: ${tone.accentText}; }
.agrid__name { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.13em; color: ${tone.text2}; white-space: nowrap; }
.agrid__flag { font-size: 13px; line-height: 1; }
.agrid__sum { font-size: 11px; color: ${tone.text3}; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agrid__rooms { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.agrid__slot { display: flex; min-width: 0; }
.agrid__room { appearance: none; flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; text-align: left; font: inherit; cursor: pointer; padding: 9px 12px; border-radius: 9px; border: 1px solid ${tone.border}; background: ${tone.surface}; }
.agrid__room[data-health='degraded'] { border-color: ${tint(tone.caution, 45)}; }
.agrid__room[data-health='fault'] { border-color: ${tint(tone.danger, 55)}; }
.agrid__room:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 1px; }
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

@container auracle-grid (min-width: 1280px) {
  .agrid__plan { align-items: center; padding-top: 22px; }
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
function RoomCard({ id, vital }: { id: RoomId; vital: RoomVital }): JSX.Element {
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
        title={label}
        onClick={() => openRoom(id)}
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

/** One district: its number, its name, what its rooms add up to, and a flag
 *  the moment any room inside it stops being nominal. */
function DistrictBlock({ district, vitals }: { district: District; vitals: GridVitals }): JSX.Element {
  const health = districtHealth(district, vitals);
  return (
    <section
      className="agrid__district"
      data-testid={`grid-district-${district.id}`}
      data-district={district.number}
      data-health={health}
      style={{ '--agrid-span': district.rooms.length } as CSSProperties}
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
        </span>
        <span className="agrid__sum" data-testid={`grid-district-summary-${district.id}`}>
          {districtSummary(district, vitals)}
        </span>
      </div>
      <span className="agrid__stem" aria-hidden />
      <div className="agrid__rooms">
        {district.rooms.map((id) => (
          <RoomCard key={id} id={id} vital={vitals[id]} />
        ))}
      </div>
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
  const attention = roomsNeedingAttention(vitals);

  return (
    <div className="agrid" data-testid="auracle-grid-home">
      <div className="agrid__plan">
        <p className="agrid__hint">
          The system as a floor plan — every surface, and what it is doing right now.
        </p>
        <div className="agrid__root" data-testid="grid-root" data-attention={attention}>
          <h1 className="agrid__rootname">Auracle</h1>
          <span className="agrid__rootnote">
            {attention === 0
              ? `${ROOM_IDS.length} rooms · nothing needs attention`
              : `${ROOM_IDS.length} rooms · ${attention} ${attention === 1 ? 'needs' : 'need'} attention`}
          </span>
        </div>
        <span className="agrid__stem" aria-hidden />
        <div className="agrid__districts">
          {DISTRICTS.map((district) => (
            <DistrictBlock key={district.id} district={district} vitals={vitals} />
          ))}
        </div>
      </div>
    </div>
  );
}
