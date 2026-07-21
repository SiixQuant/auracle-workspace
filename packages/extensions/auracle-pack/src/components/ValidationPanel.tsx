/**
 * Validation panel — the seven overfit signals for a strategy, rendered on
 * panelkit. Pick one of your own strategies and check it: the engine runs
 * the compute-don't-trust machinery (real backtest + walk-forward) and
 * returns a tri-state rail (green / red / unknown) with a plain-English
 * reading and the fix each red signal usually needs.
 *
 * This is NOT the deploy preflight (that's broker + data readiness) — it's
 * the overfit rail, the honest answer to "will this hold up out of sample?"
 * Everything is engine-computed; the panel renders the verdict verbatim.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getJsonDetailed } from '../engine/client';
import { classifyLoadFailure, type LoadFailure } from '../engine/research';
import {
  ValidationVerdict,
  normalizeVerdict,
  railHeadline,
  validationContext,
  validationPrompt,
} from '../engine/validation';
import {
  Button,
  CenterState,
  InlineNote,
  MeasureGauge,
  MeasureRow,
  PanelShell,
  Select,
  SkeletonRows,
  ToolbarSpring,
  numeric,
  tint,
  tone,
} from './panelkit';
import { PanelHostLike, useAiPanelContext, handOffToAgent, type AgentNote } from './aiPanel';
import { focusStore } from '../engine/focusStore';
import { emitPanelEvent, validationCompletedEvent } from '../engine/panelEvents';
import { strategySourceFromDotted } from '../engine/spineNav';
import { qty } from '../engine/format';

interface DeployableStrategy {
  path: string;
  label: string;
}

type ListState =
  | { phase: 'loading' }
  | { phase: 'failed'; why: LoadFailure }
  | { phase: 'ready'; strategies: DeployableStrategy[] };

type RunState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'failed'; why: LoadFailure }
  | { phase: 'error'; detail: string }
  | { phase: 'done'; verdict: ValidationVerdict };

const TIER_COLOR: Record<string, string> = {
  green: tone.ok,
  red: tone.danger,
  unknown: tone.text3,
};

const TIER_MARK: Record<string, string> = {
  green: '●',
  red: '●',
  unknown: '○',
};

/** Compact numeric read for a signal: `1,204` for counts, `0.41` for ratios. */
function fmtSig(v: number): string {
  return Math.abs(v) >= 100 ? qty(v) : v.toFixed(2);
}

/**
 * The signal's measured value against its threshold — a bullet gauge. The
 * engine computes both numbers but the panel used to drop them; showing
 * them turns "attention" into "0.41 vs a 0.20 line". Renders on the shared
 * panelkit gauge; this adapter only supplies the tier's mark colour and the
 * count/ratio number format.
 */
function SignalGauge({ tier, value, threshold }: { tier: string; value: number; threshold: number }) {
  return <MeasureGauge markColor={TIER_COLOR[tier] ?? tone.text3} value={value} threshold={threshold} format={fmtSig} />;
}

function SignalRow({
  name,
  tier,
  plain,
  fix,
  value,
  threshold,
}: {
  name: string;
  tier: string;
  plain: string;
  fix: string;
  value: number | null;
  threshold: number | null;
}) {
  const color = TIER_COLOR[tier] ?? tone.text3;
  return (
    <MeasureRow
      markGlyph={TIER_MARK[tier] ?? '○'}
      markColor={color}
      title={name}
      detail={plain || undefined}
      footnote={tier === 'red' && fix ? `Usually fixed by: ${fix}` : undefined}
      statusLabel={tier === 'unknown' ? 'not checked' : tier === 'red' ? 'attention' : 'healthy'}
      statusColor={color}
    >
      {typeof value === 'number' && typeof threshold === 'number' ? (
        <SignalGauge tier={tier} value={value} threshold={threshold} />
      ) : null}
    </MeasureRow>
  );
}

/**
 * The overall read of the rail — one verdict word in the worst tier's colour,
 * a plain detail, and the healthy / attention / not-checked tally. Tinted by
 * severity so the answer to "will this hold up?" lands before the rows do.
 */
