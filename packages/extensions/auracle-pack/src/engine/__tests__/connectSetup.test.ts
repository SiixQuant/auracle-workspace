/**
 * The DF4 "connected ⇒ hide" predicate (WS-H / FR-H2, AC-7).
 *
 * The single connect entry disappears only once the operator has established a
 * REAL connection — a non-simulator broker, or a KEYED data vendor — AND nothing
 * they enabled is degraded/error/connecting. The zero-config free defaults never
 * count as "set up": houston reports keyless yfinance `connected` (it needs no
 * key) and forces the paper simulator `connected` too, so a bare box is live for
 * backtest+paper out of the box — the entry's whole job is to get something REAL
 * wired over the top of those, so a fresh box always SHOWS it.
 */
import { describe, expect, it } from 'vitest';
import {
  isSetupComplete,
  isZeroConfigDefault,
  normalizeConnector,
  type Connector,
  type FieldMeta,
} from '../model';

/** A minimal key field, so a data provider reads as KEYED (fields non-empty)
 *  rather than the keyless zero-config default that yfinance is. */
function keyField(name = 'api_key'): FieldMeta {
  return { name, label: name, kind: 'password', required: true, has_value: false, preview: '', options: [] };
}

function conn(id: string, kind: string, state: string, over: Partial<Connector> = {}): Connector {
  return normalizeConnector({ id, kind, status: { state, detail: null }, ...over });
}

// Realistic registry states. yfinance is a keyless data provider (no fields) that
// houston reports `connected` out of the box; the paper simulator is a
// credential-free broker also `connected`. Keyed vendors carry a key field;
// brokers (never a zero-config default unless id==='simulator') carry creds.
const YFINANCE = (state = 'connected') => conn('yfinance', 'data_provider', state); // fields default []
const SIMULATOR = (state = 'connected') => conn('simulator', 'broker', state);
const IBKR = (state = 'not_configured') =>
  conn('ibkr', 'broker', state, { fields: [keyField('username')], test_supported: true });
const ALPACA = (state = 'not_configured') =>
  conn('alpaca', 'broker', state, { fields: [keyField('key_id')], test_supported: true });
const POLYGON = (state = 'not_configured') =>
  conn('polygon', 'data_provider', state, { fields: [keyField()], test_supported: true });
const EODHD = (state = 'not_configured') =>
  conn('eodhd', 'data_provider', state, { fields: [keyField()], test_supported: true });

describe('isZeroConfigDefault — the free, out-of-the-box sources', () => {
  it('treats the paper simulator as a zero-config default', () => {
    expect(isZeroConfigDefault(SIMULATOR('connected'))).toBe(true);
  });
  it('treats keyless yfinance (data_provider, no fields) as a zero-config default', () => {
    expect(isZeroConfigDefault(YFINANCE('connected'))).toBe(true);
  });
  it('does NOT treat a keyed data vendor as a default', () => {
    expect(isZeroConfigDefault(POLYGON('connected'))).toBe(false);
  });
  it('does NOT treat a real broker as a default', () => {
    expect(isZeroConfigDefault(IBKR('connected'))).toBe(false);
  });
});

describe('isSetupComplete — the DF4 hide predicate', () => {
  it('SHOWS on a fresh box (only the free yfinance + simulator defaults are live)', () => {
    const connectors = [YFINANCE(), SIMULATOR(), IBKR(), ALPACA(), POLYGON(), EODHD()];
    expect(isSetupComplete(connectors)).toBe(false);
  });

  it('HIDES once a real broker is connected and healthy', () => {
    const connectors = [YFINANCE(), SIMULATOR(), IBKR('connected'), POLYGON(), EODHD()];
    expect(isSetupComplete(connectors)).toBe(true);
  });

  it('HIDES once a keyed data vendor is connected and healthy', () => {
    const connectors = [YFINANCE(), SIMULATOR(), POLYGON('connected')];
    expect(isSetupComplete(connectors)).toBe(true);
  });

  it('keyless yfinance connected does NOT count as a real connection', () => {
    // Both free defaults live, nothing real wired — still incomplete.
    const connectors = [YFINANCE('connected'), SIMULATOR('connected'), IBKR(), POLYGON()];
    expect(isSetupComplete(connectors)).toBe(false);
  });

  it('re-shows when an enabled connector degrades, even with a real connection', () => {
    const connectors = [SIMULATOR(), IBKR('connected'), ALPACA('degraded')];
    expect(isSetupComplete(connectors)).toBe(false);
  });

  it('re-shows on any enabled-unhealthy state (error, connecting, degraded)', () => {
    for (const bad of ['error', 'connecting', 'degraded']) {
      const connectors = [SIMULATOR(), IBKR('connected'), POLYGON(bad)];
      expect(isSetupComplete(connectors)).toBe(false);
    }
  });

  it('does not treat an unconfigured optional as unhealthy', () => {
    const connectors = [SIMULATOR(), IBKR('connected'), ALPACA(), POLYGON(), EODHD()];
    expect(isSetupComplete(connectors)).toBe(true);
  });

  it('SHOWS on a defaults-only / all-unconfigured registry', () => {
    const connectors = [YFINANCE(), SIMULATOR(), IBKR(), ALPACA(), POLYGON(), EODHD()];
    expect(isSetupComplete(connectors)).toBe(false);
  });

  it('SHOWS on an empty registry', () => {
    expect(isSetupComplete([])).toBe(false);
  });
});
