/**
 * BacktestPanel — the slide-out (placement:'bottom') results surface for the
 * editor "Run" action. It renders whatever the shared backtestStore holds:
 * resolving the open file to a strategy, the backtest run lifecycle, and the
 * folded-in overfit Validation (the seven signals). The engine exposes no JSON
 * for a backtest's headline stats, so a completed run confirms + hands off to
 * the full engine results and the Validate check rather than inventing numbers.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { backtestStore, type BacktestResultData } from '../engine/backtestStore';
import { backtestContext, backtestPrompt } from '../engine/backtest';
import { markBacktestPanelMounted, markBacktestPanelUnmounted } from './panelVisibility';
import { railHeadline, type ValidationSignal } from '../engine/validation';
import { percent } from '../engine/format';
import {
  Button,
  CenterState,
  InlineNote,
  PanelShell,
  SkeletonRows,
  StatBand,
  ToolbarSpring,
  tone,
  trendColor,
} from './panelkit';
import { EquityChartShad } from './charts/EquityChartShad';
import { PanelHostLike, useAiPanelContext, handOffToAgent, type AgentNote } from './aiPanel';

const TIER_COLOR: Record<string, string> = { green: tone.ok, red: tone.danger, unknown: tone.text3 };

function SignalLine({ signal }: { signal: ValidationSignal }) {
  return (
    <article
      className="apk-card"
      style={{
        display: 'flex',
        gap: 10,
        padding: '9px 12px',
        borderRadius: 8,
        border: `1px solid ${tone.border}`,
        background: tone.surface,
      }}
    >
      <span aria-hidden style={{ color: TIER_COLOR[signal.tier] ?? tone.text3, fontSize: 11, lineHeight: '18px' }}>
        {signal.tier === 'unknown' ? '○' : '●'}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: tone.text }}>{signal.name}</span>
        {signal.plain ? <span style={{ fontSize: 12, color: tone.text2 }}>{signal.plain}</span> : null}
        {signal.tier === 'red' && signal.what_usually_fixes_it ? (
          <span style={{ fontSize: 11.5, color: tone.text3 }}>Usually fixed by: {signal.what_usually_fixes_it}</span>
        ) : null}
      </div>
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: TIER_COLOR[signal.tier] ?? tone.text3,
          whiteSpace: 'nowrap',
        }}
      >
        {signal.tier === 'unknown' ? 'not checked' : signal.tier === 'red' ? 'attention' : 'healthy'}
      </span>
    </article>
  );
}

/**
 * The chartable result of a completed run: the equity curve (growth of $1),
 * the headline stats, and the drawdown. Every figure is an engine value — the
 * panel renders this only when the engine returned a real series.
 */
export function BacktestResultView({ result }: { result: BacktestResultData }): JSX.Element {
  const s = result.stats;
  const asPct = (v: number | null | undefined) => (typeof v === 'number' ? percent(v * 100) : '—');
  const asNum = (v: number | null | undefined, digits = 2) =>
    typeof v === 'number' ? v.toFixed(digits) : '—';
  const totalReturn = s.total_return;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <EquityChartShad
        points={result.equity}
        title="Equity curve"
        description="Growth of $1 over the backtest"
        format={(v) => `$${v.toFixed(2)}`}
      />
      <StatBand
        items={[
          {
            label: 'Total return',
            value: asPct(totalReturn),
            valueColor: trendColor(typeof totalReturn === 'number' ? totalReturn : 0),
          },
          { label: 'CAGR', value: asPct(s.annualized_return ?? s.cagr) },
          { label: 'Sharpe', value: asNum(s.sharpe) },
          { label: 'Max drawdown', value: asPct(s.max_drawdown) },
          { label: 'Trades', value: result.trades },
        ]}
      />
      <EquityChartShad
        points={result.drawdown}
        variant="drawdown"
        title="Drawdown"
        description="Peak-to-trough decline"
        footer={false}
        height={110}
        format={(v) => `${v.toFixed(1)}%`}
      />
    </div>
  );
}

