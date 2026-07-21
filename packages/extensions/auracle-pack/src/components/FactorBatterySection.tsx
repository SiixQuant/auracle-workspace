/**
 * FactorBatterySection — the robustness battery rendered inside the Metrics
 * Viewer, keyed by job id. It requests the engine's factor-attribution battery
 * for a completed run and renders it as a measure rail on the SAME panelkit
 * primitive the overfit validation rail uses (MeasureRow).
 *
 * Every verdict and reading is the engine's string, rendered verbatim — the
 * client derives no statistical judgment and applies no p-value threshold. A
 * factor loading is a magnitude, not a health state (the house's position on
 * the research surface too), so the rail stays chromatically neutral: the
 * verdict word and the plain reading carry the meaning, not a green/red dot.
 *
 * Because the request is keyed by job id, it serves any jobs row the engine
 * honours — a local run or a persisted QuantConnect import alike. When the
 * engine can't produce a battery (window too short, no factor overlap, run not
 * found, quant extra missing), the section shows the engine's own explanation
 * rather than a blank space or a client-invented excuse.
 */
import { useEffect, useState } from 'react';
import { backtestJobFactors } from '../engine/client';
import {
  batteryAbsence,
  humanizeVerdict,
  measureFigure,
  normalizeBattery,
  type FactorBattery,
} from '../engine/factorBattery';
import { houseProvenanceNote } from '../engine/houseStats';
import { InlineNote, MeasureRow, numeric, SectionTitle, SkeletonRows, tone } from './panelkit';

type BatteryState =
  | { phase: 'loading' }
  | { phase: 'ready'; battery: FactorBattery }
  | { phase: 'absent'; reason: string };

/** The quiet context line: window, overlap count, and the factor set. */
function contextLine(battery: FactorBattery): string {
  const bits: string[] = [];
  if (battery.window) bits.push(`${battery.window.start} to ${battery.window.end}`);
  if (battery.nObs !== null) bits.push(`${battery.nObs} overlapping days`);
  if (battery.factorSet.length) bits.push(battery.factorSet.join(' / '));
  return bits.join(' · ');
}

export function FactorBatterySection({
  jobId,
  sourceLabel,
}: {
  jobId: number;
  /** Humanized origin of a non-local run (e.g. "QuantConnect"); drives the
   *  cross-source provenance caveat. Absent for a local backtest. */
  sourceLabel?: string;
}): JSX.Element {
  const [state, setState] = useState<BatteryState>({ phase: 'loading' });

  useEffect(() => {
    let live = true;
    setState({ phase: 'loading' });
    void (async () => {
      const res = await backtestJobFactors(jobId);
      if (!live) return;
      if (res.ok && res.body.ok) {
        setState({ phase: 'ready', battery: normalizeBattery(res.body) });
        return;
      }
      // Absent: surface the engine's reason from whichever body came back.
      const status = res.ok ? 200 : res.status;
      setState({ phase: 'absent', reason: batteryAbsence(status, res.body) });
    })();
    return () => {
      live = false;
    };
  }, [jobId]);

  const provenance = houseProvenanceNote(sourceLabel);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionTitle>Factor attribution</SectionTitle>
      {state.phase === 'loading' ? (
        <SkeletonRows rows={3} />
      ) : state.phase === 'absent' ? (
        <InlineNote kind="muted" testId="battery-absent">
          {state.reason}
        </InlineNote>
      ) : (
        <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {contextLine(state.battery) ? (
            <span style={{ fontSize: 11.5, color: tone.text3, ...numeric }}>{contextLine(state.battery)}</span>
          ) : null}
          {state.battery.measures.map((m) => {
            const figure = measureFigure(m);
            return (
              <MeasureRow
                key={m.measure}
                testId={`battery-measure-${m.measure}`}
                markGlyph="●"
                markColor={tone.text3}
                title={m.label}
                detail={m.reading || undefined}
                statusLabel={humanizeVerdict(m.verdict)}
                statusColor={tone.text3}
              >
                {figure ? (
                  <span style={{ fontSize: 12, fontWeight: 600, color: tone.text2, marginTop: 2, ...numeric }}>
                    {figure}
                  </span>
                ) : null}
              </MeasureRow>
            );
          })}
          {state.battery.factorNote || provenance ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
              {state.battery.factorNote ? (
                <span style={{ fontSize: 10.5, lineHeight: 1.5, color: tone.text3 }}>{state.battery.factorNote}</span>
              ) : null}
              {provenance ? (
                <span data-testid="battery-provenance" style={{ fontSize: 10.5, lineHeight: 1.5, color: tone.text3 }}>
                  {provenance}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
