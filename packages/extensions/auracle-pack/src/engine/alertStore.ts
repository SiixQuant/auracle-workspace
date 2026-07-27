/**
 * Open-alert count — the single number the rail button badges.
 *
 * SOURCE: `open_alerts` on the engine's consolidated status call,
 * `GET /ui/api/summary`. The engine computes that figure as the length of the
 * very incident feed the Incidents surface reads and labels "N open" — the
 * caller's dismissals honored, the same bounded lookback — so the badge and the
 * room cannot drift, and a user can always verify the badge by opening that
 * room and counting the rows. Reading it here rather than fetching the feed
 * again is what lets the badge and the Grid sheet share one call.
 *
 * HONESTY: an engine that did not answer (or is too old to serve the route)
 * reads ZERO, never the last count it managed to fetch. A badge still claiming
 * "3" while nothing is reachable is a number the user cannot act on; the room
 * is where an outage gets explained, not the badge.
 *
 * COST: polling is lazy. The interval starts with the first subscriber and
 * stops with the last, so a window that never renders the badge pays nothing.
 */
import { getJson, onConnectGeneration } from './client';
import { SUMMARY_PATH, type SummaryBody } from './gridVitals';

/** Same cadence as the Incidents surface, so the two never disagree for long. */
const POLL_MS = 30_000;

let count = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let stopGenerationWatch: (() => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: number): void {
  if (next === count) return;
  count = next;
  for (const listener of listeners) listener();
}

async function read(): Promise<void> {
  const summary = await getJson<SummaryBody>(SUMMARY_PATH);
  const open = summary?.open_alerts;
  // Zero for anything that is not a stated count: an engine that did not
  // answer, a build that does not serve the call, and a district whose own
  // read failed (the engine reports that block as null) all leave the badge
  // clear rather than claiming a number nobody can act on.
  publish(typeof open === 'number' && Number.isFinite(open) ? open : 0);
}

function start(): void {
  if (timer !== null) return;
  void read();
  timer = setInterval(() => void read(), POLL_MS);
  // A reconnect (new key, engine restarted) invalidates the count immediately
  // rather than at the end of the current poll window.
  stopGenerationWatch = onConnectGeneration(() => void read());
}

function stop(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  stopGenerationWatch?.();
  stopGenerationWatch = null;
}

/**
 * The open-alert count, shaped for `useSyncExternalStore`: a primitive
 * snapshot, so a re-render happens exactly when the number changes.
 */
export const alertStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    start();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) stop();
    };
  },

  getSnapshot(): number {
    return count;
  },

  /** Force a read now (a manual refresh, and the seam tests drive). */
  refresh(): Promise<void> {
    return read();
  },
};