export function BacktestPanel({ host }: { host?: PanelHostLike }): JSX.Element {
  const snap = useSyncExternalStore(backtestStore.subscribe, backtestStore.getSnapshot);
  const [note, setNote] = useState<AgentNote>(null);

  // The host only exposes a toggle event to open panels; report our mount state
  // so the Run header can avoid toggling an already-open panel shut on a re-run.
  useEffect(() => {
    markBacktestPanelMounted();
    return markBacktestPanelUnmounted;
  }, []);

  const run = snap.strategyPath && snap.cls && snap.jobId
    ? { strategyPath: snap.strategyPath, cls: snap.cls, jobId: snap.jobId }
    : null;
  useAiPanelContext(host, snap.phase === 'succeeded' && run ? backtestContext(run) : null);

  const askAgent = useCallback(async () => {
    if (!run) return;
    setNote(await handOffToAgent(host, backtestPrompt(run), `Backtest: ${run.cls}`));
  }, [host, run]);

  const retryFromFile = () => {
    if (snap.file) void backtestStore.run(snap.file);
  };

  const description =
    snap.cls && (snap.phase === 'running' || snap.phase === 'queued' || snap.phase === 'succeeded' || snap.phase === 'failed')
      ? `${snap.cls} — from ${snap.file?.split(/[\\/]/).pop() ?? 'this file'}`
      : 'Run the strategy in the open file and check it for overfitting.';

  return (
    <PanelShell title="Backtest" description={description}>
      {snap.phase === 'idle' ? (
        <CenterState
          title="Open a strategy and press Run"
          detail="Use the Run button above a .py strategy file. Its backtest and overfit check show up here."
        />
      ) : snap.phase === 'resolving' ? (
        <SkeletonRows rows={3} />
      ) : snap.phase === 'engine-down' ? (
        <CenterState
          title={snap.outdated ? 'Engine update required' : "The engine didn't respond"}
          detail={snap.detail ?? undefined}
          actions={
            <Button variant={snap.outdated ? 'ghost' : 'primary'} onClick={retryFromFile}>
              {snap.outdated ? 'Re-check' : 'Retry'}
            </Button>
          }
        />
      ) : snap.phase === 'unmatched' ? (
        <CenterState
          title="Not a recognized strategy"
          detail="This file doesn't match a strategy the engine discovered. A backtestable strategy is a Strategy subclass or a backtest_* function in your Auracle workspace."
        />
      ) : snap.phase === 'ambiguous' ? (
        <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12.5, color: tone.text2 }}>
            This file defines more than one strategy — pick which to backtest:
          </span>
          {snap.options.map((opt) => (
            <Button key={opt.path} variant="ghost" onClick={() => void backtestStore.choose(opt)}>
              {opt.label}
            </Button>
          ))}
        </div>
      ) : snap.phase === 'queued' || snap.phase === 'running' ? (
        <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '12px 14px',
              borderRadius: 10,
              border: `1px solid ${tone.border}`,
              background: tone.surface,
            }}
          >
            <span
              aria-hidden
              className="apk-pulse"
              style={{ width: 9, height: 9, borderRadius: '50%', background: tone.accent, flex: 'none' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: tone.text }}>
                {snap.phase === 'queued' ? 'Queuing the backtest…' : `Backtesting ${snap.cls ?? 'strategy'}…`}
              </span>
              <span style={{ fontSize: 12, color: tone.text3 }}>
                Running the vectorized backtest on your local engine — the equity curve and stats appear here when it finishes.
              </span>
            </div>
          </div>
          <SkeletonRows rows={3} />
        </div>
      ) : snap.phase === 'failed' ? (
        <CenterState
          title="The backtest didn't complete"
          detail={snap.detail ?? undefined}
          actions={
            <Button variant="primary" onClick={() => void backtestStore.retry()}>
              Try again
            </Button>
          }
        />
      ) : (
        // succeeded
        <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <InlineNote kind="ok">Backtest complete{snap.jobId ? ` — job ${snap.jobId}` : ''}.</InlineNote>
            <ToolbarSpring />
            {snap.validation.phase !== 'running' ? (
              <Button variant="ghost" onClick={() => void backtestStore.validate()}>
                {snap.validation.phase === 'done' ? 'Re-check overfit' : 'Validate (overfit check)'}
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => void askAgent()}>
              Ask the agent
            </Button>
          </div>
          {note ? <InlineNote kind={note.kind}>{note.text}</InlineNote> : null}

          {snap.result ? <BacktestResultView result={snap.result} /> : null}

          {snap.validation.phase === 'idle' ? (
            <span style={{ fontSize: 12, color: tone.text3 }}>
              {snap.result
                ? 'Validate above for the seven overfit signals, or ask the agent to open the full tearsheet.'
                : 'The run is recorded in the engine. Validate it above for the seven overfit signals, or ask the agent to open and interpret the full tearsheet.'}
            </span>
          ) : snap.validation.phase === 'running' ? (
            <SkeletonRows rows={3} />
          ) : snap.validation.phase === 'error' ? (
            <InlineNote kind="err">{snap.validation.detail ?? 'The engine could not measure this strategy.'}</InlineNote>
          ) : snap.validation.phase === 'failed' ? (
            <InlineNote kind="muted">The validation run didn't complete — make sure the stack is running.</InlineNote>
          ) : snap.validation.verdict ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, color: tone.text2 }}>{railHeadline(snap.validation.verdict.signals)}</span>
                {snap.validation.verdict.signals.some((s) => s.tier === 'red') ? (
                  <InlineNote kind="err">Overfit risk — see the flagged signals.</InlineNote>
                ) : snap.validation.verdict.signals.some((s) => s.tier === 'unknown') ? (
                  <InlineNote kind="muted">Some checks couldn't run on this history.</InlineNote>
                ) : (
                  <InlineNote kind="ok">Passes the overfit checks.</InlineNote>
                )}
              </div>
              {snap.validation.verdict.signals.map((signal) => (
                <SignalLine key={signal.signal} signal={signal} />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </PanelShell>
  );
}
