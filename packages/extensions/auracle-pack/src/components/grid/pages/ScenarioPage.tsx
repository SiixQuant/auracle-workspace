/**
 * Scenarios — the Build-Test district's stress room (Frontier #11).
 *
 * Replays the focused strategy through the named historical stress windows
 * (2008, COVID, 2018 Q4, 2022 …) by SLICING its stored equity curve — no
 * re-run, and truer than one, because the slice keeps the real warm-up state
 * the strategy carried into each crisis. Each window shows the in-window return,
 * the drawdown it took, and a small in-window curve; a window before the
 * strategy's history is left blank rather than invented. The slice math lives in
 * {@link runScenarios}; this room only points it at the focused run and draws
 * the result with the shared DataGrid.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';

import { tearsheetResult } from '../../../engine/client';
import { focusStore } from '../../../engine/focusStore';
import { EM_DASH, statPercent } from '../../../engine/houseStats';
import { runScenarios, type ScenarioResult } from '../../../engine/scenarios';
import {
  Button,
  CenterState,
  InlineNote,
  PanelShell,
  SkeletonRows,
  ToolbarSpring,
} from '../../panelkit';
import { DataGrid, type Column, type HeatScale } from '../DataGrid';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'nocurve' }
  | { phase: 'ready'; scenarios: ScenarioResult[] };

/** Deeper in-window drawdowns read redder, derived from the covered windows. */
function drawdownScale(rows: ScenarioResult[]): HeatScale | undefined {
  const dds = rows
    .map((r) => r.maxDrawdown)
    .filter((d): d is number => typeof d === 'number' && d < 0);
  if (dds.length === 0) return undefined;
  const worst = Math.min(...dds);
  return { min: worst, max: 0, mid: worst / 2 };
}

export function scenarioColumns(rows: ScenarioResult[]): Column<ScenarioResult>[] {
  const scale = drawdownScale(rows.filter((r) => r.covered));
  return [
    { key: 'name', header: 'Scenario', value: (r) => r.window.name, title: (r) => r.window.what },
    { key: 'period', header: 'Period', value: (r) => r.window.blurb },
    {
      key: 'return',
      header: 'Return',
      numeric: true,
      trend: true,
      value: (r) => (r.covered ? statPercent(r.ret) : EM_DASH),
      scalar: (r) => r.ret,
    },
    {
      key: 'maxdd',
      header: 'Max DD',
      numeric: true,
      value: (r) => (r.covered ? statPercent(r.maxDrawdown) : EM_DASH),
      scalar: (r) => r.maxDrawdown,
      ...(scale ? { heat: scale } : null),
    },
    {
      key: 'trend',
      header: 'In-window',
      value: () => EM_DASH,
      spark: (r) => (r.covered && r.series.length >= 2 ? r.series : null),
    },
  ];
}

export function ScenarioPage(_: PanelHostProps): JSX.Element {
  const focus = useSyncExternalStore(
    focusStore.subscribe,
    focusStore.getSnapshot,
    focusStore.getSnapshot
  );
  const jobId = focus.run?.kind === 'backtest' ? Number(focus.run.id) : NaN;
  const hasJob = Number.isFinite(jobId);
  const [state, setState] = useState<State>({ phase: hasJob ? 'loading' : 'idle' });

  const load = useCallback(async () => {
    if (!Number.isFinite(jobId)) {
      setState({ phase: 'idle' });
      return;
    }
    setState({ phase: 'loading' });
    const result = await tearsheetResult(jobId);
    if (!result) {
      setState({ phase: 'failed' });
      return;
    }
    const chart = result.chart;
    if (!chart || !Array.isArray(chart.labels) || chart.labels.length < 2) {
      setState({ phase: 'nocurve' });
      return;
    }
    setState({ phase: 'ready', scenarios: runScenarios(chart.labels, chart.points) });
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = state.phase === 'ready' ? state.scenarios : null;
  const covered = ready ? ready.filter((r) => r.covered).length : null;
  const worstDD = ready
    ? ready.reduce(
        (m, r) => (r.covered && r.maxDrawdown !== null && r.maxDrawdown < m ? r.maxDrawdown : m),
        0
      )
    : null;

  const status: RoomStatus =
    state.phase === 'failed' ? 'attention' : state.phase === 'loading' ? 'degraded' : 'nominal';
  const label =
    state.phase === 'failed'
      ? 'engine unreachable'
      : state.phase === 'loading'
        ? 'reading'
        : !hasJob
          ? 'no run focused'
          : state.phase === 'nocurve'
            ? 'no curve'
            : covered === 0
              ? 'none in history'
              : undefined;

  const vitals: PageVital[] = [
    { label: 'covered', value: covered !== null ? String(covered) : null },
    {
      label: 'worst drawdown',
      value: worstDD ? statPercent(worstDD) : null,
      emphasis: 'bad',
    },
  ];

  return (
    <RoomPage
      room="scenario"
      status={status}
      statusLabel={label}
      context={ROOM_CONTEXT.scenario}
      vitals={vitals}
    >
      <PanelShell
        title="Stress scenarios"
        toolbar={
          <>
            <Button variant="ghost" onClick={() => void load()}>
              Refresh
            </Button>
            <ToolbarSpring />
          </>
        }
      >
        {!hasJob ? (
          <CenterState
            title="No run focused yet"
            detail="Open a strategy and run a backtest, or pick a saved run — its stress-window replay renders here."
          />
        ) : state.phase === 'loading' ? (
          <SkeletonRows rows={5} />
        ) : state.phase === 'failed' ? (
          <CenterState
            title="The run couldn't be loaded"
            detail="Stress windows are sliced from the focused run's curve, read from your local Auracle engine. Make sure the stack is running, then retry."
            actions={
              <Button variant="primary" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        ) : state.phase === 'nocurve' ? (
          <CenterState
            title="No equity curve"
            detail="This run recorded no plottable curve, so there is nothing to slice stress windows from."
          />
        ) : state.phase === 'ready' ? (
          <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <InlineNote kind="muted">
              How the focused strategy actually moved through each historical stress window — sliced
              from its own backtest, so a window before the strategy&rsquo;s history is left blank.
            </InlineNote>
            <DataGrid
              testId="scenario-grid"
              label="Stress scenarios"
              columns={scenarioColumns(state.scenarios)}
              rows={state.scenarios}
              rowKey={(r) => r.window.id}
            />
          </div>
        ) : null}
      </PanelShell>
    </RoomPage>
  );
}
