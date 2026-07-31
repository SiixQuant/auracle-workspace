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
 * THE PANEL OPENS ON THE RESTING STATE: one line of status and the standing
 * watches (GridHome). The two legacy faces — the Board and the Plan — remain
 * reachable only by the keyboard cycle in {@link gridFaceStore}, as
 * construction scaffolding while their replacements are built; the deletion
 * issue of the swap removes them and the cycle with them. No on-screen
 * control offers a face, and no face is remembered: opening state is a
 * contract, not a preference. Pressing the shortcut from inside a ROOM comes
 * home first, so the key is never dead where a room happens to be showing.
 *
 * Layout responds to the PANEL's width with `@container`, never `@media`: the
 * Grid renders inside a host pane whose width has nothing to do with the
 * window's, so a viewport query would lay it out for a size it never has.
 *
 * The command palette is mounted HERE rather than on the sheet, above the
 * router: the shortcut has to work from inside a room as well as from the
 * plan, and an overlay that only existed on the home view would vanish the
 * moment it was used.
 *
 * The page descriptor the AI chat reads is published from here for the same
 * reason: the router is the one place that knows which room is showing, so
 * every room announces itself the same way rather than eleven pages each
 * remembering to (see `gridFocus`).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { ensurePanelKitStyles, tone } from '../panelkit';
import { AiApprovalDialog } from './AiApprovalDialog';
import { aiRunStore, approveAiAction, declineAiAction } from './gridAiActions';
// Side-effect import: registers the assistant's palette provider. Done here,
// at the panel, so the rows exist whether the plan or a room is showing.
import './gridAiCommands';
// Same reason, for what the actions DO: the executors register on import, so an
// action raised from the palette or a room page finds its lane installed.
import { registerAgentHost, unregisterAgentHost } from './gridAiExecutors';
import { closePalette, isPaletteOpen, subscribePalette, togglePalette } from './gridCommands';
import { useRoomAiContext } from './gridFocus';
import { getActiveRoom, subscribeGrid } from './gridNav';
import { boardGraphStore } from '../../engine/boardGraphStore';
import { GridHealthLine } from './GridHealthLine';
import { GridHome } from './GridHome';
import { GridPalette } from './GridPalette';
import { GRID_ACCENT } from './gridTheme';
import { ROOMS, type RoomId } from './rooms';

const STYLE_ID = 'auracle-grid-styles';

/**
 * The panel is the @container the sheet's layout tiers are written against —
 * the one rule that has to live out here, above whichever view is showing.
 *
 * The panel itself no longer scrolls; the view inside it does. That is what
 * lets the palette sit centred over the pane a person is actually looking at:
 * an overlay in a scrolling box would be pinned to the top of the CONTENT and
 * scroll off with it.
 */
