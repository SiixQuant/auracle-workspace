/**
 * Strategy Tearsheet — the strategy-detail room (WS-E, PRD DF5).
 *
 * The room is now a thin FRAME around the shared {@link Tearsheet} body: this
 * file owns only the {@link RoomPage} anatomy — the breadcrumb, the status tag,
 * the one-sentence context, and the three headline vitals — while every figure,
 * control and load lives in `Tearsheet`, which the home hero renders too so the
 * two surfaces can never drift apart.
 *
 * ## Vitals mirror the table
 * The vitals are lifted straight out of the tearsheet's own metric rows through
 * `Tearsheet`'s `onLoaded` callback, so the headline and the table can never be
 * two different runs; an em dash there becomes the frame's quiet placeholder
 * rather than a fabricated figure.
 */
import { useState, useSyncExternalStore } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { focusStore } from '../../../engine/focusStore';
import { EM_DASH, type TearsheetMetricRow } from '../../../engine/houseStats';
import { RoomPage, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';
import { Tearsheet } from './Tearsheet';

export function StrategyPage({ host }: PanelHostProps): JSX.Element {
  const focus = useSyncExternalStore(focusStore.subscribe, focusStore.getSnapshot);
  // Lifted from the tearsheet body so the frame's vitals quote the very rows on
  // the table below them, never a second measurement of the same run.
  const [rows, setRows] = useState<TearsheetMetricRow[]>([]);

  const job = focus.run?.kind === 'backtest' ? Number(focus.run.id) : null;
  const runId = job !== null && Number.isFinite(job) ? job : null;

  const vital = (label: string): string | null => {
    const value = rows.find((row) => row.label === label)?.value;
    return value && value !== EM_DASH ? value : null;
  };
  const vitals: PageVital[] = [
    { label: 'Annualized Return', value: vital('Annualized Return') },
    { label: 'Sharpe', value: vital('Sharpe Ratio') },
    { label: 'max drawdown', value: vital('Max Drawdown'), emphasis: 'bad' },
  ];

  const context =
    runId !== null
      ? `${ROOM_CONTEXT.strategy} Showing backtest job ${runId}.`
      : ROOM_CONTEXT.strategy;

  return (
    <RoomPage room="strategy" status="nominal" context={context} vitals={vitals}>
      <Tearsheet host={host} onLoaded={setRows} />
    </RoomPage>
  );
}
