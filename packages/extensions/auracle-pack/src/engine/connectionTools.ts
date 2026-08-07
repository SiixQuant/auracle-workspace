/**
 * The connections registry, in the agent's hands — plus the two pieces of panel
 * state a connect drives: the pending secret field, and the data-source advisory.
 *
 * ## One registry, one set of rules
 * Everything here reads and writes through the SAME connections API the panel's
 * connect sheet uses (`/ui/api/connections…`, via {@link ./client}), so an agent
 * and a person cannot put the box into two different states. The tools are
 * value-free by construction: a summary names a connector and whether it is
 * connected, never a field value; a detail read reduces to field NAMES and
 * has_value flags, never a preview or a secret.
 *
 * ## The secret NEVER travels through a tool
 * `connect_source` cannot accept a credential. A keyless source connects in one
 * call; a keyed one is NOT saved by the tool — it arms the pending-connection
 * signal so the panel shows a write-only paste field, the only route a secret
 * has (mirrors {@link ../components/grid/CredentialPaste}). Any option that looks
 * secret-shaped is refused against the one shared pattern
 * ({@link ./boardTools}.VALUE_SHAPED), not a second copy that could drift.
 *
 * ## The advisory is idempotent, and clears itself
 * While no REAL market-data source is connected the pack pushes one ambient note
 * to the agent (through the captured host handle), and clears it the moment one
 * connects. It fires only on the transition, never once per poll, and no-ops on a
 * host with no AI lane.
 */
import type { ExtensionToolResult } from '@nimbalyst/extension-sdk';
import type { PanelAiSlice } from '../components/aiPanel';
import { VALUE_SHAPED, WRITE_ONLY_REFUSAL } from './boardTools';
import { bumpConnectGeneration, getJson, postJson } from './client';
import {
  isConnected,
  KEYLESS_IDS,
  normalizeConnector,
  type Connector,
  type FieldMeta,
} from './model';

/* ── reading the registry ────────────────────────────────────────────────── */

/** Every connector the engine lists, normalized. Empty when nothing answered —
 *  a read tool reports "none" rather than inventing a reason. */
async function readConnections(): Promise<Connector[]> {
  const body = await getJson<{ connections?: Array<Partial<Connector> & { id?: string }> }>(
    '/ui/api/connections?kind=all'
  );
  const rows = body && Array.isArray(body.connections) ? body.connections : [];
  return rows
    .filter((row): row is Partial<Connector> & { id: string } => typeof row?.id === 'string')
    .map((row) => normalizeConnector(row));
}

/**
 * One connector's fields, from the detail route the list omits. Null when
 * nothing answered — the caller then refuses rather than pretending it read an
 * empty connector. Ids are engine slugs, so the path is unescaped to match the
 * connect sheet's own reads (and its test mocks).
 */
async function readConnectionDetail(id: string): Promise<Connector | null> {
  const body = await getJson<Record<string, unknown>>(`/ui/api/connections/${id}`);
  if (!body) return null;
  const raw = (body.connection ?? body) as (Partial<Connector> & { id?: string }) | null;
  if (!raw) return null;
  return normalizeConnector({ ...raw, id: typeof raw.id === 'string' ? raw.id : id });
}

/**
 * How a source is paid for — the one catalog fact the engine does NOT carry (it
 * knows capability, not pricing). Sourced from each provider's live pricing page
 * (verified 2026-08); keep in sync when a provider changes plans. `free` = no
 * account or key at all; `account` = a free signup yields a free, rate-limited
 * key; `paid` = no sustaining free tier (subscription or funded account). An id
 * absent here resolves to null — the agent then treats it as "needs a key".
 */
const DATA_ACCESS_TIER: Record<string, 'free' | 'account' | 'paid'> = {
  yfinance: 'free',
  cboe: 'free',
  finnhub: 'account',
  tiingo: 'account',
  twelvedata: 'account',
  alphavantage: 'account',
  polygon: 'account',
  eodhd: 'account',
  fmp: 'account',
  alpaca: 'account',
  databento: 'paid',
  ibkr: 'paid',
  ibkr_cp: 'paid',
  intrinio: 'paid',
};

