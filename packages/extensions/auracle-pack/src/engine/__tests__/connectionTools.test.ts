/**
 * The connections lane, in the agent's hands.
 *
 * The properties worth pinning are the honesty ones: a summary is value-free and
 * marks the free sources; `has_real_data_source` counts only a real, non-free
 * connection; and a connect NEVER carries a secret — a keyless source saves
 * empty, a keyed one only ARMS the paste field, and a secret-shaped option is
 * refused in the shared write-only words rather than sent.
 *
 * The one seam cut is the engine client (getJson for the reads, postJson for the
 * one keyless save, bumpConnectGeneration for the re-poll); everything else under
 * test is the shipped module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>();
  return { ...actual, getJson: vi.fn(), postJson: vi.fn(), bumpConnectGeneration: vi.fn() };
});

import { bumpConnectGeneration, getJson, postJson } from '../client';
import { normalizeConnector, type Connector } from '../model';
import {
  __resetConnectionToolsForTests,
  connectSource,
  connectionStatus,
  listSources,
  pendingConnectionStore,
} from '../connectionTools';

function conn(id: string, kind: string, state: string, over: Partial<Connector> = {}): Connector {
  return normalizeConnector({ id, kind, status: { state, detail: null }, ...over });
}

/** The engine's detail payload for a keyed vendor — wrapped in `connection`, as
 *  the route serves it (the list omits fields). */
