/**
 * Platform health in one line — the floor plan's whole job, at chip size.
 *
 * The chip reads nominal or names the worst thing wrong right now, from the
 * same per-room vitals the plan's tiles drew their colours from: nothing here
 * derives a fault a second time, so the chip can never disagree with the
 * readings behind it. Expanding it lists every room that is not nominal, each
 * with its one-line consequence, and — where the action library offers one —
 * the repair, which runs through the same agent lane and approval gate as
 * every other agent action. No inline form anywhere: a repair is asked for,
 * and capital-shaped consequences still stop at the dialog.
 *
 * The strip is part of the header flow, never an overlay: it takes its own
 * height above the view and covers nothing.
 */
import { useState, useSyncExternalStore } from 'react';

import { gridVitals, worseHealth, type Health } from '../../engine/gridVitals';
import { ensurePanelKitStyles, tone } from '../panelkit';
import { HEALTH_COLOR, HEALTH_WORD } from './districts';
import { availableActions, requestAiAction, type AiAction } from './gridAiActions';
import { ROOMS, type RoomId } from './rooms';

const STYLE_ID = 'auracle-grid-health-styles';

const SHEET = `
.ahealth { flex: none; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px 0; }
.ahealth__chip { display: inline-flex; align-items: center; gap: 7px; align-self: flex-start; appearance: none; font: inherit; font-size: 11.5px; font-weight: 600; line-height: 1; padding: 5px 11px; border: 1px solid ${tone.border}; border-radius: 999px; background: ${tone.surface}; color: ${tone.text2}; cursor: pointer; }
.ahealth__chip:focus-visible { outline: 2px solid ${tone.text3}; outline-offset: 1px; }
.ahealth__dot { width: 7px; height: 7px; border-radius: 999px; }
.ahealth__list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0 0 2px; list-style: none; }
.ahealth__row { display: flex; align-items: baseline; gap: 10px; padding: 5px 10px; font-size: 12px; color: ${tone.text2}; }
.ahealth__room { flex: none; font-weight: 600; color: ${tone.text}; }
.ahealth__note { flex: 1; min-width: 0; }
.ahealth__fix { flex: none; appearance: none; font: inherit; font-size: 11px; font-weight: 600; padding: 3px 10px; border: 1px solid ${tone.border}; border-radius: 999px; background: transparent; color: ${tone.text2}; cursor: pointer; }
.ahealth__fix:hover { color: ${tone.text}; }
`;

function ensureHealthStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

interface Trouble {
  room: RoomId;
  health: Health;
  note: string;
  repair: AiAction | null;
}

/** Every room that is not nominal, worst first, with its offered repair. */
function troubles(): Trouble[] {
  const vitals = gridVitals.getSnapshot();
  const repairs = availableActions(vitals).filter((action) => action.class === 'repair');
  const rank: Record<Health, number> = { fault: 0, degraded: 1, nominal: 2 };
  return (Object.keys(vitals) as RoomId[])
    .filter((room) => vitals[room].health !== 'nominal')
    .sort((a, b) => rank[vitals[a].health] - rank[vitals[b].health])
    .map((room) => ({
      room,
      health: vitals[room].health,
      // The vital's note IS the consequence line the room card shows; a room
      // that is unwell but silent still gets named rather than dropped.
      note: vitals[room].note ?? HEALTH_WORD[vitals[room].health],
      repair: repairs.find((action) => action.room === room) ?? null,
    }));
}

export function GridHealthLine(): JSX.Element {
  ensurePanelKitStyles();
  ensureHealthStyles();
  useSyncExternalStore(gridVitals.subscribe, gridVitals.getSnapshot, gridVitals.getSnapshot);
  const [open, setOpen] = useState(false);

  const rows = troubles();
  const worst = rows.reduce<Health>((acc, row) => worseHealth(acc, row.health), 'nominal');
  const label =
    worst === 'nominal'
      ? 'All systems nominal'
      : `${ROOMS[rows[0].room].title}: ${rows[0].note}`;

  return (
    <div className="ahealth" data-testid="grid-health" data-health={worst}>
      <button
        type="button"
        className="ahealth__chip"
        data-testid="grid-health-chip"
        aria-expanded={open && rows.length > 0}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ahealth__dot" style={{ background: HEALTH_COLOR[worst] }} aria-hidden />
        {label}
      </button>
      {open && rows.length > 0 ? (
        <ul className="ahealth__list" data-testid="grid-health-list">
          {rows.map((row) => (
            <li className="ahealth__row" data-testid={`grid-health-${row.room}`} key={row.room}>
              <span className="ahealth__room">{ROOMS[row.room].title}</span>
              <span className="ahealth__note">{row.note}</span>
              {row.repair ? (
                <button
                  type="button"
                  className="ahealth__fix"
                  data-testid={`grid-health-fix-${row.room}`}
                  onClick={() => void requestAiAction(row.repair as AiAction)}
                >
                  {row.repair.label}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
