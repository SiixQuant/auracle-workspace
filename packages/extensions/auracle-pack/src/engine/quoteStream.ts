/**
 * The pack's first streaming consumer — one Board card's live quote line, over
 * the engine's server-sent quote stream, with the two things a push client owes
 * a person who leaves it on screen: it RECOVERS a dropped stream, and it never
 * FREEZES while recovering.
 *
 * ## Why this is not the engine client
 * Every other call in the pack goes through the main-process bridge
 * ({@link ./client}), which is request/response. A stream is neither: it is a
 * connection held open for as long as the card is on the canvas. So the stream
 * itself is a native `EventSource` opened against the engine's URL, while the
 * SNAPSHOT fallback — an ordinary GET — still goes through the bridge, where it
 * is already authed and already mockable. The two are injected as
 * {@link QuoteStreamDeps} so the whole state machine below is testable without
 * a live engine: a test hands in a fake EventSource and a fake snapshot.
 *
 * ## The state machine, in one paragraph
 * Open the stream. On the first quote it is `live`. If it errors — the daily
 * gateway reset, a transient drop, an engine that is not up yet — close it,
 * start pulling SNAPSHOTS on an interval so figures keep arriving, and schedule
 * a reconnect on a BACKOFF that grows each attempt up to a ceiling. When a
 * reconnect opens, stop the snapshots and go back to `live`. A card that can't
 * stream at all (no EventSource, engine URL not known yet) degrades straight to
 * snapshots and keeps retrying, so it upgrades to the stream the moment it can.
 * `close()` tears all of it down — the open line, the pending reconnect, the
 * snapshot interval — which is how leaving the Board releases the engine's line.
 */
import { engineConfig, getJson } from './client';
import {
  parseQuote,
  parseQuoteFrames,
  watchQuery,
  type ContractRef,
  type Quote,
  type QuoteStreamStatus,
} from './liveQuotes';

export const QUOTE_STREAM_PATH = '/ui/api/quotes/stream';
export const QUOTE_SNAPSHOT_PATH = '/ui/api/quotes/snapshot';

/** The minimum of a native `EventSource` this connection drives — so a test can
 *  stand one up without the DOM type, and the real one is adapted to it. */
