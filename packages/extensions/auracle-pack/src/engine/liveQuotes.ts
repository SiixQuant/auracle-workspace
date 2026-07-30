/**
 * The live-quote domain — the value objects a streaming quote card is built on,
 * and the two honesty rules that make it safe to show.
 *
 * Pure by design: types, the contract → wire mapping the engine's quote routes
 * take, the parse of a quote frame off the stream, and the quality arithmetic.
 * No transport, no React, no store — so every rule below is testable from a
 * literal alone. The connection that opens the stream lives in
 * {@link ./quoteStream}; the card that draws one lives in
 * {@link ../components/grid/QuoteCard}.
 *
 * ## The two rules this file exists to keep
 *  - **I1, quality honesty.** A quote is only ever shown as `realtime` when the
 *    engine says so AND its `market_data_type` agrees (1 == realtime). A payload
 *    that calls itself realtime while its market-data type says otherwise is
 *    DOWNGRADED here, not trusted — {@link displayQuality}. Delayed and frozen
 *    are labelled as themselves; nothing non-realtime is ever called live.
 *  - **A contract resolves to itself.** {@link contractToWire} names every
 *    qualifier a derivative needs (an option's expiry/strike/right, a future's
 *    expiry/exchange, an FX pair's currency), so the watch request the engine
 *    receives is the contract the person specified and not a lookalike.
 */

/** The instrument types v1 can watch. STK/ETF/IND resolve on symbol alone;
 *  the rest need the qualifiers named in {@link QUALIFIER_FIELDS}. */
export const SEC_TYPES = ['STK', 'ETF', 'IND', 'OPT', 'FUT', 'FOP', 'CASH'] as const;

export type SecType = (typeof SEC_TYPES)[number];

/** How each type is written on screen. */
export const SEC_TYPE_LABEL: Record<SecType, string> = {
  STK: 'Stock',
  ETF: 'ETF',
  IND: 'Index',
  OPT: 'Option',
  FUT: 'Future',
  FOP: 'Future option',
  CASH: 'FX',
};

export function isSecType(value: string): value is SecType {
  return (SEC_TYPES as readonly string[]).includes(value);
}

/**
 * The user/agent-facing spec that resolves to a broker Contract. Symbol and
 * sec_type are always required; the rest are the per-type qualifiers, present
 * only where the type needs them. Stored on a Board quote card verbatim (camel
 * case, the graph's convention); mapped to the engine's wire shape by
 * {@link contractToWire}.
 */
export interface ContractRef {
  symbol: string;
  secType: SecType;
  /** Option/future contract month or date, e.g. `20260117` or `202603`. */
  expiry?: string;
  /** Option/future-option strike. */
  strike?: number;
  /** Option/future-option right. */
  right?: 'C' | 'P';
  /** Listing exchange (future/FX; optional override for equities). */
  exchange?: string;
  /** FX quote currency (the pair's second leg). */
  currency?: string;
  /** Contract multiplier, where the type carries one. */
  multiplier?: string;
}

/** One qualifier field a type needs, for the editor to draw and for
 *  {@link missingQualifiers} to check. */
export interface QualifierField {
  key: 'expiry' | 'strike' | 'right' | 'currency' | 'exchange' | 'multiplier';
  label: string;
  placeholder: string;
  required: boolean;
  kind: 'text' | 'number' | 'right';
}

/**
 * The extra fields each type needs to resolve unambiguously. STK/ETF/IND need
 * none beyond the symbol (an optional exchange aside, which the engine can
 * default). This table is the single source both the editor and the
 * watchability check read, so the two can never disagree about what an option
 * requires.
 */
