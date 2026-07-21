import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../client', () => ({ getJson: vi.fn() }));

import { getJson } from '../client';
import {
  displayTierName,
  entitlementsStore,
  quotaNudge,
  refreshEntitlements,
  type Entitlements,
  type UsageItem,
} from '../entitlements';

const item = (count: number, cap: number | null, scope = 'user'): UsageItem => ({ count, cap, scope });

describe('quotaNudge thresholds', () => {
  it('says nothing while there is comfortable headroom', () => {
    expect(quotaNudge(item(1, 5), 'live deployment')).toBeNull();
  });

  it('says nothing on an unlimited cap or before anything is used', () => {
    expect(quotaNudge(item(3, null), 'live deployment')).toBeNull();
    expect(quotaNudge(item(3, 0), 'live deployment')).toBeNull();
    expect(quotaNudge(item(0, 3), 'live deployment')).toBeNull();
  });

  it('nudges on the final slot, before the hard stop', () => {
    const n = quotaNudge(item(2, 3), 'live deployment');
    expect(n).not.toBeNull();
    expect(n?.atLimit).toBe(false);
    expect(n?.remaining).toBe(1);
  });

  it('nudges once past the fraction on a larger cap', () => {
    // 8 of 10 = 80%, remaining 2 (> 1) — still warns via the fraction rule.
    const n = quotaNudge(item(8, 10), 'schedule');
    expect(n).not.toBeNull();
    expect(n?.atLimit).toBe(false);
  });

  it('flags the hard limit once reached', () => {
    const n = quotaNudge(item(3, 3), 'live deployment');
    expect(n?.atLimit).toBe(true);
    expect(n?.remaining).toBe(0);
    expect(n?.message).toContain('plan limit');
  });
});

describe('quotaNudge respects the enforcement scope', () => {
  it('phrases a per-user cap as "on your account"', () => {
    const n = quotaNudge(item(3, 3, 'user'), 'live deployment');
    expect(n?.message).toContain('on your account');
  });

  it('phrases an install-wide cap as "across this install"', () => {
    const n = quotaNudge(item(3, 3, 'install'), 'schedule');
    expect(n?.message).toContain('across this install');
    // The noun pluralises against the cap.
    expect(n?.message).toContain('3 of 3 schedules used');
  });
});

describe('displayTierName aligns IDE vocabulary with the engine', () => {
  it('maps the back-compat "pro" alias and its siblings to engine display names', () => {
    expect(displayTierName('pro')).toBe('Institutional');
    expect(displayTierName('institutional')).toBe('Institutional');
    expect(displayTierName('community')).toBe('Community');
    expect(displayTierName('enterprise')).toBe('Enterprise');
  });

  it('reads an empty tier as Free and never invents a paid label for "team"', () => {
    expect(displayTierName('')).toBe('Free');
    expect(displayTierName(null)).toBe('Free');
    // 'team' is a phantom: echoed, not mapped to any real (paid) tier name.
    expect(displayTierName('team')).toBe('Team');
    expect(['Institutional', 'Enterprise', 'Community']).not.toContain(displayTierName('team'));
  });
});

describe('refreshEntitlements (mocked client seam)', () => {
  const snapshot: Entitlements = {
    tier: 'pro',
    display_tier: 'Institutional',
    days_remaining: 300,
    email: 'a@b.co',
    runtime_state: 'valid',
    live_allowed: true,
    active_broker: 'ibkr',
    quotas: { schedule_cap: null },
    deploy_caps: { max_live_deployments: null },
    usage: {
      enabled_schedules: item(1, null, 'install'),
      active_live_deployments: item(1, null, 'user'),
    },
  };

  beforeEach(() => entitlementsStore.set(null));
  afterEach(() => {
    vi.clearAllMocks();
    entitlementsStore.set(null);
  });

  it('publishes a valid snapshot to the store', async () => {
    vi.mocked(getJson).mockResolvedValue(snapshot);
    const result = await refreshEntitlements();
    expect(result).toEqual(snapshot);
    expect(entitlementsStore.getSnapshot()).toEqual(snapshot);
  });

  it('leaves the store untouched on an older/unreachable engine', async () => {
    vi.mocked(getJson).mockResolvedValue(null);
    expect(await refreshEntitlements()).toBeNull();
    expect(entitlementsStore.getSnapshot()).toBeNull();
  });

  it('rejects a malformed body (no tier) rather than storing garbage', async () => {
    vi.mocked(getJson).mockResolvedValue({ usage: {} } as never);
    expect(await refreshEntitlements()).toBeNull();
    expect(entitlementsStore.getSnapshot()).toBeNull();
  });
});