/**
 * Whether a connector actually feeds market data — a data provider, or a broker
 * the engine flagged as ALSO providing data (verified: only IBKR and Alpaca).
 * An execution-only broker (ClearStreet, Hyperliquid, Tradier, Tradovate) and an
 * integration are false: they connect, but no bars come out — so the agent never
 * offers them as a data source.
 */
function providesMarketData(connector: Connector): boolean {
  if (connector.kind === 'data_provider') return true;
  return connector.kind === 'broker' && (connector.provides_data ?? false);
}

/** A connector reduced to a value-free row: what it is, whether it is up, whether
 *  it feeds data, and how it's paid for — never a credential. `is_free` marks the
 *  keyless out-of-the-box sources; `access_tier` is the free/account/paid bucket. */
interface SourceSummary {
  id: string;
  name: string;
  kind: string;
  connected: boolean;
  status: string;
  provides_data: boolean;
  provides_market_data: boolean;
  access_tier: 'free' | 'account' | 'paid' | null;
  is_free: boolean;
}

function sourceSummary(connector: Connector): SourceSummary {
  return {
    id: connector.id,
    name: connector.display_label || connector.id,
    kind: connector.kind,
    connected: isConnected(connector.status),
    status: connector.status?.state ?? '',
    provides_data: connector.provides_data ?? false,
    provides_market_data: providesMarketData(connector),
    access_tier: DATA_ACCESS_TIER[connector.id] ?? null,
    is_free: KEYLESS_IDS.has(connector.id),
  };
}

/** The connector kinds that count as a market-data source or a broker. An
 *  integration (e.g. a notifier) is neither, so a connected one is not a data
 *  source. */
const DATA_SOURCE_KINDS: ReadonlySet<string> = new Set(['broker', 'data_provider']);

/**
 * Whether the box has a REAL market-data source — any connected connector that
 * is NOT a free keyless default and whose kind is a broker or a data provider.
 * The free yfinance floor and the paper simulator are excluded by id, because
 * they are live out of the box and were never wired by the operator.
 *
 * This is the one predicate the backtest advisory turns on, and the same one
 * `connection_status` reports as `has_real_data_source`.
 */
export function hasRealDataSource(connections: Connector[]): boolean {
  return connections.some(
    (connector) =>
      isConnected(connector.status) &&
      !KEYLESS_IDS.has(connector.id) &&
      DATA_SOURCE_KINDS.has(connector.kind)
  );
}

/** Whether a connector still needs a credential from the person: a keyed
 *  connector (not keyless) with a required field that has no stored value. */
function needsCredential(connector: Connector): boolean {
  if (KEYLESS_IDS.has(connector.id)) return false;
  return connector.fields.some((field) => field.required && !field.has_value);
}

/** The field metas, reduced to what the agent may see — a NAME, a label, and
 *  whether a value is stored, never the value, the preview, or the kind of key. */
function fieldViews(
  fields: FieldMeta[]
): Array<{ name: string; label: string; required: boolean; has_value: boolean }> {
  return fields.map((field) => ({
    name: field.name,
    label: field.label,
    required: field.required,
    has_value: field.has_value,
  }));
}

/* ── the tools ───────────────────────────────────────────────────────────── */

/**
 * List every connectable data source and broker and their live status. Value
 * free: the summary carries `is_free` per row and no credential anywhere.
 */
export async function listSources(): Promise<ExtensionToolResult> {
  const connectors = await readConnections();
  const sources = connectors.map(sourceSummary);

  // The condensed answer to "what can I connect for data?": market-data sources
  // only (execution-only brokers + integrations excluded — they feed no bars),
  // grouped by cost tier, cheapest first. Deterministic so the agent renders the
  // same short list every time rather than re-deriving the grouping.
  const dataSources = sources.filter((source) => source.provides_market_data);
  const inTier = (tier: SourceSummary['access_tier']) =>
    dataSources.filter((source) => source.access_tier === tier).map((source) => source.id);
  const catalog = { free: inTier('free'), account: inTier('account'), paid: inTier('paid') };
  const marketDataBrokers = sources
    .filter((source) => source.kind === 'broker' && source.provides_market_data)
    .map((source) => source.id);

  return {
    success: true,
    message: `${sources.length} connectable source${sources.length === 1 ? '' : 's'}.`,
    data: { sources, catalog, market_data_brokers: marketDataBrokers },
  };
}

