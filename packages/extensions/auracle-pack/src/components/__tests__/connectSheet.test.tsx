/**
 * The single connect entry + sheet (WS-H, FR-H1/FR-H2, AC-7).
 *
 * Three promises are pinned here. GROUPING: the sheet lays connectors out
 * cheapest-first (free/keyless, your broker, data vendors) with humanized names,
 * never a raw id. WRITE-THROUGH: a key-paste connector saves directly against
 * the connections API — `POST /{id}/test` then `POST /{id}/save` with exactly
 * what was typed — the same seam the settings page uses. HIDE: once the DF4
 * predicate holds, the entry renders nothing at all.
 *
 * The only seam cut is the engine client (getJson for the on-demand field fetch,
 * postJson for the write); every other module under test is the shipped one.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/client')>();
  return { ...actual, getJson: vi.fn(), postJson: vi.fn(), bumpConnectGeneration: vi.fn() };
});

import { bumpConnectGeneration, getJson, postJson } from '../../engine/client';
import { normalizeConnector, type Connector } from '../../engine/model';
import { GridConnect } from '../grid/GridConnect';

function conn(
  id: string,
  kind: string,
  state: string,
  over: Partial<Connector> = {}
): Connector {
  return normalizeConnector({ id, kind, status: { state, detail: null }, ...over });
}

/** A fresh box: the keyless yfinance + paper defaults are live out of the box
 *  (houston reports them `connected`), everything real still unconfigured. */
const FRESH: Connector[] = [
  conn('yfinance', 'data_provider', 'connected', { display_label: 'yfinance' }),
  conn('simulator', 'broker', 'connected', { display_label: 'Paper Simulator' }),
  conn('ibkr', 'broker', 'not_configured', { test_supported: true }),
  conn('alpaca', 'broker', 'not_configured', { test_supported: true, display_label: 'Alpaca' }),
  conn('polygon', 'data_provider', 'not_configured', { test_supported: true, display_label: 'Polygon' }),
  conn('eodhd', 'data_provider', 'not_configured', { test_supported: true, display_label: 'EODHD' }),
];

/** A viable, healthy box: a connected real broker (data + venue) over the free
 *  defaults, nothing enabled unhealthy. */
const COMPLETE: Connector[] = [
  conn('yfinance', 'data_provider', 'connected'),
  conn('simulator', 'broker', 'connected'),
  conn('ibkr', 'broker', 'connected', { test_supported: true }),
];

/** A partly-wired box: a real broker is live, but a keyed vendor the operator
 *  enabled is degraded — so the entry stays, showing only the REAL live count. */
const PARTIAL: Connector[] = [
  conn('yfinance', 'data_provider', 'connected'),
  conn('simulator', 'broker', 'connected'),
  conn('ibkr', 'broker', 'connected', { test_supported: true }),
  conn('polygon', 'data_provider', 'degraded', { test_supported: true }),
];

/** Brokers that ALSO stream market data carry `provides_data: true` (IBKR,
 *  Alpaca) — the deduped registry lists each once, doing both jobs. Polygon is a
 *  plain data vendor and must NOT gain the capability hint. */
const DATA_BROKERS: Connector[] = [
  conn('yfinance', 'data_provider', 'connected', { display_label: 'yfinance' }),
  conn('simulator', 'broker', 'connected', { display_label: 'Paper Simulator' }),
  conn('ibkr', 'broker', 'not_configured', { test_supported: true, provides_data: true }),
  conn('alpaca', 'broker', 'not_configured', {
    test_supported: true,
    display_label: 'Alpaca',
    provides_data: true,
  }),
  conn('polygon', 'data_provider', 'not_configured', { test_supported: true, display_label: 'Polygon' }),
];

/** A STALE engine that has not deduped: the same id answers more than once — a
 *  second `simulator`, and `ibkr` listed as both a broker and a data provider. */
const DUPLICATED: Connector[] = [
  ...FRESH,
  conn('ibkr', 'data_provider', 'connected', { display_label: 'IBKR (data)' }),
  conn('simulator', 'broker', 'connected', { display_label: 'Paper Simulator' }),
];

/** The engine's detail payload for polygon — fields the list omits. */
const POLYGON_DETAIL = {
  connection: {
    id: 'polygon',
    kind: 'data_provider',
    display_label: 'Polygon',
    test_supported: true,
    fields: [
      { name: 'api_key', label: 'API Key', kind: 'secret', required: true, has_value: false, preview: '', options: [] },
    ],
  },
};

