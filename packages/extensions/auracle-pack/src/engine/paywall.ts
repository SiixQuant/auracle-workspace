/**
 * One place that reads the engine's error responses and decides whether the
 * user hit a PAYWALL (upgrade to unlock), a BLOCKED LICENSE (renew to restore),
 * or an ordinary error. Every mutation surface that could be tier-gated —
 * deploy, connections, the research/agent conveyor — routes its failure through
 * {@link parseEngineError} so the plan context is rendered the same way instead
 * of each panel re-inventing a "rejected (status)" string.
 *
 * The engine wraps an `HTTPException(detail=...)` as `{"detail": {...}}`, and a
 * few routes answer with a top-level `{"ok": false, "error": ...}` JSONResponse
 * instead — this reads both. The structured bodies it recognises are the
 * engine's own, stable shapes:
 *   - tier gate        `{error: "tier_upgrade_required", message, current_tier, required_tier, upgrade_url}`
 *   - agent gateway    `{error: "agent_requires_key_or_upgrade", options, upgrade_url}`
 *   - blocked license  `{error: "license_blocked", message, state, reason}`
 * Anything else degrades to a generic message (a validation `issues` list, a
 * plain `error`/`message` string, or the caller's fallback) — never a paywall
 * card for a defect that upgrading cannot fix.
 */

/** A paywall the user can clear by upgrading their plan. */
export interface PaywallGate {
  kind: 'paywall';
  /** The engine's `error` code, kept so callers can branch if they need to. */
  error: string;
  message: string;
  /** The plan the install is on, when the engine disclosed it. */
  currentTier: string | null;
  /** The plan the feature needs, when the engine disclosed it. */
  requiredTier: string | null;
  /** Where to upgrade, when the engine disclosed it. */
  upgradeUrl: string | null;
}

/** A license that is no longer active — renewing restores service, not upgrading. */
export interface LicenseGate {
  kind: 'license';
  error: string;
  message: string;
  state: string | null;
  reason: string | null;
}

/** An ordinary failure — the caller shows it as text, not as an upgrade card. */
export interface GenericError {
  kind: 'generic';
  message: string;
}

export type EngineError = PaywallGate | LicenseGate | GenericError;

/** The engine's own upgrade destination — used only when a paywall body omits
 *  its own `upgrade_url`, so the gate always offers somewhere to go. */
export const UPGRADE_URL = 'https://auracle-engine.com/#pricing';

/**
 * Build a paywall gate from an ALREADY-KNOWN gated state — e.g. the connections
 * list's `gated_reason`, where the engine reported the block up front rather
 * than on a 402. A pre-gated control then renders the same card a live paywall
 * response would, so the two never drift.
 */
export function paywallFromReason(message: string, currentTier?: string | null): PaywallGate {
  return {
    kind: 'paywall',
    error: 'tier_upgrade_required',
    message,
    currentTier: currentTier ?? null,
    requiredTier: null,
    upgradeUrl: UPGRADE_URL,
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** Peel the `{detail: ...}` HTTPException envelope; a top-level body passes
 *  through untouched. */
function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && 'detail' in body) {
    return (body as { detail: unknown }).detail;
  }
  return body;
}

/**
 * Classify an engine failure. WHICH structured gate it is (paywall vs blocked
 * license) is decided by the body's `error` code, not the 402 status — a blocked
 * license and a tier gate are both 402, and only the code tells them apart. The
 * `status` still guards the structured verdicts to an actual error response
 * (>= 400): a transport failure (status 0, null body) or a success body with a
 * stray `error` field must never masquerade as a paywall.
 */
export function parseEngineError(status: number, body: unknown, fallback: string): EngineError {
  const detail = unwrap(body);

  if (typeof detail === 'string') {
    return { kind: 'generic', message: detail.trim().length > 0 ? detail : fallback };
  }
  if (!detail || typeof detail !== 'object') {
    return { kind: 'generic', message: fallback };
  }

  const d = detail as Record<string, unknown>;
  const error = asString(d.error);
  const errored = status >= 400;

  if (errored && (error === 'tier_upgrade_required' || error === 'agent_requires_key_or_upgrade')) {
    return {
      kind: 'paywall',
      error,
      message:
        asString(d.message) ??
        (error === 'agent_requires_key_or_upgrade'
          ? 'The Auracle Agent needs your own model key, or a paid plan for the included agent.'
          : 'This feature requires a higher plan.'),
      currentTier: asString(d.current_tier),
      requiredTier: asString(d.required_tier),
      upgradeUrl: asString(d.upgrade_url) ?? UPGRADE_URL,
    };
  }

  if (errored && error === 'license_blocked') {
    return {
      kind: 'license',
      error,
      message: asString(d.message) ?? 'This install’s license is no longer active.',
      state: asString(d.state),
      reason: asString(d.reason),
    };
  }

  // A deploy preflight answers `{ok:false, issues:[...]}` — surface the real
  // reasons rather than dropping them for a bare status code.
  if (Array.isArray(d.issues)) {
    const issues = d.issues.filter((i): i is string => typeof i === 'string' && i.length > 0);
    return { kind: 'generic', message: issues.length > 0 ? issues.join(' ') : fallback };
  }

  return { kind: 'generic', message: asString(d.error) ?? asString(d.message) ?? fallback };
}
