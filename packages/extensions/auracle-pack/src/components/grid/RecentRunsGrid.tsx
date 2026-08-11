/**
 * RecentRunsGrid — recent backtests as a dense, scannable grid (Frontier #19).
 *
 * The engine already serves the last N backtests (`tearsheetRuns`), but the only
 * place they surfaced was a <select> in the tearsheet toolbar — a list you can
 * pick from but not READ. This is that same feed rendered as the dense grid the
 * DataGrid primitive exists for: one row per run, the return trend-coloured, the
 * Sharpe heat-tinted against a fixed unitless scale, the drawdown reddening with
 * its depth, and the strategy name a live pivot ({@link EntityLink}) to its
 * tearsheet. A row click focuses that run — the exact publish the picker does —
 * so the grid and the dropdown drive the room identically.
 *
 * It reads the feed once on mount and renders the caller's fallback until there
 * is at least one run to show, so an empty box shows the room's own empty state
 * rather than a bare table.
 */
import { useEffect, useState, type ReactNode } from 'react';

import { tearsheetRuns, type RecentRun } from '../../engine/client';
import type { EntityRef } from '../../engine/entityLinks';
import { focusStore } from '../../engine/focusStore';
import { EM_DASH, statPercent } from '../../engine/houseStats';
import { prettifyPath } from '../../engine/humanize';
import { DataGrid, type Column, type HeatScale } from './DataGrid';

/** The run's strategy, as a pivot to its focused tearsheet (S3 / #2). */
function runEntity(run: RecentRun): EntityRef {
  const label = prettifyPath(run.strategyPath) ?? run.strategyPath;
  return {
    kind: 'run',
    id: String(run.jobId),
    label,
    strategyPath: run.strategyPath,
    runId: String(run.jobId),
  };
}

/** The date part of the engine's ISO finish stamp, or an em dash. */
function finishedLabel(iso: string): string {
  return iso ? iso.slice(0, 10) : EM_DASH;
}

/**
 * The drawdown heat scale, derived from the column's own values so it is right
 * whatever the unit: the deepest drawdown anchors the red end, zero the other,
 * the half-depth reads neutral. Undefined when nothing drew down (nothing to
 * shade).
 */
export function drawdownScale(runs: RecentRun[]): HeatScale | undefined {
  const depths = runs
    .map((r) => r.maxDrawdown)
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d < 0);
  if (depths.length === 0) return undefined;
  const worst = Math.min(...depths);
  return { min: worst, max: 0, mid: worst / 2 };
}

/** The grid's columns over a set of runs (drawdown scale derived from them). */
export function recentRunColumns(runs: RecentRun[]): Column<RecentRun>[] {
  const ddScale = drawdownScale(runs);
  const cols: Column<RecentRun>[] = [
    {
      key: 'strategy',
      header: 'Strategy',
      value: (r) => prettifyPath(r.strategyPath) ?? r.strategyPath,
      link: (r) => runEntity(r),
      title: (r) => r.strategyPath,
    },
    {
      key: 'finished',
      header: 'Finished',
      value: (r) => finishedLabel(r.finishedAt),
      title: (r) => r.finishedAt || undefined,
    },
    {
      key: 'return',
      header: 'Return',
      numeric: true,
      trend: true,
      value: (r) => statPercent(r.totalReturn),
      scalar: (r) => r.totalReturn,
    },
    {
      key: 'sharpe',
      header: 'Sharpe',
      numeric: true,
      heat: { min: -1, max: 3, mid: 0 },
      value: (r) => (typeof r.sharpe === 'number' ? r.sharpe.toFixed(2) : EM_DASH),
      scalar: (r) => r.sharpe,
    },
    {
      key: 'maxdd',
      header: 'Max DD',
      numeric: true,
      ...(ddScale ? { heat: ddScale } : null),
      value: (r) => statPercent(r.maxDrawdown),
      scalar: (r) => r.maxDrawdown,
    },
    {
      key: 'bars',
      header: 'Bars',
      numeric: true,
      value: (r) => String(r.nBars),
    },
  ];
  return cols;
}

/** Focus a run — the same publish the tearsheet's run picker performs. */
function focusRun(run: RecentRun): void {
  focusStore.publish({
    strategy: { filePath: run.strategyPath, dottedPath: run.strategyPath },
    run: { kind: 'backtest', id: String(run.jobId) },
  });
}

export function RecentRunsGrid({
  focusedJob,
  fallback,
}: {
  /** The run currently focused, highlighted in the grid. */
  focusedJob: number | null;
  /** Shown while loading and when the feed is empty. */
  fallback?: ReactNode;
}): JSX.Element {
  const [runs, setRuns] = useState<RecentRun[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await tearsheetRuns();
        if (!cancelled) setRuns(rows);
      } catch {
        if (!cancelled) setRuns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!runs || runs.length === 0) {
    return <>{fallback ?? null}</>;
  }

  return (
    <DataGrid
      testId="recent-runs-grid"
      label="Recent backtests"
      columns={recentRunColumns(runs)}
      rows={runs}
      rowKey={(r) => r.jobId}
      isActive={(r) => r.jobId === focusedJob}
      onRowActivate={focusRun}
    />
  );
}
