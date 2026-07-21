import { describe, expect, it } from 'vitest';
import { parseEngineError, paywallFromReason, UPGRADE_URL } from '../paywall';

const FALLBACK = 'Deploy rejected (400).';

describe('parseEngineError — structured paywall', () => {
  it('reads the engine tier gate (require_tier 402) with plan context', () => {
    // Exactly the license_gate.require_tier body, wrapped in FastAPI's {detail}.
    const body = {
      detail: {
        error: 'tier_upgrade_required',
        message: 'This feature requires the Institutional tier or higher. Your install is on Community.',
        current_tier: 'community',
        required_tier: 'institutional',
        upgrade_url: 'https://auracle-engine.com/pricing',
      },
    };
    const info = parseEngineError(402, body, FALLBACK);
    expect(info.kind).toBe('paywall');
    if (info.kind !== 'paywall') return;
    expect(info.currentTier).toBe('community');
    expect(info.requiredTier).toBe('institutional');
    expect(info.upgradeUrl).toBe('https://auracle-engine.com/pricing');
    expect(info.message).toContain('Institutional');
  });

  it('reads the agent-gateway 402 (no tiers) and still offers an upgrade URL', () => {
    const body = {
      detail: {
        error: 'agent_requires_key_or_upgrade',
        options: ['byo_key', 'upgrade'],
        upgrade_url: 'https://auracle-engine.com/#pricing',
      },
    };
    const info = parseEngineError(402, body, FALLBACK);
    expect(info.kind).toBe('paywall');
    if (info.kind !== 'paywall') return;
    expect(info.currentTier).toBeNull();
    expect(info.requiredTier).toBeNull();
    expect(info.upgradeUrl).toBe('https://auracle-engine.com/#pricing');
    expect(info.message.length).toBeGreaterThan(0);
  });

  it('defaults the upgrade URL when a paywall body omits it', () => {
    const info = parseEngineError(402, { detail: { error: 'tier_upgrade_required' } }, FALLBACK);
    expect(info.kind).toBe('paywall');
    if (info.kind !== 'paywall') return;
    expect(info.upgradeUrl).toBe(UPGRADE_URL);
  });
});

describe('parseEngineError — blocked license is NOT a paywall', () => {
  it('classifies license_blocked distinctly, carrying its state/reason', () => {
    const body = {
      detail: {
        error: 'license_blocked',
        message: "This Auracle install's license is no longer active.",
        state: 'blocked',
        reason: 'expired',
      },
    };
    const info = parseEngineError(402, body, FALLBACK);
    expect(info.kind).toBe('license');
    if (info.kind !== 'license') return;
    expect(info.state).toBe('blocked');
    expect(info.reason).toBe('expired');
  });
});

describe('parseEngineError — generic failures never wear the upgrade card', () => {
  it('joins a deploy preflight issues list instead of dropping it', () => {
    const body = { detail: { ok: false, issues: ['Give the deployment a name.', 'Choose a brokerage.'] } };
    const info = parseEngineError(400, body, FALLBACK);
    expect(info.kind).toBe('generic');
    expect(info.message).toContain('Choose a brokerage.');
  });

  it('surfaces a plain string detail', () => {
    const info = parseEngineError(400, { detail: 'body must be an object' }, FALLBACK);
    expect(info).toEqual({ kind: 'generic', message: 'body must be an object' });
  });

  it('reads a top-level {ok:false,error} JSONResponse (no detail envelope)', () => {
    const info = parseEngineError(402, { ok: false, error: 'Cloud provisioning requires a paid plan.' }, FALLBACK);
    // No structured error code -> generic, but the reason is preserved.
    expect(info.kind).toBe('generic');
    expect(info.message).toContain('Cloud provisioning');
  });

  it('falls back to the caller message when nothing is parseable', () => {
    expect(parseEngineError(0, null, FALLBACK)).toEqual({ kind: 'generic', message: FALLBACK });
    expect(parseEngineError(500, { detail: {} }, FALLBACK)).toEqual({ kind: 'generic', message: FALLBACK });
  });
});

describe('paywallFromReason', () => {
  it('wraps an already-known gated reason as a paywall with the current tier', () => {
    const info = paywallFromReason('Community tier supports IBKR only.', 'community');
    expect(info.kind).toBe('paywall');
    expect(info.currentTier).toBe('community');
    expect(info.upgradeUrl).toBe(UPGRADE_URL);
    expect(info.message).toContain('IBKR');
  });
});
