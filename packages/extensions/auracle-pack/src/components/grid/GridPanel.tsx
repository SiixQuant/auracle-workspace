/**
 * The Grid — the pack's one registered surface.
 *
 * It is a router, not a tab strip: a home plan that lists the rooms, and one
 * room showing at a time. The room comes from a store outside React
 * (gridNav), read with `useSyncExternalStore` rather than state+effect,
 * because a hand-off can select a room between this render and a post-commit
 * subscribe (an editor Deploy racing the Grid's first mount) — subscribing
 * reconciles, so no selection is dropped.
 *
 * Layout responds to the PANEL's width with `@container`, never `@media`: the
 * Grid renders inside a host pane whose width has nothing to do with the
 * window's, so a viewport query would lay it out for a size it never has.
 */
import { useSyncExternalStore } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { ensurePanelKitStyles, tone } from '../panelkit';
import { getActiveRoom, openGridHome, openRoom, subscribeGrid } from './gridNav';
import { ROOMS, ROOM_LIST, type RoomId } from './rooms';

const STYLE_ID = 'auracle-grid-styles';

const SHEET = `
.auracle-grid { container-type: inline-size; container-name: auracle-grid; }
.auracle-grid__rooms { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
@container auracle-grid (min-width: 560px) {
  .auracle-grid__rooms { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container auracle-grid (min-width: 900px) {
  .auracle-grid__rooms { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.auracle-grid__room { appearance: none; text-align: left; font: inherit; cursor: pointer; background: ${tone.surface}; border: 1px solid ${tone.border}; border-radius: 11px; padding: 13px 14px; display: flex; flex-direction: column; gap: 4px; }
.auracle-grid__room:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 1px; }
`;

function ensureGridStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** The plan: every room the pack owns, one press away. */
function GridHome(): JSX.Element {
  return (
    <div
      data-testid="auracle-grid-home"
      style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px' }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: tone.text,
          }}
        >
          System plan
        </h1>
        <p style={{ margin: 0, fontSize: 12.5, color: tone.text2 }}>
          Every Auracle surface, from a finding to a live deployment.
        </p>
      </header>
      <div className="auracle-grid__rooms">
        {ROOM_LIST.map((room) => (
          <button
            key={room.id}
            type="button"
            className="apk-card auracle-grid__room"
            data-testid={`grid-home-room-${room.id}`}
            onClick={() => openRoom(room.id)}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: tone.text }}>{room.title}</span>
            <span style={{ fontSize: 12, color: tone.text2 }}>{room.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** One room, with the way back to the plan. */
function GridRoomView({ roomId, hostProps }: { roomId: RoomId; hostProps: PanelHostProps }): JSX.Element {
  const room = ROOMS[roomId];
  const Page = room.component;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          borderBottom: `1px solid ${tone.border}`,
          flex: 'none',
        }}
      >
        <button
          type="button"
          className="apk-hubtab"
          data-testid="grid-back"
          onClick={openGridHome}
        >
          System plan
        </button>
        <span aria-hidden style={{ color: tone.text3, fontSize: 12 }}>
          /
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: tone.text }}>{room.title}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Page {...hostProps} />
      </div>
    </div>
  );
}

export function GridPanel(props: PanelHostProps): JSX.Element {
  ensurePanelKitStyles();
  ensureGridStyles();
  const roomId = useSyncExternalStore(subscribeGrid, getActiveRoom, () => null);

  return (
    <div
      className="auracle-grid"
      data-testid="auracle-grid"
      data-room={roomId ?? 'home'}
      style={{
        height: '100%',
        overflow: 'auto',
        background: tone.bg,
        color: tone.text,
        font: `13px/1.5 ${tone.font}`,
      }}
    >
      {roomId === null ? <GridHome /> : <GridRoomView roomId={roomId} hostProps={props} />}
    </div>
  );
}
