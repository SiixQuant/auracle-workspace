/**
 * The shadcn equity chart block — a recharts line (or drawdown area) inside a
 * shadcn Card, with a header, a hover tooltip, and a trend footer. This is the
 * "full shadcn block" the owner picked: the real recharts engine + shadcn Card
 * chrome, themed onto the Auracle IDE variables.
 *
 * Honesty rule holds: fewer than two real points renders nothing at all — the
 * curve is never a placeholder, and the trend footer reads the actual series.
 */
import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn, ensureShadChartStyles } from './theme';
import { finitePoints } from './series';

export type ChartVariant = 'equity' | 'drawdown';

interface EquityChartShadProps {
  /** The real series (equity index, or drawdown as non-positive percents). */
  points: number[];
  /** Optional x labels (dates); when absent the axis is hidden. */
  labels?: string[];
  title?: string;
  description?: string;
  variant?: ChartVariant;
  /** Show the trend footer (first→last delta). Default true for equity. */
  footer?: boolean;
  height?: number;
  /** Formats the tooltip / footer value. Default: 2-dp fixed. */
  format?: (v: number) => string;
  /** Extra footer subline; overrides the default "growth of $1" copy. */
  footerNote?: string;
}

const COLOR: Record<ChartVariant, string> = {
  equity: 'var(--chart-1)',
  drawdown: 'var(--chart-2)',
};

function ArrowUp(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M4 17 L10 11 L14 15 L20 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7 L20 7 L20 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ArrowDown(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M4 7 L10 13 L14 9 L20 17" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 17 L20 17 L20 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface TipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: { x: string } }>;
  color: string;
  label: string;
  format: (v: number) => string;
}
function ShadTooltip({ active, payload, color, label, format }: TipProps): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  return (
    <div className="sc-tooltip">
      <div className="sc-tt-label">{p.payload.x}</div>
      <div className="sc-tt-row">
        <span className="sc-tt-dot" style={{ background: color }} />
        {label}
        <span className="sc-tt-val">{format(p.value)}</span>
      </div>
    </div>
  );
}

/**
 * A shadcn Card wrapper — header (title + description), content, and an optional
 * footer node. Kept inline; the classes come from the injected shadcn sheet.
 */
export function ChartCard({
  title,
  description,
  footer,
  children,
}: {
  title?: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  ensureShadChartStyles();
  return (
    <div className={cn('auracle-shad', 'sc-card')}>
      {title || description ? (
        <div className="sc-header">
          {title ? <span className="sc-title">{title}</span> : null}
          {description ? <span className="sc-desc">{description}</span> : null}
        </div>
      ) : null}
      <div className="sc-content">{children}</div>
      {footer ? <div className="sc-footer">{footer}</div> : null}
    </div>
  );
}

export function EquityChartShad({
  points,
  labels,
  title,
  description,
  variant = 'equity',
  footer = true,
  height = 180,
  format = (v) => v.toFixed(2),
  footerNote,
}: EquityChartShadProps): JSX.Element | null {
  ensureShadChartStyles();
  // Honesty gate: drop non-finite points (the engine serialises NaN/Inf as
  // null, and the backtest feed forwards points unfiltered), THEN require two
  // real points — never a placeholder, a gap-spanning line, or a fabricated
  // trend figure computed off a null endpoint.
  const data = finitePoints(points, labels);
  if (data.length < 2) return null;

  const color = COLOR[variant];
  const seriesLabel = variant === 'drawdown' ? 'Drawdown' : 'Equity';
  const hasLabels = Array.isArray(labels) && labels.length === (points?.length ?? 0);

  const first = data[0].v;
  const last = data[data.length - 1].v;
  const delta = variant === 'drawdown' ? last : first !== 0 ? (last / first - 1) * 100 : 0;
  const up = delta >= 0;

  const footerEl =
    footer && variant === 'equity' ? (
      <>
        <span className="sc-trend" style={{ color: up ? 'var(--chart-1)' : 'var(--chart-2)' }}>
          {up ? 'Trending up' : 'Trending down'} {Math.abs(delta).toFixed(1)}% over the window
          {up ? <ArrowUp /> : <ArrowDown />}
        </span>
        <span className="sc-sub">{footerNote ?? 'Growth of $1 across the tested window'}</span>
      </>
    ) : null;

  const axisTick = { fill: 'var(--sc-muted)', fontSize: 11 };

  return (
    <ChartCard title={title} description={description} footer={footerEl}>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          {variant === 'drawdown' ? (
            <AreaChart data={data} margin={{ left: 8, right: 12, top: 6, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="x"
                hide={!hasLabels}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={44}
                tick={axisTick}
              />
              <YAxis hide domain={['dataMin', 0]} />
              <Tooltip
                cursor={{ stroke: 'var(--sc-border)' }}
                content={(p) => (
                  <ShadTooltip
                    active={p.active}
                    payload={p.payload as unknown as TipProps['payload']}
                    color={color}
                    label={seriesLabel}
                    format={format}
                  />
                )}
              />
              <Area
                dataKey="v"
                type="natural"
                stroke={color}
                strokeWidth={1.8}
                fill={color}
                fillOpacity={0.14}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          ) : (
            <LineChart data={data} margin={{ left: 8, right: 12, top: 6, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="x"
                hide={!hasLabels}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={44}
                tick={axisTick}
              />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip
                cursor={{ stroke: 'var(--sc-border)' }}
                content={(p) => (
                  <ShadTooltip
                    active={p.active}
                    payload={p.payload as unknown as TipProps['payload']}
                    color={color}
                    label={seriesLabel}
                    format={format}
                  />
                )}
              />
              <Line
                dataKey="v"
                type="natural"
                stroke={color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
