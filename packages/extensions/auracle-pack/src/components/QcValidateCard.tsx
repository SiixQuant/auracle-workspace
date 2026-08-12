/**
 * "Validate translation" control (#274). Given a completed QC backtest, it
 * compares the QuantConnect original against a completed LOCAL Auracle run of
 * the imported strategy — the user picks which of their recent runs is the
 * port. The engine reads that run's own statistics (by id) and grades the
 * reproduction; this card just sources the run and renders the verdict
 * ({@link QcValidationReport}).
 *
 * Honest throughout: no local runs yet → a prompt to run the import first; a
 * disconnected / unreadable result → a plain reason, never a half-table.
 */
import { useEffect, useState } from 'react';

import { postJson, tearsheetRuns, type RecentRun } from '../engine/client';
import {
  qcValidatePath,
  readValidationReport,
  type QcValidationReport as Report,
} from '../engine/quantconnect';
import { QcValidationReport } from './QcValidationReport';
import { Button, InlineNote, Select, tone } from './panelkit';

type Phase = 'idle' | 'validating' | 'error' | 'done';

/** A recent local run, labelled for the picker: strategy class · as-of · Sharpe. */
function runLabel(run: RecentRun): string {
  const cls = run.strategyPath.split('.').pop() || run.strategyPath || `run ${run.jobId}`;
  const when = run.asOf || run.finishedAt.slice(0, 10) || '';
  const sharpe = run.sharpe != null ? ` · Sharpe ${run.sharpe.toFixed(2)}` : '';
  return when ? `${cls} · ${when}${sharpe}` : `${cls}${sharpe}`;
}

export function QcValidateCard({
  projectId,
  backtestId,
}: {
  projectId: number;
  backtestId: string;
}): JSX.Element {
  // null = still loading the recent-runs feed; [] = none to pick.
  const [runs, setRuns] = useState<RecentRun[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string>('');
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    let alive = true;
    void tearsheetRuns().then((r) => {
      if (alive) setRuns(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  const validate = async () => {
    if (!selected) return;
    setPhase('validating');
    const resp = await postJson(qcValidatePath(), {
      project_id: projectId,
      backtest_id: backtestId,
      auracle_job_id: Number(selected),
    });
    if (resp.status === 200) {
      const parsed = readValidationReport(resp.body);
      if (parsed) {
        setReport(parsed);
        setPhase('done');
        return;
      }
    }
    const body = (resp.body ?? {}) as { error?: string; connected?: boolean };
    setMessage(
      body.connected === false
        ? 'Connect QuantConnect in Settings to validate.'
        : typeof body.error === 'string'
          ? body.error
          : `Validation failed (${resp.status || 'engine unreachable'}).`
    );
    setPhase('error');
  };

  if (runs === null) {
    return (
      <InlineNote kind="muted" testId="qc-validate-loading">
        Looking for a local run to compare…
      </InlineNote>
    );
  }

  if (runs.length === 0) {
    return (
      <InlineNote kind="muted" testId="qc-validate-needs-run">
        Run the imported strategy locally, then come back to compare its results
        against the QuantConnect original.
      </InlineNote>
    );
  }

  if (phase === 'done' && report) {
    return (
      <div data-testid="qc-validate" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <QcValidationReport report={report} />
        <div>
          <Button
            variant="quiet"
            testId="qc-validate-reset"
            onClick={() => {
              setReport(null);
              setPhase('idle');
            }}
          >
            Compare another run
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="qc-validate" className="flex flex-col gap-2">
      <span style={{ fontSize: 11, color: tone.text3 }}>
        Compare a local run of this import against the QuantConnect original.
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Select
          ariaLabel="Local run to compare"
          placeholder="Pick a local run…"
          minWidth={240}
          value={selected}
          onChange={setSelected}
          options={runs.map((r) => ({ value: String(r.jobId), label: runLabel(r) }))}
        />
        <Button
          variant="ghost"
          busy={phase === 'validating'}
          disabled={!selected}
          testId="qc-validate-btn"
          onClick={validate}
        >
          Validate translation
        </Button>
      </div>
      {phase === 'error' && (
        <InlineNote kind="err" testId="qc-validate-error">
          {message}
        </InlineNote>
      )}
    </div>
  );
}