function VerdictHero({ signals }: { signals: ValidationVerdict['signals'] }): JSX.Element {
  const green = signals.filter((s) => s.tier === 'green').length;
  const red = signals.filter((s) => s.tier === 'red').length;
  const unknown = signals.filter((s) => s.tier === 'unknown').length;
  const worst = red > 0 ? tone.danger : unknown > 0 ? tone.caution : tone.ok;
  const verdict = red > 0 ? 'Overfit risk' : unknown > 0 ? 'Mostly holds up' : 'Holds up out of sample';
  const detail =
    red > 0
      ? `${red} signal${red === 1 ? '' : 's'} flagged — review the rows below.`
      : unknown > 0
        ? `${unknown} check${unknown === 1 ? '' : 's'} couldn't run on this history.`
        : 'Every overfit check passes on the out-of-sample window.';

  const tally = (n: number, label: string, color: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 44 }}>
      <span style={{ fontSize: 20, fontWeight: 650, color, ...numeric }}>{n}</span>
      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: tone.text3 }}>
        {label}
      </span>
    </div>
  );

  return (
    <div
      className="apk-enter"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        flexWrap: 'wrap',
        padding: '16px 20px',
        borderRadius: 11,
        border: `1px solid ${tint(worst, 38)}`,
        background: tint(worst, 9),
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 220 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 650, color: worst }}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: worst }} />
          {verdict}
        </span>
        <span style={{ fontSize: 12.5, color: tone.text2 }}>{detail}</span>
      </div>
      <div style={{ display: 'flex', gap: 20 }}>
        {tally(green, 'Healthy', tone.ok)}
        {tally(red, 'Attention', red > 0 ? tone.danger : tone.text3)}
        {tally(unknown, 'Not checked', unknown > 0 ? tone.caution : tone.text3)}
      </div>
    </div>
  );
}

