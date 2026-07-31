/**
 * Which face the panel is showing — the Plan or the Board.
 *
 * The panel has two faces over one surface, so the choice is a store outside
 * React for the same reason the room router is: the toggle raises it, the panel
 * renders off it, the keystroke flips it from wherever focus happens to be, and
 * none of those three has to hold the other's state.
 *
 * ## Board first, then whatever they last used
 * An undecided workspace opens on the BOARD. That is not a preference for one
 * face over the other — the Board's empty state IS the onboarding (connect
 * something, ask something, watch the rest arrive), and a person who has never
 * seen it should meet it before they meet a floor plan of a platform they have
 * not filled yet. The moment they choose a face, that choice is what opens.
 *
 * ## Per workspace, through the host's own workspace state
 * The lane is {@link ExtensionStorage}'s workspace tier — the same
 * `workspace:update-state` store the host persists its own layout in, namespaced
 * to this extension. Workspace rather than global because a face belongs to a
 * body of work: a research workspace opens on its Board, a maintenance one on
 * its Plan, and neither drags the other's choice along.
 *
 * NOT the engine's synced settings lane, which is where the Board's GRAPH goes.
 * That lane is shared, network-backed and asynchronous; which face to paint has
 * to be answered on the FIRST frame, from memory, with no fetch in the way.
 *
 * ## Why hydration happens during render
 * `storage.get` is synchronous, so binding it before the first snapshot is read
 * costs nothing and spares the panel a flip-flop: seed-then-notify from an
 * effect would paint the default face first and correct it a frame later. The
 * panel therefore calls {@link bindFaceStorage} in its render body, next to the
 * two `ensure…Styles()` calls that are there for the same reason. It is
 * idempotent, it seeds only a face nobody has chosen yet, and it never
 * notifies — there is nothing subscribed at that point by construction.
 *
 * The one thing it cannot promise: the host's workspace cache is filled by an
 * IPC round trip taken at startup, so a panel mounted in the same instant a
 * workspace opens may read nothing and land on the Board default. That is the
 * fresh-workspace answer, which is the right thing to be wrong with.
 */
import type { ExtensionStorage } from '@nimbalyst/extension-sdk';

/** The panel's views. `home` is the resting state; the two legacy faces
 * remain reachable by keyboard as construction scaffolding until the swap's
 * deletion issue removes them. */
export type GridFace = 'home' | 'plan' | 'board';

/** Every workspace opens on the resting state. The redesign's contract is
 * that the panel opens on a statement of state, so the opening view is not a
 * preference and is deliberately not remembered. */
export const DEFAULT_FACE: GridFace = 'home';

/** Workspace-storage key, namespaced by the host to this extension. */
export const FACE_KEY = 'grid.face';

/** `null` until something decides — a stored choice, or a person pressing. */
let face: GridFace | null = null;
/** Where the choice is written back. Absent on a host that offers no storage
 *  (and in tests), which costs the memory and nothing else. */
let backing: ExtensionStorage | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Bind the workspace store and adopt the face it remembers.
 *
 * Safe to call on every render: it re-binds (the host hands out a new storage
 * object when the workspace changes) but only ADOPTS into an undecided face, so
 * a person's press is never overwritten by what was on disk before it.
 */
export function bindFaceStorage(storage: ExtensionStorage | undefined | null): void {
  if (!storage) return;
  backing = storage;
  // Deliberately no adoption: the panel OPENS on the resting state every
  // time, so a face remembered from before the redesign must not decide the
  // opening view. The binding is kept so a mid-session flip still writes,
  // which costs nothing and dies with this store in the deletion issue.
}

/** The face to draw. */
export function getFace(): GridFace {
  return face ?? DEFAULT_FACE;
}

/** Show a face, and remember it. A write that changes nothing does not notify,
 *  so a redraw is never spent on a no-op — but it still binds the choice, which
 *  is how "I meant this one" survives a restart. */
export function setFace(next: GridFace): void {
  const changed = getFace() !== next;
  face = next;
  // Fire and forget: the panel must not wait on a disk write to change what it
  // is showing, and a failed write costs the memory of a preference, nothing
  // else. Wrapped rather than awaited so a backend that throws — synchronously
  // or later — cannot take the flip down with it.
  if (backing) {
    try {
      void Promise.resolve(backing.set(FACE_KEY, next)).catch(() => {});
    } catch {
      /* see above */
    }
  }
  if (changed) notify();
}

/** The next view along: home, then the Board, then the Plan, then home.
 * The cycle is the scaffolding entry to the legacy faces — no on-screen
 * control offers them any more. */
export function toggleFace(): void {
  const current = getFace();
  setFace(current === 'home' ? 'board' : current === 'board' ? 'plan' : 'home');
}

export function subscribeFace(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Back to undecided and unbound — for tests, which share a module instance. */
export function resetFaceStore(): void {
  face = null;
  backing = null;
  notify();
}