const POLYGON_DETAIL = {
  connection: {
    id: 'polygon',
    kind: 'data_provider',
    display_label: 'Polygon',
    status: { state: 'not_configured', detail: null },
    test_supported: true,
    fields: [
      {
        name: 'api_key',
        label: 'API Key',
        kind: 'secret',
        required: true,
        has_value: false,
        preview: '',
        options: [],
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  __resetConnectionToolsForTests();
});

describe('list_sources', () => {
  it('maps the registry to a value-free summary, including is_free', async () => {
    vi.mocked(getJson).mockResolvedValue({
      connections: [
        conn('yfinance', 'data_provider', 'connected', { display_label: 'yfinance' }),
        conn('ibkr', 'broker', 'not_configured', {
          display_label: 'Interactive Brokers',
          provides_data: true,
        }),
        conn('polygon', 'data_provider', 'not_configured', { display_label: 'Polygon' }),
      ],
    } as never);

    const res = await listSources();

    expect(vi.mocked(getJson)).toHaveBeenCalledWith('/ui/api/connections?kind=all');
    expect(res.success).toBe(true);
    expect((res.data as { sources: unknown[] }).sources).toEqual([
      { id: 'yfinance', name: 'yfinance', kind: 'data_provider', connected: true, status: 'connected', provides_data: false, provides_market_data: true, access_tier: 'free', is_free: true },
      { id: 'ibkr', name: 'Interactive Brokers', kind: 'broker', connected: false, status: 'not_configured', provides_data: true, provides_market_data: true, access_tier: 'paid', is_free: false },
      { id: 'polygon', name: 'Polygon', kind: 'data_provider', connected: false, status: 'not_configured', provides_data: false, provides_market_data: true, access_tier: 'account', is_free: false },
    ]);
    // The condensed catalog groups the market-data sources by cost tier, and
    // names the brokers that actually pull data.
    const grouped = res.data as {
      catalog: { free: string[]; account: string[]; paid: string[] };
      market_data_brokers: string[];
    };
    expect(grouped.catalog).toEqual({ free: ['yfinance'], account: ['polygon'], paid: ['ibkr'] });
    expect(grouped.market_data_brokers).toEqual(['ibkr']);
    // Nothing in the answer is a credential value, preview, or has_value flag.
    const json = JSON.stringify(res.data);
    expect(json).not.toContain('api_key');
    expect(json).not.toContain('preview');
  });

  it('answers with an empty list rather than inventing rows when nothing answered', async () => {
    vi.mocked(getJson).mockResolvedValue(null as never);
    const res = await listSources();
    expect(res.success).toBe(true);
    expect((res.data as { sources: unknown[] }).sources).toEqual([]);
  });

  it('excludes execution-only brokers from the data catalog', async () => {
    // Only a broker the engine flags as also providing data (Alpaca) counts as a
    // market-data source; ClearStreet and Tradier connect for orders only.
    vi.mocked(getJson).mockResolvedValue({
      connections: [
        conn('alpaca', 'broker', 'not_configured', { display_label: 'Alpaca', provides_data: true }),
        conn('clearstreet', 'broker', 'not_configured', { display_label: 'ClearStreet' }),
        conn('tradier', 'broker', 'not_configured', { display_label: 'Tradier' }),
      ],
    } as never);

    const res = await listSources();
    const grouped = res.data as {
      catalog: { free: string[]; account: string[]; paid: string[] };
      market_data_brokers: string[];
      sources: Array<{ id: string; provides_market_data: boolean }>;
    };
    expect(grouped.market_data_brokers).toEqual(['alpaca']);
    expect(grouped.catalog.account).toContain('alpaca');
    const providesData = Object.fromEntries(
      grouped.sources.map((source) => [source.id, source.provides_market_data])
    );
    expect(providesData).toEqual({ alpaca: true, clearstreet: false, tradier: false });
  });
});

describe('connection_status without an id', () => {
  it('reports has_real_data_source false when only the free defaults are connected', async () => {
    vi.mocked(getJson).mockResolvedValue({
      connections: [
        conn('yfinance', 'data_provider', 'connected'),
        conn('simulator', 'broker', 'connected'),
        conn('polygon', 'data_provider', 'not_configured'),
      ],
    } as never);

    const res = await connectionStatus({});
    expect(res.success).toBe(true);
    expect((res.data as { has_real_data_source: boolean }).has_real_data_source).toBe(false);
  });

  it('reports has_real_data_source true when a keyed provider is connected', async () => {
    vi.mocked(getJson).mockResolvedValue({
      connections: [
        conn('yfinance', 'data_provider', 'connected'),
        conn('polygon', 'data_provider', 'connected'),
      ],
    } as never);

    const res = await connectionStatus({});
    expect((res.data as { has_real_data_source: boolean }).has_real_data_source).toBe(true);
  });

  it('reports has_real_data_source true when a real (non-simulator) broker is connected', async () => {
    vi.mocked(getJson).mockResolvedValue({
      connections: [
        conn('yfinance', 'data_provider', 'connected'),
        conn('simulator', 'broker', 'connected'),
        conn('ibkr', 'broker', 'connected'),
      ],
    } as never);

    const res = await connectionStatus({});
    expect((res.data as { has_real_data_source: boolean }).has_real_data_source).toBe(true);
  });
});

describe('connection_status with an id', () => {
  it('reduces the detail to connected/needs-credential and field names, never values', async () => {
    vi.mocked(getJson).mockResolvedValue(POLYGON_DETAIL as never);

    const res = await connectionStatus({ id: 'polygon' });

    expect(vi.mocked(getJson)).toHaveBeenCalledWith('/ui/api/connections/polygon');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      id: 'polygon',
      connected: false,
      status: 'not_configured',
      needs_credential: true,
      fields: [{ name: 'api_key', label: 'API Key', required: true, has_value: false }],
    });
    // The `kind: 'secret'` and empty `preview` the engine sent do not survive.
    expect(JSON.stringify(res.data)).not.toContain('preview');
  });

  it('refuses honestly when the connector does not answer', async () => {
    vi.mocked(getJson).mockResolvedValue(null as never);
    const res = await connectionStatus({ id: 'polygon' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('polygon');
  });
});

describe('connect_source', () => {
  it('connects a keyless source with an empty save and bumps the generation', async () => {
    vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, body: { ok: true } } as never);

    const res = await connectSource({ id: 'yfinance' });

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ ok: true, connected: true, id: 'yfinance' });
    expect(vi.mocked(postJson)).toHaveBeenCalledWith('/ui/api/connections/yfinance/save', {});
    expect(vi.mocked(bumpConnectGeneration)).toHaveBeenCalled();
    // A keyless connect reads nothing and arms no paste field.
    expect(pendingConnectionStore.getSnapshot()).toBeNull();
  });

  it('lets a non-secret mode field ride along to the keyless save', async () => {
    vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, body: { ok: true } } as never);
    await connectSource({ id: 'simulator', options: { mode: 'paper' } });
    expect(vi.mocked(postJson)).toHaveBeenCalledWith('/ui/api/connections/simulator/save', {
      mode: 'paper',
    });
  });

  it('a keyed connector returns needs_credential WITHOUT posting, and arms the paste field', async () => {
    vi.mocked(getJson).mockResolvedValue(POLYGON_DETAIL as never);

    const res = await connectSource({ id: 'polygon' });

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ ok: true, needs_credential: true, id: 'polygon' });
    // Nothing was saved and the registry was not re-polled — no key exists yet.
    expect(vi.mocked(postJson)).not.toHaveBeenCalled();
    expect(vi.mocked(bumpConnectGeneration)).not.toHaveBeenCalled();
    // The panel's write-only field is armed for exactly this connector + field.
    expect(pendingConnectionStore.getSnapshot()).toEqual({
      id: 'polygon',
      sourceName: 'Polygon',
      fieldName: 'api_key',
    });
    // The returned fields name the key but carry no value.
    expect(JSON.stringify(res.data)).not.toContain('preview');
  });

  it('refuses a secret-shaped value in options, in the write-only words, touching nothing', async () => {
    const res = await connectSource({ id: 'polygon', options: { api_key: 'sk-live-123' } });

    expect(res.success).toBe(false);
    expect(res.error).toContain('never travels through');
    expect(vi.mocked(getJson)).not.toHaveBeenCalled();
    expect(vi.mocked(postJson)).not.toHaveBeenCalled();
    expect(pendingConnectionStore.getSnapshot()).toBeNull();
  });

  it('refuses a secret-shaped option even under an innocent key name', async () => {
    const res = await connectSource({ id: 'polygon', options: { note: 'my api_key is 42' } });
    expect(res.success).toBe(false);
    expect(res.error).toContain('never travels through');
    expect(vi.mocked(postJson)).not.toHaveBeenCalled();
  });

  it('requires an id', async () => {
    const res = await connectSource({});
    expect(res.success).toBe(false);
    expect(res.error).toContain('id is required');
  });
});
