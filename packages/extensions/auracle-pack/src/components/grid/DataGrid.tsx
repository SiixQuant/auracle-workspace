/**
 * DataGrid — the Grid's one dense, conditionally-formatted table (Frontier #19).
 *
 * Auracle's rooms grew their tables by hand: a flex row here, a CSS-grid there,
 * each re-deciding alignment, tabular figures and hover on its own. That is fine
 * for a three-field list and wrong for a wall of numbers an analyst scans for
 * the outlier. This is the shared primitive that wall is built from:
 *
 *   - every figure column is tabular ({@link numeric}), right-aligned, so digits
 *     line up and the eye reads down a column, not across a ragged one;
 *   - a column can carry MEANING in its colour — {@link trendColor} for the sign
 *     of a return, a {@link heatBackground} tint for where a value sits in a
 *     range — so the outlier is coloured, not hunted for;
 *   - a value can be a pivot: pass an {@link EntityRef} and the cell renders an
 *     {@link EntityLink} (Frontier #2), so a strategy name in a grid opens its
 *     tearsheet, the same click it is anywhere else;
 *   - a column can draw an inline {@link Sparkline} where a shape says more than
 *     a number.
 *
 * The component owns none of the domain: columns are described by the caller,
 * and the two rules worth unit-testing — how a value maps to a heat tint, how a
 * series maps to a sparkline path — are pure functions exported beside it. A
 * real <table> is the substrate on purpose: columns align across rows for free,
 * the header is a sticky <thead>, and a row is a real focusable box. The grid
 * renders real rows or the caller's empty state; it never invents a figure.
 */
import type { CSSProperties, ReactNode } from 'react';

import type { EntityRef } from '../../engine/entityLinks';
import { numeric, tint, tone, trendColor } from '../panelkit';
import { EntityLink } from './EntityLink';
import { GRID_ACCENT } from './gridTheme';

/** Which edge a cell's content sits against. Figures read down a right edge. */
export type CellAlign = 'left' | 'right';

/**
 * A diverging heat scale: where a value sits between {@link min} and {@link max},
 * around a neutral {@link mid}, decides a cell's background tint. Above mid warms
 * green, below mid warms red, magnitude sets the alpha. `invert` flips the sense
 * for a column where lower is better (so the "good" end still reads green).
 */
export interface HeatScale {
  min: number;
  max: number;
  /** The value that reads as neutral. Defaults to the midpoint of [min, max]. */
  mid?: number;
  /** Flip green/red — for a column where a lower number is the better one. */
  invert?: boolean;
}

/** One column of a {@link DataGrid}, described over the row type `T`. */
export interface Column<T> {
  /** Stable key — React key for the header/cell and the grid's column id. */
  key: string;
  /** Column heading. */
  header: string;
  /** Left for text, right for figures. Defaults to right when `numeric`. */
  align?: CellAlign;
  /** Tabular, feature-locked figures — set on every quantity column. */
  numeric?: boolean;
  /** The displayed cell content: a formatted string, or any node. */
  value: (row: T) => ReactNode;
  /** The raw number behind the cell, for colour rules. null → no formatting. */
  scalar?: (row: T) => number | null | undefined;
  /** Colour the text by the sign of {@link scalar} (green up, red down). */
  trend?: boolean;
  /** Tint the cell background by where {@link scalar} sits in this scale. */
  heat?: HeatScale;
  /** An inline sparkline series for the cell, or null for none. */
  spark?: (row: T) => number[] | null | undefined;
  /** Make the cell a pivot: the entity this value links to, or null. */
  link?: (row: T) => EntityRef | null | undefined;
  /** A hover title for the cell (e.g. the full path behind a short label). */
  title?: (row: T) => string | undefined;
}

export interface DataGridProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Stable identity per row. */
  rowKey: (row: T) => string | number;
  /** Fired on click / Enter / Space when a row is activatable. */
  onRowActivate?: (row: T) => void;
  /** Highlight the row that is currently focused elsewhere. */
  isActive?: (row: T) => boolean;
  /** Rendered in place of the grid when there are no rows. */
  empty?: ReactNode;
  testId?: string;
  /** Accessible name for the grid. */
  label?: string;
}

/* ───────────────────────── pure formatting rules ───────────────────────── */

/**
 * The background tint for a heat cell: undefined when there is no number or the
 * value sits on the neutral mid, else a low-alpha green (above mid) or red
 * (below mid) whose strength grows with distance from mid, capped so the figure
 * on top stays readable. `invert` swaps the two sides.
 */
export function heatBackground(
  value: number | null | undefined,
  scale: HeatScale
): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const mid = scale.mid ?? (scale.min + scale.max) / 2;
  let t: number;
  if (value >= mid) {
    const span = scale.max - mid || 1;
    t = Math.min(1, (value - mid) / span);
  } else {
    const span = mid - scale.min || 1;
    t = -Math.min(1, (mid - value) / span);
  }
  if (scale.invert) t = -t;
  if (t === 0) return undefined;
  // Cap at ~22% so a tinted cell never drowns its own figure.
  const alphaPct = Math.round(Math.abs(t) * 22);
  if (alphaPct <= 0) return undefined;
  return tint(t > 0 ? tone.ok : tone.danger, alphaPct);
}

