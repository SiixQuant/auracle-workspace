/**
 * The room page frame — the one anatomy every Grid room wears.
 *
 * Reading order, top to bottom: where you are (breadcrumb), whether this room
 * is healthy (status tag), what it is for (one sentence), its numbers (vitals),
 * the work itself (the body), and where the work goes next (the wired-to
 * chips). A room page is therefore answerable at a glance even before the body
 * has loaded, which is the whole reason the plan is a plan and not a tab strip.
 *
 * ## No tabs
 * Sub-views stack inline inside the body. A room never grows a tab strip: the
 * Grid replaced the two hubs precisely because a tab hides state behind a click
 * and then lies about it (a failing gate on an unselected tab is invisible).
 *
 * ## The body is the existing panel, unchanged
 * Pages mount the real surfaces — Research, QC, Backtest, Validation — as-is.
 * The frame declares {@link EmbeddedShellContext} so those panels' own
 * `PanelShell` drops its duplicate title and page chrome; none of their
 * behaviour is reimplemented here.
 *
 * ## Motion
 * The page zooms out of the control that opened it (`transform` + `opacity`
 * only, so it composites), and is DISABLED outright under
 * `prefers-reduced-motion` — checked in JS as well as in the sheet, so the
 * decision is observable (`data-zoom`) rather than buried in a media query.
 *
 * ## Layout
 * Width rules are `@container`, never `@media`: the Grid renders inside a host
 * pane whose width has nothing to do with the window's.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { gridVitals } from '../../engine/gridVitals';
import {
  EmbeddedShellContext,
  ensurePanelKitStyles,
  numeric,
  prefersReducedMotion,
  tone,
} from '../panelkit';
import { getZoomOrigin, openGridHome, openRoom, zoomOriginFrom } from './gridNav';
import { ROOMS, type RoomId } from './rooms';
import { WIRED_TO } from './wiring';

/** How a room reports itself: red needs you, amber is degraded, green is fine. */
export type RoomStatus = 'attention' | 'degraded' | 'nominal';

/**
 * One headline figure on a room page. `value: null` renders the quiet
 * placeholder — a page that cannot read a number says so rather than showing
 * the last one it saw.
 *
 * Named apart from the sheet's `RoomVital` (engine/gridVitals) because they
 * answer different questions: that one is a room's health as the PLAN reads it
 * from a distance, this one is a figure the page states in full.
 */
export interface PageVital {
  label: string;
  value: string | null;
  /** Semantic ink for the figure. Omitted = neutral. */
  emphasis?: 'bad' | 'warn';
}

const STATUS_COLOR: Record<RoomStatus, string> = {
  attention: tone.danger,
  degraded: tone.caution,
  nominal: tone.ok,
};

const STATUS_WORD: Record<RoomStatus, string> = {
  attention: 'attention',
  degraded: 'degraded',
  nominal: 'nominal',
};

/** House "no value" mark — the same em dash every pack surface uses. */
const EM_DASH = '—';

const STYLE_ID = 'auracle-room-styles';

const SHEET = `
.auracle-room { height: 100%; overflow: auto; padding: 0 16px 30px; transform-origin: var(--auracle-zoom-origin, 50% 40%); }
/* The way back stays on screen: a long body must never scroll its own exit
   away. Sticky against this page (its own scroll box), bleeding into the
   page gutter so nothing scrolls through it. */
.auracle-room__crumb { position: sticky; top: 0; z-index: 2; background: ${tone.bg}; margin-inline: -16px; padding: 15px 16px 12px; }
.auracle-room__sheet { max-width: 880px; margin-inline: auto; display: flex; flex-direction: column; gap: 15px; }
.auracle-room__vitals { display: flex; flex-wrap: wrap; gap: 10px 30px; }
.auracle-room[data-zoom="on"] { animation: auracle-room-zoom 180ms cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes auracle-room-zoom { from { transform: scale(0.94); opacity: 0; } }
@container auracle-grid (min-width: 620px) {
  .auracle-room { padding: 0 34px 34px; }
  .auracle-room__crumb { margin-inline: -34px; padding: 17px 34px 12px; }
  .auracle-room__vitals { gap: 10px 38px; }
}
.auracle-room__chip { appearance: none; font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 7px; padding: 4px 12px; border-radius: 999px; border: 1px solid ${tone.border}; background: transparent; color: ${tone.text2}; cursor: pointer; transition: border-color 150ms ease-out, color 150ms ease-out; }
.auracle-room__chip:hover { border-color: ${tone.borderStrong}; color: ${tone.text}; }
.auracle-room__chip:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 1px; }
.auracle-room__crumbhome { appearance: none; font: inherit; font-size: 12px; font-weight: 600; background: none; border: 0; padding: 3px 6px; margin-left: -6px; border-radius: 6px; color: ${tone.text2}; cursor: pointer; transition: color 150ms ease-out, background-color 150ms ease-out; }
.auracle-room__crumbhome:hover { background: ${tone.surface2}; color: ${tone.text}; }
.auracle-room__crumbhome:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) {
  .auracle-room[data-zoom="on"] { animation: none; }
  .auracle-room__chip, .auracle-room__crumbhome { transition: none; }
}
`;

function ensureRoomStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** An element that owns the Escape key itself (a field the reader is typing in). */
function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (el as HTMLElement).isContentEditable === true;
}

