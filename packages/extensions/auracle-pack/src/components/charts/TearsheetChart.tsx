/**
 * The strategy tearsheet's performance chart — Plotly, matched to the owner's
 * reference (mockup `_c.html`).
 *
 * ## Why Plotly, bundled inline
 * The reference is a Plotly figure: a strategy line and a light-grey benchmark
 * on the top panel, an underwater drawdown on a shared-x subplot beneath it,
 * −45° ISO date ticks, `x unified` hover. Lightweight-charts and the pack's own
 * recharts wrapper can't draw a stacked-domain subplot with a second y-axis, so
 * the owner chose Plotly (PRD D6). It ships as `plotly.js-basic-dist-min` and is
 * imported STATICALLY — the extension builds to one blob-URL file with
 * `inlineDynamicImports`, so a lazy `import()` would break the load; the whole
 * bundle is inlined by design (the size cost is measured and accepted).
 *
 * ## Figure vs. paint
 * {@link buildTearsheetFigure} is a pure function of the three series — every
 * trace, colour, width, axis domain and tickformat the reference specifies —
 * so the figure can be asserted in a test without Plotly ever painting (jsdom
 * has no layout engine). The component only owns the imperative part: drive a
 * div through `Plotly.react`, resize with the container, purge on unmount.
 */
import { useEffect, useMemo, useRef } from 'react';
import Plotly from 'plotly.js-basic-dist-min';

/** A dated series in the engine's PERCENT units (e.g. 173.0 = +173%). */
export interface TearsheetSeries {
  labels: string[];
  points: number[];
}

/** The three overlays the tearsheet draws. `benchmark` is null on a run the
 *  engine computed no benchmark for — the figure then carries two traces. */
export interface TearsheetChartData {
  /** Strategy cumulative return %, on the top panel (y). */
  chart: TearsheetSeries;
  /** Underwater drawdown %, on the subplot (y2). */
  drawdown: TearsheetSeries;
  /** Benchmark cumulative return %, on the top panel (y), or null. */
  benchmark?: (TearsheetSeries & { symbol?: string }) | null;
}

/** One Plotly scatter trace — the subset the tearsheet emits. */
export interface TearsheetTrace {
  x: string[];
  y: number[];
  type: 'scatter';
  mode: 'lines';
  name: string;
  line: { color: string; width: number };
  xaxis: 'x';
  yaxis: 'y' | 'y2';
  hovertemplate: string;
}

export interface TearsheetFigure {
  traces: TearsheetTrace[];
  layout: Record<string, unknown>;
  config: Record<string, unknown>;
}

/* The reference palette — literal hex from `_c.html`, deliberately not the
 * panelkit tone tokens: these are the Plotly canvas's own colours (near-black
 * paper, orange strategy, grey benchmark, steel underwater), matched exactly to
 * the owner's screenshot. */
const STRATEGY = '#f26430';
const BENCHMARK = '#cfd3d8';
const DRAWDOWN = '#86a0bd';
const PAPER = '#0e0f13';
const GRID = '#20232a';
const ZERO = '#3a3d44';
const HELVETICA = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const AX_FONT = { family: HELVETICA, size: 10, color: '#8b9096' };

/**
 * Assemble the Plotly figure exactly as the reference draws it. Pure — no DOM,
 * no Plotly — so the traces, axis domains and tickformats are directly testable.
 */
