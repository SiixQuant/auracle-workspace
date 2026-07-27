/**
 * The Operate and System district pages: Deployments, Blotter, Incidents,
 * Schedules, Runway, Connections.
 *
 * What is worth pinning here is the same promise the first five pages made —
 * each room mounts the REAL surface rather than a lookalike, so what a room
 * headlines and what its body shows come from one read of the engine. Two
 * things are specific to this wave and get their own cases: the ops journal's
 * undo may only be offered on an entry the engine still calls `applied`, and
 * Connections must describe a connector with the same words the Settings page
 * uses.
 *
 * The engine client is mocked at its seam, so every figure asserted below is
 * one the fixtures actually served.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { panels } from '../../index';
import { alertStore } from '../../engine/alertStore';
import { gridVitals } from '../../engine/gridVitals';
import { openGridHome, openRoom } from '../grid/gridNav';
import { WIRED_TO } from '../grid/wiring';
import type { RoomId } from '../grid/rooms';

vi.mock('../../engine/client', () => ({
  authState: vi.fn(async () => ({ signedIn: true })),
  authBases: vi.fn(async () => ({ hq: '', engine: '' })),
  authStart: vi.fn(async () => ({ ok: false, status: 0, body: null, base: null })),
  authRequest: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  authPersist: vi.fn(async () => {}),
  authSignout: vi.fn(async () => {}),
  engineConfig: vi.fn(async () => ({ engineUrl: '', hasKey: false })),
  getJson: vi.fn(async () => null),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  runBacktest: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  backtestJobStatus: vi.fn(async () => null),
  backtestJobResult: vi.fn(async () => null),
  backtestJobFactors: vi.fn(async () => null),
  resolveRunSource: vi.fn(() => undefined),
  connectCheck: vi.fn(async () => null),
  connectCheckDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import { getJson, getJsonDetailed, postJson } from '../../engine/client';

const DEPLOYMENT = {
  id: 4,
  name: 'Momentum SPY — paper',
  strategy_path: 'strategies.momentum',
  strategy_cls: 'Momentum',
  broker: 'simulator',
  mode: 'paper',
  aum: 100_000,
  state: 'running',
  equity: 101_500,
  return_pct: 1.5,
  positions: [],
};

const ORDER = {
  id: 31,
  symbol: 'SPY',
  action: 'buy',
  status: 'filled',
  plain: 'Bought 40 SPY at 512.10',
};

const INCIDENT = {
  severity: 'critical',
  cause: 'scheduled run failed',
  detail: 'the strategy raised on bar 12',
  kind: 'failed_job',
  id: 'failed_job:42',
  action: { kind: 'open_job', job_id: 42 },
  dismiss: { kind: 'failed_job', id: 42 },
};

const SCHEDULE = { id: 2, name: 'momentum-daily', cron: '30 9 * * 1-5', enabled: true };

const RUNWAY = {
  stages: {
    research: { reached: 'yes', evidence: '3 findings ranked' },
    build: { reached: 'yes', evidence: '1 strategy in the workspace' },
    validate: { reached: 'partial', evidence: 'walk-forward not run' },
    paper: { reached: 'no' },
    go_live: { reached: 'no' },
    monitor: { reached: 'unknown' },
  },
};

const CONNECTIONS = {
  connections: [
    {
      id: 'ibkr',
      display_label: 'Interactive Brokers',
      blurb: 'Live and paper execution',
      kind: 'broker',
      status: { state: 'connected' },
    },
    {
      id: 'yfinance',
      display_label: 'Yahoo Finance',
      blurb: 'Free daily bars',
      kind: 'data_provider',
      status: { state: 'not_configured' },
    },
    {
      id: 'polygon',
      display_label: 'Polygon',
      blurb: 'Intraday bars',
      kind: 'data_provider',
      status: { state: 'error', detail: 'key rejected' },
    },
  ],
};

/** One applied (reversible) entry and one already undone, as the engine serves them. */
const JOURNAL = {
  entries: [
    {
      id: 'j-8',
      actor: 'operator',
      action: 'stop deployment',
      target: { kind: 'deployment', id: 4 },
      pre_state: { state: 'running', mode: 'paper' },
      inverse: 'start deployment',
      status: 'applied',
      created_at: '2026-07-27T14:02:00Z',
    },
    {
      id: 'j-7',
      actor: 'operator',
      action: 'pause schedule',
      target: 'momentum-daily',
      pre_state: { enabled: true },
      inverse: 'resume schedule',
      status: 'undone',
      created_at: '2026-07-27T13:40:00Z',
      undone_at: '2026-07-27T13:41:00Z',
    },
  ],
};

