/**
 * DataGrid — the dense, conditionally-formatted table (Frontier #19).
 *
 * Pins the two pure rules the grid is built on (a value → heat tint, a series →
 * sparkline path) and the behaviours a dense grid promises: tabular figures,
 * trend colour by sign, a heat-tinted cell, a value that is a live pivot
 * (EntityLink / #2), keyboard-activatable rows with an active wash, and an
 * honest empty state instead of a fabricated row.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { EntityRef } from '../../engine/entityLinks';
import { getActiveRoom, openGridHome } from '../grid/gridNav';
import {
  DataGrid,
  Sparkline,
  heatBackground,
  sparkPath,
  type Column,
} from '../grid/DataGrid';

afterEach(() => {
  cleanup();
  openGridHome();
});

describe('heatBackground', () => {
  const scale = { min: -1, max: 3, mid: 0 };

  it('warms green above the mid and red below it', () => {
    const hot = heatBackground(2.5, scale);
    const cold = heatBackground(-0.8, scale);
    expect(hot).toMatch(/color-mix.*#3fb950/); // tone.ok
    expect(cold).toMatch(/color-mix.*#e5534b/); // tone.danger
  });

  it('is undefined on the neutral mid and for a non-number', () => {
    expect(heatBackground(0, scale)).toBeUndefined();
    expect(heatBackground(null, scale)).toBeUndefined();
    expect(heatBackground(undefined, scale)).toBeUndefined();
    expect(heatBackground(Number.NaN, scale)).toBeUndefined();
  });

  it('clamps beyond the range and grows with distance', () => {
    const near = heatBackground(0.5, scale);
    const far = heatBackground(3, scale);
    const beyond = heatBackground(99, scale);
    // alpha grows: near < far, and clamps at the max (far === beyond)
    const alpha = (s: string | undefined): number =>
      Number(/(\d+)%/.exec(s ?? '')?.[1] ?? '0');
    expect(alpha(near)).toBeLessThan(alpha(far));
    expect(alpha(beyond)).toBe(alpha(far));
  });

  it('invert flips which side reads green', () => {
    const plain = heatBackground(2.5, scale);
    const inverted = heatBackground(2.5, { ...scale, invert: true });
    expect(plain).toMatch(/#3fb950/); // green without invert
    expect(inverted).toMatch(/#e5534b/); // red once inverted
  });
});

describe('sparkPath', () => {
  it('starts with a move and scales the series across the width', () => {
    const d = sparkPath([0, 1, 2], 100, 20);
    expect(d.startsWith('M0.0,')).toBe(true);
    // three points → M then two L segments
    expect(d.match(/L/g)?.length).toBe(2);
    // rising series ends higher (smaller y) than it starts
    const ys = [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys[2]).toBeLessThan(ys[0]);
  });

  it('draws a flat series down the middle', () => {
    const d = sparkPath([5, 5, 5], 100, 20);
    const ys = [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys.every((y) => y === 10)).toBe(true); // h/2
  });

  it('has no shape below two points', () => {
    expect(sparkPath([], 100, 20)).toBe('');
    expect(sparkPath([1], 100, 20)).toBe('');
  });
});

describe('Sparkline', () => {
  it('renders nothing for a degenerate series', () => {
    const { container } = render(<Sparkline series={[1]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
  it('renders an svg path for a real series', () => {
    const { container } = render(<Sparkline series={[1, 2, 1, 3]} />);
    expect(container.querySelector('svg path')?.getAttribute('d')).toContain('M0.0,');
  });
});

/* ── the grid ─────────────────────────────────────────────────────────── */

interface Row {
  id: number;
  name: string;
  ret: number | null;
  sharpe: number | null;
}

const entityFor = (r: Row): EntityRef => ({
  kind: 'strategy',
  id: r.name,
  label: r.name,
  strategyPath: r.name,
});

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', value: (r) => r.name, link: (r) => entityFor(r) },
  { key: 'ret', header: 'Return', numeric: true, trend: true, value: (r) => String(r.ret), scalar: (r) => r.ret },
  {
    key: 'sharpe',
    header: 'Sharpe',
    numeric: true,
    heat: { min: -1, max: 3, mid: 0 },
    value: (r) => (r.sharpe === null ? '—' : r.sharpe.toFixed(2)),
    scalar: (r) => r.sharpe,
  },
];

const rows: Row[] = [
  { id: 1, name: 'Alpha', ret: 0.5, sharpe: 2.4 },
  { id: 2, name: 'Beta', ret: -0.3, sharpe: -0.5 },
];

describe('DataGrid', () => {
  it('renders a header per column and a row per datum', () => {
    render(<DataGrid testId="g" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    ['Name', 'Return', 'Sharpe'].forEach((h) => expect(screen.getByText(h)).toBeTruthy());
    expect(screen.getByTestId('g-row-1')).toBeTruthy();
    expect(screen.getByTestId('g-row-2')).toBeTruthy();
  });

  it('makes figure cells tabular', () => {
    render(<DataGrid testId="g" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const retCell = screen.getByText('0.5');
    expect((retCell as HTMLElement).style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('colours a trend cell differently for a gain and a loss', () => {
    render(<DataGrid testId="g" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const gain = screen.getByText('0.5').style.color;
    const loss = screen.getByText('-0.3').style.color;
    expect(gain).not.toBe('');
    expect(loss).not.toBe('');
    expect(gain).not.toBe(loss);
  });

  it('heat-tints a strong Sharpe and leaves an absent one bare', () => {
    const withNull: Row[] = [...rows, { id: 3, name: 'Gamma', ret: null, sharpe: null }];
    render(<DataGrid testId="g" columns={columns} rows={withNull} rowKey={(r) => r.id} />);
    expect(screen.getByText('2.40').style.background).toContain('color-mix');
    expect(screen.getByText('—').style.background).toBe('');
  });

  it('renders a linked value as a pivot and navigates on its click', () => {
    render(<DataGrid testId="g" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const links = screen.getAllByTestId('entity-link');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('data-entity-kind')).toBe('strategy');
    fireEvent.click(links[0]);
    expect(getActiveRoom()).toBe('strategy'); // PRIMARY_ROOM
  });

  it('activates a row by click and by keyboard, and marks the active one', () => {
    const onRowActivate = vi.fn();
    render(
      <DataGrid
        testId="g"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowActivate={onRowActivate}
        isActive={(r) => r.id === 2}
      />
    );
    fireEvent.click(screen.getByTestId('g-row-1'));
    expect(onRowActivate).toHaveBeenCalledWith(rows[0]);
    fireEvent.keyDown(screen.getByTestId('g-row-1'), { key: 'Enter' });
    expect(onRowActivate).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('g-row-2').getAttribute('data-active')).toBe('');
    expect(screen.getByTestId('g-row-1').getAttribute('data-active')).toBeNull();
  });

  it('shows the empty state instead of a table when there are no rows', () => {
    render(
      <DataGrid
        testId="g"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<span>nothing yet</span>}
      />
    );
    expect(screen.getByTestId('g-empty').textContent).toBe('nothing yet');
    expect(screen.queryByRole('table')).toBeNull();
  });
});