beforeEach(() => {
  vi.mocked(getJson).mockImplementation(async (path: string) =>
    path === '/ui/api/connections/polygon' ? (POLYGON_DETAIL as never) : null
  );
  vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, body: { ok: true } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the connect entry', () => {
  it('shows on a fresh box (only free defaults live) and opens the sheet', () => {
    render(<GridConnect connectors={FRESH} />);
    const entry = screen.getByTestId('connect-entry');
    expect(entry).toBeTruthy();
    // The keyless yfinance + paper defaults don't count as a real connection, so
    // a fresh box invites wiring one rather than claiming an inflated live count.
    expect(screen.getByTestId('connect-entry-status').textContent).toContain(
      'Connect your market data'
    );

    expect(screen.queryByTestId('connect-sheet')).toBeNull();
    fireEvent.click(screen.getByTestId('connect-open'));
    expect(screen.getByTestId('connect-sheet')).toBeTruthy();
  });

  it('counts only REAL live connections, not the keyless defaults', () => {
    // ibkr is a live real connection; polygon (enabled) is degraded so the entry
    // stays; the free yfinance + simulator defaults are excluded from the count.
    render(<GridConnect connectors={PARTIAL} />);
    const status = screen.getByTestId('connect-entry-status').textContent ?? '';
    expect(status).toContain('1');
    expect(status).toContain('connection');
  });

  it('renders nothing at all once the box is set up (DF4)', () => {
    const { container } = render(<GridConnect connectors={COMPLETE} />);
    expect(screen.queryByTestId('connect-entry')).toBeNull();
    expect(screen.queryByTestId('connect-open')).toBeNull();
    // No DOM at all — a set-up box is as quiet as an unknown one.
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing while the registry is still unknown (null)', () => {
    const { container } = render(<GridConnect connectors={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('the sheet groups connectors cheapest-first with humanized names', () => {
  beforeEach(() => {
    render(<GridConnect connectors={FRESH} />);
    fireEvent.click(screen.getByTestId('connect-open'));
  });

  it('renders the free, broker and data-vendor groups', () => {
    expect(screen.getByTestId('connect-group-free')).toBeTruthy();
    expect(screen.getByTestId('connect-group-brokers')).toBeTruthy();
    expect(screen.getByTestId('connect-group-data')).toBeTruthy();
  });

  it('humanizes ids — never shows a raw slug', () => {
    // 'ibkr' → Interactive Brokers, 'simulator' → Paper Simulator (via brokerLabel).
    expect(screen.getByTestId('connect-name-ibkr').textContent).toBe('Interactive Brokers');
    expect(screen.getByTestId('connect-name-simulator').textContent).toBe('Paper Simulator');
    expect(screen.getByTestId('connect-name-alpaca').textContent).toBe('Alpaca');
    expect(screen.getByTestId('connect-name-polygon').textContent).toBe('Polygon');
  });

  it('places each connector in its cheapest-first group', () => {
    const free = screen.getByTestId('connect-group-free');
    expect(free.querySelector('[data-testid="connect-row-yfinance"]')).toBeTruthy();
    expect(free.querySelector('[data-testid="connect-row-simulator"]')).toBeTruthy();

    const brokers = screen.getByTestId('connect-group-brokers');
    expect(brokers.querySelector('[data-testid="connect-row-ibkr"]')).toBeTruthy();
    expect(brokers.querySelector('[data-testid="connect-row-alpaca"]')).toBeTruthy();

    const data = screen.getByTestId('connect-group-data');
    expect(data.querySelector('[data-testid="connect-row-polygon"]')).toBeTruthy();
    expect(data.querySelector('[data-testid="connect-row-eodhd"]')).toBeTruthy();
  });

  it('carries the honest aggregator footnote (trading only, no market data)', () => {
    expect(screen.getByTestId('connect-row-aggregator')).toBeTruthy();
    expect(screen.getByTestId('connect-footnote').textContent).toContain('no price data');
  });
});

describe('a key-paste connector writes through the connections API', () => {
  it('runs POST /test then POST /save with exactly what was typed, and re-polls', async () => {
    render(<GridConnect connectors={FRESH} />);
    fireEvent.click(screen.getByTestId('connect-open'));

    // Expand Polygon's inline key form — fields are fetched on demand.
    fireEvent.click(screen.getByTestId('connect-key-polygon'));
    await waitFor(() => expect(vi.mocked(getJson)).toHaveBeenCalledWith('/ui/api/connections/polygon'));
    const input = (await screen.findByTestId('connect-field-api-key')) as HTMLInputElement;
    expect(input.type).toBe('password'); // a secret field, not text

    fireEvent.change(input, { target: { value: 'pk_test_123' } });
    fireEvent.click(screen.getByTestId('connect-save-polygon'));

    await waitFor(() =>
      expect(vi.mocked(postJson)).toHaveBeenCalledWith('/ui/api/connections/polygon/save', {
        api_key: 'pk_test_123',
      })
    );
    // Test ran first, save second — both with the entered value, to the connector's own routes.
    expect(vi.mocked(postJson)).toHaveBeenCalledWith('/ui/api/connections/polygon/test', {
      api_key: 'pk_test_123',
    });
    const paths = vi.mocked(postJson).mock.calls.map((c) => c[0]);
    expect(paths.indexOf('/ui/api/connections/polygon/test')).toBeLessThan(
      paths.indexOf('/ui/api/connections/polygon/save')
    );
    // A save re-polls every pack surface so the row + hide predicate catch up.
    expect(vi.mocked(bumpConnectGeneration)).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('connect-key-note-polygon').textContent).toContain('Saved')
    );
  });

  it('does not save a key that failed its test', async () => {
    vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, body: { ok: false, message: 'key rejected' } });
    render(<GridConnect connectors={FRESH} />);
    fireEvent.click(screen.getByTestId('connect-open'));
    fireEvent.click(screen.getByTestId('connect-key-polygon'));
    const input = await screen.findByTestId('connect-field-api-key');
    fireEvent.change(input, { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByTestId('connect-save-polygon'));

    await waitFor(() =>
      expect(screen.getByTestId('connect-key-note-polygon').textContent).toContain('key rejected')
    );
    const paths = vi.mocked(postJson).mock.calls.map((c) => c[0]);
    expect(paths).toContain('/ui/api/connections/polygon/test');
    expect(paths).not.toContain('/ui/api/connections/polygon/save');
    expect(vi.mocked(bumpConnectGeneration)).not.toHaveBeenCalled();
  });
});

describe('the sheet is defensive about a stale, un-deduped registry', () => {
  it('collapses duplicate connector ids to a single row (first occurrence wins)', () => {
    render(<GridConnect connectors={DUPLICATED} />);
    fireEvent.click(screen.getByTestId('connect-open'));
    // ibkr and simulator each arrived twice; each renders exactly once — getAllBy
    // returns every match, so a length of 1 proves the duplicate never rendered.
    expect(screen.getAllByTestId('connect-connector-ibkr')).toHaveLength(1);
    expect(screen.getAllByTestId('connect-row-ibkr')).toHaveLength(1);
    expect(screen.getAllByTestId('connect-row-simulator')).toHaveLength(1);
    // First occurrence kept: ibkr keeps its BROKER identity (FRESH lists it as a
    // broker first), so it stays in the broker group and never doubles into data.
    const brokers = screen.getByTestId('connect-group-brokers');
    expect(brokers.querySelector('[data-testid="connect-row-ibkr"]')).toBeTruthy();
    const data = screen.getByTestId('connect-group-data');
    expect(data.querySelector('[data-testid="connect-row-ibkr"]')).toBeNull();
  });
});

describe('a broker that also provides market data', () => {
  it('surfaces a subtle "trades + data" hint instead of a second data-vendor row', () => {
    render(<GridConnect connectors={DATA_BROKERS} />);
    fireEvent.click(screen.getByTestId('connect-open'));
    // IBKR and Alpaca both trade AND stream, so each broker row carries the hint.
    expect(screen.getByTestId('connect-cap-ibkr').textContent).toContain('trades + data');
    expect(screen.getByTestId('connect-cap-alpaca').textContent).toContain('trades + data');
    // The hint is a separate mark, not part of the name — the shared humanized
    // name contract still reads exactly, with nothing appended to it.
    expect(screen.getByTestId('connect-name-ibkr').textContent).toBe('Interactive Brokers');
    // A plain data vendor (no trading) earns no capability hint.
    expect(screen.queryByTestId('connect-cap-polygon')).toBeNull();
    // And IBKR is not ALSO listed as its own row in the data-vendor group.
    const data = screen.getByTestId('connect-group-data');
    expect(data.querySelector('[data-testid="connect-row-ibkr"]')).toBeNull();
  });
});
