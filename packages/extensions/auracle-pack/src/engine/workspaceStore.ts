/**
 * workspaceStore — saved views of the Grid (Frontier #3).
 *
 * A "workspace" is one named (room + focus) view: "Factors · FundPair", "Backtest
 * · Target-25". Saving one lets a person jump straight back to it from the ⌘K
 * palette instead of re-navigating and re-picking the strategy every time.
 *
 * ## Why the renderer's own storage, not the settings lane
 * The engine validates settings pref names against a fixed allowlist (see
 * boardPersistence), so a brand-new `grid_workspaces` key would be REFUSED until
 * the engine ships it — an engine change and a deploy. Workspaces are a
 * single-person convenience on one desktop, and `window.localStorage` already
 * persists across app restarts here, so this keeps them purely in the renderer:
 * no engine dependency, live the moment the IDE updates. Moving them to the
 * synced settings lane later is additive and does not change this interface.
 *
 * Pure list/save/remove over a small cached array, mirrored to storage on every
 * change; a subscribe/getSnapshot pair matches the pack's other stores so a
 * surface can render the set reactively.
 */
import type { RoomId } from '../components/grid/rooms';
import type { Focus } from './focusStore';

/** One saved view: where you were and what you were looking at. */
export interface Workspace {
  /** Stable id derived from room + focus, so re-saving the same view upserts. */
  id: string;
  /** What the palette row reads — "Factors · FundPair". */
  label: string;
  /** The room to reopen. */
  room: RoomId;
  /** The focus to republish on reopen. */
  focus: Focus;
}

const LOCAL_KEY = 'auracle.grid_workspaces';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null);
  } catch {
    // A renderer with storage disabled throws on the property itself.
    return null;
  }
}

function isWorkspace(v: unknown): v is Workspace {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  return (
    typeof w.id === 'string' &&
    typeof w.label === 'string' &&
    typeof w.room === 'string' &&
    typeof w.focus === 'object' &&
    w.focus !== null
  );
}

function read(): Workspace[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isWorkspace) : [];
  } catch {
    return [];
  }
}

function persist(list: Workspace[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    // A full or disabled store is not a reason to throw from a save.
  }
}

// Cached so `getSnapshot` returns a stable reference between changes (React's
// useSyncExternalStore re-renders on identity change; a fresh array each read
// would loop). Loaded lazily on first access.
let cache: Workspace[] | null = null;
const listeners = new Set<() => void>();

function all(): Workspace[] {
  if (cache === null) cache = read();
  return cache;
}

function commit(next: Workspace[]): void {
  cache = next;
  persist(next);
  for (const l of listeners) l();
}

export const workspaceStore = {
  /** A copy of the saved workspaces, for callers that iterate or mutate. */
  list(): Workspace[] {
    return [...all()];
  },
  /** The stable array for `useSyncExternalStore` (do not mutate). */
  getSnapshot(): Workspace[] {
    return all();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Upsert one workspace by id (re-saving the same view replaces it). */
  save(workspace: Workspace): void {
    commit([...all().filter((w) => w.id !== workspace.id), workspace]);
  },
  /** Forget one workspace. */
  remove(id: string): void {
    commit(all().filter((w) => w.id !== id));
  },
  /** Test seam: clear both the cache and storage. */
  __resetForTest(): void {
    const store = storage();
    try {
      store?.removeItem(LOCAL_KEY);
    } catch {
      // ignore
    }
    commit([]);
    cache = null;
  },
};