export const QUALIFIER_FIELDS: Record<SecType, readonly QualifierField[]> = {
  STK: [{ key: 'exchange', label: 'Exchange', placeholder: 'SMART', required: false, kind: 'text' }],
  ETF: [{ key: 'exchange', label: 'Exchange', placeholder: 'SMART', required: false, kind: 'text' }],
  IND: [{ key: 'exchange', label: 'Exchange', placeholder: 'CBOE', required: false, kind: 'text' }],
  OPT: [
    { key: 'expiry', label: 'Expiry', placeholder: 'YYYYMMDD', required: true, kind: 'text' },
    { key: 'strike', label: 'Strike', placeholder: '200', required: true, kind: 'number' },
    { key: 'right', label: 'Right', placeholder: 'C or P', required: true, kind: 'right' },
    { key: 'exchange', label: 'Exchange', placeholder: 'SMART', required: false, kind: 'text' },
  ],
  FUT: [
    { key: 'expiry', label: 'Expiry', placeholder: 'YYYYMM', required: true, kind: 'text' },
    { key: 'exchange', label: 'Exchange', placeholder: 'CME', required: true, kind: 'text' },
    { key: 'multiplier', label: 'Multiplier', placeholder: '50', required: false, kind: 'text' },
  ],
  FOP: [
    { key: 'expiry', label: 'Expiry', placeholder: 'YYYYMM', required: true, kind: 'text' },
    { key: 'strike', label: 'Strike', placeholder: '5000', required: true, kind: 'number' },
    { key: 'right', label: 'Right', placeholder: 'C or P', required: true, kind: 'right' },
    { key: 'exchange', label: 'Exchange', placeholder: 'CME', required: true, kind: 'text' },
  ],
  CASH: [
    { key: 'currency', label: 'Quote currency', placeholder: 'USD', required: true, kind: 'text' },
    { key: 'exchange', label: 'Exchange', placeholder: 'IDEALPRO', required: false, kind: 'text' },
  ],
};

/** The qualifiers a contract still needs before it can be watched. Empty means
 *  it resolves. Symbol is handled separately by {@link isWatchable}. */
export function missingQualifiers(ref: ContractRef): string[] {
  const missing: string[] = [];
  for (const field of QUALIFIER_FIELDS[ref.secType] ?? []) {
    if (!field.required) continue;
    const value = ref[field.key];
    const absent = field.key === 'strike' ? typeof value !== 'number' : !value;
    if (absent) missing.push(field.label);
  }
  return missing;
}

/** Whether a contract is complete enough to open a line for. A card streams
 *  only its watchable contracts; a half-typed one waits in the editor. */
export function isWatchable(ref: ContractRef): boolean {
  return ref.symbol.trim() !== '' && missingQualifiers(ref).length === 0;
}

export function watchableContracts(refs: readonly ContractRef[]): ContractRef[] {
  return refs.filter(isWatchable);
}

/* ── the wire shape ──────────────────────────────────────────────────────── */

/**
 * A contract in the engine's own words: snake_case, `sec_type`, and only the
 * qualifiers that are set. This is the exact object the quote routes qualify a
 * Contract from, so an option carries its expiry/strike/right and a future its
 * expiry/exchange — never a bare symbol that would resolve to the wrong thing.
 */
export function contractToWire(ref: ContractRef): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    symbol: ref.symbol.trim().toUpperCase(),
    sec_type: ref.secType,
  };
  if (ref.expiry) wire.expiry = ref.expiry.trim();
  if (typeof ref.strike === 'number' && Number.isFinite(ref.strike)) wire.strike = ref.strike;
  if (ref.right) wire.right = ref.right;
  if (ref.exchange) wire.exchange = ref.exchange.trim().toUpperCase();
  if (ref.currency) wire.currency = ref.currency.trim().toUpperCase();
  if (ref.multiplier) wire.multiplier = ref.multiplier.trim();
  return wire;
}

/**
 * A stable identifier for one contract within a card's set — the key a quote is
 * filed under, and a React key. Built from every field that distinguishes two
 * contracts, so two options on one underlying at different strikes never
 * collapse into one row.
 */
export function contractKey(ref: {
  symbol: string;
  secType: string;
  expiry?: string;
  strike?: number;
  right?: string;
  currency?: string;
}): string {
  return [
    ref.secType,
    ref.symbol.trim().toUpperCase(),
    ref.expiry ?? '',
    typeof ref.strike === 'number' ? ref.strike : '',
    ref.right ?? '',
    ref.currency ?? '',
  ].join('|');
}