/** Everything the engine serves in a healthy workspace. Tests that need an
 *  unhealthy one narrow this per case rather than mutating the fixtures. */
async function defaultGetJson(path: string): Promise<unknown> {
  if (path.startsWith('/deployments')) return [DEPLOYMENT];
  if (path.startsWith('/ui/api/orders')) return { orders: [ORDER] };
  if (path.startsWith('/ui/api/incidents')) return { incidents: [INCIDENT] };
  if (path.startsWith('/ui/api/schedules.json')) return { schedules: [SCHEDULE] };
  if (path.startsWith('/ui/api/runway')) return RUNWAY;
  if (path.startsWith('/ui/api/connections')) return CONNECTIONS;
  if (path.startsWith('/ui/api/quantconnect/projects')) return { connected: false };
  if (path.startsWith('/ui/api/backtest/strategies')) return { strategies: [] };
  return null;
}

async function defaultGetJsonDetailed(path: string): Promise<unknown> {
  if (path.startsWith('/ui/api/ops/journal')) return { ok: true, status: 200, body: JOURNAL };
  if (path.startsWith('/ui/api/connections')) return { ok: true, status: 200, body: CONNECTIONS };
  return { ok: false, status: 0, body: null };
}

const host = { panelId: 'com.auracle.pack.grid', extensionId: 'com.auracle.pack' };

function renderGrid(room: RoomId) {
  openRoom(room);
  const Grid = panels.grid.component;
  return render(<Grid host={host as never} />);
}

beforeEach(() => {
  vi.mocked(getJson).mockImplementation(defaultGetJson as never);
  vi.mocked(getJsonDetailed).mockImplementation(defaultGetJsonDetailed as never);
  vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, body: {} } as never);
  gridVitals.reset();
});

afterEach(async () => {
  cleanup();
  openGridHome();
  vi.restoreAllMocks();
  vi.mocked(getJson).mockImplementation(async () => null as never);
  await alertStore.refresh();
  gridVitals.reset();
});

describe('each Operate and System page mounts its real surface', () => {
  it('Deployments renders the desk table with its per-row actions', async () => {
    renderGrid('deploys');

    expect(await screen.findByText(DEPLOYMENT.name)).toBeTruthy();
    expect(screen.getByTestId('grid-page-deploys')).toBeTruthy();
    // The lifecycle controls come with the desk — this row is running, so the
    // engine's own action list offers a stop.
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    // The figures are the desk's own rows, not a second read.
    await waitFor(() => {
      expect(screen.getByTestId('room-vital-deployed').textContent).toContain('1');
    });
    expect(screen.getByTestId('room-vital-running').textContent).toContain('1');
    expect(screen.getByTestId('room-vital-errored').textContent).toContain('0');
  });

  it('Deployments reads an errored row as attention, like the plan does', async () => {
    vi.mocked(getJson).mockImplementation((async (path: string) =>
      path.startsWith('/deployments')
        ? [{ ...DEPLOYMENT, state: 'errored' }]
        : defaultGetJson(path)) as never);
    renderGrid('deploys');

    await waitFor(() => {
      expect(screen.getByTestId('room-status').getAttribute('data-status')).toBe('attention');
    });
    expect(screen.getByTestId('room-status').textContent).toContain('1 errored');
  });

  it('Blotter renders the order book', async () => {
    renderGrid('blotter');

    expect(await screen.findByText(ORDER.plain)).toBeTruthy();
    expect(screen.getByTestId('grid-page-blotter')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('room-vital-orders').textContent).toContain('1');
    });
    expect(screen.getByTestId('room-vital-filled').textContent).toContain('1');
  });

  it('Schedules renders the cadence table', async () => {
    renderGrid('schedules');

    expect(await screen.findByText(SCHEDULE.name)).toBeTruthy();
    expect(screen.getByTestId('grid-page-schedules')).toBeTruthy();
    // The panel's own row actions come with it.
    expect(screen.getByRole('button', { name: 'Run now' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('room-vital-enabled').textContent).toContain('1');
    });
  });

  it('Runway renders the stages, and counts only the ones actually reached', async () => {
    renderGrid('runway');

    expect(await screen.findByText('Validate')).toBeTruthy();
    expect(screen.getByTestId('grid-page-runway')).toBeTruthy();
    await waitFor(() => {
      // research + build are reached; partial and unknown are NOT counted.
      expect(screen.getByTestId('room-vital-stages-reached').textContent).toContain('2 of 6');
    });
    expect(screen.getByTestId('room-vital-furthest').textContent).toContain('Build');
  });

  it('Incidents renders the wall, and reads an open incident as attention', async () => {
    renderGrid('incidents');

    expect(await screen.findByText(INCIDENT.cause)).toBeTruthy();
    expect(screen.getByTestId('grid-page-incidents')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('room-status').getAttribute('data-status')).toBe('attention');
    });
    expect(screen.getByTestId('room-vital-open').textContent).toContain('1');
    expect(screen.getByTestId('room-vital-critical').textContent).toContain('1');
  });

  it('shows the quiet placeholder rather than a count it does not have', async () => {
    // Nothing answers: the page still frames itself, and states no numbers.
    vi.mocked(getJson).mockImplementation((async () => null) as never);
    vi.mocked(getJsonDetailed).mockImplementation(
      (async () => ({ ok: false, status: 0, body: null })) as never
    );
    renderGrid('blotter');

    await waitFor(() => {
      expect(screen.getByTestId('room-status').textContent).toContain('engine unreachable');
    });
    expect(screen.getByTestId('room-vital-orders').textContent).toContain('—');
  });
});

