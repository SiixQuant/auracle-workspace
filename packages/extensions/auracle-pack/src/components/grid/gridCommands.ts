/**
 * The command post — what the Grid's palette can run, and whether it is showing.
 *
 * COMMANDS COME FROM PROVIDERS, never from a literal list. The palette asks
 * this registry, the registry asks each registered provider, and the base
 * provider is the room table itself: "Open Backtest" is a command like any
 * other. A later surface (the state-aware AI actions) registers its own
 * provider and appears in the same list without the palette learning anything
 * about it — which is the whole reason the seam is here rather than a `rooms`
 * array inside the component.
 *
 * STATE-AWARE ORDER: a provider is handed the current vitals and may mark a
 * command with the health behind it. The registry floats the unwell ones to the
 * top of their own provider's block, so the row already under the cursor when
 * the palette opens is the one that needs a person. The sort is stable, so a
 * provider's own ordering survives everywhere it is not overruled by trouble.
 *
 * OPEN/CLOSED lives here too, in a store outside React (the same shape as
 * gridNav's): the sheet's root node opens the palette, the panel renders it,
 * and neither has to hold the other's state.
 */
import type { GridVitals, Health } from '../../engine/gridVitals';
import { ROOM_ICONS } from './districts';
import { openRoomFocused } from './gridNav';
import { ROOM_CONTEXT } from './roomContext';
import { ROOM_IDS, ROOMS, type RoomId } from './rooms';

/** One runnable row. */
export interface GridCommand {
  /** Unique across providers — also what the row's `data-testid` carries. */
  id: string;
  /** What the row reads. An imperative: "Open Validation". */
  label: string;
  /** Material Symbols ligature, drawn with the face the host loads globally. */
  icon: string;
  /** Extra words the filter matches on but nobody sees — a room's blurb, its
   *  id, whatever a person is likely to type instead of the title. */
  keywords?: string[];
  /** The heading this command files under. */
  section: string;
  /**
   * A short mark drawn at the end of the row — "AI" on the assistant's rows.
   * A section heading scrolls out of sight while its rows are still on screen,
   * so a row that will ACT on the system carries the mark itself rather than
   * relying on the heading it arrived under.
   */
  badge?: string;
  /** What Enter (or a click) does. */
  run: () => void;
  /**
   * The reading behind this command, when it has one. Shown as a dot and used
   * for ordering; a command with no reading (an action, not a place) simply
   * sorts in its provider's own order.
   */
  health?: Health;
}

/** What a provider gets to decide with. */
export interface GridCommandContext {
  vitals: GridVitals;
  /** The palette's current query, when there is one. Most providers ignore it
   *  and answer statically (the palette filters their rows itself); a
   *  query-reactive provider — the `<entity> <verb>` grammar — reads it to emit
   *  rows only for a grammar phrase. Optional so every existing caller and
   *  provider is unaffected. */
  query?: string;
}

export interface GridCommandProvider {
  /** Stable id — registering the same id twice replaces the first. */
  id: string;
  /** The commands this provider offers right now. Called on every read, so it
   *  can (and should) answer differently as the system's state moves. */
  list(context: GridCommandContext): GridCommand[];
}

/* ── provider registry ──────────────────────────────────────────────── */

/** Insertion-ordered: the order providers register is the order their blocks
 *  appear, so the rooms stay first and later providers land beneath them. */
const providers = new Map<string, GridCommandProvider>();

/** Register a provider. Returns the disposer that removes it again. */
export function registerCommandProvider(provider: GridCommandProvider): () => void {
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id);
  };
}

/** Trouble first: a faulted room outranks a degraded one, which outranks
 *  everything that is either healthy or not a place at all. */
const ATTENTION_RANK: Record<Health, number> = { fault: 0, degraded: 1, nominal: 2 };

function rank(command: GridCommand): number {
  return command.health ? ATTENTION_RANK[command.health] : ATTENTION_RANK.nominal;
}

/** Every command on offer, provider by provider, trouble first within each. */
export function listCommands(context: GridCommandContext): GridCommand[] {
  const all: GridCommand[] = [];
  for (const provider of providers.values()) {
    all.push(...[...provider.list(context)].sort((a, b) => rank(a) - rank(b)));
  }
  return all;
}

/**
 * Narrow by what was typed. Every whitespace-separated term must appear
 * somewhere in the row's own words (label, section, keywords) — so "val gate"
 * and "gate val" find the same row, and a term that matches nothing hides it.
 */
export function filterCommands(commands: GridCommand[], query: string): GridCommand[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return commands;
  return commands.filter((command) => {
    const hay = `${command.label} ${command.section} ${(command.keywords ?? []).join(' ')}`
      .toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}

/**
 * Bloomberg-style mnemonics — the short codes a power user reaches for instead
 * of the room's full name. They ride in each room's `keywords`, so typing `bt`
 * lands on Backtest and `fac` on Factors without spelling either out. Muscle
 * memory over menus; every code is a plain abbreviation, never a secret.
 */
const ROOM_MNEMONICS: Record<RoomId, readonly string[]> = {
  findings: ['fnd', 'ideas'],
  qc: ['qc', 'lib'],
  catalog: ['data', 'coverage', 'universe', 'symbols'],
  strategies: ['strat', 'strats'],
  strategy: ['ts', 'tear', 'sheet'],
  backtest: ['bt'],
  validation: ['val', 'gates', 'overfit'],
  factors: ['fac', 'risk', 'attribution', 'alpha'],
  portfolio: ['pf', 'port', 'blend', 'combine'],
  deploys: ['dep', 'live'],
  blotter: ['blt', 'fills'],
  incidents: ['inc', 'alerts'],
  schedules: ['sch', 'cron'],
  runway: ['rw'],
};

/* ── the base provider: every room ──────────────────────────────────── */

/** The rooms, as commands. `openRoomFocused` rather than `openGridRoom`: the
 *  palette only ever runs while the Grid is already the surface on screen, so
 *  asking the host to front the panel again would be a second, pointless
 *  toggle — but the room still has to land on the object the reader is looking
 *  at, which is what the focused open guarantees. */
const roomsProvider: GridCommandProvider = {
  id: 'rooms',
  list: ({ vitals }) =>
    ROOM_IDS.map((id) => ({
      id: `room-${id}`,
      label: `Open ${ROOMS[id].title}`,
      icon: ROOM_ICONS[id],
      // Searchable by what the room is FOR, not only by its name: the sentence
      // is the one every other surface shows, so nobody has to guess the title
      // of the room that holds the thing they are after.
      keywords: [id, ROOMS[id].title, ROOM_CONTEXT[id], ...ROOM_MNEMONICS[id]],
      section: 'Rooms',
      health: vitals[id]?.health,
      run: () => openRoomFocused(id),
    })),
};

registerCommandProvider(roomsProvider);

/* ── open/closed store (session-lived) ──────────────────────────────── */

let open = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function isPaletteOpen(): boolean {
  return open;
}

export function openPalette(): void {
  if (open) return;
  open = true;
  notify();
}

export function closePalette(): void {
  if (!open) return;
  open = false;
  notify();
}

export function togglePalette(): void {
  open = !open;
  notify();
}

export function subscribePalette(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** How the shortcut is written on screen. `navigator.platform` is what the
 *  host's own shortcut layer reads, so the two never disagree. */
export const PALETTE_HINT =
  typeof navigator !== 'undefined' && /^Mac/i.test(navigator.platform ?? '') ? 'Cmd K' : 'Ctrl K';