export interface QuoteEventSource {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

export interface QuoteStreamHandlers {
  onQuote: (quote: Quote) => void;
  onStatus: (status: QuoteStreamStatus) => void;
}

export interface QuoteStreamDeps {
  /**
   * Open a stream for this watch set, or return null when streaming is not
   * possible here (no `EventSource`, engine URL not known yet). Null is a soft
   * failure: the connection degrades to snapshots and keeps retrying.
   */
  createStream: (refs: readonly ContractRef[]) => QuoteEventSource | null;
  /** One-shot snapshot of the watch set; null on any failure. */
  snapshot: (refs: readonly ContractRef[]) => Promise<Quote[] | null>;
  /** Backoff ladder in ms; the last entry is the ceiling every later attempt
   *  reuses. */
  backoffMs?: readonly number[];
  /** How often to pull a snapshot while the stream is down. */
  snapshotEveryMs?: number;
}

export interface QuoteStreamHandle {
  close(): void;
}

const DEFAULT_BACKOFF: readonly number[] = [1000, 2000, 4000, 8000, 15000];
const DEFAULT_SNAPSHOT_EVERY_MS = 3000;

function safeJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Open a live-quote connection for one card's contracts. Returns a handle whose
 * `close()` releases everything. An empty watch set opens nothing and sits
 * `idle` — a card with no contract described yet holds no engine line.
 */
export function openQuoteStream(
  refs: readonly ContractRef[],
  handlers: QuoteStreamHandlers,
  deps: QuoteStreamDeps
): QuoteStreamHandle {
  const backoff = deps.backoffMs && deps.backoffMs.length > 0 ? deps.backoffMs : DEFAULT_BACKOFF;
  const snapshotEvery = deps.snapshotEveryMs ?? DEFAULT_SNAPSHOT_EVERY_MS;

  let closed = false;
  let source: QuoteEventSource | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotTimer: ReturnType<typeof setInterval> | undefined;

  const emitStatus = (status: QuoteStreamStatus): void => {
    if (!closed) handlers.onStatus(status);
  };

  const clearReconnect = (): void => {
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  };

  const stopSnapshots = (): void => {
    if (snapshotTimer !== undefined) {
      clearInterval(snapshotTimer);
      snapshotTimer = undefined;
    }
  };

  const pullSnapshot = async (): Promise<void> => {
    if (closed) return;
    let quotes: Quote[] | null = null;
    try {
      quotes = await deps.snapshot(refs);
    } catch {
      quotes = null;
    }
    if (closed || quotes === null) return;
    for (const quote of quotes) handlers.onQuote(quote);
  };

  const startSnapshots = (): void => {
    if (snapshotTimer !== undefined || closed) return;
    emitStatus('snapshot');
    // Immediately, so a dropped stream does not go blank for one whole interval
    // before the first fallback figures arrive.
    void pullSnapshot();
    snapshotTimer = setInterval(() => void pullSnapshot(), snapshotEvery);
  };

  const scheduleReconnect = (): void => {
    clearReconnect();
    const delay = backoff[Math.min(attempt, backoff.length - 1)];
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  };

  function connect(): void {
    if (closed) return;
    const next = deps.createStream(refs);
    if (!next) {
      // Cannot stream right now — keep figures flowing via snapshots and try the
      // stream again later, so the card upgrades the moment it becomes possible.
      startSnapshots();
      scheduleReconnect();
      return;
    }
    source = next;
    if (attempt === 0) emitStatus('connecting');

    next.onopen = (): void => {
      if (closed) return;
      attempt = 0;
      stopSnapshots();
      emitStatus('live');
    };
    next.onmessage = (event): void => {
      if (closed) return;
      const quote = parseQuote(safeJson(event.data));
      if (!quote) return;
      // A frame arriving is proof the line is live, even if `onopen` was missed.
      stopSnapshots();
      emitStatus('live');
      handlers.onQuote(quote);
    };
    next.onerror = (): void => {
      if (closed) return;
      try {
        next.close();
      } catch {
        // already gone
      }
      if (source === next) source = null;
      startSnapshots();
      scheduleReconnect();
    };
  }

  if (refs.length === 0) {
    emitStatus('idle');
    return {
      close(): void {
        closed = true;
      },
    };
  }

  connect();

  return {
    close(): void {
      if (closed) return;
      closed = true;
      clearReconnect();
      stopSnapshots();
      if (source) {
        try {
          source.close();
        } catch {
          // already gone
        }
        source = null;
      }
    },
  };
}

/* ── the production wiring ───────────────────────────────────────────────── */

/** The engine origin the stream opens against, primed once and cached. Read
 *  synchronously by {@link defaultQuoteDeps}; unknown on the very first call,
 *  which simply defers the card to snapshots until the reconnect that follows. */
let cachedOrigin: string | null = null;
let priming: Promise<void> | null = null;

function primeOrigin(): Promise<void> {
  if (priming) return priming;
  priming = engineConfig()
    .then((config) => {
      cachedOrigin = config.engineUrl || '';
    })
    .catch(() => {
      cachedOrigin = '';
    });
  return priming;
}

async function fetchSnapshot(refs: readonly ContractRef[]): Promise<Quote[] | null> {
  if (refs.length === 0) return [];
  const body = await getJson<unknown>(`${QUOTE_SNAPSHOT_PATH}?${watchQuery(refs)}`);
  return body === null ? null : parseQuoteFrames(body);
}

/**
 * The deps a real card uses: the stream over a native `EventSource` against the
 * engine URL (with credentials, so the engine's session cookie rides along on
 * the GET), and the snapshot over the authed bridge. Injected, so tests never
 * touch either.
 */
export function defaultQuoteDeps(): QuoteStreamDeps {
  void primeOrigin();
  return {
    createStream(refs): QuoteEventSource | null {
      if (typeof EventSource === 'undefined') return null;
      if (!cachedOrigin) {
        void primeOrigin();
        return null;
      }
      try {
        const url = `${cachedOrigin}${QUOTE_STREAM_PATH}?${watchQuery(refs)}`;
        // Adapt the DOM EventSource to the minimal shape the connection drives.
        return new EventSource(url, { withCredentials: true }) as unknown as QuoteEventSource;
      } catch {
        return null;
      }
    },
    snapshot: (refs) => fetchSnapshot(refs),
  };
}