describe('the ops action journal', () => {
  it('lists recent entries with the status the engine gave them', async () => {
    renderGrid('incidents');

    expect(await screen.findByTestId('ops-journal')).toBeTruthy();
    expect(await screen.findByTestId('ops-journal-entry-j-8')).toBeTruthy();
    expect(screen.getByTestId('ops-journal-entry-j-7')).toBeTruthy();
    expect(screen.getByTestId('ops-journal-status-j-8').textContent).toContain('applied');
    expect(screen.getByTestId('ops-journal-status-j-7').textContent).toContain('undone');
    // The entry states what it changed and what would put it back.
    expect(screen.getByTestId('ops-journal-entry-j-8').textContent).toContain('deployment 4');
    expect(screen.getByTestId('ops-journal-entry-j-8').textContent).toContain('state=running');
    // Counted in the room's own vitals, from the same read.
    await waitFor(() => {
      expect(screen.getByTestId('room-vital-recorded-actions').textContent).toContain('2');
    });
    expect(screen.getByTestId('room-vital-reversible').textContent).toContain('1');
  });

  it('offers Undo only on an entry the engine still calls applied', async () => {
    renderGrid('incidents');

    expect(await screen.findByTestId('ops-journal-undo-j-8')).toBeTruthy();
    expect(screen.queryByTestId('ops-journal-undo-j-7')).toBeNull();
  });

  it('undoes through the engine route, and settles the row before the re-read lands', async () => {
    // The re-read is held open, so what the row shows in the meantime is the
    // optimistic mark and nothing else.
    let release: (() => void) | null = null;
    let reads = 0;
    vi.mocked(getJsonDetailed).mockImplementation((async (path: string) => {
      if (!path.startsWith('/ui/api/ops/journal')) return defaultGetJsonDetailed(path);
      reads += 1;
      if (reads > 1) await new Promise<void>((resolve) => (release = resolve));
      return { ok: true, status: 200, body: JOURNAL };
    }) as never);
    renderGrid('incidents');

    fireEvent.click(await screen.findByTestId('ops-journal-undo-j-8'));

    await waitFor(() => expect(postJson).toHaveBeenCalledWith('/ui/api/ops/journal/j-8/undo'));
    await waitFor(() => {
      expect(screen.getByTestId('ops-journal-status-j-8').textContent).toContain('undone');
    });
    // The control it offered is gone, and the entry it did not touch is untouched.
    expect(screen.queryByTestId('ops-journal-undo-j-8')).toBeNull();
    expect(screen.getByTestId('ops-journal-status-j-7').textContent).toContain('undone');
    (release as (() => void) | null)?.();
  });

  it('lets the engine record stand when the re-read disagrees with the optimistic mark', async () => {
    renderGrid('incidents');

    fireEvent.click(await screen.findByTestId('ops-journal-undo-j-8'));

    // The fixture keeps serving `applied`, i.e. the engine did not record the
    // reversal after all. The row must go back to what the engine says rather
    // than keep the optimistic claim.
    await waitFor(() => {
      expect(screen.getByTestId('ops-journal-status-j-8').textContent).toContain('applied');
    });
    expect(screen.getByTestId('ops-journal-undo-j-8')).toBeTruthy();
  });

  it('states the engine reason and leaves the row alone when the undo is refused', async () => {
    vi.mocked(postJson).mockResolvedValue({
      ok: false,
      status: 409,
      body: { detail: 'that deployment has already been restarted' },
    } as never);
    renderGrid('incidents');

    fireEvent.click(await screen.findByTestId('ops-journal-undo-j-8'));

    const note = await screen.findByTestId('ops-journal-note');
    expect(note.textContent).toContain('already been restarted');
    // Nothing was optimistically changed — the entry is still applied, and
    // still offers the control.
    expect(screen.getByTestId('ops-journal-status-j-8').textContent).toContain('applied');
    expect(screen.getByTestId('ops-journal-undo-j-8')).toBeTruthy();
  });

  it('says an engine build cannot serve the journal rather than showing it empty', async () => {
    vi.mocked(getJsonDetailed).mockImplementation((async (path: string) =>
      path.startsWith('/ui/api/ops/journal')
        ? { ok: false, status: 404, body: null }
        : defaultGetJsonDetailed(path)) as never);
    renderGrid('incidents');

    expect(await screen.findByTestId('ops-journal-unsupported')).toBeTruthy();
    expect(screen.queryByTestId('ops-journal-empty')).toBeNull();
    // A journal that could not be read states no count.
    expect(screen.getByTestId('room-vital-recorded-actions').textContent).toContain('—');
  });
});

