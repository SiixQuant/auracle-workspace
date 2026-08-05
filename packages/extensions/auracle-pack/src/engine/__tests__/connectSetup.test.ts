/**
 * The DF4 "fully connected ⇒ hide" predicate (WS-H / FR-H2, AC-7).
 *
 * The connect entry disappears only on a viable, HEALTHY setup: at least one
 * live data source AND one live execution venue (the paper simulator counts)
 * AND nothing the operator enabled is degraded/error/connecting. These cases
 * pin every branch of that rule, from a fresh keyless box (shows) to a broker
 * that later wobbles (re-shows).
 */
import { describe, expect, it } from 'vitest';
import { isSetupComplete, normalizeConnector, type Connector } from '../model';

/** A connector shaped like the registry list payload. */
function conn(
  id: string,
  kind: string,
  state: string,
  over: Partial<Connector> = {}
): Connector {
  return normalizeConnector({ id, kind, status: { state, detail: null }, ...over });
}

// The six connectors a real registry lists, in their fresh (untouched) state.
const YFINANCE = (state = 'not_configured') => conn('yfinance', 'data_provider', state);
const SIMULATOR = (state = 'not_configured') => conn('simulator', 'broker', state);
const IBKR = (state = 'not_configured') => conn('ibkr', 'broker', state, { test_supported: true });
const ALPACA = (state = 'not_configured') => conn('alpaca', 'broker', state, { test_supported: true });
const POLYGON = (state = 'not_configured') => conn('polygon', 'data_provider', state, { test_supported: true });
const EODHD = (state = 'not_configured') => conn('eodhd', 'data_provider', state, { test_supported: true });

describe('isSetupComplete — the DF4 hide predicate', () => {
  it('hides on a viable, healthy setup (a connected broker gives data AND venue)', () => {
    // IBKR connected = a live data source and a live venue; the paper simulator
    // is a venue too. The unconfigured optionals (yfinance, polygon, eodhd) must
    // NOT keep it open.
    const connectors = [YFINANCE(), SIMULATOR(), IBKR('connected'), POLYGON(), EODHD()];
    expect(isSetupComplete(connectors)).toBe(true);
  });

  it('hides on a data vendor + paper (no live broker needed — paper counts)', () => {
    const connectors = [YFINANCE(), SIMULATOR(), POLYGON('connected')];
    expect(isSetupComplete(connectors)).toBe(true);
  });

  it('shows when missing a data source (only the paper venue is live)', () => {
    // A box with the paper simulator (a live venue) but no connected data source
    // — keyless yfinance in its default state does not count.
    const connectors = [YFINANCE(), SIMULATOR(), POLYGON(), EODHD()];
    expect(isSetupComplete(connectors)).toBe(false);
  });

  it('shows when missing a venue (a live data source but nothing can execute)', () => {
    // A connected data vendor, but no broker and no paper simulator to route to.
    const connectors = [POLYGON('connected'), EODHD()];
    expect(isSetupComplete(connectors)).toBe(false);
  });

  it('re-shows when an enabled connector degrades', () => {
    // IBKR connected would otherwise hide it — but Alpaca, which the operator
    // enabled, is degraded, so the entry comes back.
    const connectors = [SIMULATOR(), IBKR('connected'), ALPACA('degraded')];
    expect(isSetupComplete(connectors)).toBe(false);
  });

  it('re-shows on any enabled-unhealthy state (error, connecting), not just degraded', () => {
    for (const bad of ['error', 'connecting', 'degraded']) {
      const connectors = [SIMULATOR(), IBKR('connected'), POLYGON(bad)];
      expect(isSetupComplete(connectors)).toBe(false);
    }
  });

  it('shows on an all-unconfigured fresh box', () => {
    const connectors = [YFINANCE(), SIMULATOR(), IBKR(), ALPACA(), POLYGON(), EODHD()];
    expect(isSetupComplete(connectors)).toBe(false);
  });

  it('does not treat an unconfigured optional as unhealthy (it stays hidden)', () => {
    // Same viable IBKR setup, plus a pile of untouched optionals — none of which
    // is `connecting`/`degraded`/`error`, so none keeps the entry open.
    const connectors = [SIMULATOR(), IBKR('connected'), ALPACA(), POLYGON(), EODHD()];
    expect(isSetupComplete(connectors)).toBe(true);
  });

  it('shows on an empty registry', () => {
    expect(isSetupComplete([])).toBe(false);
  });

  it('shows when the only live venue (paper) has errored, even with a data source', () => {
    const connectors = [POLYGON('connected'), SIMULATOR('error')];
    expect(isSetupComplete(connectors)).toBe(false);
  });
});
