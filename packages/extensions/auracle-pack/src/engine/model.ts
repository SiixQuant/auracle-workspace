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
 * Connector kinds that can serve MARKET DATA. A broker carries data as well as
 * execution ("your broker = data + trading"), so a live broker satisfies the
 * data-source requirement too; a pure data vendor obviously does.
 */
const DATA_SOURCE_KINDS: ReadonlySet<string> = new Set(['broker', 'data_provider']);

/** Connector kinds that can EXECUTE orders. */
const VENUE_KINDS: ReadonlySet<string> = new Set(['broker']);

/**
 * States that mean the operator ENABLED a connector and it is NOT healthy — one
 * they turned on that is mid-handshake, wobbling, or rejected. `not_configured`
 * and `disconnected` are deliberately absent: an unconfigured connector is a
 * choice, not a fault (the platform is keyless by default), so an untouched
 * optional never holds the connect entry open (DF4). Only these three, reached
 * exclusively AFTER the operator engages a connector, keep it open.
 */
const ENABLED_UNHEALTHY_STATES: ReadonlySet<string> = new Set([
  'connecting',
  'degraded',
  'error',
]);

/**
 * The zero-config paper execution venue: a keyless broker usable the moment the
 * engine is up, so it counts as a live venue without ever reporting `connected`
 * — this is the "paper counts" clause of DF4.
 */
const PAPER_SIMULATOR_ID = 'simulator';

/**
 * A connector that gives LIVE market data: a real, engine-confirmed connection
 * to a broker or a data vendor. Keyless yfinance in its default `not_configured`
 * state is NOT counted — the connect entry's whole job is to get a real data
 * source wired, so a bare keyless box still reads as "set me up", not "done".
 */
function isLiveDataSource(connector: Connector): boolean {
  return DATA_SOURCE_KINDS.has(connector.kind) && isConnected(connector.status);
}

/**
 * A venue the operator can execute against right now: a connected broker, or the
 * always-available paper simulator (unless it has actually errored). Paper
 * counts even though it is never `connected`, per DF4.
 */
function isLiveVenue(connector: Connector): boolean {
  if (connector.id === PAPER_SIMULATOR_ID) return connector.status?.state !== 'error';
  return VENUE_KINDS.has(connector.kind) && isConnected(connector.status);
}

/**
 * Whether the operator has a viable, HEALTHY trading setup — the DF4 predicate
 * behind hiding the single connect entry (FR-H2). True (⇒ hide the entry) only
 * when there is at least one live data source AND at least one live execution
 * venue (the paper simulator counts) AND nothing the operator has enabled is
 * mid-handshake, degraded, or errored.
 *
 * PURE: derived entirely from the connector list the registry already polls, so
 * it re-shows the entry the instant an enabled connector degrades and never
 * fabricates a reason to hide. Unconfigured optional connectors do NOT keep it
 * open — only what the operator turned on and is unhealthy does. A fresh box
 * (everything `not_configured`, keyless sources included) is missing a real data
 * source, so it reads as incomplete and the entry stays.
 */
export function isSetupComplete(connectors: Connector[]): boolean {
  const hasData = connectors.some(isLiveDataSource);
  const hasVenue = connectors.some(isLiveVenue);
  const anyEnabledUnhealthy = connectors.some((connector) =>
    ENABLED_UNHEALTHY_STATES.has(connector.status?.state ?? '')
  );
  return hasData && hasVenue && !anyEnabledUnhealthy;
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
  };
}
