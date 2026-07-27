/**
 * The room page frame, and the five district pages that first wear it.
 *
 * Two things are worth pinning here and they are different in kind. The FRAME
 * is a promise about orientation: you can always see where you are, how the
 * room is doing, and how to leave — by the breadcrumb, by Escape, or into a
 * wired room. The PAGES are a promise about honesty: each one mounts the real
 * surface rather than a lookalike, so what the room headlines and what its body
 * shows are the same data.
 *
 * The engine client is mocked at its seam, so every figure asserted below is
 * one the fixtures actually served.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { panels } from '../../index';
import { alertStore } from '../../engine/alertStore';
import { openGridHome, openRoom } from '../grid/gridNav';
import { faultedRooms } from '../grid/wiring';
import type { RoomId } from '../grid/rooms';

vi.mock('../../engine/client', () => ({
  authState: vi.fn(async () => ({ signedIn: true })),
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
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import { getJson, getJsonDetailed } from '../../engine/client';

const FINDING = {
  id: 11,
  paper_id: 'p11',
  source: 'arxiv',
  title: 'Overnight drift in low-float industrials',
  status: 'surfaced',
  model: 'heuristic',
  confidence: 'medium',
  composite: 87,
  band: 'candidate',
  hypothesis: 'Return asymmetry persists after an earnings exclusion.',
};

const STRATEGY = { path: 'strategies.alpha.AlphaOne', doc: 'A workspace strategy' };
const QC_PROJECT = { projectId: 7, name: 'Pairs research', language: 'Py' };

/** No incidents unless a test says otherwise — the honest default. */
let incidents: unknown[] = [];

async function defaultGetJson(path: string): Promise<unknown> {
  if (path.startsWith('/ui/api/incidents')) return { incidents };
  if (path.startsWith('/ui/api/quantconnect/projects')) {
    return { connected: true, projects: [QC_PROJECT] };
  }
  if (path.startsWith('/ui/api/backtest/strategies')) return { strategies: [STRATEGY] };
  return null;
}

async function defaultGetJsonDetailed(path: string): Promise<unknown> {
  if (path.startsWith('/ui/api/research/feed')) {
    return { ok: true, status: 200, body: { findings: [FINDING], last_scan: null } };
  }
  if (path.startsWith('/ui/api/backtest/strategies')) {
    return { ok: true, status: 200, body: { strategies: [STRATEGY], excluded: [] } };
  }
  return { ok: false, status: 0, body: null };
}

const host = { panelId: 'com.auracle.pack.grid', extensionId: 'com.auracle.pack' };

function renderGrid(room: RoomId) {
  openRoom(room);
  const Grid = panels.grid.component;
  return render(<Grid host={host as never} />);
}

beforeEach(() => {
  incidents = [];
  vi.mocked(getJson).mockImplementation(defaultGetJson as never);
  vi.mocked(getJsonDetailed).mockImplementation(defaultGetJsonDetailed as never);
});

afterEach(async () => {
  cleanup();
  openGridHome();
  vi.restoreAllMocks();
  // The alert count is module state; leave it at zero for the next case.
  incidents = [];
  vi.mocked(getJson).mockImplementation(defaultGetJson as never);
  await alertStore.refresh();
});

