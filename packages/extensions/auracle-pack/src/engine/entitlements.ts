/**
 * Entitlements snapshot — one authoritative read of what the install's plan
 * unlocks. Mirrors the engine's `GET /ui/api/ide/entitlements`: the tier, each
 * quota with how much of it is already used (and the SCOPE that cap is enforced
 * at), whether live trading is actually permitted, and the license runtime
 * state. Panels read this to gate proactively — a "2 of 3 used" nudge before the
 * hard stop — instead of only reacting to a 402.
 *
 * A tiny module store (the pack's `subscribe`/`getSnapshot`/`set` shape, as with
 * `deployStore` / `focusStore`) so any surface can follow the same snapshot;
 * {@link refreshEntitlements} fetches it through the mocked-testable client seam.
 */
import { getJson } from './client';

/** One quota's current standing. `cap === null` means unlimited (paid tiers). */
export interface UsageItem {
  count: number;
  cap: number | null;
  /** Where the cap is enforced — `install` (whole install) or `user` (per account). */
  scope: string;
}

/** The `GET /ui/api/ide/entitlements` payload (the subset the IDE consumes). */
export interface Entitlements {
  /** Engine tier vocabulary: community | pro | institutional | enterprise. */
  tier: string;
  /** Customer-facing tier name from the engine (e.g. "Institutional"). */
  display_tier: string;
  days_remaining: number | null;
  email: string | null;
  runtime_state: string;
  /** The REAL order-path allowance: paid tier AND runtime allows AND the active
   *  broker can trade live — stricter than connect-check's runtime-only field. */
  live_allowed: boolean;
  active_broker: string | null;
  quotas: Record<string, unknown>;
  deploy_caps: Record<string, unknown>;
  usage: {
    enabled_schedules: UsageItem;
    active_live_deployments: UsageItem;
  };
}

let snapshot: Entitlements | null = null;
const listeners = new Set<() => void>();

export const entitlementsStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): Entitlements | null {
    return snapshot;
  },
  set(next: Entitlements | null): void {
    if (snapshot === next) return;
    snapshot = next;
    for (const listener of listeners) listener();
  },
};

/** Fetch the snapshot and publish it to the store. Returns null (leaving any
 *  prior snapshot in place) on an older engine that predates the route, or when
 *  the engine is unreachable — callers degrade to their existing fallbacks. */
export async function refreshEntitlements(): Promise<Entitlements | null> {
  const body = await getJson<Entitlements>('/ui/api/ide/entitlements');
  if (body && typeof body === 'object' && typeof body.tier === 'string') {
    entitlementsStore.set(body);
    return body;
  }
  return null;
}

/* ── tier vocabulary ─────────────────────────────────────────────────── */

/**
 * Engine-aligned display name for a tier. The engine ranks
 * community < pro == institutional < enterprise and maps the back-compat "pro"
 * alias to "Institutional"; this mirrors that map so a tier rendered in the IDE
 * reads the same word the engine and CLI use. There is no "team" tier — a value
 * the engine doesn't know falls back to a title-cased echo, never a paid label.
 */
const TIER_DISPLAY: Record<string, string> = {
  community: 'Community',
  free: 'Community',
  pro: 'Institutional',
  institutional: 'Institutional',
  enterprise: 'Enterprise',
};

export function displayTierName(tier: string | null | undefined): string {
  const t = (tier ?? '').toLowerCase().trim();
  if (!t) return 'Free';
  return TIER_DISPLAY[t] ?? t.charAt(0).toUpperCase() + t.slice(1);
}

/* ── proactive quota nudges ──────────────────────────────────────────── */

/** Surface a nudge once usage reaches this fraction of the cap, so a larger cap
 *  warns before its final slot rather than only at cap-1. */
export const NUDGE_FRACTION = 0.8;

export interface QuotaNudge {
  /** Human noun for the thing being counted, e.g. "live deployment". */
  noun: string;
  count: number;
  cap: number;
  remaining: number;
  atLimit: boolean;
  scope: string;
  /** Ready-to-render line, scope phrased in. */
  message: string;
}

const SCOPE_PHRASE: Record<string, string> = {
  install: 'across this install',
  user: 'on your account',
};

function plural(n: number, noun: string): string {
  return `${noun}${n === 1 ? '' : 's'}`;
}

/**
 * A proactive nudge for one quota, or null when there is nothing to say yet.
 * Silent while there is comfortable headroom, on an unlimited cap (`null`/`0`),
 * or before anything is used; it speaks only once the cap is APPROACHING (final
 * slot, or past {@link NUDGE_FRACTION}) or already reached. Respects the item's
 * enforcement scope so "on your account" vs "across this install" is honest.
 */
export function quotaNudge(item: UsageItem | null | undefined, noun: string): QuotaNudge | null {
  if (!item) return null;
  const { count, cap, scope } = item;
  if (typeof cap !== 'number' || cap <= 0) return null; // unlimited / unknown
  if (typeof count !== 'number' || count < 1) return null; // nothing used yet

  const remaining = cap - count;
  const atLimit = remaining <= 0;
  const approaching = remaining <= 1 || count / cap >= NUDGE_FRACTION;
  if (!atLimit && !approaching) return null;

  const where = SCOPE_PHRASE[scope] ?? '';
  const used = `${count} of ${cap} ${plural(cap, noun)} used${where ? ` ${where}` : ''}`;
  const message = atLimit
    ? `${used} — you’re at your plan limit.`
    : `${used} — ${Math.max(remaining, 0)} left on your plan.`;

  return { noun, count, cap, remaining: Math.max(remaining, 0), atLimit, scope, message };
}
