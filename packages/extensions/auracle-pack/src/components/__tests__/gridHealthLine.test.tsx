/**
 * The health line — the floor plan's whole job, at chip size.
 *
 * Four claims:
 *
 *  - the chip reads nominal when everything is, and names the WORST room and
 *    its consequence when something is not — from the same vitals the plan's
 *    tiles read, so it can never disagree with the readings behind it;
 *  - expanding it lists every room that is not nominal, worst first, each
 *    with its one-line consequence;
 *  - a fault whose repair the action library offers gets that repair as a
 *    button into the agent lane — and no fault gets an inline form;
 *  - the strip is part of the header FLOW: its own height, never an overlay,
 *    and absent from room pages, which carry their own status surface.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authState: vi.fn(async () => ({ signedIn: false })),
  engineConfig: vi.fn(async () => ({ engineUrl: '', hasKey: false })),
  getJson: vi.fn(async () => null),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  connectCheck: vi.fn(async () => null),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { GridPanel } from '../grid/GridPanel';
import { GridHealthLine } from '../grid/GridHealthLine';
import { gridVitals, type GridVitals } from '../../engine/gridVitals';
import { resetFaceStore } from '../grid/gridFaceStore';
import { aiRunStore } from '../grid/gridAiActions';
import { openGridHome, openRoom } from '../grid/gridNav';
import { closePalette } from '../grid/gridCommands';

function hostProps(): PanelHostProps {
  return { host: { panelId: 'grid', extensionId: 'pack' } } as unknown as PanelHostProps;
}

/** Every room nominal, then the overrides a case needs. */
function seedVitals(overrides: Partial<Record<string, Partial<GridVitals[keyof GridVitals]>>>): void {
  const base = gridVitals.getSnapshot();
  const next: Record<string, unknown> = {};
  for (const room of Object.keys(base)) {
    next[room] = {
      ...base[room as keyof GridVitals],
      health: 'nominal',
      note: null,
      subjects: [],
      ...(overrides[room] ?? {}),
    };
  }
  vi.spyOn(gridVitals, 'getSnapshot').mockReturnValue(next as GridVitals);
}

beforeEach(() => {
  gridVitals.reset();
  resetFaceStore();
});

afterEach(() => {
  cleanup();
  closePalette();
  openGridHome();
  resetFaceStore();
  vi.restoreAllMocks();
  gridVitals.reset();
});

describe('the chip', () => {
  it('reads nominal when everything is', () => {
    seedVitals({});
    render(<GridHealthLine />);

    expect(screen.getByTestId('grid-health').getAttribute('data-health')).toBe('nominal');
    expect(screen.getByTestId('grid-health-chip').textContent).toContain('All systems nominal');
  });

  it('names the worst room and its consequence', () => {
    seedVitals({
      conns: { health: 'degraded', note: 'engine reachable, broker is not' },
      deploys: { health: 'fault', note: '2 deployments errored' },
    });
    render(<GridHealthLine />);

    expect(screen.getByTestId('grid-health').getAttribute('data-health')).toBe('fault');
    // The fault outranks the degradation, whatever the record order.
    expect(screen.getByTestId('grid-health-chip').textContent).toContain('2 deployments errored');
  });
});

describe('the expansion', () => {
  it('lists every unwell room, worst first, with its consequence line', () => {
    seedVitals({
      conns: { health: 'degraded', note: 'engine reachable, broker is not' },
      deploys: { health: 'fault', note: '2 deployments errored' },
    });
    render(<GridHealthLine />);

    fireEvent.click(screen.getByTestId('grid-health-chip'));

    const list = screen.getByTestId('grid-health-list');
    const rows = Array.from(list.querySelectorAll('li')).map((el) =>
      el.getAttribute('data-testid')
    );
    expect(rows[0]).toBe('grid-health-deploys');
    expect(rows).toContain('grid-health-conns');
    expect(screen.getByTestId('grid-health-conns').textContent).toContain(
      'engine reachable, broker is not'
    );
    // Nominal rooms are not news.
    expect(rows).toHaveLength(2);
  });

  it('offers the repair the action library offers, and no form', () => {
    seedVitals({ deploys: { health: 'fault', note: '2 deployments errored' } });
    render(<GridHealthLine />);
    fireEvent.click(screen.getByTestId('grid-health-chip'));

    const fix = screen.getByTestId('grid-health-fix-deploys');
    expect(fix.textContent).toContain('Restart the errored deployments');
    // A repair is asked for, never configured: no input anywhere in the strip.
    expect(
      screen.getByTestId('grid-health').querySelectorAll('input, select, textarea')
    ).toHaveLength(0);
  });

  it('a fault with no offered repair is still named, without a button', () => {
    seedVitals({ blotter: { health: 'degraded', note: 'fills are stale' } });
    render(<GridHealthLine />);
    fireEvent.click(screen.getByTestId('grid-health-chip'));

    expect(screen.getByTestId('grid-health-blotter')).toBeTruthy();
    expect(screen.queryByTestId('grid-health-fix-blotter')).toBeNull();
  });

  it('pressing the repair enters the agent lane, not a form', async () => {
    // Repairs run straight away by the store's own rule -- only mutations
    // park at the approval dialog. What the strip owes is that the press
    // enters the SAME lane every agent action takes: the run store leaves
    // idle, and nothing renders an input.
    seedVitals({ deploys: { health: 'fault', note: '2 deployments errored' } });
    render(<GridPanel {...hostProps()} />);
    fireEvent.click(screen.getByTestId('grid-health-chip'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('grid-health-fix-deploys'));
    });

    const run = aiRunStore.getSnapshot();
    expect(run.running !== null || run.outcome !== null).toBe(true);
  });
});

describe('placement', () => {
  it('sits in the header flow on the resting state', () => {
    seedVitals({});
    render(<GridPanel {...hostProps()} />);

    const strip = screen.getByTestId('grid-health');
    expect(screen.getByTestId('grid-resting')).toBeTruthy();
    // Part of the flow, not an overlay: no absolute positioning on the strip.
    expect(strip.style.position).not.toBe('absolute');
  });

  it('is absent from room pages, which carry their own status surface', async () => {
    seedVitals({});
    render(<GridPanel {...hostProps()} />);
    await act(async () => {
      openRoom('backtest');
    });

    expect(screen.queryByTestId('grid-health')).toBeNull();
  });
});