describe('the room page frame', () => {
  it('says where you are, how the room is, and what it is wired to', async () => {
    renderGrid('findings');

    const crumb = screen.getByTestId('room-breadcrumb');
    expect(crumb.textContent).toContain('System Plan');
    expect(screen.getByTestId('room-breadcrumb-here').textContent).toBe('Findings');

    expect(screen.getByTestId('room-status')).toBeTruthy();
    expect(screen.getByTestId('room-context').textContent).toBeTruthy();

    // The vitals are the panel's own feed, once it has loaded.
    expect((await screen.findByTestId('room-vital-top-score')).textContent).toContain('87');
    expect(screen.getByTestId('room-vital-findings').textContent).toContain('1');

    const wired = screen.getByTestId('room-wired');
    expect(wired.textContent).toContain('Wired to');
    expect(screen.getByTestId('room-wired-strategies')).toBeTruthy();
    expect(screen.getByTestId('room-wired-qc')).toBeTruthy();
  });

  it('shows the quiet placeholder rather than a number it does not have', () => {
    // Backtest opens idle: no run, so no CAGR to report.
    renderGrid('backtest');
    expect(screen.getByTestId('room-vital-CAGR').textContent).toContain('—');
  });

  it('returns to the plan from the breadcrumb', () => {
    renderGrid('findings');
    fireEvent.click(screen.getByTestId('grid-back'));

    expect(screen.getByTestId('auracle-grid-home')).toBeTruthy();
    expect(screen.queryByTestId('grid-room-findings')).toBeNull();
  });

  it('returns to the plan on Escape', () => {
    renderGrid('findings');
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByTestId('auracle-grid-home')).toBeTruthy();
  });

  it('leaves Escape alone while the reader is typing in a field', () => {
    renderGrid('validation');
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    field.remove();

    expect(screen.getByTestId('grid-room-validation')).toBeTruthy();
  });

  it('routes to the target room when a wired-to chip is pressed', () => {
    renderGrid('findings');
    fireEvent.click(screen.getByTestId('room-wired-strategies'));

    expect(screen.getByTestId('grid-room-strategies')).toBeTruthy();
    expect(screen.queryByTestId('grid-room-findings')).toBeNull();
  });

  it('routes to a room whose page is not built yet, which shows its placeholder', () => {
    renderGrid('validation');
    fireEvent.click(screen.getByTestId('room-wired-deploys'));

    const room = screen.getByTestId('grid-room-deploys');
    expect(room.textContent).toContain('not built yet');
  });

  it('flags a wired chip whose room holds an open fault', async () => {
    incidents = [{ id: 1, title: 'A deployment stopped' }];
    renderGrid('validation');

    expect(await screen.findByTestId('room-wired-fault-deploys')).toBeTruthy();
    // The room that is fine carries no flag — an unflagged chip claims nothing.
    expect(screen.queryByTestId('room-wired-fault-backtest')).toBeNull();
  });

  it('zooms on arrival, and not at all under reduced motion', () => {
    renderGrid('findings');
    expect(screen.getByTestId('grid-room-findings').getAttribute('data-zoom')).toBe('on');

    cleanup();
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList
    );

    renderGrid('findings');
    expect(screen.getByTestId('grid-room-findings').getAttribute('data-zoom')).toBe('off');
  });
});

describe('faults are read from what the pack already knows', () => {
  it('an open incident flags the room that lists it and the deployments it is about', () => {
    const faulted = faultedRooms(1, 'idle');
    expect([...faulted].sort()).toEqual(['deploys', 'incidents']);
  });

  it('a failed or unreachable run flags the Backtest room', () => {
    expect(faultedRooms(0, 'failed').has('backtest')).toBe(true);
    expect(faultedRooms(0, 'engine-down').has('backtest')).toBe(true);
    expect(faultedRooms(0, 'succeeded').size).toBe(0);
  });
});

describe('each page mounts its real surface', () => {
  it('Findings renders the research feed, scored', async () => {
    renderGrid('findings');
    expect(await screen.findByText(FINDING.title)).toBeTruthy();
    expect(screen.getByText(FINDING.hypothesis)).toBeTruthy();
    // The panel's own actions come with it.
    expect(screen.getByText('Deep-rank')).toBeTruthy();
  });

  it('QC Library renders the linked account, and does not certify locally', async () => {
    renderGrid('qc');
    expect(await screen.findByText(QC_PROJECT.name)).toBeTruthy();
    expect(screen.getByTestId('room-context').textContent).toContain('certified locally');
  });

  it('Strategies renders what the engine discovered', async () => {
    renderGrid('strategies');
    expect(await screen.findByTestId(`strategy-row-${STRATEGY.path}`)).toBeTruthy();
    expect(screen.getByTestId('room-vital-runnable').textContent).toContain('1');
  });

  it('Backtest renders the run surface', () => {
    renderGrid('backtest');
    expect(screen.getByText('Open a strategy and press Run')).toBeTruthy();
  });

  it('Validation renders the gates surface', async () => {
    renderGrid('validation');
    expect(await screen.findByLabelText('Strategy to check')).toBeTruthy();
  });

  it('a mounted body does not repeat the room name', async () => {
    renderGrid('findings');
    await screen.findByText(FINDING.title);
    // The frame names the room; the embedded panel drops its own hero title.
    expect(screen.queryByText('Research')).toBeNull();
    expect(screen.getAllByTestId('room-title')).toHaveLength(1);
  });
});