export function buildTearsheetFigure(data: TearsheetChartData): TearsheetFigure {
  const traces: TearsheetTrace[] = [
    {
      x: data.chart.labels,
      y: data.chart.points,
      type: 'scatter',
      mode: 'lines',
      name: 'Strategy',
      line: { color: STRATEGY, width: 1.6 },
      xaxis: 'x',
      yaxis: 'y',
      hovertemplate: 'Strategy  %{y:.1f}%<extra></extra>',
    },
  ];

  if (data.benchmark && data.benchmark.points.length > 0) {
    traces.push({
      x: data.benchmark.labels,
      y: data.benchmark.points,
      type: 'scatter',
      mode: 'lines',
      name: 'Benchmark',
      line: { color: BENCHMARK, width: 1.2 },
      xaxis: 'x',
      yaxis: 'y',
      hovertemplate: 'Benchmark  %{y:.1f}%<extra></extra>',
    });
  }

  traces.push({
    x: data.drawdown.labels,
    y: data.drawdown.points,
    type: 'scatter',
    mode: 'lines',
    name: 'Drawdown',
    line: { color: DRAWDOWN, width: 1.2 },
    xaxis: 'x',
    yaxis: 'y2',
    hovertemplate: 'Drawdown  %{y:.2f}%<extra></extra>',
  });

  const layout: Record<string, unknown> = {
    paper_bgcolor: PAPER,
    plot_bgcolor: PAPER,
    font: { family: HELVETICA, size: 11, color: '#9aa0a6' },
    margin: { l: 56, r: 14, t: 6, b: 46 },
    showlegend: false,
    hovermode: 'x unified',
    hoverlabel: { bgcolor: '#16181d', bordercolor: '#2a2d34', font: { color: '#e6e8eb', size: 11 } },
    xaxis: {
      domain: [0, 1],
      anchor: 'y2',
      gridcolor: GRID,
      zeroline: false,
      showline: false,
      linecolor: GRID,
      tickformat: '%Y-%m-%d',
      tickangle: -45,
      tickfont: AX_FONT,
      ticks: '',
      nticks: 9,
    },
    yaxis: {
      domain: [0.3, 1.0],
      gridcolor: GRID,
      zeroline: true,
      zerolinecolor: ZERO,
      ticksuffix: '%',
      tickformat: '.0f',
      tickfont: AX_FONT,
      ticks: '',
    },
    yaxis2: {
      domain: [0, 0.2],
      gridcolor: GRID,
      zeroline: true,
      zerolinecolor: ZERO,
      ticksuffix: '%',
      tickformat: '.2f',
      tickfont: AX_FONT,
      ticks: '',
      nticks: 5,
    },
  };

  const config: Record<string, unknown> = { displayModeBar: false, responsive: true };

  return { traces, layout, config };
}

const STYLE_ID = 'auracle-tearsheet-chart-styles';

/** Height lives in CSS (not inline) so the container query can shrink it — the
 *  Grid renders inside a host pane, so width is a `@container` measure, never a
 *  `@media` one (the pack's hard rule). */
function ensureChartStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
.auracle-tearsheet-chart { width: 100%; height: 496px; }
@container auracle-grid (max-width: 760px) { .auracle-tearsheet-chart { height: 380px; } }
`;
  document.head.appendChild(el);
}

/**
 * Render the tearsheet figure into a div through `Plotly.react`, keep it sized
 * to its container, and tear it down on unmount. The figure is memoised on the
 * three series' identities so a parent re-render that hasn't changed the data
 * neither re-plots nor thrashes the resize observer.
 */
export function TearsheetChart({ data }: { data: TearsheetChartData }): JSX.Element {
  ensureChartStyles();
  const ref = useRef<HTMLDivElement | null>(null);
  const figure = useMemo(
    () => buildTearsheetFigure(data),
    [data.chart, data.drawdown, data.benchmark]
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    void Plotly.react(el, figure.traces, figure.layout, figure.config);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        try {
          Plotly.Plots.resize(el);
        } catch {
          // Plotly throws if the node was purged mid-frame; harmless.
        }
      });
      observer.observe(el);
    }

    return () => {
      observer?.disconnect();
      try {
        Plotly.purge(el);
      } catch {
        // Already gone — nothing to purge.
      }
    };
  }, [figure]);

  return <div ref={ref} className="auracle-tearsheet-chart" data-testid="tearsheet-chart" />;
}
