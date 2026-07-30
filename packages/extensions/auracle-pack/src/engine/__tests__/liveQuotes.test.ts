/**
 * The live-quote domain: the two honesty rules, and the contract → watch
 * request every type resolves to.
 *
 * What is pinned here:
 *  - I1: nothing non-realtime is ever reported as live — a delayed payload reads
 *    delayed, and a payload that CALLS itself realtime while its market-data
 *    type disagrees is downgraded, not trusted;
 *  - AC2: a fully specified option, future and FX pair each build the watch
 *    request the engine needs to qualify the RIGHT contract, not a lookalike.
 */
import { describe, expect, it } from 'vitest';
import {
  contractKey,
  contractLabel,
  contractToWire,
  displayQuality,
  isLive,
  isWatchable,
  missingQualifiers,
  parseQuote,
  parseQuoteFrames,
  quoteReading,
  watchQuery,
  worstQuality,
  type ContractRef,
  type Quote,
} from '../liveQuotes';

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: 'AAPL',
    secType: 'STK',
    last: 190.25,
    bid: 190.2,
    ask: 190.3,
    bidSize: 100,
    askSize: 120,
    volume: 10_000,
    ts: '2026-07-29T14:30:00Z',
    quality: 'realtime',
    marketDataType: 1,
    ...overrides,
  };
}

/* ── AC2: every type resolves to the right watch request ─────────────────── */

describe('a contract builds the watch request its type needs (AC2)', () => {
  it('carries only symbol and sec_type for a stock', () => {
    expect(contractToWire({ symbol: 'aapl', secType: 'STK' })).toEqual({
      symbol: 'AAPL',
      sec_type: 'STK',
    });
  });

  it('carries an option with its expiry, strike and right', () => {
    const option: ContractRef = {
      symbol: 'AAPL',
      secType: 'OPT',
      expiry: '20260117',
      strike: 200,
      right: 'C',
      exchange: 'smart',
    };
    expect(contractToWire(option)).toEqual({
      symbol: 'AAPL',
      sec_type: 'OPT',
      expiry: '20260117',
      strike: 200,
      right: 'C',
      exchange: 'SMART',
    });
  });

  it('carries a future with its expiry and exchange', () => {
    const future: ContractRef = { symbol: 'ES', secType: 'FUT', expiry: '202603', exchange: 'CME' };
    expect(contractToWire(future)).toEqual({
      symbol: 'ES',
      sec_type: 'FUT',
      expiry: '202603',
      exchange: 'CME',
    });
  });

  it('carries an FX pair with its quote currency', () => {
    const fx: ContractRef = { symbol: 'EUR', secType: 'CASH', currency: 'usd' };
    expect(contractToWire(fx)).toEqual({ symbol: 'EUR', sec_type: 'CASH', currency: 'USD' });
  });

  it('encodes the whole watch SET as one ref parameter', () => {
    const set: ContractRef[] = [
      { symbol: 'AAPL', secType: 'STK' },
      { symbol: 'ES', secType: 'FUT', expiry: '202603', exchange: 'CME' },
    ];
    const query = watchQuery(set);
    expect(query.startsWith('ref=')).toBe(true);
    const decoded = JSON.parse(decodeURIComponent(query.slice('ref='.length)));
    expect(decoded).toEqual([
      { symbol: 'AAPL', sec_type: 'STK' },
      { symbol: 'ES', sec_type: 'FUT', expiry: '202603', exchange: 'CME' },
    ]);
  });

  it('names what a half-specified derivative still needs, and refuses to watch it', () => {
    const bareOption: ContractRef = { symbol: 'AAPL', secType: 'OPT' };
    expect(missingQualifiers(bareOption)).toEqual(['Expiry', 'Strike', 'Right']);
    expect(isWatchable(bareOption)).toBe(false);
    expect(isWatchable({ symbol: 'AAPL', secType: 'OPT', expiry: '20260117', strike: 200, right: 'C' })).toBe(true);
  });

  it('does not watch a contract with no symbol', () => {
    expect(isWatchable({ symbol: '   ', secType: 'STK' })).toBe(false);
  });

  it('keys two options on one underlying apart, and labels them', () => {
    const call: ContractRef = { symbol: 'AAPL', secType: 'OPT', expiry: '20260117', strike: 200, right: 'C' };
    const put: ContractRef = { symbol: 'AAPL', secType: 'OPT', expiry: '20260117', strike: 200, right: 'P' };
    expect(contractKey(call)).not.toBe(contractKey(put));
    expect(contractLabel(call)).toBe('AAPL 20260117 200C');
    expect(contractLabel({ symbol: 'EUR', secType: 'CASH', currency: 'USD' })).toBe('EUR/USD');
  });
});

