/**
 * The streaming connection — recovery and non-freezing, the two things the
 * pack's first push client owes a card left on screen.
 *
 * What is pinned here:
 *  - a dropped stream RECONNECTS on a backoff that grows each attempt;
 *  - and it does not FREEZE while recovering: it falls back to periodic
 *    snapshots so figures keep arriving until the stream is back;
 *  - a recovered stream stops the snapshots and goes live again;
 *  - and `close()` releases everything — the open line, the pending reconnect,
 *    the snapshot interval — which is how leaving the Board frees the engine.
 *
 * The stream and the snapshot are injected as a fake EventSource and a fake
 * fetch, so none of this touches a live engine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openQuoteStream,
  type QuoteEventSource,
  type QuoteStreamDeps,
} from '../quoteStream';
import type { ContractRef, Quote, QuoteStreamStatus } from '../liveQuotes';

const REFS: ContractRef[] = [{ symbol: 'AAPL', secType: 'STK' }];

class FakeEventSource implements QuoteEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.onopen?.();
  }

  emitQuote(quote: Partial<Quote> & { symbol: string }): void {
    this.onmessage?.({ data: JSON.stringify({ sec_type: 'STK', quality: 'realtime', market_data_type: 1, ...quote }) });
  }

  emitError(): void {
    this.onerror?.();
  }
}

interface Harness {
  deps: QuoteStreamDeps;
  created: FakeEventSource[];
  snapshotCalls: ContractRef[][];
  quotes: Quote[];
  statuses: QuoteStreamStatus[];
  handlers: { onQuote: (q: Quote) => void; onStatus: (s: QuoteStreamStatus) => void };
  setSnapshot: (quotes: Quote[] | null) => void;
  setCreateNull: (value: boolean) => void;
}

function snapshotQuote(symbol: string): Quote {
  return {
    symbol,
    secType: 'STK',
    last: 101.5,
    bid: 101.4,
    ask: 101.6,
    bidSize: 100,
    askSize: 100,
    volume: 5000,
    ts: '2026-07-29T15:00:00Z',
    quality: 'delayed',
    marketDataType: 3,
  };
}

function harness(): Harness {
  const created: FakeEventSource[] = [];
  const snapshotCalls: ContractRef[][] = [];
  const quotes: Quote[] = [];
  const statuses: QuoteStreamStatus[] = [];
  let snapshotResult: Quote[] | null = [snapshotQuote('AAPL')];
  let createNull = false;

  const deps: QuoteStreamDeps = {
    createStream: () => {
      if (createNull) return null;
      const es = new FakeEventSource();
      created.push(es);
      return es;
    },
    snapshot: async (refs) => {
      snapshotCalls.push([...refs]);
      return snapshotResult;
    },
    backoffMs: [1000, 4000],
    snapshotEveryMs: 2000,
  };

  return {
    deps,
    created,
    snapshotCalls,
    quotes,
    statuses,
    handlers: { onQuote: (q) => quotes.push(q), onStatus: (s) => statuses.push(s) },
    setSnapshot: (value) => {
      snapshotResult = value;
    },
    setCreateNull: (value) => {
      createNull = value;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a live connection streams and recovers', () => {
  it('goes live and delivers each quote', () => {
    const h = harness();
    openQuoteStream(REFS, h.handlers, h.deps);
    expect(h.created).toHaveLength(1);

    h.created[0].emitOpen();
    expect(h.statuses).toContain('live');

    h.created[0].emitQuote({ symbol: 'AAPL', last: 190.25 });
    expect(h.quotes.at(-1)).toMatchObject({ symbol: 'AAPL', last: 190.25, quality: 'realtime' });
  });

  it('opens nothing and sits idle for an empty watch set', () => {
    const h = harness();
    openQuoteStream([], h.handlers, h.deps);
    expect(h.created).toHaveLength(0);
    expect(h.statuses).toEqual(['idle']);
  });
});

describe('a dropped stream reconnects on a growing backoff', () => {
  it('waits the first backoff, then a longer one on the next failure', () => {
    const h = harness();
    openQuoteStream(REFS, h.handlers, h.deps);
    h.created[0].emitOpen();

    // First drop: closed, and a reconnect scheduled at backoff[0] = 1000ms.
    h.created[0].emitError();
    expect(h.created[0].closed).toBe(true);
    vi.advanceTimersByTime(999);
    expect(h.created).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(h.created).toHaveLength(2);

    // Second drop WITHOUT a successful open: the next backoff is the longer
    // rung (4000ms), proving the delay grows with consecutive failures.
    h.created[1].emitError();
    vi.advanceTimersByTime(3999);
    expect(h.created).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(h.created).toHaveLength(3);
  });

  it('resets the backoff once a reconnect succeeds', () => {
    const h = harness();
    openQuoteStream(REFS, h.handlers, h.deps);
    h.created[0].emitOpen();

    h.created[0].emitError();
    vi.advanceTimersByTime(1000);
    expect(h.created).toHaveLength(2);
    // A successful reopen resets the ladder; the next drop waits the FIRST rung
    // again, not the second.
    h.created[1].emitOpen();
    h.created[1].emitError();
    vi.advanceTimersByTime(1000);
    expect(h.created).toHaveLength(3);
  });
});

describe('a dropped stream degrades to snapshots rather than freezing', () => {
  it('pulls a snapshot immediately on the drop, then on an interval', async () => {
    const h = harness();
    openQuoteStream(REFS, h.handlers, h.deps);
    h.created[0].emitOpen();

    h.created[0].emitError();
    expect(h.statuses).toContain('snapshot');
    // Immediate, so the card does not blank for a whole interval.
    expect(h.snapshotCalls).toHaveLength(1);
    expect(h.snapshotCalls[0]).toEqual(REFS);

    // And again every snapshotEveryMs while the stream is down.
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.snapshotCalls.length).toBeGreaterThanOrEqual(2);
    // The snapshot's quotes reach the card, labelled by their own quality.
    expect(h.quotes.at(-1)).toMatchObject({ symbol: 'AAPL', quality: 'delayed' });
  });

  it('stops the snapshots once the stream is live again', async () => {
    const h = harness();
    openQuoteStream(REFS, h.handlers, h.deps);
    h.created[0].emitOpen();
    h.created[0].emitError();
    expect(h.snapshotCalls).toHaveLength(1);

    // Reconnect and reopen: snapshots stop, and no further snapshot fires.
    vi.advanceTimersByTime(1000);
    h.created[1].emitOpen();
    expect(h.statuses.at(-1)).toBe('live');
    const countAtRecovery = h.snapshotCalls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(h.snapshotCalls).toHaveLength(countAtRecovery);
  });

  it('degrades straight to snapshots when it cannot open a stream at all', () => {
    const h = harness();
    h.setCreateNull(true);
    openQuoteStream(REFS, h.handlers, h.deps);
    expect(h.created).toHaveLength(0);
    expect(h.statuses).toContain('snapshot');
    expect(h.snapshotCalls.length).toBeGreaterThanOrEqual(1);

    // It keeps retrying the stream, so it upgrades the moment it becomes able.
    h.setCreateNull(false);
    vi.advanceTimersByTime(1000);
    expect(h.created).toHaveLength(1);
  });
});

describe('close releases the line', () => {
  it('closes the open stream and cancels every pending timer', async () => {
    const h = harness();
    const handle = openQuoteStream(REFS, h.handlers, h.deps);
    h.created[0].emitOpen();

    handle.close();
    expect(h.created[0].closed).toBe(true);

    // Nothing reconnects and nothing snapshots after a close.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.created).toHaveLength(1);
    expect(h.snapshotCalls).toHaveLength(0);
  });

  it('cancels a reconnect that was already scheduled', () => {
    const h = harness();
    const handle = openQuoteStream(REFS, h.handlers, h.deps);
    h.created[0].emitOpen();
    h.created[0].emitError();
    handle.close();

    vi.advanceTimersByTime(10_000);
    expect(h.created).toHaveLength(1);
  });
});
