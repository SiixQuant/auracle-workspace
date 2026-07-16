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
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn, ensureShadChartStyles } from './theme';
import { canUseLogScale, finitePoints, logTicks } from './series';

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
  /**
   * Show the "Trending up N%" line. Default true. Turn it off when the caller's
   * `footerNote` already states the outcome — printing both says the same thing
   * twice in two different units.
   */
  trend?: boolean;
  height?: number;
  /** Formats the tooltip / footer value. Default: 2-dp fixed. */
  format?: (v: number) => string;
  /** Extra footer subline; overrides the default "growth of $1" copy. */
  footerNote?: string;
  /**
   * Y-axis scale. Defaults to 'linear' so existing callers are untouched;
   * 'log' silently degrades back to linear when the series touches zero or
   * goes negative, because a log axis cannot express those.
   */
  scale?: 'linear' | 'log';
  /** Reveal the Y axis. Off by default — existing callers render as before. */
  showYAxis?: boolean;
  /** Formats Y-axis ticks. Falls back to `format`. */
  yTickFormat?: (v: number) => string;
  /** A horizontal marker, e.g. the max-drawdown line. In DATA units. */
  refLine?: { y: number; label: string };
  /** Use the house ALL-CAPS title treatment (scoped; does not restyle other panels). */
  caps?: boolean;
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
  caps,
  children,
}: {
  title?: string;
  description?: string;
  footer?: ReactNode;
  /** House ALL-CAPS title. Scoped to a modifier class so opting in here does
   *  NOT restyle `.sc-title` for the panels that don't ask for it. */
  caps?: boolean;
  children: ReactNode;
}): JSX.Element {
  ensureShadChartStyles();
  return (
    <div className={cn('auracle-shad', 'sc-card', caps && 'sc-card--house')}>
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
  trend = true,
  height = 180,
  format = (v) => v.toFixed(2),
  footerNote,
  scale = 'linear',
  showYAxis = false,
  yTickFormat,
  refLine,
  caps = false,
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

  // A log axis needs strictly-positive data. A wiped-out curve reaches zero,
  // so degrade to linear rather than render an empty axis — and say so in the
  // footer, because a silently-linear "log scale" chart is a lie by omission.
  const logRequested = scale === 'log' && variant === 'equity';
  const useLog = logRequested && canUseLogScale(data);
  const logFellBack = logRequested && !useLog;

  const lo = Math.min(...data.map((d) => d.v));
  const hi = Math.max(...data.map((d) => d.v));
  const yTick = yTickFormat ?? format;

  const footerEl =
    footer && variant === 'equity' ? (
      <>
        {trend ? (
          <span className="sc-trend" style={{ color: up ? 'var(--chart-1)' : 'var(--chart-2)' }}>
            {up ? 'Trending up' : 'Trending down'} {Math.abs(delta).toFixed(1)}% over the window
            {up ? <ArrowUp /> : <ArrowDown />}
          </span>
        ) : null}
        <span className="sc-sub">
          {footerNote ?? 'Growth of $1 across the tested window'}
          {logFellBack ? ' · Linear scale: the curve reaches zero, which a log axis cannot show.' : ''}
        </span>
      </>
    ) : null;

  const axisTick = { fill: 'var(--sc-muted)', fontSize: 11 };

  return (
    <ChartCard title={title} description={description} footer={footerEl} caps={caps}>
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
              <YAxis
                hide={!showYAxis}
                domain={['dataMin', 0]}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                width={showYAxis ? 52 : 0}
                tick={axisTick}
                tickFormatter={(v: number) => yTick(v)}
              />
              {refLine ? (
                <ReferenceLine
                  y={refLine.y}
                  stroke={color}
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                  label={{
                    value: refLine.label,
                    position: 'insideBottomRight',
                    fill: 'var(--sc-muted)',
                    fontSize: 10.5,
                  }}
                />
              ) : null}
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
              {/* Recharts produces no usable ticks on a log axis and mishandles
                  domain={['auto','auto']} there, so both are explicit. */}
              <YAxis
                hide={!showYAxis}
                scale={useLog ? 'log' : 'linear'}
                domain={useLog ? [lo, hi] : ['auto', 'auto']}
                ticks={useLog ? logTicks(lo, hi) : undefined}
                allowDataOverflow={false}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                width={showYAxis ? 52 : 0}
                tick={axisTick}
                tickFormatter={(v: number) => yTick(v)}
              />
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