/* ── I1: quality honesty ─────────────────────────────────────────────────── */

describe('a quote is only ever shown as live when it truly is (I1)', () => {
  it('shows a realtime quote as live', () => {
    const q = quote({ quality: 'realtime', marketDataType: 1 });
    expect(displayQuality(q)).toBe('realtime');
    expect(isLive(q)).toBe(true);
  });

  it('shows a delayed quote as delayed, never as live', () => {
    const q = quote({ quality: 'delayed', marketDataType: 3 });
    expect(displayQuality(q)).toBe('delayed');
    expect(isLive(q)).toBe(false);
  });

  it('shows a frozen quote as frozen', () => {
    expect(displayQuality(quote({ quality: 'frozen', marketDataType: 2 }))).toBe('frozen');
  });

  it('DOWNGRADES a quote that calls itself realtime while its market-data type disagrees', () => {
    // The one exception to trusting the tag: a realtime label over a delayed
    // market-data type is a bug, and I1 refuses to pass it as live.
    const mislabelled = quote({ quality: 'realtime', marketDataType: 3 });
    expect(displayQuality(mislabelled)).toBe('delayed');
    expect(isLive(mislabelled)).toBe(false);
  });

  it('trusts a realtime tag when no market-data type was stated', () => {
    expect(isLive(quote({ quality: 'realtime', marketDataType: null }))).toBe(true);
  });

  it('reads an unknown quality as unavailable rather than guessing', () => {
    const q = parseQuote({ symbol: 'AAPL', quality: 'weird', last: 1 });
    expect(q?.quality).toBe('unavailable');
  });
});

/* ── parsing off the wire ────────────────────────────────────────────────── */

describe('parsing a quote frame', () => {
  it('reads the engine wire shape and keeps absent numbers null, never zero', () => {
    const q = parseQuote({
      symbol: 'AAPL',
      sec_type: 'STK',
      last: 190.25,
      bid: 190.2,
      ask: 190.3,
      bid_size: 100,
      ask_size: 120,
      volume: 10_000,
      ts: '2026-07-29T14:30:00Z',
      quality: 'realtime',
      market_data_type: 1,
    });
    expect(q).toMatchObject({ symbol: 'AAPL', last: 190.25, bidSize: 100, marketDataType: 1 });
    const sparse = parseQuote({ symbol: 'AAPL', quality: 'realtime' });
    expect(sparse?.last).toBeNull();
    expect(sparse?.bid).toBeNull();
  });

  it('is not a quote when there is no symbol to file it under', () => {
    expect(parseQuote({ last: 1, quality: 'realtime' })).toBeNull();
    expect(parseQuote({ heartbeat: true })).toBeNull();
  });

  it('reads a snapshot as an array or a { quotes } envelope', () => {
    expect(parseQuoteFrames([{ symbol: 'AAPL', quality: 'realtime' }])).toHaveLength(1);
    expect(parseQuoteFrames({ quotes: [{ symbol: 'AAPL', quality: 'delayed' }] })).toHaveLength(1);
    expect(parseQuoteFrames({ nope: true })).toHaveLength(0);
  });
});

/* ── the card's overall reading ──────────────────────────────────────────── */

describe('the card reads only as live as its least-live line', () => {
  it('is live when every line is realtime and the stream is up', () => {
    expect(quoteReading('live', ['realtime', 'realtime'])).toEqual({ health: 'nominal', word: 'live' });
  });

  it('reads degraded the moment one line is delayed', () => {
    expect(worstQuality(['realtime', 'delayed'])).toBe('delayed');
    expect(quoteReading('live', ['realtime', 'delayed']).health).toBe('degraded');
  });

  it('reads degraded while the stream is down, even on last-live figures', () => {
    expect(quoteReading('snapshot', ['realtime']).health).toBe('degraded');
    expect(quoteReading('snapshot', ['realtime']).word).toContain('snapshots');
  });

  it('is honest ignorance before the first frame', () => {
    expect(quoteReading('idle', []).health).toBe('unknown');
    expect(quoteReading('connecting', []).health).toBe('unknown');
  });
});