const SHEET = `
.auracle-grid { container-type: inline-size; container-name: auracle-grid; position: relative; overflow: hidden; display: flex; flex-direction: column; }
.auracle-grid:focus { outline: none; }
.auracle-grid__view { flex: 1; min-height: 0; overflow: auto; }
/* One track, two segments, the moved one lit — a segmented control rather than
   two buttons, so the pair reads as one thing with two positions. */
.auracle-grid__face { appearance: none; font: inherit; font-size: 11.5px; font-weight: 600; line-height: 1; padding: 5px 11px; border: 0; border-radius: 6px; background: transparent; color: ${tone.text3}; cursor: pointer; transition: background-color 150ms ease-out, color 150ms ease-out; }
.auracle-grid__face:hover { color: ${tone.text2}; }
.auracle-grid__face[aria-pressed='true'] { background: ${tone.surface3}; color: ${tone.text}; }
.auracle-grid__face:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
/* The written shortcut is the first thing to go when the pane is narrow: it is
   a reminder, not a control, and the segments it explains are still there. */
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
  const paletteOpen = useSyncExternalStore(subscribePalette, isPaletteOpen, () => false);
  // The approval gate is mounted above the router for the same reason the
  // palette is: a mutation can be raised from the stage, from a room, or from
  // the palette, and it has to be answerable on whichever view is showing when
  // it is raised.
  const aiRun = useSyncExternalStore(aiRunStore.subscribe, aiRunStore.getSnapshot, aiRunStore.getSnapshot);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wasOpen = useRef(false);

  // Tell the chat which room is showing and what it is focused on. No-op on a
  // host with no AI lane, and on the home plan.
  useRoomAiContext(props.host, roomId, roomId ? ROOMS[roomId].title : null);

  // Hand the executors the host they hand a draft off to. Published from the
  // panel because the module-level registry holds no host of its own, and
  // withdrawn on unmount — but only while it is still this panel's host, so a
  // second panel taking over is not undone by the first one closing.
  useEffect(() => {
    registerAgentHost(props.host);
    return () => unregisterAgentHost(props.host);
  }, [props.host]);

  // The workspace graph is opened HERE, not by the Board: the resting state
  // draws its watch list from the graph, and a load that waited for the Board
  // to mount would leave the watches empty forever once the Board is gone.
  // open() is idempotent, so the Board's own call (which also owns the flush
  // on the way out) stays.
  const workspaceId = props.host?.workspacePath ?? '';
  useEffect(() => {
    void boardGraphStore.open(workspaceId);
  }, [workspaceId]);

  /**
   * The panel's one shortcut — the command palette — scoped to this panel by
   * FOCUS rather than by a manifest keybinding. The SDK's
   * `contributions.keybindings` is the only keybinding surface an extension
   * has, and it can address exactly one kind of command: a panel's
   * auto-registered TOGGLE. It cannot reach an action inside a panel, and it
   * carries no when-clause, so a declared binding would fire app-wide and could
   * still not open this palette.
   *
   * Capture phase at the window, because the host's own global shortcut layer
   * listens there in capture and calls `stopPropagation()` — a bubble-phase
   * listener here would simply never run. Among listeners on the same target
   * and phase the order is registration order, and this panel is a child of
   * the host shell, so its effect registers first; stopping the event
   * IMMEDIATELY is therefore what keeps the host's own combination from also
   * firing and pulling this panel off screen mid-press.
   *
   * Guarded on the panel being mounted, visible, and containing whatever has
   * focus, so nothing fires for a Grid that is merely alive off screen.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key?.toLowerCase();
      if (key !== 'k' || event.altKey || event.shiftKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const host = hostRef.current;
      if (!host || !host.isConnected) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (!host.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      togglePalette();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  // The open flag outlives this component (it is a module store), so a panel
  // that is torn down while the palette is up must put it away — otherwise the
  // Grid would reappear later wearing a palette nobody asked for.
  useEffect(() => () => closePalette(), []);

  // Closing hands focus back to the node that opens the palette, so the
  // keyboard is never left pointing at nothing. Falls back to the panel itself
  // when a room page is showing and the sheet's root is not on screen.
  useEffect(() => {
    if (wasOpen.current && !paletteOpen) {
      const host = hostRef.current;
      const root = host?.querySelector<HTMLElement>('[data-testid="grid-root"]');
      (root ?? host)?.focus();
    }
    wasOpen.current = paletteOpen;
  }, [paletteOpen]);

  return (
    <div
      ref={hostRef}
      className="auracle-grid"
      data-testid="auracle-grid"
      data-room={roomId ?? 'home'}
      data-palette={paletteOpen ? 'open' : 'closed'}
      data-approval={aiRun.pending ? 'open' : 'closed'}
      // Focusable but not tabbable: a click anywhere on the plan puts focus
      // inside the panel, which is what makes the shortcut's focus guard match
      // what a person would call "I am looking at the Grid".
      tabIndex={-1}
      style={{
        height: '100%',
        background: tone.bg,
        color: tone.text,
        font: `13px/1.5 ${tone.font}`,
      }}
    >
      {/* Home only: a room page carries its own whole frame, and its own
          status surface, so a second health line over it would state the
          room's condition twice. Part of the header flow — never an overlay. */}
      {roomId === null ? <GridHealthLine /> : null}
      <div className="auracle-grid__view">
        {roomId === null ? (
          <GridHome />
        ) : (
          <GridRoomView roomId={roomId} hostProps={props} />
        )}
      </div>
      {paletteOpen ? <GridPalette /> : null}
      {aiRun.pending ? (
        <AiApprovalDialog
          action={aiRun.pending}
          onApprove={() => void approveAiAction()}
          onDecline={declineAiAction}
        />
      ) : null}
    </div>
  );
}
