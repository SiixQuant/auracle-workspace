/**
 * Interactive "Validate translation" control (#274). Given a completed QC
 * backtest and the imported strategy's own Auracle-run statistics, it POSTs to
 * the engine and renders the graded side-by-side ({@link QcValidationReport}).
 * Honest states throughout: no stats → a prompt to run locally first; a
 * disconnected / unreadable result → a plain reason, never a half-table.
 */
import { useState } from 'react';

import { postJson } from '../engine/client';
import {
  qcValidatePath,
  readValidationReport,
  type QcValidationReport as Report,
} from '../engine/quantconnect';
import { QcValidationReport } from './QcValidationReport';
import { Button, InlineNote } from './panelkit';

type State =
  | { phase: 'idle' }
  | { phase: 'validating' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; report: Report };

export function QcValidateCard({
  projectId,
  backtestId,
  auracleStatistics,
}: {
  projectId: number;
  backtestId: string;
  /** The imported strategy's own run statistics, keyed by QC statistic name
   *  (e.g. "Sharpe Ratio"). Null until a local run of the import exists. */
  auracleStatistics: Record<string, unknown> | null;
}): JSX.Element {
  const [state, setState] = useState<State>({ phase: 'idle' });

  const validate = async () => {
    if (!auracleStatistics) return;
    setState({ phase: 'validating' });
    const resp = await postJson(qcValidatePath(), {
      project_id: projectId,
      backtest_id: backtestId,
      auracle_statistics: auracleStatistics,
    });
    if (resp.status === 200) {
      const report = readValidationReport(resp.body);
      if (report) {
        setState({ phase: 'done', report });
        return;
      }
    }
    const body = (resp.body ?? {}) as { error?: string; connected?: boolean };
    const message =
      body.connected === false
        ? 'Connect QuantConnect in Settings to validate.'
        : typeof body.error === 'string'
          ? body.error
          : `Validation failed (${resp.status || 'engine unreachable'}).`;
    setState({ phase: 'error', message });
  };

  if (!auracleStatistics) {
    return (
      <InlineNote kind="muted" testId="qc-validate-needs-run">
        Run the imported strategy locally, then validate its results against the
        QuantConnect original.
      </InlineNote>
    );
  }

  return (
    <div data-testid="qc-validate" className="flex flex-col gap-2">
      {state.phase !== 'done' && (
        <Button
          variant="ghost"
          busy={state.phase === 'validating'}
          testId="qc-validate-btn"
          onClick={validate}
        >
          Validate translation
        </Button>
      )}
      {state.phase === 'error' && (
        <InlineNote kind="err" testId="qc-validate-error">
          {state.message}
        </InlineNote>
      )}
      {state.phase === 'done' && <QcValidationReport report={state.report} />}
    </div>
  );
}
