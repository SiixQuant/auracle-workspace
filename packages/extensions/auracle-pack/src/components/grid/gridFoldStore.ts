/**
 * Which districts are folded shut — module state, deliberately outside React.
 *
 * A fold has two readers, not one. The sheet draws a count chip instead of the
 * district's rooms; the wire overlay has to RECOMPUTE its geometry, because the
 * cards its wires were drawn between just left the DOM. A store rather than a
 * prop is what lets the second reader exist without the first knowing about it:
 * anything that draws off the plan's shape subscribes here and redraws.
 *
 * ## The API is the seam — keep it this small
 * `subscribe(listener)` fires after every real change and returns its own
 * unsubscribe. `getSnapshot()` returns the folded ids as a frozen-by-convention
 * set whose REFERENCE only changes when the set does, so it is safe to read
 * with `useSyncExternalStore`. `set` / `toggle` write, `isFolded` asks about one
 * district, `reset` returns the plan to fully open (tests, and any future
 * "expand all"). A write that changes nothing does not notify, so a redraw is
 * never spent on a no-op.
 *
 * ## Session-lived, never persisted
 * Folding a district, walking into a room and coming back leaves it folded —
 * this is module state, and the sheet unmounts while a room is showing. A
 * reload starts with everything open: a fold is a glance, not a preference, and
 * a plan that hides a district across restarts could hide a failing room.
 *
 * District ids are plain strings here (`districts.ts` owns the roster) so the
 * store stays a leaf with no import of its own.
 */

/** The folded district ids. Reference-stable between changes. */
export type FoldedDistricts = ReadonlySet<string>;

const NONE: FoldedDistricts = new Set<string>();

let folded: FoldedDistricts = NONE;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): FoldedDistricts {
  return folded;
}

function isFolded(districtId: string): boolean {
  return folded.has(districtId);
}

function set(districtId: string, next: boolean): void {
  if (folded.has(districtId) === next) return;
  const draft = new Set(folded);
  if (next) draft.add(districtId);
  else draft.delete(districtId);
  folded = draft;
  notify();
}

function toggle(districtId: string): void {
  set(districtId, !folded.has(districtId));
}

function reset(): void {
  if (folded.size === 0) return;
  folded = NONE;
  notify();
}

export const gridFoldStore = { subscribe, getSnapshot, isFolded, set, toggle, reset };