describe('the Connections room', () => {
  it('lists the connectors with their kind and status tag', async () => {
    renderGrid('conns');

    expect(await screen.findByTestId('conns-list')).toBeTruthy();
    expect(screen.getByTestId('grid-page-conns')).toBeTruthy();
    expect(screen.getByTestId('conns-row-ibkr').textContent).toContain('Interactive Brokers');
    expect(screen.getByTestId('conns-kind-ibkr').textContent).toContain('Broker');
    expect(screen.getByTestId('conns-status-ibkr').textContent).toContain('Connected');
    // Keyless sources are READY, not "not configured" — the same rule the
    // Settings page renders.
    expect(screen.getByTestId('conns-status-yfinance').textContent).toContain('Ready');
    expect(screen.getByTestId('conns-status-polygon').textContent).toContain('key rejected');
  });

  it('reads an errored connector as attention, and names where keys are managed', async () => {
    renderGrid('conns');

    await waitFor(() => {
      expect(screen.getByTestId('room-status').getAttribute('data-status')).toBe('attention');
    });
    expect(screen.getByTestId('room-vital-in-error').textContent).toContain('1');
    expect(screen.getByTestId('conns-manage-note').textContent).toContain('Auracle Connections');
  });

  it('does not offer to edit a credential from this room', async () => {
    renderGrid('conns');

    await screen.findByTestId('conns-list');
    for (const label of ['Save', 'Test', 'Disconnect']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });
});

describe('the Operate and System rooms are wired to each other', () => {
  it('declares the flow the districts are grouped by', () => {
    expect(WIRED_TO.deploys).toEqual(['incidents', 'blotter', 'schedules', 'runway']);
    expect(WIRED_TO.blotter).toEqual(['deploys']);
    expect(WIRED_TO.incidents).toEqual(['deploys']);
    expect(WIRED_TO.schedules).toEqual(['deploys']);
    expect(WIRED_TO.runway).toEqual(['deploys', 'conns']);
    expect(WIRED_TO.conns).toEqual(['deploys', 'qc']);
  });

  it('routes from a chip to the room it names', async () => {
    renderGrid('deploys');

    fireEvent.click(await screen.findByTestId('room-wired-blotter'));
    expect(screen.getByTestId('grid-room-blotter')).toBeTruthy();
    expect(screen.queryByTestId('grid-room-deploys')).toBeNull();

    fireEvent.click(screen.getByTestId('room-wired-deploys'));
    expect(screen.getByTestId('grid-room-deploys')).toBeTruthy();
  });

  it('routes from Runway out to Connections', async () => {
    renderGrid('runway');

    fireEvent.click(await screen.findByTestId('room-wired-conns'));
    expect(screen.getByTestId('grid-room-conns')).toBeTruthy();
  });
});
