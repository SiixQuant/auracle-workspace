/**
 * MonteCarloSection — the robustness fan rendered inside the Metrics Viewer,
 * keyed by job id. It requests the engine's Monte-Carlo bootstrap for a
 * completed run and shows how much of the realised curve is signal vs the luck
 * of the return ordering: a shaded 5–95th-percentile band, the median path, and
 * the terminal multiples.
 *
 * The engine returns ONLY numbers, so this renders strictly FACTUAL text — the
 * range and where the realised terminal falls within it. It never labels a run
 * "lucky" or "skilled"; a wide band means more path-dependent variance and the
 * reader draws the conclusion. When the engine can't produce a fan (window too
 * short, run not found), the section shows the engine's own reason, not a blank.
 *
 * The fan is a dependency-free inline SVG on a viewBox, so it scales without a
 * ResizeObserver — safe in the Grid's hidden-tab pane where layout callbacks
 * don't fire until a frame is forced.
 */
import { useEffect, useState } from 'react';

import { backtestJobMonteCarlo } from '../engine/client';
import {
  hasFan,
  mcAbsence,
  monteCarloRead,
  normalizeMonteCarlo,
  type MonteCarlo,
} from '../engine/monteCarlo';
import { InlineNote, numeric, SectionTitle, SkeletonRows, tone } from './panelkit';

type McState =
  | { phase: 'loading' }
  | { phase: 'ready'; mc: MonteCarlo }
  | { phase: 'absent'; reason: string };

const W = 320;
const H = 96;

/** The 5–95 band + median path as one dependency-free SVG. */
function MonteCarloFan({ mc }: { mc: MonteCarlo }): JSX.Element | null {
  if (!hasFan(mc)) return null;
  const n = mc.p50.length;
  const all = [...mc.p05, ...mc.p95];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - ((v - min) / range) * H;

  const top = mc.p95.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L');
  const bottomRev = mc.p05
    .map((v, i) => ({ i, v }))
    .reverse()
    .map(({ i, v }) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' L');
  const band = `M${top} L${bottomRev} Z`;
  const median = 'M' + mc.p50.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L');
  const baseY = y(1).toFixed(1); // the growth-of-$1 baseline

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label="Monte-Carlo 5 to 95 percentile equity band"
      data-testid="mc-fan"
      style={{ display: 'block', borderRadius: 8, background: tone.sunken }}
    >
      <line x1="0" y1={baseY} x2={W} y2={baseY} stroke={tone.border} strokeWidth="1" strokeDasharray="3 3" />
      <path d={band} fill="rgba(255,255,255,0.07)" stroke="none" />
      <path d={median} fill="none" stroke={tone.text2} strokeWidth="1.4" />
    </svg>
  );
}

function Term({ label, value, strong }: { label: string; value: number; strong?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 62 }}>
      <span style={{ fontSize: 10, letterSpacing: '.02em', color: tone.text3, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: strong ? tone.text : tone.text2, ...numeric }}>
        {value.toFixed(2)}×
      </span>
    </div>
  );
}

export function MonteCarloSection({ jobId }: { jobId: number }): JSX.Element {
  const [state, setState] = useState<McState>({ phase: 'loading' });

  useEffect(() => {
    let live = true;
    setState({ phase: 'loading' });
    void (async () => {
      const res = await backtestJobMonteCarlo(jobId);
      if (!live) return;
      if (res.ok && res.body.ok) {
        setState({ phase: 'ready', mc: normalizeMonteCarlo(res.body) });
        return;
      }
      const status = res.ok ? 200 : res.status;
      setState({ phase: 'absent', reason: mcAbsence(status, res.ok ? res.body : res.body) });
    })();
    return () => {
      live = false;
    };
  }, [jobId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionTitle>Monte-Carlo robustness</SectionTitle>
      {state.phase === 'loading' ? (
        <SkeletonRows rows={3} />
      ) : state.phase === 'absent' ? (
        <InlineNote kind="muted" testId="mc-absent">
          {state.reason}
        </InlineNote>
      ) : (
        <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <MonteCarloFan mc={state.mc} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }} data-testid="mc-terminals">
            <Term label="Realised" value={state.mc.realised} strong />
            <Term label="Median" value={state.mc.medianTerminal} />
            <Term label="5th pct" value={state.mc.p05Terminal} />
            <Term label="95th pct" value={state.mc.p95Terminal} />
          </div>
          <span data-testid="mc-read" style={{ fontSize: 11, lineHeight: 1.55, color: tone.text3 }}>
            {monteCarloRead(state.mc)}
          </span>
        </div>
      )}
    </div>
  );
}
