/**
 * Number formatting for the pack's money / quantity / percent cells.
 *
 * Native Intl — no dependency — with an en-US locale pinned so the output
 * is deterministic regardless of the host machine's locale (the engine
 * reports USD figures; the IDE should render them the same everywhere).
 * Non-finite input renders as an em dash, matching the panels' "no value"
 * convention rather than printing "NaN"/"$NaN".
 */

const USD0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const USD2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const EM_DASH = '—';

function finite(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Whole-dollar money for AUM / equity: `$250,000`. */
export function money(n: number | null | undefined): string {
  return finite(n) ? USD0.format(n) : EM_DASH;
}

/** Per-share / fill price with cents: `$228.44`. */
export function price(n: number | null | undefined): string {
  return finite(n) ? USD2.format(n) : EM_DASH;
}

/** Share / contract quantities with thousands separators: `1,204`. */
export function qty(n: number | null | undefined): string {
  return finite(n) ? INT.format(n) : EM_DASH;
}

/**
 * Signed percent: `+12.34%` / `-3.10%` / `—`. ASCII sign to match the
 * existing `formatReturn` convention (its unit tests lock that output).
 */
export function percent(n: number | null | undefined, digits = 2): string {
  if (!finite(n)) return EM_DASH;
  const sign = n >= 0 ? '+' : '-';
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

/**
 * A span of milliseconds as a compact elapsed string: `3d 4h`, `5h 12m`,
 * `45m`, `30s`. At most the two largest non-zero units, so an uptime cell
 * stays short. Non-finite or negative input renders the em dash rather than a
 * nonsensical negative or "NaN" span.
 */
export function duration(ms: number | null | undefined): string {
  if (!finite(ms) || ms < 0) return EM_DASH;
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
