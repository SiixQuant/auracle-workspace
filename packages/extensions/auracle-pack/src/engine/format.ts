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
