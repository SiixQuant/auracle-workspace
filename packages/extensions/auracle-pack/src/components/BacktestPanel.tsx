/**
 * BacktestPanel — the slide-out (placement:'bottom') results surface for the
 * editor "Run" action. It renders whatever the shared backtestStore holds:
 * resolving the open file to a strategy, the backtest run lifecycle, and the
 * folded-in overfit Validation (the seven signals).
 *
 * A finished run follows the house tearsheet's information order: sample
 * honesty first, then the headline six, then proof over time, then drawdown
 * truth. Validate is the panel's ONE primary verb (panelkit's contract) and
 * lives inside the sample strip, answering the claim the strip makes;
 * everything else sits in the overflow. When the engine returns no chartable
 * series — an older build, or a function/signal strategy — the panel says so
 * plainly instead of inventing numbers.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { backtestStore, type BacktestResultData } from '../engine/backtestStore';
import { backtestContext, backtestPrompt } from '../engine/backtest';
import { markBacktestPanelMounted, markBacktestPanelUnmounted } from './panelVisibility';
import { railHeadline, type ValidationSignal } from '../engine/validation';
import { detailCards, headlineCards, houseFootnote, tailFacts } from '../engine/houseStats';
import {
  Button,
  CenterState,
  InlineNote,
  MetricGrid,
  numeric,
  OverflowMenu,
  PanelShell,
  SampleStrip,
  SectionTitle,
  SkeletonRows,
  tone,
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
      {/* The measured number and the line it was judged against. The engine
          sends both (validation.ts:41-42) and the panel used to show neither,
          so a signal read "attention" with no evidence. Rendered plainly, not
          as a meter: the payload carries no unit and no direction, so any
          scale drawn here would be invented. */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
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
        {signal.value !== null && signal.threshold !== null ? (
          <span style={{ fontSize: 11, color: tone.text3, whiteSpace: 'nowrap', ...numeric }}>
            {signal.value.toFixed(2)} vs {signal.threshold.toFixed(2)}
          </span>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The chartable result of a completed run: the equity curve (growth of $1),
 * the headline stats, and the drawdown. Every figure is an engine value — the
 * panel renders this only when the engine returned a real series.
 */
const BASE = 10_000;

/** $10,000 → "$740.4K" / "$1.85M" — the axis and the end-value read alike. */
function money(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function BacktestResultView({ result }: { result: BacktestResultData }): JSX.Element {
  const s = result.stats;
  const labels = result.labels;
  // The house charts growth of $10,000, not of $1 — the engine's curve is a
  // cumulative-return index, so it scales at the call site.
  const grown = result.equity.map((v) => v * BASE);
  const ended = grown.length ? grown[grown.length - 1] : null;
  const multiple = result.equity.length ? result.equity[result.equity.length - 1] : null;
  const window = labels.length ? `${labels[0]} to ${labels[labels.length - 1]}` : 'window unknown';
  const maxDd = typeof s.max_drawdown === 'number' ? s.max_drawdown : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <MetricGrid items={headlineCards(s, result.nBars)} columns={6} />

      <EquityChartShad
        points={grown}
        labels={labels}
        caps
        scale="log"
        showYAxis
        title="Growth of $10,000 (log scale)"
        description={`In-Sample · ${window} · ${result.nBars} bars`}
        height={190}
        format={money}
        // The end-value line below already states the outcome; the stock
        // "Trending up N%" banner would repeat it in a second unit.
        trend={false}
        footerNote={
          ended !== null && multiple !== null
            ? `Ended at ${money(ended)} · ${multiple.toFixed(1)}x · In-Sample`
            : undefined
        }
      />

      <EquityChartShad
        points={result.drawdown}
        labels={labels}
        caps
        showYAxis
        variant="drawdown"
        title="Drawdown"
        description={tailFacts(s)}
        footer={false}
        height={110}
        format={(v) => `${v.toFixed(1)}%`}
        // Round toward zero, not away from it: toFixed(0) on -0.4 prints
        // "-0%", which reads as a signed zero and duplicates the 0 tick.
        yTickFormat={(v) => (v > -0.5 ? '0%' : `${v.toFixed(0)}%`)}
        // stats.max_drawdown is a FRACTION (-0.30); drawdown points are
        // PERCENT (the engine multiplies by 100). Without this the marker
        // lands at -0.3 on an axis running to -30, flush against zero.
        refLine={
          maxDd !== null
            ? { y: maxDd * 100, label: `Max ${(maxDd * 100).toFixed(1)}%` }
            : undefined
        }
      />

      <SectionTitle>Risk and return detail</SectionTitle>
      <MetricGrid items={detailCards(s, result.trades)} columns={4} />

      <span style={{ fontSize: 10.5, lineHeight: 1.5, color: tone.text3 }}>
        {houseFootnote(s, result.nBars, result.asOf)}
      </span>
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

  // The job id rides the subtitle: traceable back to the engine's own record,
  // without spending a row of the panel on a line that says "complete".
  const description =
    snap.cls && (snap.phase === 'running' || snap.phase === 'queued' || snap.phase === 'succeeded' || snap.phase === 'failed')
      ? `${snap.cls} — from ${snap.file?.split(/[\\/]/).pop() ?? 'this file'}${
          snap.phase === 'succeeded' && snap.jobId ? ` · job ${snap.jobId}` : ''
        }`
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
          {/* House rule: lead with what kind of evidence this is, not with the
              number it produced. A backtest job has no out-of-sample start, so
              "100% In-Sample" is a structural fact, not a computed one — which
              is why the strip is a constant and the one verb answers it. */}
          <SampleStrip
            headline="100% In-Sample — no out-of-sample record to date"
            takeaway={
              snap.validation.phase === 'done' && snap.validation.verdict
                ? railHeadline(snap.validation.verdict.signals)
                : snap.validation.phase === 'running'
                  ? 'Checking for overfit…'
                  : 'Not yet checked for overfit.'
            }
            actions={
              <>
                <Button
                  variant="primary"
                  busy={snap.validation.phase === 'running'}
                  onClick={() => void backtestStore.validate()}
                >
                  {snap.validation.phase === 'done' ? 'Re-check overfit' : 'Validate'}
                </Button>
                <OverflowMenu items={[{ label: 'Ask the agent', onClick: () => void askAgent() }]} />
              </>
            }
          />

          {snap.result ? (
            <BacktestResultView result={snap.result} />
          ) : (
            <InlineNote kind="ok">
              Backtest complete. The run is recorded in the engine, which returned no chartable
              series for it.
            </InlineNote>
          )}
          {note ? <InlineNote kind={note.kind}>{note.text}</InlineNote> : null}

          {snap.validation.phase === 'idle' ? null : snap.validation.phase === 'running' ? (
            <SkeletonRows rows={3} />
          ) : snap.validation.phase === 'error' ? (
            <InlineNote kind="err">{snap.validation.detail ?? 'The engine could not measure this strategy.'}</InlineNote>
          ) : snap.validation.phase === 'failed' ? (
            <InlineNote kind="muted">The validation run didn't complete — make sure the stack is running.</InlineNote>
          ) : snap.validation.verdict ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* The strip above already carries railHeadline as the takeaway,
                  so this section states the verdict once and then shows the
                  evidence for it. */}
              <SectionTitle>Overfit validation</SectionTitle>
              {snap.validation.verdict.signals.some((s) => s.tier === 'red') ? (
                <InlineNote kind="err">Overfit risk — see the flagged signals.</InlineNote>
              ) : snap.validation.verdict.signals.some((s) => s.tier === 'unknown') ? (
                <InlineNote kind="muted">Some checks couldn't run on this history.</InlineNote>
              ) : (
                <InlineNote kind="ok">Passes the overfit checks.</InlineNote>
              )}
              {/* A clean run doesn't spend the panel congratulating itself:
                  only what needs attention gets a full row. */}
              {snap.validation.verdict.signals
                .filter((signal) => signal.tier !== 'green')
                .map((signal) => (
                  <SignalLine key={signal.signal} signal={signal} />
                ))}
              {snap.validation.verdict.signals.some((s) => s.tier === 'green') ? (
                <span style={{ fontSize: 11.5, color: tone.text3 }}>
                  {snap.validation.verdict.signals.filter((s) => s.tier === 'green').length} of{' '}
                  {snap.validation.verdict.signals.length} signals healthy:{' '}
                  {snap.validation.verdict.signals
                    .filter((s) => s.tier === 'green')
                    .map((s) => s.name)
                    .join(', ')}
                  .
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </PanelShell>
  );
}
