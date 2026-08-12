/**
 * Factors — the Build-Test district's attribution room.
 *
 * Promotes the factor battery from a footnote inside the tearsheet to a
 * standing room: how much of the focused run's return is genuine alpha
 * versus market and style-factor exposure. The battery itself — the fetch,
 * the render, and the engine's plain-English verdicts and readings — is
 * {@link FactorBatterySection}, mounted whole. This room only points it at
 * the focused backtest and shows an honest empty state when none is
 * focused. The client judges no statistics; every verdict and reading is
 * the engine's own string.
 */
import { useSyncExternalStore } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';

import { focusStore } from '../../../engine/focusStore';
import { FactorBatterySection } from '../../FactorBatterySection';
import { MonteCarloSection } from '../../MonteCarloSection';
import { CenterState } from '../../panelkit';
import { RoomPage } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

export function FactorPage(_props: PanelHostProps): JSX.Element {
  const focus = useSyncExternalStore(
    focusStore.subscribe,
    focusStore.getSnapshot,
    focusStore.getSnapshot,
  );
  // Factor attribution is defined for a backtest run; a deployment or a
  // validation focus has no battery to read.
  const jobId = focus.run?.kind === 'backtest' ? Number(focus.run.id) : NaN;
  const hasJob = Number.isFinite(jobId);

  return (
    <RoomPage
      room="factors"
      status="nominal"
      statusLabel={hasJob ? undefined : 'no run focused'}
      context={ROOM_CONTEXT.factors}
    >
      {hasJob ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <FactorBatterySection jobId={jobId} />
          <MonteCarloSection jobId={jobId} />
        </div>
      ) : (
        <CenterState
          title="No run focused yet"
          detail="Open a strategy and run a backtest, or pick a saved run — its factor attribution renders here."
        />
      )}
    </RoomPage>
  );
}