/** A contract as a person reads it: `AAPL`, `AAPL 20260117 200C`, `EUR/USD`. */
export function contractLabel(ref: ContractRef): string {
  const symbol = ref.symbol.trim().toUpperCase() || '—';
  if (ref.secType === 'CASH') return ref.currency ? `${symbol}/${ref.currency.toUpperCase()}` : symbol;
  const tail: string[] = [];
  if (ref.expiry) tail.push(ref.expiry);
  if (typeof ref.strike === 'number') tail.push(`${ref.strike}${ref.right ?? ''}`);
  else if (ref.right) tail.push(ref.right);
  return tail.length === 0 ? symbol : `${symbol} ${tail.join(' ')}`;
}

/**
 * The query a stream or snapshot request carries — the whole watch SET encoded
 * as `ref=<json>`, the engine's own array form. A card is a small watchlist
 * (one line per contract), so the set travels together rather than one request
 * per symbol.
 */
export function watchQuery(refs: readonly ContractRef[]): string {
  const wire = refs.map(contractToWire);
  return `ref=${encodeURIComponent(JSON.stringify(wire))}`;
}

/* ── quotes off the wire ─────────────────────────────────────────────────── */

/** `realtime` is the only value that may be called live (I1). */
export type QuoteQuality = 'realtime' | 'delayed' | 'frozen' | 'unavailable';

const QUALITIES: readonly QuoteQuality[] = ['realtime', 'delayed', 'frozen', 'unavailable'];

/** An immutable quote snapshot, parsed from one stream frame or one snapshot
 *  row. Numbers absent on the wire come through as null, never 0. */
export interface Quote {
  symbol: string;
  secType: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  volume: number | null;
  ts: string | null;
  quality: QuoteQuality;
  /** IB's market-data type: 1 realtime, 2 frozen, 3 delayed, 4 delayed-frozen.
   *  Null when the engine did not state one. */
  marketDataType: number | null;
  /** Carried through when the engine echoes a derivative's qualifiers, so a
   *  quote files under the same key as the contract that asked for it. */
  expiry?: string;
  strike?: number;
  right?: string;
  currency?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number, or null. Tolerates a numeric string (the wire is JSON, but
 *  a provider that stringifies a price must not read as "no price"). */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function quality(value: unknown): QuoteQuality {
  return typeof value === 'string' && (QUALITIES as readonly string[]).includes(value)
    ? (value as QuoteQuality)
    : 'unavailable';
}

/** One quote frame. Null when it carries no symbol — a frame with nothing to
 *  file (a heartbeat, a comment) is not a quote and must not overwrite one. */
export function parseQuote(raw: unknown): Quote | null {
  if (!isRecord(raw)) return null;
  const symbol = typeof raw.symbol === 'string' ? raw.symbol : '';
  if (symbol.trim() === '') return null;
  const strike = num(raw.strike);
  return {
    symbol,
    secType: typeof raw.sec_type === 'string' ? raw.sec_type : '',
    last: num(raw.last),
    bid: num(raw.bid),
    ask: num(raw.ask),
    bidSize: num(raw.bid_size),
    askSize: num(raw.ask_size),
    volume: num(raw.volume),
    ts: typeof raw.ts === 'string' ? raw.ts : null,
    quality: quality(raw.quality),
    marketDataType: num(raw.market_data_type),
    ...(typeof raw.expiry === 'string' ? { expiry: raw.expiry } : {}),
    ...(strike !== null ? { strike } : {}),
    ...(typeof raw.right === 'string' ? { right: raw.right } : {}),
    ...(typeof raw.currency === 'string' ? { currency: raw.currency } : {}),
  };
}

/** A snapshot answers with an array, or `{ quotes: [...] }`. Either way, the
 *  quotes it actually carried. */
export function parseQuoteFrames(raw: unknown): Quote[] {
  const rows = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.quotes) ? raw.quotes : [];
  return rows.map(parseQuote).filter((quote): quote is Quote => quote !== null);
}

