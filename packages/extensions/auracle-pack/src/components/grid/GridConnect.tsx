/**
 * The single connect entry + in-panel connect sheet (WS-H, FR-H1/FR-H2, DF4).
 *
 * ## Why the sheet writes creds itself
 * There is no host API to deep-link another extension's settings panel
 * (ConnsPage), so the entry cannot "open Settings → Connections" for the
 * operator. Instead the sheet does the connect INLINE, against the same
 * connections API the settings page uses: it lists from the registry the Grid
 * already polls (`engineFeeds.connections`), fetches a connector's fields on
 * demand (`GET /ui/api/connections/{id}`), and writes a key through
 * `POST /{id}/test` then `POST /{id}/save` — the exact save/test pattern
 * {@link AuracleConnections} runs. On a save it bumps the connect generation so
 * every pack surface re-polls at once.
 *
 * ## Why it disappears
 * The whole entry (and its sheet) is gated on {@link isSetupComplete}: once the
 * operator has a live data source, a live venue (paper counts) and nothing they
 * enabled is unhealthy, the nudge is done and renders NOTHING — no DOM at all,
 * so a set-up box is as quiet as a fresh one is inviting. It re-shows the moment
 * an enabled connector degrades, because the predicate is pure over the same
 * poll.
 *
 * ## Cheapest-first, and honest about data
 * The sheet groups connectors the way the mockup does: Free/keyless first, then
 * your broker (data + trading), then data vendors you paste a key for, then any
 * remaining integrations, with a dashed, optional aggregator footnote that
 * carries NO market data. Labels are humanized (`brokerLabel` et al.) — never a
 * raw id. Status words come from the one shared {@link connectorTag}, so a
 * connector reads the same here as on the settings page.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  connectorTag,
  isConnected,
  isSetupComplete,
  isZeroConfigDefault,
  normalizeConnector,
  KEYLESS_IDS,
  type Connector,
  type FieldMeta,
} from '../../engine/model';
import { brokerLabel, prettifySlug } from '../../engine/humanize';
import { bumpConnectGeneration, getJson, postJson } from '../../engine/client';
import { ensurePanelKitStyles, InlineNote, tint, tone } from '../panelkit';
import { GRID_ACCENT } from './gridTheme';

const STYLE_ID = 'auracle-connect-styles';

/** Brokers whose connection runs through an external local gateway rather than a
 *  pasteable key — the sheet shows an instruction for these, not a form. */
const GATEWAY_IDS: ReadonlySet<string> = new Set(['ibkr', 'ibkr_cp']);

/** kebab-case DOM marker from an id/field name ("api_key" → "api-key"). */
function slug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** A connector's display name, humanized — never a raw id. Known brokers take
 *  their curated label; everything else keeps the engine's own display label,
 *  falling back to a prettified slug so a new connector still reads as words. */
function connectorName(connector: Connector): string {
  const mapped = brokerLabel(connector.id);
  if (mapped !== 'none') return mapped;
  const shown = connector.display_label?.trim();
  if (shown) return shown;
  return prettifySlug(connector.id) ?? connector.id;
}

/** One row's one-line blurb: the engine's when it gave one, else a short, honest
 *  per-shape default so the row never renders blank. */
function connectorBlurb(connector: Connector, kind: RowAction): string {
  const engine = connector.blurb?.trim();
  if (engine) return engine;
  switch (kind) {
    case 'keyless':
      return 'Ready to use — no account needed';
    case 'gateway':
      return 'Real-time data + execution through your local gateway';
    default:
      return 'Market data — paste your API key';
  }
}

type RowAction = 'keyless' | 'gateway' | 'key';

function rowAction(connector: Connector): RowAction {
  if (KEYLESS_IDS.has(connector.id)) return 'keyless';
  if (GATEWAY_IDS.has(connector.id)) return 'gateway';
  return 'key';
}

/** The status word's colour, from the one shared tag rule. */
function tagColor(kind: ReturnType<typeof connectorTag>['kind']): string {
  if (kind === 'ok') return tone.ok;
  if (kind === 'danger') return tone.danger;
  if (kind === 'caution') return tone.caution;
  return tone.text3;
}

function ensureConnectStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
.auracle-connect__entry { display: flex; align-items: center; gap: 11px; padding: 10px 12px; border-radius: 10px; border: 1px solid ${tint(GRID_ACCENT, 24)}; background: ${tint(GRID_ACCENT, 6)}; }
.auracle-connect__entry-icon { width: 26px; height: 26px; border-radius: 7px; flex: none; display: grid; place-items: center; color: ${GRID_ACCENT}; background: ${tint(GRID_ACCENT, 15)}; }
.auracle-connect__entry-text { flex: 1; min-width: 0; font-size: 12.5px; color: ${tone.text2}; }
.auracle-connect__entry-text b { color: ${tone.text}; font-weight: 600; }
.auracle-connect__cta { appearance: none; border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; padding: 6px 13px; border-radius: 7px; background: ${GRID_ACCENT}; color: #17110c; display: inline-flex; align-items: center; gap: 6px; flex: none; }
.auracle-connect__cta:hover { background: ${tint(GRID_ACCENT, 88)}; }
.auracle-connect__cta:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 2px; }

.auracle-connect__scrim { position: fixed; inset: 0; z-index: 40; display: flex; align-items: flex-end; justify-content: center; background: color-mix(in srgb, ${tone.bg} 74%, transparent); backdrop-filter: blur(3px); }
.auracle-connect__sheet { width: 100%; max-width: 560px; max-height: 88%; overflow-y: auto; background: ${tone.surface}; border: 1px solid ${tone.borderStrong}; border-bottom: 0; border-radius: 12px 12px 0 0; padding: 18px 18px 22px; box-shadow: 0 -30px 80px -30px rgba(0,0,0,0.7); }
.auracle-connect__x { float: right; appearance: none; background: transparent; border: 0; color: ${tone.text3}; font-size: 20px; line-height: 1; cursor: pointer; padding: 0 2px; }
.auracle-connect__x:hover { color: ${tone.text}; }
.auracle-connect__title { margin: 0 0 3px; font-size: 15px; font-weight: 600; color: ${tone.text}; }
.auracle-connect__sub { color: ${tone.text3}; font-size: 12px; margin-bottom: 4px; }
.auracle-connect__grp { font-size: 9.5px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase; color: ${tone.text3}; margin: 16px 2px 8px; }
.auracle-connect__row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 9px; background: ${tone.sunken}; border: 1px solid ${tone.border}; margin-bottom: 7px; }
.auracle-connect__row--dashed { background: transparent; border-style: dashed; }
.auracle-connect__ic { width: 30px; height: 30px; border-radius: 8px; flex: none; display: grid; place-items: center; background: ${tone.surface2}; color: ${tone.text2}; font-size: 12px; font-weight: 700; }
.auracle-connect__meta { min-width: 0; flex: 1; }
.auracle-connect__nm { font-weight: 600; font-size: 12.5px; color: ${tone.text}; }
.auracle-connect__ds { color: ${tone.text3}; font-size: 11px; margin-top: 1px; }
.auracle-connect__cap { display: inline-block; margin-left: 7px; padding: 0 6px; border-radius: 999px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; white-space: nowrap; vertical-align: 1px; color: ${GRID_ACCENT}; background: ${tint(GRID_ACCENT, 12)}; border: 1px solid ${tint(GRID_ACCENT, 26)}; }
.auracle-connect__act { margin-left: auto; flex: none; display: flex; align-items: center; gap: 10px; }
.auracle-connect__status { font-size: 11.5px; font-weight: 600; white-space: nowrap; }
.auracle-connect__hint { font-size: 11px; color: ${tone.text3}; white-space: nowrap; }
.auracle-connect__keybtn { appearance: none; border: 0; background: transparent; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600; color: ${GRID_ACCENT}; padding: 2px; }
.auracle-connect__keybtn:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 2px; border-radius: 4px; }
.auracle-connect__form { display: flex; flex-direction: column; gap: 10px; margin: -3px 2px 9px; padding: 12px; border-radius: 9px; border: 1px solid ${tone.border}; background: ${tone.surface}; }
.auracle-connect__field { display: flex; flex-direction: column; gap: 5px; }
.auracle-connect__flabel { font-size: 11.5px; color: ${tone.text2}; }
.auracle-connect__saved { color: ${tone.text3}; font-weight: 400; }
.auracle-connect__input { width: 100%; padding: 7px 9px; border-radius: 6px; font-size: 13px; border: 1px solid ${tone.borderStrong}; background: ${tone.sunken}; color: ${tone.text}; outline: none; }
.auracle-connect__input:focus { border-color: ${tone.accentDim}; }
.auracle-connect__formactions { display: flex; align-items: center; gap: 10px; }
.auracle-connect__save { appearance: none; border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; padding: 6px 13px; border-radius: 7px; background: ${GRID_ACCENT}; color: #17110c; }
.auracle-connect__save:disabled { cursor: default; opacity: 0.55; }
.auracle-connect__foott { color: ${tone.text3}; font-size: 11px; margin-top: 14px; line-height: 1.55; }
`;
  document.head.appendChild(el);
}

interface KeyResult {
  ok: boolean;
  message: string;
}

/**
 * Inline credential form for a key-paste connector. Mirrors the settings page's
 * ConnectorDetail: fetches the connector's fields on mount (the list payload
 * carries none), renders an input per field, and on Connect runs `POST /test`
 * then `POST /save` against the connections API — never saving a key that failed
 * its test. A save bumps the connect generation so the registry re-polls.
 */
function ConnectorKeyForm({ connector }: { connector: Connector }): JSX.Element {
  const [fields, setFields] = useState<FieldMeta[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KeyResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const body = await getJson<Record<string, unknown>>(`/ui/api/connections/${connector.id}`);
      if (cancelled) return;
      const raw = (body?.connection ?? body) as (Partial<Connector> & { id?: string }) | null;
      const filled = raw ? normalizeConnector({ ...raw, id: raw.id ?? connector.id }) : connector;
      setFields(filled.fields);
    })();
    return () => {
      cancelled = true;
    };
  }, [connector]);

  const entered = useMemo(() => {
    const body: Record<string, string> = {};
    for (const [name, value] of Object.entries(values)) {
      if (value.trim().length > 0) body[name] = value;
    }
    return body;
  }, [values]);

  const connect = async () => {
    setBusy(true);
    setResult(null);
    // Test first, save only on a pass — the same order the settings page runs,
    // and the honest one: never persist a key the engine just rejected.
    if (connector.test_supported) {
      const testRes = await postJson(`/ui/api/connections/${connector.id}/test`, entered);
      const testBody = (testRes.body ?? {}) as { ok?: boolean; message?: string };
      if (!(testRes.ok && testBody.ok === true)) {
        setResult({
          ok: false,
          message:
            testBody.message ?? `Test failed (${testRes.status || 'engine unreachable'}).`,
        });
        setBusy(false);
        return;
      }
    }
    const saveRes = await postJson(`/ui/api/connections/${connector.id}/save`, entered);
    setBusy(false);
    if (saveRes.ok) {
      setResult({ ok: true, message: 'Saved.' });
      // Every pack surface re-polls at once, so the row's status and the hide
      // predicate both catch up without waiting out the interval.
      bumpConnectGeneration();
    } else {
      setResult({
        ok: false,
        message: `Save failed (${saveRes.status || 'engine unreachable'}).`,
      });
    }
  };

  return (
    <div className="auracle-connect__form" data-testid={`connect-key-form-${slug(connector.id)}`}>
      {fields === null ? (
        <div className="auracle-connect__hint">Loading fields…</div>
      ) : fields.length === 0 ? (
        <div className="auracle-connect__hint">No editable fields for this connector.</div>
      ) : (
        fields.map((field) => (
          <label key={field.name} className="auracle-connect__field">
            <span className="auracle-connect__flabel">
              {field.label || field.name}
              {field.required ? ' *' : ''}
              {field.has_value && field.preview ? (
                <span className="auracle-connect__saved">{`  (saved: ${field.preview})`}</span>
              ) : null}
            </span>
            {field.options.length > 0 ? (
              <select
                className="auracle-connect__input"
                aria-label={field.label || field.name}
                data-testid={`connect-field-${slug(field.name)}`}
                value={values[field.name] ?? ''}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                }
              >
                <option value="">{field.has_value ? '(keep saved value)' : 'Select…'}</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="auracle-connect__input"
                data-testid={`connect-field-${slug(field.name)}`}
                type={field.kind === 'secret' || field.kind === 'password' ? 'password' : 'text'}
                placeholder={field.has_value ? '(keep saved value)' : ''}
                value={values[field.name] ?? ''}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                }
              />
            )}
          </label>
        ))
      )}
      <div className="auracle-connect__formactions">
        <button
          type="button"
          className="auracle-connect__save"
          data-testid={`connect-save-${slug(connector.id)}`}
          disabled={busy || fields === null}
          onClick={() => void connect()}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        {result ? (
          <InlineNote
            kind={result.ok ? 'ok' : 'err'}
            testId={`connect-key-note-${slug(connector.id)}`}
          >
            {result.message}
          </InlineNote>
        ) : null}
      </div>
    </div>
  );
}

/** One connector row: monogram, humanized name + blurb, shared status word, and
 *  the right affordance for its shape (nothing for keyless, an instruction for a
 *  gateway, an expandable key form for everything else). */
function ConnectorRow({ connector }: { connector: Connector }): JSX.Element {
  const action = rowAction(connector);
  const [open, setOpen] = useState(false);
  const tag = connectorTag(connector);
  const name = connectorName(connector);
  const connected = isConnected(connector.status);
  const monogram = (name.trim().charAt(0) || '?').toUpperCase();

  return (
    <div data-testid={`connect-connector-${slug(connector.id)}`}>
      <div className="auracle-connect__row" data-testid={`connect-row-${slug(connector.id)}`}>
        <span aria-hidden className="auracle-connect__ic">
          {monogram}
        </span>
        <span className="auracle-connect__meta">
          <span className="auracle-connect__nm" data-testid={`connect-name-${slug(connector.id)}`}>
            {name}
          </span>
          <span className="auracle-connect__ds">
            {connectorBlurb(connector, action)}
            {/* A broker that also streams quotes (IBKR/Alpaca) does both jobs, so
                it carries a subtle capability mark rather than earning a second,
                duplicate data-vendor row. Orange = a capability fact, never a
                status (health stays on the semantic ramp). */}
            {connector.kind === 'broker' && connector.provides_data ? (
              <span
                className="auracle-connect__cap"
                data-testid={`connect-cap-${slug(connector.id)}`}
              >
                trades + data
              </span>
            ) : null}
          </span>
        </span>
        <span className="auracle-connect__act">
          <span
            className="auracle-connect__status"
            data-testid={`connect-status-${slug(connector.id)}`}
            style={{ color: tagColor(tag.kind) }}
          >
            {tag.label}
          </span>
          {action === 'gateway' && !connected ? (
            <span className="auracle-connect__hint">Start your local gateway</span>
          ) : null}
          {action === 'key' ? (
            <button
              type="button"
              className="auracle-connect__keybtn"
              data-testid={`connect-key-${slug(connector.id)}`}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {connected ? 'Update key' : 'Add key'}
            </button>
          ) : null}
        </span>
      </div>
      {action === 'key' && open ? <ConnectorKeyForm connector={connector} /> : null}
    </div>
  );
}

interface Group {
  id: string;
  label: string;
  connectors: Connector[];
}

/** Defensive de-dup: keep the FIRST occurrence of each connector id. The engine
 *  now dedupes the registry so each connector answers once, but a stale engine
 *  could still emit a duplicate id (two `simulator`, or an `ibkr` listed once as
 *  a broker and again as a data provider before the dedupe landed) — collapsing
 *  by id here means such a payload can never render two rows for one connector. */
function uniqueById(connectors: Connector[]): Connector[] {
  const seen = new Set<string>();
  const out: Connector[] = [];
  for (const connector of connectors) {
    if (seen.has(connector.id)) continue;
    seen.add(connector.id);
    out.push(connector);
  }
  return out;
}

/** Cheapest-first grouping, matched to the mockup: free/keyless, then your
 *  broker (data + trading), then data vendors, then any remaining integrations
 *  so nothing is silently dropped. De-duped by id first, so one connector is one
 *  row even if the engine listed it twice. */
function groupConnectors(connectors: Connector[]): Group[] {
  const unique = uniqueById(connectors);
  const keyless = unique.filter((c) => KEYLESS_IDS.has(c.id));
  const brokers = unique.filter((c) => c.kind === 'broker' && !KEYLESS_IDS.has(c.id));
  const vendors = unique.filter((c) => c.kind === 'data_provider' && !KEYLESS_IDS.has(c.id));
  const integrations = unique.filter((c) => c.kind === 'integration' && !KEYLESS_IDS.has(c.id));
  return [
    { id: 'free', label: 'Free · no account', connectors: keyless },
    { id: 'brokers', label: 'Your broker · live data + trading', connectors: brokers },
    { id: 'data', label: 'More market data · paste a key', connectors: vendors },
    { id: 'integrations', label: 'Integrations', connectors: integrations },
  ].filter((group) => group.connectors.length > 0);
}

function ConnectSheet({
  connectors,
  onClose,
}: {
  connectors: Connector[];
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = groupConnectors(connectors);

  return (
    <div
      className="auracle-connect__scrim"
      data-testid="connect-scrim"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="auracle-connect__sheet"
        data-testid="connect-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Connect your data and brokers"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="auracle-connect__x"
          data-testid="connect-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
        <h3 className="auracle-connect__title">Connect your data &amp; brokers</h3>
        <div className="auracle-connect__sub">
          One place. Start free, add your broker for live data + trading. Cheapest routes first.
        </div>

        {groups.map((group) => (
          <div key={group.id} data-testid={`connect-group-${group.id}`}>
            <div className="auracle-connect__grp">{group.label}</div>
            {group.connectors.map((connector) => (
              <ConnectorRow key={connector.id} connector={connector} />
            ))}
          </div>
        ))}

        {/* Optional aggregator footnote — trading only, NO market data, and not
            the core (PRD non-goal). A dashed, quiet row, never a live route. */}
        <div className="auracle-connect__grp">More brokers · trading only</div>
        <div
          className="auracle-connect__row auracle-connect__row--dashed"
          data-testid="connect-row-aggregator"
        >
          <span aria-hidden className="auracle-connect__ic">
            +
          </span>
          <span className="auracle-connect__meta">
            <span className="auracle-connect__nm">Trade 30+ more brokers?</span>
            <span className="auracle-connect__ds">
              Robinhood, Schwab, Fidelity, Webull… trading only, no market data
            </span>
          </span>
          <span className="auracle-connect__act">
            <span className="auracle-connect__hint">Later</span>
          </span>
        </div>

        <div className="auracle-connect__foott" data-testid="connect-footnote">
          Market data comes from your broker and data vendors — not a personal-account aggregator.
          Interactive Brokers runs on your machine through the local gateway, so nothing sensitive
          leaves the box. The dashed row is an optional add-on for trading extra retail brokers; it
          carries no price data.
        </div>
      </div>
    </div>
  );
}

/** The count of REAL connections that read live right now — connected AND not a
 *  zero-config default. The free yfinance + paper-simulator defaults are always
 *  live but the operator never wired them, so counting them would inflate this
 *  misleadingly; "N live" here means N connections the operator established. */
function liveCount(connectors: Connector[]): number {
  return connectors.filter(
    (connector) => connectorTag(connector).kind === 'ok' && !isZeroConfigDefault(connector)
  ).length;
}

/**
 * The single connect entry. Reads the connector list the Grid already polls (no
 * new poller) and renders a quiet, orange-accented line with a Connect
 * affordance — UNLESS the box is fully set up ({@link isSetupComplete}), in
 * which case it renders nothing at all. The sheet mounts only while open.
 */
export function GridConnect({ connectors }: { connectors: Connector[] | null }): JSX.Element | null {
  ensurePanelKitStyles();
  ensureConnectStyles();
  const [open, setOpen] = useState(false);

  const complete = connectors !== null && connectors.length > 0 && isSetupComplete(connectors);
  const showEntry = connectors !== null && connectors.length > 0 && !complete;

  // Nothing known yet, or a fully set-up box, and the sheet is closed: render no
  // DOM at all. A set-up box is as quiet as an empty one.
  if (!showEntry && !open) return null;

  const live = connectors ? liveCount(connectors) : 0;

  return (
    <>
      {showEntry ? (
        <div className="auracle-connect__entry" data-testid="connect-entry">
          <span aria-hidden className="auracle-connect__entry-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M9 12h6M8 8a4 4 0 0 0 0 8h1M16 8a4 4 0 0 1 0 8h-1" />
            </svg>
          </span>
          <span className="auracle-connect__entry-text" data-testid="connect-entry-status">
            {live > 0 ? (
              <>
                <b>{live}</b> {live === 1 ? 'connection' : 'connections'} live · add your data &amp;
                broker
              </>
            ) : (
              'Connect your market data and broker'
            )}
          </span>
          <button
            type="button"
            className="auracle-connect__cta"
            data-testid="connect-open"
            onClick={() => setOpen(true)}
          >
            Connect
          </button>
        </div>
      ) : null}
      {open && connectors ? (
        <ConnectSheet connectors={connectors} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
