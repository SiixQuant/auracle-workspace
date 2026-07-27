/**
 * The palette — the Grid's command post, drawn.
 *
 * It is a centred overlay INSIDE the panel, not a host-level modal: the Grid is
 * one pane among several, and a person who opened a palette from this plan is
 * addressing this plan. It is laid out with flexbox inside the panel's own box
 * (no anchoring, no measured coordinates), so it needs no positioning library
 * and its width tier is an `@container` rule like every other Grid rule.
 *
 * WHAT IT CAN RUN comes entirely from {@link listCommands} — the palette knows
 * about providers, not about rooms. Ordering, including trouble-first, is the
 * registry's call; this file only draws what it is handed.
 *
 * KEYBOARD: the input keeps focus for the whole interaction and the rows are
 * pointed at with `aria-activedescendant`, so arrows never move focus off the
 * field and typing is never interrupted. Escape is two-stage on purpose —
 * clearing a query is the correction people mean most of the time, and only an
 * already-empty field reads Escape as "leave".
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { gridVitals } from '../../engine/gridVitals';
import { tone } from '../panelkit';
import { HEALTH_COLOR, HEALTH_WORD } from './districts';
import {
  PALETTE_HINT,
  closePalette,
  filterCommands,
  listCommands,
  type GridCommand,
} from './gridCommands';

const STYLE_ID = 'auracle-grid-palette-styles';

const LIST_ID = 'auracle-grid-palette-list';

/** The row the highlight is on, as an element id — what the input points at. */
function optionId(index: number): string {
  return `auracle-grid-palette-option-${index}`;
}

const SHEET = `
.agrid-cmd { position: absolute; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; padding: 24px 16px; background: rgba(0, 0, 0, 0.5); }
.agrid-cmd__box { display: flex; flex-direction: column; width: 100%; max-width: 460px; max-height: 100%; overflow: hidden; border-radius: 12px; border: 1px solid ${tone.borderStrong}; background: ${tone.surface}; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55); }
.agrid-cmd__field { display: flex; align-items: center; gap: 9px; padding: 11px 13px; border-bottom: 1px solid ${tone.border}; }
.agrid-cmd__fico { font-size: 16px; line-height: 1; color: ${tone.text3}; flex: none; }
.agrid-cmd__input { flex: 1; min-width: 0; appearance: none; font: inherit; font-size: 13px; color: ${tone.text}; background: transparent; border: 0; padding: 0; outline: none; }
.agrid-cmd__input::placeholder { color: ${tone.text3}; }
.agrid-cmd__key { flex: none; font-family: ${tone.mono}; font-size: 10px; letter-spacing: 0.04em; color: ${tone.text3}; border: 1px solid ${tone.border}; border-radius: 5px; padding: 1px 5px; }
.agrid-cmd__list { flex: 1; min-height: 0; overflow-y: auto; padding: 5px; }
.agrid-cmd__sec { padding: 7px 9px 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.13em; color: ${tone.text3}; }
.agrid-cmd__row { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 9px; border-radius: 7px; cursor: pointer; }
.agrid-cmd__row[data-active='true'] { background: ${tone.surface3}; }
.agrid-cmd__rico { flex: none; font-size: 15px; line-height: 1; color: ${tone.text3}; }
.agrid-cmd__label { flex: 1; min-width: 0; font-size: 12.5px; color: ${tone.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agrid-cmd__badge { flex: none; font-size: 9.5px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; border: 1px solid ${tone.border}; color: ${tone.text3}; }
.agrid-cmd__dot { flex: none; width: 6px; height: 6px; border-radius: 50%; }
.agrid-cmd__empty { padding: 14px 10px; font-size: 12px; color: ${tone.text3}; }

@container auracle-grid (min-width: 640px) {
  .agrid-cmd__box { max-width: 520px; }
}
`;

function ensurePaletteStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

