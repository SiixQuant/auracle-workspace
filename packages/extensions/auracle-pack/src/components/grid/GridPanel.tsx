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
import { getActiveRoom, subscribeGrid } from './gridNav';
import { GridSheet } from './GridSheet';
import { ROOMS, type RoomId } from './rooms';

const STYLE_ID = 'auracle-grid-styles';

/** The panel is the @container the sheet's layout tiers are written against —
 *  the one rule that has to live out here, above whichever view is showing. */
const SHEET = `
.auracle-grid { container-type: inline-size; container-name: auracle-grid; }
`;

function ensureGridStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/**
 * One room. The page itself carries the whole frame — breadcrumb, status,
 * vitals, body, wired-to (see RoomPage) — so the router adds no chrome of its
 * own; a second header here would state the room's name twice.
 *
 * Keyed by room so moving between rooms REMOUNTS the page: the enter
 * transition is a mount effect, and a reused instance would arrive without one.
 */
function GridRoomView({ roomId, hostProps }: { roomId: RoomId; hostProps: PanelHostProps }): JSX.Element {
  const Page = ROOMS[roomId].component;
  return <Page key={roomId} {...hostProps} />;
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
      {roomId === null ? <GridSheet /> : <GridRoomView roomId={roomId} hostProps={props} />}
    </div>
  );
}
