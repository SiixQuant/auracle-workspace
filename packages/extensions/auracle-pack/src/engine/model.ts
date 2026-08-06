/**
 * Engine wire types and pure helpers, ported 1:1 (with their unit tests) from
 * the previous native client. These encode the platform's honesty rules:
 * "connected" is claimed only when the engine reports exactly that, and
 * section summaries never overstate counts.
 */

/**
 * One connector's live status, exactly as the engine reports it
 * (`{"state": ..., "detail": ...}`). `state` is the engine's vocabulary:
 * `connected` | `not_configured` | `error` | broker runtime states
 * (`connecting`/`disconnected`/`degraded`/…).
 */
export interface ConnStatus {
  state: string;
  detail?: string | null;
}

/**
 * One connector in the unified registry. The list endpoint returns these with
 * `fields` empty; the detail endpoint fills `fields` (with `has_value`/preview
 * flags) for the credentials form.
 */
export interface Connector {
  id: string;
  display_label: string;
  blurb: string;
  /** `broker` | `data_provider` | `integration`. */
  kind: string;
  status: ConnStatus;
  fields: FieldMeta[];
  asset_kinds: string[];
  /** When false the panel shows Save-only (no fake green from a missing tester). */
  test_supported: boolean;
  /** Whether the operator's tier blocks connecting this connector. */
  gated: boolean;
  gated_reason: string;
  /** Whether this connector ALSO provides market data. A broker like IBKR/Alpaca
   *  trades AND streams quotes, so the sheet can say "trades + data" on the one
   *  broker row rather than listing a separate data-vendor row for it. The engine
   *  dedupes the registry so such a connector appears once carrying this flag;
   *  everything else defaults false. */
  provides_data?: boolean;
}

export interface FieldMeta {
  name: string;
  label: string;
  kind: string;
  required: boolean;
  has_value: boolean;
  preview: string;
  options: string[];
}

export interface Account {
  email: string;
  tier: string;
  license_status: { state: string; expiry?: string | null };
  manage_url?: string | null;
}

/** `GET /ui/api/ide/connect-check` shape (subset the UI consumes). */
export interface ConnectCheck {
  ok: boolean;
  engine?: { name?: string; version?: string };
  user?: { email?: string };
  active_broker?: string | null;
  live_allowed?: boolean;
}

/**
 * True only when the engine reports a live, configured connection. Every
 * other state (not_configured, error, disconnected, degraded, …) is honest
 * about NOT being connected.
 */
export function isConnected(status: ConnStatus | undefined): boolean {
  return status?.state === 'connected';
}

/** A one-line, honest status summary for a section of connectors. */
export function sectionSummary(connectors: Connector[]): string {
  if (connectors.length === 0) {
    return 'None available';
  }
  const connected = connectors.filter((connector) => isConnected(connector.status)).length;
  const total = connectors.length;
  if (connected === 0) return 'None connected';
  if (connected === total && total === 1) return 'Connected';
  if (connected === total) return `All ${total} connected`;
  return `${connected} of ${total} connected`;
}

/**
 * Whether a section should start expanded: a section with nothing connected is
 * opened on first load to invite the operator to connect; an already-set-up
 * section starts collapsed to stay out of the way.
 */
export function defaultExpanded(connectors: Connector[]): boolean {
  return connectors.length > 0 && !connectors.some((connector) => isConnected(connector.status));
}

/**
 * Connectors that need no credentials — the platform is keyless by default, so
 * reading these as "not configured" would understate a source that is ready to
 * use right now.
 */
export const KEYLESS_IDS: ReadonlySet<string> = new Set(['yfinance', 'simulator']);

export interface ConnectorTag {
  kind: 'ok' | 'caution' | 'danger' | 'muted';
  label: string;
}

/**
 * The one status tag every connector surface renders — the Settings page and
 * the Grid's Connections room read this same function, so the two can never
 * describe one connector with two different words.
 *
 * The engine's own vocabulary is preserved: an error or an intermediate state
 * shows the engine's `detail` when it gave one, and any state that is neither
 * connected, keyless-ready, nor errored is shown AS IS rather than flattened
 * into "not configured" — a connector that is reconnecting has not failed.
 */