/* ── quality honesty (I1) ────────────────────────────────────────────────── */

/** IB's market-data type as a quality. Anything but 1 is non-realtime. */
export function qualityFromMarketDataType(type: number | null): QuoteQuality {
  if (type === 1) return 'realtime';
  if (type === 2 || type === 4) return 'frozen';
  if (type === 3) return 'delayed';
  return 'unavailable';
}

/**
 * The quality a quote may be SHOWN as — I1 enforced client-side.
 *
 * The engine tags every quote, and this trusts that tag with one exception it
 * refuses to make: a quote that calls itself realtime while its market-data
 * type says it is not (a bug, a race across a delayed-entitlement fallback) is
 * downgraded to what the market-data type actually reports. Non-realtime tags
 * are shown as themselves. The net rule: nothing reaches a screen labelled live
 * unless it truly is.
 */
export function displayQuality(quote: Quote): QuoteQuality {
  if (quote.quality === 'realtime') {
    if (quote.marketDataType === null || quote.marketDataType === 1) return 'realtime';
    return qualityFromMarketDataType(quote.marketDataType);
  }
  return quote.quality;
}

/** The single test the whole honesty rule reduces to. */
export function isLive(quote: Quote): boolean {
  return displayQuality(quote) === 'realtime';
}

/** How each quality is written on a badge. `realtime` is the ONLY word that
 *  reads as live; the rest name themselves plainly. */
export const QUALITY_WORD: Record<QuoteQuality, string> = {
  realtime: 'Live',
  delayed: 'Delayed',
  frozen: 'Frozen',
  unavailable: 'No data',
};

/** The semantic tone a quality takes — mapped to a hue by the card. Live is a
 *  functional "ready" signal (green); the caveats are caution; absence is
 *  muted. */
export function qualityTone(q: QuoteQuality): 'ok' | 'caution' | 'muted' {
  if (q === 'realtime') return 'ok';
  if (q === 'unavailable') return 'muted';
  return 'caution';
}

/* ── the card's overall reading ──────────────────────────────────────────── */

/** Where a card's stream is in its own lifecycle. */
export type QuoteStreamStatus = 'idle' | 'connecting' | 'live' | 'snapshot';

export type QuoteHealth = 'nominal' | 'degraded' | 'fault' | 'unknown';

export interface QuoteReading {
  health: QuoteHealth;
  word: string;
}

const QUALITY_RANK: Record<QuoteQuality, number> = {
  realtime: 0,
  delayed: 1,
  frozen: 1,
  unavailable: 2,
};

/** The worst quality among the ones a card is currently showing — a card is
 *  only as live as its least-live line. */
export function worstQuality(qualities: readonly QuoteQuality[]): QuoteQuality | null {
  return qualities.reduce<QuoteQuality | null>(
    (worst, q) => (worst === null || QUALITY_RANK[q] > QUALITY_RANK[worst] ? q : worst),
    null
  );
}

/**
 * How the whole card reads — the dot's health and the word beside it — from the
 * stream's status and the qualities on it. A stream that has dropped to
 * snapshots reads degraded even when its last figures were live, because the
 * honest thing to say is that the live line is gone, not that the number is
 * fresh.
 */
export function quoteReading(
  status: QuoteStreamStatus,
  qualities: readonly QuoteQuality[]
): QuoteReading {
  if (status === 'snapshot') return { health: 'degraded', word: 'stream down · snapshots' };
  if (qualities.length === 0) {
    if (status === 'idle') return { health: 'unknown', word: 'no contract yet' };
    return { health: 'unknown', word: 'connecting…' };
  }
  const worst = worstQuality(qualities) ?? 'unavailable';
  if (worst === 'realtime') return { health: 'nominal', word: 'live' };
  if (worst === 'unavailable') return { health: 'unknown', word: 'no data' };
  return { health: 'degraded', word: QUALITY_WORD[worst].toLowerCase() };
}