export function GridPalette(): JSX.Element {
  ensurePaletteStyles();
  // Live readings: a room that faults while the palette is open re-sorts under
  // the cursor rather than waiting for the next opening.
  const vitals = useSyncExternalStore(
    gridVitals.subscribe,
    gridVitals.getSnapshot,
    gridVitals.getSnapshot
  );
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const commands = useMemo(() => listCommands({ vitals }), [vitals]);
  const shown = useMemo(() => filterCommands(commands, query), [commands, query]);
  // Clamped rather than corrected in an effect: the list can shrink under the
  // highlight mid-keystroke, and a render that draws an out-of-range row (even
  // for one frame) would point `aria-activedescendant` at nothing.
  const active = shown.length === 0 ? -1 : Math.min(highlight, shown.length - 1);

  // The palette is mounted only while it is open, so this runs once per opening.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the highlighted row in view when arrows walk past the fold. Guarded:
  // jsdom has no layout and therefore no scrollIntoView.
  useEffect(() => {
    if (active < 0) return;
    const row = listRef.current?.querySelector<HTMLElement>(`#${optionId(active)}`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function run(command: GridCommand | undefined): void {
    if (!command) return;
    command.run();
    closePalette();
  }

  function move(delta: number): void {
    if (shown.length === 0) return;
    setHighlight((current) => {
      const from = Math.min(current, shown.length - 1);
      return (from + delta + shown.length) % shown.length;
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Tab') {
      // The palette is modal, so there is nowhere behind it for Tab to go: it
      // walks the list instead of dropping focus out through the back.
      event.preventDefault();
      move(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(shown[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Stopped here so the room page's own window-level Escape (which zooms
      // back to the plan) never fires off the same press.
      event.stopPropagation();
      if (query.length > 0) {
        setQuery('');
        setHighlight(0);
      } else {
        closePalette();
      }
    }
  }

  // Consecutive runs of one section, so the listbox holds one labelled group
  // per heading rather than one group per row.
  const groups: { section: string; rows: { command: GridCommand; index: number }[] }[] = [];
  shown.forEach((command, index) => {
    const last = groups[groups.length - 1];
    if (last && last.section === command.section) last.rows.push({ command, index });
    else groups.push({ section: command.section, rows: [{ command, index }] });
  });

  return (
    <div
      className="agrid-cmd"
      data-testid="grid-palette"
      role="presentation"
      // Mousedown, not click: the press outside is the decision, and waiting
      // for the release would first move focus out from under the palette.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePalette();
      }}
    >
      <div
        className="agrid-cmd__box"
        role="dialog"
        aria-modal="true"
        aria-label="Grid commands"
        onKeyDown={onKeyDown}
      >
        <div className="agrid-cmd__field">
          <span className="material-symbols-outlined agrid-cmd__fico" aria-hidden>
            search
          </span>
          <input
            ref={inputRef}
            className="agrid-cmd__input"
            data-testid="grid-palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={LIST_ID}
            aria-autocomplete="list"
            aria-label="Type a room or a command"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            placeholder="Type a room or a command"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
          />
          <span className="agrid-cmd__key" aria-hidden>
            {PALETTE_HINT}
          </span>
        </div>

        <div
          ref={listRef}
          className="agrid-cmd__list"
          id={LIST_ID}
          role="listbox"
          aria-label="Commands"
        >
          {groups.length === 0 ? (
            <p className="agrid-cmd__empty" data-testid="grid-palette-empty">
              Nothing matches that.
            </p>
          ) : (
            groups.map((group) => (
              <div key={`${group.section}-${group.rows[0].index}`} role="group" aria-label={group.section}>
                <div className="agrid-cmd__sec">{group.section}</div>
                {group.rows.map(({ command, index }) => {
                  const label = command.health
                    ? `${command.label} — ${HEALTH_WORD[command.health]}`
                    : command.label;
                  return (
                    <div
                      key={command.id}
                      className="agrid-cmd__row"
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === active}
                      aria-label={label}
                      title={label}
                      data-testid={`grid-palette-item-${command.id}`}
                      data-active={index === active}
                      data-health={command.health ?? 'none'}
                      // The field keeps focus for the whole interaction, so the
                      // press must not steal it on its way to the click.
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setHighlight(index)}
                      onClick={() => run(command)}
                    >
                      <span className="material-symbols-outlined agrid-cmd__rico" aria-hidden>
                        {command.icon}
                      </span>
                      <span className="agrid-cmd__label">{command.label}</span>
                      {command.badge ? (
                        <span
                          className="agrid-cmd__badge"
                          data-testid={`grid-palette-badge-${command.id}`}
                        >
                          {command.badge}
                        </span>
                      ) : null}
                      {/* Only trouble takes a dot: a healthy row saying so in
                          colour would make eleven quiet rows shout at once. */}
                      {command.health && command.health !== 'nominal' ? (
                        <span
                          aria-hidden
                          className="agrid-cmd__dot"
                          data-testid={`grid-palette-dot-${command.id}`}
                          data-health={command.health}
                          style={{ background: HEALTH_COLOR[command.health] }}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