/**
 * Report a connection's live status. With an id, the one connector's
 * connected/needs-credential state and its field NAMES (never values). Without
 * one, the same summary as {@link listSources} plus `has_real_data_source`.
 */
export async function connectionStatus(
  params: Record<string, unknown>
): Promise<ExtensionToolResult> {
  const id = typeof params.id === 'string' ? params.id.trim() : '';

  if (id) {
    const detail = await readConnectionDetail(id);
    if (!detail) {
      return { success: false, error: `No connection answered for "${id}".` };
    }
    const connected = isConnected(detail.status);
    return {
      success: true,
      message: connected
        ? `${detail.display_label || detail.id} is connected.`
        : `${detail.display_label || detail.id} is ${detail.status?.state || 'not connected'}.`,
      data: {
        id: detail.id,
        connected,
        status: detail.status?.state ?? '',
        needs_credential: needsCredential(detail),
        fields: fieldViews(detail.fields),
      },
    };
  }

  const connectors = await readConnections();
  const sources = connectors.map(sourceSummary);
  const real = hasRealDataSource(connectors);
  return {
    success: true,
    message: real
      ? 'A real market-data source is connected.'
      : 'No real market-data source is connected — only the free defaults.',
    data: { sources, has_real_data_source: real },
  };
}

/**
 * Read an `options` object, refusing anything a secret could hide in. A
 * secret-shaped KEY (`api_key`, `token`, `secret`, …) or a secret-shaped string
 * VALUE is turned away against the one shared pattern; everything else — a mode
 * or environment field — is allowed through to `/save`.
 */
function readOptions(
  value: unknown
): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, fields: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'options must be an object of named, non-secret fields.' };
  }
  const fields: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (VALUE_SHAPED.test(key)) return { ok: false, error: `${key}: ${WRITE_ONLY_REFUSAL}` };
    if (typeof entry === 'string' && VALUE_SHAPED.test(entry)) {
      return { ok: false, error: `${key}: ${WRITE_ONLY_REFUSAL}` };
    }
    fields[key] = entry;
  }
  return { ok: true, fields };
}

/** The field the person is asked to paste, for a keyed connector: the first
 *  required field still missing a value, else the first field. Null when the
 *  connector carries no field at all (a gateway broker has none). */
function credentialField(connector: Connector): FieldMeta | null {
  if (connector.fields.length === 0) return null;
  return connector.fields.find((field) => field.required && !field.has_value) ?? connector.fields[0];
}

/**
 * Connect a source or broker by id. A keyless source connects immediately; a
 * keyed one is NOT saved here — a secret cannot travel through a tool — so it
 * arms the pending-connection signal and asks for the paste in the panel. No
 * option that looks secret-shaped is accepted.
 */
export async function connectSource(
  params: Record<string, unknown>
): Promise<ExtensionToolResult> {
  const id = typeof params.id === 'string' ? params.id.trim() : '';
  if (!id) return { success: false, error: 'id is required — the connector to connect.' };

  const options = readOptions(params.options);
  if (!options.ok) return { success: false, error: options.error };

  // A keyless source has no secret to hand in, so the tool completes the connect
  // itself: save (carrying any non-secret mode field), then re-poll every surface.
  if (KEYLESS_IDS.has(id)) {
    const res = await postJson(`/ui/api/connections/${id}/save`, options.fields);
    if (!res.ok) {
      return {
        success: false,
        error: `The engine would not connect ${id} (${res.status || 'unreachable'}).`,
      };
    }
    bumpConnectGeneration();
    return { success: true, message: `Connected ${id}.`, data: { ok: true, connected: true, id } };
  }

  // A keyed connector: read its field names (never values) and hand the paste to
  // the person. Nothing is saved — the secret arrives through the panel, if at all.
  const detail = await readConnectionDetail(id);
  if (!detail) return { success: false, error: `No connection answered for "${id}".` };

  const field = credentialField(detail);
  if (field) {
    setPendingConnection({
      id: detail.id,
      sourceName: detail.display_label || detail.id,
      fieldName: field.name,
    });
  }
  return {
    success: true,
    message: `${detail.display_label || detail.id} needs its credential pasted in the panel — no secret travels through a tool.`,
    data: {
      ok: true,
      needs_credential: true,
      id: detail.id,
      fields: fieldViews(detail.fields),
    },
  };
}