export function RoomPage({
  room,
  status,
  /** Overrides the status word when the room can say something sharper
   *  ("1 gate failing"). The colour still comes from `status`. */
  statusLabel,
  context,
  vitals = [],
  children,
}: {
  room: RoomId;
  status: RoomStatus;
  statusLabel?: string;
  context: string;
  vitals?: PageVital[];
  children: ReactNode;
}): JSX.Element {
  ensurePanelKitStyles();
  ensureRoomStyles();
  const pageRef = useRef<HTMLElement | null>(null);
  // The chips' fault flags come from the SHEET's readings, not a second
  // derivation: a room the plan drew with a red dot has to be flagged the same
  // way wherever else it is named, or the two surfaces argue in front of the
  // user. Subscribing keeps the flag live while the room stays open.
  const vitalsByRoom = useSyncExternalStore(
    gridVitals.subscribe,
    gridVitals.getSnapshot,
    gridVitals.getSnapshot
  );

  // Read once, on mount: the transition belongs to this page's arrival, and the
  // origin that produced it cannot change while it is showing.
  const [zoom] = useState(() =>
    prefersReducedMotion() ? null : (getZoomOrigin() ?? '50% 40%')
  );

  // Escape zooms back out to the plan. Bound to the window because the press
  // usually lands with focus on nothing (the card that opened this page is
  // gone), but ignored when focus sits on another surface or inside a field —
  // this page never takes an Escape that belongs to someone else, and a body
  // that handles its own Escape (the research list closing an abstract) stops
  // propagation before this ever runs.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const active = document.activeElement;
      if (isTextEntry(active)) return;
      const page = pageRef.current;
      if (active && active !== document.body && page && !page.contains(active)) return;
      openGridHome();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const meta = ROOMS[room];
  const statusColor = STATUS_COLOR[status];
  const zoomStyle = { '--auracle-zoom-origin': zoom ?? undefined } as CSSProperties;

  return (
    <section
      ref={pageRef}
      className="auracle-room"
      data-testid={`grid-room-${room}`}
      data-room={room}
      data-zoom={zoom ? 'on' : 'off'}
      style={{ ...zoomStyle, color: tone.text, font: `13px/1.5 ${tone.font}` }}
    >
      <nav
        className="auracle-room__crumb"
        data-testid="room-breadcrumb"
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <button
          type="button"
          className="auracle-room__crumbhome"
          data-testid="grid-back"
          onClick={() => openGridHome()}
        >
          System Plan
        </button>
        <span aria-hidden style={{ fontSize: 11, color: tone.text3 }}>
          /
        </span>
        <span data-testid="room-breadcrumb-here" style={{ fontSize: 12, fontWeight: 600 }}>
          {meta.title}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: tone.text3 }}>esc returns to the plan</span>
      </nav>

      <div className="auracle-room__sheet">
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2
            data-testid="room-title"
            style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: -0.2, color: tone.text }}
          >
            {meta.title}
          </h2>
          <span
            data-testid="room-status"
            data-status={status}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 9px',
              borderRadius: 999,
              color: statusColor,
              border: `1px solid color-mix(in srgb, ${statusColor} 45%, transparent)`,
              background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
            }}
          >
            <span aria-hidden style={{ fontSize: 8 }}>
              ●
            </span>
            {statusLabel ?? STATUS_WORD[status]}
          </span>
        </header>

        <p
          data-testid="room-context"
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: tone.text2,
            maxWidth: '75ch',
            borderBottom: `1px solid ${tone.border}`,
            paddingBottom: 13,
          }}
        >
          {context}
        </p>

        {vitals.length ? (
          <div className="auracle-room__vitals" data-testid="room-vitals">
            {vitals.map((vital) => (
              <div
                key={vital.label}
                data-testid={`room-vital-${vital.label.replace(/\s+/g, '-')}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 3 }}
              >
                <span
                  style={{
                    fontSize: 21,
                    fontWeight: 600,
                    lineHeight: 1.05,
                    color:
                      vital.value === null
                        ? tone.text3
                        : vital.emphasis === 'bad'
                          ? tone.danger
                          : vital.emphasis === 'warn'
                            ? tone.caution
                            : tone.text,
                    ...numeric,
                  }}
                >
                  {vital.value ?? EM_DASH}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 0.6,
                    textTransform: 'uppercase',
                    color: tone.text3,
                  }}
                >
                  {vital.label}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div data-testid="room-body" style={{ minWidth: 0 }}>
          <EmbeddedShellContext.Provider value>{children}</EmbeddedShellContext.Provider>
        </div>

        <footer
          data-testid="room-wired"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            borderTop: `1px solid ${tone.border}`,
            paddingTop: 13,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.9,
              textTransform: 'uppercase',
              color: tone.text3,
            }}
          >
            Wired to
          </span>
          {WIRED_TO[room].map((target) => {
            const reading = vitalsByRoom[target];
            const hasFault = reading.health === 'fault';
            // A flagged chip carries the room's own note, so the reason travels
            // with the flag instead of costing a trip to find out.
            const chipTitle = hasFault
              ? `${ROOMS[target].title} needs attention${reading.note ? ` — ${reading.note}` : ''}`
              : ROOMS[target].title;
            return (
              <button
                key={target}
                type="button"
                className="auracle-room__chip"
                data-testid={`room-wired-${target}`}
                data-fault={hasFault ? 'true' : undefined}
                title={chipTitle}
                onClick={(event) => openRoom(target, zoomOriginFrom(event.currentTarget))}
              >
                {ROOMS[target].title}
                {hasFault ? (
                  <span
                    data-testid={`room-wired-fault-${target}`}
                    aria-label="needs attention"
                    role="img"
                    style={{ fontSize: 8, color: tone.danger }}
                  >
                    ●
                  </span>
                ) : null}
              </button>
            );
          })}
        </footer>
      </div>
    </section>
  );
}