export function connectorTag(connector: Connector): ConnectorTag {
  if (isConnected(connector.status)) return { kind: 'ok', label: 'Connected' };
  if (KEYLESS_IDS.has(connector.id)) return { kind: 'ok', label: 'Ready' };
  const state = connector.status?.state ?? '';
  if (state === 'error') {
    return { kind: 'danger', label: connector.status.detail || 'Error' };
  }
  if (state && state !== 'not_configured') {
    return { kind: 'caution', label: connector.status.detail || state };
  }
  return { kind: 'muted', label: 'Not configured' };
}

/* ── setup completeness (WS-H / FR-H2, PRD DF4) ─────────────────────── */

/**
 * States that mean the operator ENABLED a connector and it is NOT healthy — one
 * they turned on that is mid-handshake, wobbling, or rejected. `not_configured`
 * and `disconnected` are deliberately absent: an unconfigured (or a passively
 * dropped) optional is not a fault the operator must fix, so it never holds the
 * connect entry open (DF4). Only these three, reached exclusively AFTER the
 * operator engages a connector, keep it open.
 */
const ENABLED_UNHEALTHY_STATES: ReadonlySet<string> = new Set([
  'connecting',
  'degraded',
  'error',
]);

/** The zero-config paper execution venue — usable the moment the engine is up,
 *  and reported `connected` even though the operator did nothing (houston forces
 *  a credential-free broker's display state to `connected`). */
const PAPER_SIMULATOR_ID = 'simulator';

/**
 * Whether a connector is a ZERO-CONFIG DEFAULT — a source the engine reports
 * `connected` without the operator lifting a finger, so it can never, on its
 * own, mean the box is "set up":
 *   - the paper simulator (a credential-free broker), and
 *   - a KEYLESS data provider: kind `data_provider` with an EMPTY `fields` array.
 *     yfinance needs no key, so houston emits no fields for it AND reports it
 *     `connected` (`_data_provider_payload`: `configured = True` when there are
 *     no key fields); a keyed vendor like Polygon/EODHD carries its key field,
 *     so it is NOT a default.
 *
 * This is the distinction the whole hide predicate turns on: yfinance + the
 * simulator are live out of the box, so the entry must stay until the operator
 * wires something real over the top of them.
 */
export function isZeroConfigDefault(connector: Connector): boolean {
  if (connector.id === PAPER_SIMULATOR_ID) return true;
  return connector.kind === 'data_provider' && connector.fields.length === 0;
}

/**
 * A REAL connection the operator established: any connector the engine reports
 * `connected` that is NOT a zero-config default — a connected non-simulator
 * broker (IBKR/Alpaca) or a connected KEYED data vendor (Polygon/EODHD). This is
 * the one thing a fresh box lacks.
 */
function isRealConnection(connector: Connector): boolean {
  return isConnected(connector.status) && !isZeroConfigDefault(connector);
}

/**
 * Whether the operator has a viable, HEALTHY trading setup — the DF4 predicate
 * behind hiding the single connect entry (FR-H2). True (⇒ hide the entry) only
 * when the operator has established at least one REAL connection AND nothing
 * they enabled is mid-handshake, degraded, or errored.
 *
 * The free defaults cover the rest: yfinance always gives backtest data and the
 * paper simulator always gives a venue, both reported `connected` out of the
 * box — so the ONLY thing a fresh box is missing, and the only thing this entry
 * asks for, is a real data/broker connection. PURE over the connector list the
 * registry already polls, so it re-shows the instant an enabled connector
 * degrades and never fabricates a reason to hide; an unconfigured or passively
 * dropped optional never holds it open.
 */
export function isSetupComplete(connectors: Connector[]): boolean {
  const hasRealConnection = connectors.some(isRealConnection);
  const anyEnabledUnhealthy = connectors.some((connector) =>
    ENABLED_UNHEALTHY_STATES.has(connector.status?.state ?? '')
  );
  return hasRealConnection && !anyEnabledUnhealthy;
}

/** Fill engine-optional fields so list rows render without undefined checks. */
export function normalizeConnector(raw: Partial<Connector> & { id: string }): Connector {
  return {
    id: raw.id,
    display_label: raw.display_label ?? '',
    blurb: raw.blurb ?? '',
    kind: raw.kind ?? '',
    status: raw.status ?? { state: '', detail: null },
    fields: raw.fields ?? [],
    asset_kinds: raw.asset_kinds ?? [],
    test_supported: raw.test_supported ?? false,
    gated: raw.gated ?? false,
    gated_reason: raw.gated_reason ?? '',
    provides_data: raw.provides_data ?? false,
  };
}
