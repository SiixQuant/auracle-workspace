/**
 * Shared guard for the panel→AI proactive event envelope.
 *
 * Both ends of the routing use this: the renderer (PanelHostImpl) shape-checks
 * a `notifyChange` payload before spending an IPC hop on it, and the main
 * process re-validates the payload arriving over IPC (untrusted from the
 * renderer's perspective) before the governor sees it. Keeping the check in one
 * place means the two ends can never drift.
 *
 * The envelope shape is the SDK contract (`PanelChangeEnvelope`). This module
 * adds only the runtime validation the type cannot express.
 */
import type { PanelChangeEnvelope } from '@nimbalyst/runtime';

/** The envelope schema version this host understands. */
export const SUPPORTED_PANEL_ENVELOPE_VERSION = 1;

/** The v1 event types the host routes. Anything else is ignored (a v2 pack can
 *  add types without this host reacting to them). */
export const ROUTED_PANEL_EVENT_TYPES = ['backtest.finished', 'deploy.failed', 'validation.completed'] as const;
export type RoutedPanelEventType = (typeof ROUTED_PANEL_EVENT_TYPES)[number];

/**
 * True when `data` is a structurally valid {@link PanelChangeEnvelope} — a
 * finite numeric `v`, and non-empty string `type` and `subject`. Version- and
 * type-agnostic on purpose: routing decisions (is this v1? a type we handle?)
 * are made by the caller so an unknown envelope is dropped, never crashes.
 */
export function isPanelChangeEnvelope(data: unknown): data is PanelChangeEnvelope {
  if (!data || typeof data !== 'object') return false;
  const e = data as Record<string, unknown>;
  return (
    typeof e.v === 'number' &&
    Number.isFinite(e.v) &&
    typeof e.type === 'string' &&
    e.type.length > 0 &&
    typeof e.subject === 'string' &&
    e.subject.length > 0
  );
}

/**
 * True when the envelope is one this host both understands (v1) and routes (a
 * known event type). A well-formed envelope with an unknown `v` or `type` is
 * NOT routable — the caller drops it quietly, honoring the contract's "ignore
 * what you don't understand" rule.
 */
export function isRoutablePanelEvent(
  envelope: PanelChangeEnvelope
): envelope is PanelChangeEnvelope & { type: RoutedPanelEventType } {
  return (
    envelope.v === SUPPORTED_PANEL_ENVELOPE_VERSION &&
    (ROUTED_PANEL_EVENT_TYPES as readonly string[]).includes(envelope.type)
  );
}