export function ValidationPanel({ host }: { host?: PanelHostLike }): JSX.Element {
  const [list, setList] = useState<ListState>({ phase: 'loading' });
  const [selected, setSelected] = useState('');
  const [run, setRun] = useState<RunState>({ phase: 'idle' });
  const [note, setNote] = useState<AgentNote>(null);

  // Publish the active verdict to the AI chat (ambient) while a check is shown.
  useAiPanelContext(host, run.phase === 'done' ? validationContext(run.verdict) : null);

  const askAgent = async (verdict: ValidationVerdict) => {
    const cls = verdict.strategy_path.split('.').pop() ?? verdict.strategy_path;
    setNote(await handOffToAgent(host, validationPrompt(verdict), `Validate: ${cls}`));
  };

  // Open the validated strategy's source file. Validation reports the id as
  // `module.Class`, so the transform strips the class before mapping to the
  // workspace file; a desk-grafted or non-workspace strategy has no editable
  // file here, so the button degrades to disabled-with-reason rather than
  // opening a path the editor can't resolve.
  const openSource = (verdict: ValidationVerdict) => {
    const src = strategySourceFromDotted(verdict.strategy_path, { hasClassSuffix: true });
    if (!src || !src.openable) return;
    focusStore.publish({ strategy: { filePath: src.path, dottedPath: verdict.strategy_path } });
    host?.openFile?.(src.path);
  };

  const loadStrategies = useCallback(async () => {
    const result = await getJsonDetailed<{ strategies?: Array<Record<string, unknown>> }>(
      '/ui/api/backtest/strategies?deployable=1'
    );
    if (!result.ok) {
      setList({ phase: 'failed', why: classifyLoadFailure(result.status) });
      return;
    }
    const rows = Array.isArray(result.body.strategies) ? result.body.strategies : [];
    const strategies: DeployableStrategy[] = rows
      .map((s) => {
        const path = typeof s.path === 'string' ? s.path : '';
        const doc = typeof s.doc === 'string' ? s.doc : '';
        // Show the class name + first docstring line, not the full dotted path.
        const cls = path.split('.').pop() ?? path;
        return { path, label: doc ? `${cls} — ${doc}` : cls };
      })
      .filter((s) => s.path.length > 0);
    setList({ phase: 'ready', strategies });
  }, []);

  useEffect(() => {
    void loadStrategies();
  }, [loadStrategies]);

  const check = async (path: string) => {
    setRun({ phase: 'running' });
    const result = await getJsonDetailed<Record<string, unknown>>(
      `/ui/api/validation?strategy_path=${encodeURIComponent(path)}`
    );
    if (!result.ok) {
      // 422 carries the engine's "could not measure" detail; other statuses
      // are outdated/unreachable transport failures. Read {detail} off the same
      // response (getJsonDetailed keeps the body on failure) — no re-fetch.
      if (result.status === 422) {
        const detail = (result.body as { detail?: string } | null)?.detail;
        setRun({
          phase: 'error',
          detail: detail ?? 'The engine could not measure this strategy.',
        });
        return;
      }
      setRun({ phase: 'failed', why: classifyLoadFailure(result.status) });
      return;
    }
    const verdict = normalizeVerdict(result.body);
    setRun({ phase: 'done', verdict });
    emitPanelEvent(host?.ai, validationCompletedEvent(verdict));
  };

  const onPick = (path: string) => {
    setSelected(path);
    if (path) {
      // Publish focus first; the verdict's own richer context follows.
      focusStore.publish({ run: { kind: 'validation', id: path } });
      void check(path);
    } else setRun({ phase: 'idle' });
  };

  // Follow on open: when the Spine points at a validation target this panel can
  // offer, pre-select it (without auto-running) so opening lands on the focused
  // strategy. Fires once, when the list first loads — a later manual change is
  // the user's, not ours to override. Only acts when focus is set, so an empty
  // focus is unchanged from today.
  const followed = useRef(false);
  useEffect(() => {
    if (followed.current || list.phase !== 'ready') return;
    followed.current = true;
    const focus = focusStore.getSnapshot();
    const target = focus.run?.kind === 'validation' ? focus.run.id : focus.strategy?.dottedPath;
    if (target && list.strategies.some((s) => s.path === target)) setSelected(target);
  }, [list]);

  const picker =
    list.phase === 'ready' && list.strategies.length > 0 ? (
      <Select
        ariaLabel="Strategy to check"
        placeholder="Pick a strategy to check…"
        minWidth={300}
        value={selected}
        onChange={onPick}
        options={list.strategies.map((s) => ({ value: s.path, label: s.label }))}
      />
    ) : null;

  return (
    <PanelShell
      title="Validation"
      description="Check a strategy for overfitting before you trust it. The engine runs a real backtest and walk-forward, then reports the seven signals — this is the out-of-sample honesty check, not the deploy preflight."
      toolbar={
        <>
          {picker}
          {selected && run.phase !== 'running' ? (
            <Button variant="ghost" onClick={() => void check(selected)}>
              Re-check
            </Button>
          ) : null}
          <ToolbarSpring />
        </>
      }
    >
      {list.phase === 'loading' ? (
        <SkeletonRows rows={3} />
      ) : list.phase === 'failed' && list.why === 'outdated' ? (
        <CenterState
          title="Engine update required"
          detail="This engine build predates the validation surface. Update the Auracle stack from the launcher, then re-check."
          actions={
            <Button variant="ghost" onClick={() => void loadStrategies()}>
              Re-check
            </Button>
          }
        />
      ) : list.phase === 'failed' ? (
        <CenterState
          title="The engine didn't respond"
          detail="Validation runs on your local Auracle engine. Make sure the stack is running, then retry."
          actions={
            <Button variant="primary" onClick={() => void loadStrategies()}>
              Retry
            </Button>
          }
        />
      ) : list.strategies.length === 0 ? (
        <CenterState
          title="No strategies to validate"
          detail="Create or import a strategy first — anything in your Auracle workspace shows up here to check for overfitting."
        />
      ) : run.phase === 'idle' ? (
        <CenterState
          title="Pick a strategy to check"
          detail="Validation measures a strategy out of sample and returns the seven overfit signals. Choose one above to run the check."
        />
      ) : run.phase === 'running' ? (
        <SkeletonRows rows={4} />
      ) : run.phase === 'error' ? (
        <CenterState
          title="Couldn't measure this strategy"
          detail={run.detail}
          actions={
            <Button variant="ghost" onClick={() => void check(selected)}>
              Try again
            </Button>
          }
        />
      ) : run.phase === 'failed' ? (
        <CenterState
          title="The engine didn't respond"
          detail="The validation run didn't complete. Make sure the stack is running, then re-check."
          actions={
            <Button variant="primary" onClick={() => void check(selected)}>
              Retry
            </Button>
          }
        />
      ) : (
        <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <VerdictHero signals={run.verdict.signals} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: tone.text3 }}>{railHeadline(run.verdict.signals)}</span>
            <ToolbarSpring />
            {(() => {
              const src = strategySourceFromDotted(run.verdict.strategy_path, { hasClassSuffix: true });
              if (!src) return null;
              return (
                <Button
                  variant="ghost"
                  testId="validation-open-source"
                  disabled={!src.openable}
                  title={src.openable ? `Open ${src.path}` : src.reason}
                  onClick={() => openSource(run.verdict)}
                >
                  Open source
                </Button>
              );
            })()}
            <Button variant="primary" onClick={() => void askAgent(run.verdict)}>
              ⚡ Ask the agent
            </Button>
          </div>
          {note ? <InlineNote kind={note.kind}>{note.text}</InlineNote> : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {run.verdict.signals.map((signal) => (
              <SignalRow
                key={signal.signal}
                name={signal.name}
                tier={signal.tier}
                plain={signal.plain}
                fix={signal.what_usually_fixes_it}
                value={signal.value}
                threshold={signal.threshold}
              />
            ))}
          </div>
        </div>
      )}
    </PanelShell>
  );
}
