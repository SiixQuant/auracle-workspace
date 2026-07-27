/**
 * Backtest — the Build-Test district's metrics room.
 *
 * The body is the existing backtest surface, mounted whole: the run's equity
 * and drawdown curves, the house headline six, the risk detail and the rescue
 * paths for a file the engine cannot run.
 *
 * Vitals come from `backtestStore` — literally the store the body renders from,
 * so the three figures at the top of the page and the cards inside it can never
 * be two different runs. They are read through {@link headlineCards}, which is
 * where the house honesty rules live (CAGR withheld under a year, an em dash
 * for anything the engine did not compute); an em dash there becomes the
 * frame's quiet placeholder rather than a number.
 */
import { useSyncExternalStore } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { backtestStore, type BacktestSnapshot } from '../../../engine/backtestStore';
import { EM_DASH, RF_ZERO_SENTENCE, headlineCards } from '../../../engine/houseStats';
import { BacktestPanel } from '../../BacktestPanel';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';

function state(snap: BacktestSnapshot): { status: RoomStatus; label?: string } {
  switch (snap.phase) {
    case 'engine-down':
      return { status: 'attention', label: 'engine unreachable' };
    case 'failed':
      return { status: 'attention', label: 'run failed' };
    case 'unmatched':
      return { status: 'degraded', label: 'file not runnable' };
    case 'ambiguous':
      return { status: 'degraded', label: 'pick a strategy' };
    case 'resolving':
    case 'queued':
    case 'running':
      return { status: 'nominal', label: 'running' };
    case 'idle':
      return { status: 'nominal', label: 'idle' };
    case 'succeeded':
      return { status: 'nominal' };
  }
}

function contextFor(snap: BacktestSnapshot): string {
  if (snap.origin === 'loaded' && snap.jobId) {
    return `A saved run, job ${snap.jobId}. ${RF_ZERO_SENTENCE}`;
  }
  switch (snap.phase) {
    case 'idle':
      return 'Run a strategy from its file and its curves, headline metrics and overfit check land here.';
    case 'resolving':
      return 'Matching the open file against the strategies the engine discovered.';
    case 'queued':
    case 'running':
      return `${snap.cls ?? 'The strategy'} is running on the engine.`;
    case 'succeeded':
      return `${snap.cls ?? 'This run'}${snap.jobId ? `, job ${snap.jobId}` : ''}. ${RF_ZERO_SENTENCE}`;
    case 'failed':
      return snap.detail ?? 'The run did not finish.';
    case 'engine-down':
      return snap.detail ?? 'The engine did not answer, so no run can start.';
    case 'unmatched':
      return 'The open file is not one the engine can backtest.';
    case 'ambiguous':
      return 'That file defines more than one strategy — pick which one runs.';
  }
}

export function BacktestPage({ host }: PanelHostProps): JSX.Element {
  const snap = useSyncExternalStore(backtestStore.subscribe, backtestStore.getSnapshot);
  const { status, label } = state(snap);
  const cards = snap.result ? headlineCards(snap.result.stats, snap.result.nBars) : [];
  /** A card's figure, or null when the house rules withheld it. */
  const figure = (cardLabel: string): string | null => {
    const value = cards.find((card) => card.label === cardLabel)?.value;
    return typeof value === 'string' && value !== EM_DASH ? value : null;
  };

  const vitals: PageVital[] = [
    { label: 'CAGR', value: figure('CAGR') },
    { label: 'Sharpe', value: figure('Sharpe') },
    { label: 'max drawdown', value: figure('Max drawdown'), emphasis: 'bad' },
  ];

  return (
    <RoomPage
      room="backtest"
      status={status}
      statusLabel={label}
      context={contextFor(snap)}
      vitals={vitals}
    >
      <BacktestPanel host={host} />
    </RoomPage>
  );
}