/* ── the pending-connection signal the panel renders off ─────────────────── */

/**
 * A keyed connect waiting on its secret. The panel renders a write-only paste
 * field while this is set (the only place a key is asked for), and it clears the
 * moment the field posts — so the input appears only while a connect is pending.
 */
export interface PendingConnection {
  id: string;
  sourceName: string;
  fieldName: string;
}

let pending: PendingConnection | null = null;
const pendingListeners = new Set<() => void>();

/** Shaped for `useSyncExternalStore`: a cached value replaced only when it
 *  actually moves, so a re-set to the same connection notifies nobody. */
export const pendingConnectionStore = {
  subscribe(listener: () => void): () => void {
    pendingListeners.add(listener);
    return () => {
      pendingListeners.delete(listener);
    };
  },
  getSnapshot(): PendingConnection | null {
    return pending;
  },
};

function samePending(a: PendingConnection | null, b: PendingConnection | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.id === b.id && a.sourceName === b.sourceName && a.fieldName === b.fieldName;
}

/** Arm (or clear) the pending connection. `connect_source` sets it for a keyed
 *  connector; the paste field clears it once the secret is stored. */
export function setPendingConnection(next: PendingConnection | null): void {
  if (samePending(pending, next)) return;
  pending = next;
  for (const listener of pendingListeners) listener();
}

/**
 * Clear the pending connection — unconditionally, or only when it is the named
 * one. The paste field passes its own id so a stale field cannot wipe a pending
 * connect the person opened for a different source in the meantime.
 */
export function clearPendingConnection(id?: string): void {
  if (pending === null) return;
  if (id !== undefined && pending.id !== id) return;
  setPendingConnection(null);
}

/* ── the backtest advisory: one ambient note, on transition only ─────────── */

/**
 * The note pushed to the agent while the box has only the free yfinance floor —
 * so a backtest started in that state prompts the operator to wire a real source
 * for a proper in-sample / out-of-sample test. Value-free and static.
 */
const DATA_SOURCE_ADVISORY: Record<string, unknown> = {
  panel: 'auracle-connections',
  advisory: 'no-real-data-source',
  note:
    'No real market-data source is connected — only the free yfinance floor. Backtests ' +
    'should prompt the user to connect Polygon, IBKR, or Databento for a proper ' +
    'in-sample/out-of-sample test.',
};

/** Whether THIS module last pushed the advisory. Kept module-level so the push
 *  fires once on the transition into "no real source" and the clear fires once
 *  on the transition out — never once per poll, and we only ever clear what we
 *  ourselves wrote. */
let advisoryPushed = false;

/**
 * Reconcile the advisory with the current registry, idempotently.
 *
 *  - no AI lane (older host, or a panel that is not `aiSupported`) → no-op;
 *  - registry unknown (null, nothing answered yet) → no transition, no-op;
 *  - no real source and we have not pushed → push the note;
 *  - a real source arrived and we had pushed → clear it (and only it).
 *
 * Driven from the resting state, which already re-renders when the shared
 * connector poll moves — including on a connect-generation bump — so a real
 * source connecting clears the note without a poll of its own.
 */
export function syncDataSourceAdvisory(
  ai: PanelAiSlice | undefined,
  connections: Connector[] | null
): void {
  if (!ai) return;
  if (connections === null) return;
  const real = hasRealDataSource(connections);
  if (!real && !advisoryPushed) {
    ai.setContext({ ...DATA_SOURCE_ADVISORY });
    advisoryPushed = true;
  } else if (real && advisoryPushed) {
    ai.clearContext();
    advisoryPushed = false;
  }
}

/** Test seam: drop the advisory latch so a suite starts from a known state. */
export function __resetConnectionToolsForTests(): void {
  advisoryPushed = false;
  setPendingConnection(null);
}
