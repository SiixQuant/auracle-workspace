/**
 * The Board's live-quote subscription, as one hook.
 *
 * Being mounted IS the watcher: the hook opens the stream when the card renders
 * and closes it when the card leaves — which is how removing a card, or leaving
 * the Board, releases the engine's line. It re-opens only when the watch SET
 * actually changes (keyed on the encoded request, not the array's identity), so
 * a re-render that hands over an equal set does not churn the connection.
 *
 * The connection mechanics — reconnect, backoff, snapshot fallback — live in
 * {@link ../../engine/quoteStream}; this is the thin React seam over it. `deps`
 * is injectable so a test drives a fake stream; production omits it and gets the
 * real EventSource-and-bridge wiring.
 */
import { useEffect, useMemo, useState } from 'react';
import { contractKey, watchQuery, type ContractRef, type Quote, type QuoteStreamStatus } from '../../engine/liveQuotes';
import { defaultQuoteDeps, openQuoteStream, type QuoteStreamDeps } from '../../engine/quoteStream';

export interface LiveQuotesState {
  /** The latest quote per contract, keyed by {@link contractKey}. */
  quotes: Map<string, Quote>;
  status: QuoteStreamStatus;
}

const EMPTY: LiveQuotesState = { quotes: new Map(), status: 'idle' };

export function useLiveQuotes(
  contracts: readonly ContractRef[],
  deps?: QuoteStreamDeps
): LiveQuotesState {
  // The encoded request is the identity of the watch set: two equal sets produce
  // one string, so the effect below re-subscribes only on a real change.
  const key = useMemo(() => watchQuery(contracts), [contracts]);
  const resolvedDeps = useMemo(() => deps ?? defaultQuoteDeps(), [deps]);
  const [state, setState] = useState<LiveQuotesState>(EMPTY);

  useEffect(() => {
    if (contracts.length === 0) {
      setState({ quotes: new Map(), status: 'idle' });
      return;
    }
    // A fresh set starts clean rather than showing the last card's prices.
    setState({ quotes: new Map(), status: 'connecting' });
    const handle = openQuoteStream(
      contracts,
      {
        onQuote: (quote) =>
          setState((prev) => {
            const quotes = new Map(prev.quotes);
            quotes.set(contractKey(quote), quote);
            return { quotes, status: prev.status };
          }),
        onStatus: (status) => setState((prev) => ({ quotes: prev.quotes, status })),
      },
      resolvedDeps
    );
    return () => handle.close();
    // `contracts` is read through the closure; `key` is its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, resolvedDeps]);

  return state;
}
