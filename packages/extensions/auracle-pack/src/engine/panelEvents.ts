/**
 * Pack-side proactive event bus.
 *
 * Panels emit a typed {@link PanelEvent} at the three v1 points — a backtest a
 * user started finished, a deployment entered a failed state, a validation
 * pass completed — through the host's `PanelAIContext.notifyChange`, wrapped in
 * a versioned {@link PanelChangeEnvelope}. Emission is deliberately cheap and
 * UNCONDITIONAL: the pack never decides whether the agent should react. Every
 * policy decision (opt-in, debounce, dedup, backoff, the paid gate, and the
 * no-session fallback) lives host-side, where it cannot be bypassed. A pack
 * that emits into an older host, or a panel with no AI sink, is a silent no-op.
 *
 * The envelope carries a schema version so a later `v2` can add events without
 * touching this contract or the host routing.
 */
import type { PanelChangeEnvelope } from '@nimbalyst/extension-sdk';
import { railHeadline, type ValidationVerdict } from './validation';

/** Envelope schema version emitted today. Bumped only if the envelope SHAPE
 *  changes, never for a new event `type`. */
export const PANEL_EVENT_ENVELOPE_VERSION = 1;

export type BacktestOutcome = 'succeeded' | 'failed';

/** A run the user started completed — success or failure. */
export interface BacktestFinishedEvent {
  type: 'backtest.finished';
  /** Run identity: the engine job id when known, else the strategy id. */
  subject: string;
  payload: {
    /** The strategy the run was for (class or dotted id), when known. */
    strategy: string | null;
    outcome: BacktestOutcome;
    /** Headline engine stats on success (total_return, sharpe, …). Omitted on
     *  failure or when the engine served no chartable result. */
    stats?: Record<string, number | null>;
    /** The engine's failure detail, on failure. */
    detail?: string | null;
  };
}

/** A deployment entered a failed/errored state. */
export interface DeployFailedEvent {
  type: 'deploy.failed';
  /** The deployment id. */
  subject: string;
  payload: {
    strategy: string | null;
    /** The lifecycle state it landed in (e.g. `errored`). */
    state: string;
  };
}

/** A validation pass finished. */
export interface ValidationCompletedEvent {
  type: 'validation.completed';
  /** The strategy id the pass ran on. */
  subject: string;
  payload: {
    strategy: string;
    /** One-line overall verdict, engine-worded. */
    verdict: string;
    /** Names of the signals that came back red (need attention). */
    redSignals: string[];
  };
}

export type PanelEvent =
  | BacktestFinishedEvent
  | DeployFailedEvent
  | ValidationCompletedEvent;

/** Wrap a typed event in the versioned envelope the host routes. */
export function toEnvelope(event: PanelEvent): PanelChangeEnvelope {
  return {
    v: PANEL_EVENT_ENVELOPE_VERSION,
    type: event.type,
    subject: event.subject,
    payload: event.payload,
  };
}

/* ── builders (pure, so emit points stay thin and the shaping is tested) ──── */

export function backtestFinishedEvent(args: {
  subject: string;
  strategy: string | null;
  outcome: BacktestOutcome;
  stats?: Record<string, number | null>;
  detail?: string | null;
}): BacktestFinishedEvent {
  return {
    type: 'backtest.finished',
    subject: args.subject,
    payload: {
      strategy: args.strategy,
      outcome: args.outcome,
      ...(args.outcome === 'succeeded' && args.stats ? { stats: args.stats } : {}),
      ...(args.outcome === 'failed' && args.detail ? { detail: args.detail } : {}),
    },
  };
}

export function deployFailedEvent(args: {
  subject: string;
  strategy: string | null;
  state: string;
}): DeployFailedEvent {
  return {
    type: 'deploy.failed',
    subject: args.subject,
    payload: { strategy: args.strategy, state: args.state },
  };
}

export function validationCompletedEvent(verdict: ValidationVerdict): ValidationCompletedEvent {
  return {
    type: 'validation.completed',
    subject: verdict.strategy_path,
    payload: {
      strategy: verdict.strategy_path,
      verdict: verdict.plain || railHeadline(verdict.signals),
      redSignals: verdict.signals.filter((s) => s.tier === 'red').map((s) => s.name),
    },
  };
}

/* ── emission ──────────────────────────────────────────────────────────────
 * The sink is the slice of `host.ai` the emitter touches. `notifyChange` is
 * optional so an older host (before this lane) or a non-`aiSupported` panel is
 * an honest no-op rather than a crash. */
export interface PanelEventSink {
  notifyChange?(event: string, data?: unknown): void;
}

/**
 * Emit `event` through `sink`. No-op when the host predates `notifyChange` or
 * the panel has no AI sink. Never throws into a panel render or a store
 * transition — a failed emit is swallowed; the host owns delivery.
 */
export function emitPanelEvent(sink: PanelEventSink | undefined | null, event: PanelEvent): void {
  const notify = sink?.notifyChange;
  if (typeof notify !== 'function') return;
  try {
    notify.call(sink, event.type, toEnvelope(event));
  } catch {
    // Emission is best-effort; a throwing host must not break the panel.
  }
}

/* ── captured sink for module stores (no host ref) ───────────────────────────
 * The domain stores (backtestStore) are module singletons with no host handle,
 * exactly like the focus→ambient bridge. Every `aiSupported` pack panel
 * registers its AI sink on mount (via `useAiPanelContext`), so a store can emit
 * through the most-recently-seen sink. Mirrors focusStore's `ensureFocusAmbient`
 * single-sink model. */
let capturedSink: PanelEventSink | null = null;

/** Capture a host AI sink so module-level stores can emit through it. Called
 *  by every aiSupported panel; last non-empty sink wins. */
export function registerPanelEventSink(sink: PanelEventSink | undefined | null): void {
  if (sink && typeof sink.notifyChange === 'function') capturedSink = sink;
}

/** Emit through the captured sink — the store-side entry point. */
export function emitCapturedPanelEvent(event: PanelEvent): void {
  emitPanelEvent(capturedSink, event);
}

/** Test seam: drop the captured sink between cases. */
export function __resetPanelEventSinkForTests(): void {
  capturedSink = null;
}