/**
 * An SVG path for a sparkline: the series scaled to fill `w × h`, y inverted for
 * SVG's top-left origin. A flat series draws a centred horizontal line; fewer
 * than two points has no shape and returns ''.
 */
export function sparkPath(series: number[], w: number, h: number): string {
  if (!series || series.length < 2) return '';
  const min = Math.min(...series);
  const max = Math.max(...series);
  const flat = max === min;
  const span = max - min || 1;
  const dx = w / (series.length - 1);
  return series
    .map((v, i) => {
      const x = i * dx;
      const y = flat ? h / 2 : h - ((v - min) / span) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/* ───────────────────────────── sub-components ───────────────────────────── */

/** A tiny inline trend line: green when it ends up, red when it ends down. */
export function Sparkline({
  series,
  width = 66,
  height = 18,
  color,
}: {
  series: number[] | null | undefined;
  width?: number;
  height?: number;
  color?: string;
}): JSX.Element | null {
  if (!series || series.length < 2) return null;
  const up = series[series.length - 1] >= series[0];
  const stroke = color ?? (up ? tone.ok : tone.danger);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path
        d={sparkPath(series, width, height)}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ─────────────────────────────── the grid ──────────────────────────────── */

function Cell<T>({
  col,
  row,
  first,
  active,
}: {
  col: Column<T>;
  row: T;
  first: boolean;
  active: boolean;
}): JSX.Element {
  const align: CellAlign = col.align ?? (col.numeric ? 'right' : 'left');
  const scalar = col.scalar ? col.scalar(row) : undefined;
  const link = col.link ? col.link(row) : undefined;
  const series = col.spark ? col.spark(row) : undefined;

  const style: CSSProperties = {
    padding: '7px 11px',
    fontSize: 12.5,
    lineHeight: 1.4,
    textAlign: align,
    borderTop: `1px solid ${tone.border}`,
    whiteSpace: 'nowrap',
    ...(col.numeric ? numeric : null),
  };
  if (col.trend && typeof scalar === 'number') style.color = trendColor(scalar);
  if (col.heat) {
    const bg = heatBackground(scalar, col.heat);
    if (bg) style.background = bg;
  }
  if (first && active) style.boxShadow = `inset 3px 0 0 0 ${GRID_ACCENT}`;

  let content: ReactNode;
  if (series && series.length >= 2) {
    content = <Sparkline series={series} />;
  } else if (link) {
    // The link is its own pivot; keep its click off the row handler.
    content = (
      <span onClick={(e) => e.stopPropagation()}>
        <EntityLink entity={link}>{col.value(row)}</EntityLink>
      </span>
    );
  } else {
    content = col.value(row);
  }

  return (
    <td style={style} title={col.title?.(row)}>
      {content}
    </td>
  );
}

/**
 * The dense grid. Rows are keyboard-activatable when {@link DataGridProps.onRowActivate}
 * is given (Enter/Space, focus ring via `.apk-row`, the active row washed with
 * the Grid accent and marked with a left rule). Wide content scrolls inside the
 * grid's own box, never the page.
 */
export function DataGrid<T>({
  columns,
  rows,
  rowKey,
  onRowActivate,
  isActive,
  empty,
  testId,
  label,
}: DataGridProps<T>): JSX.Element {
  if (rows.length === 0) {
    return <div data-testid={testId ? `${testId}-empty` : undefined}>{empty ?? null}</div>;
  }

  const activatable = Boolean(onRowActivate);

  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${tone.border}`, borderRadius: 8 }}>
      <table
        data-testid={testId}
        aria-label={label}
        style={{
          borderCollapse: 'collapse',
          width: '100%',
          fontFamily: tone.font,
          color: tone.text,
        }}
      >
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  padding: '8px 11px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  color: tone.text3,
                  textAlign: col.align ?? (col.numeric ? 'right' : 'left'),
                  background: tone.bg,
                  borderBottom: `1px solid ${tone.borderStrong}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const active = isActive?.(row) ?? false;
            return (
              <tr
                key={rowKey(row)}
                className={activatable ? 'apk-row' : undefined}
                data-testid={testId ? `${testId}-row-${rowKey(row)}` : undefined}
                data-active={active ? '' : undefined}
                tabIndex={activatable ? 0 : undefined}
                onClick={activatable ? () => onRowActivate?.(row) : undefined}
                onKeyDown={
                  activatable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowActivate?.(row);
                        }
                      }
                    : undefined
                }
                style={{
                  background: active ? tint(GRID_ACCENT, 12) : undefined,
                  cursor: activatable ? 'pointer' : undefined,
                }}
              >
                {columns.map((col, ci) => (
                  <Cell key={col.key} col={col} row={row} first={ci === 0} active={active} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
