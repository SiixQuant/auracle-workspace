/**
 * The upgrade card renders straight from a classified engine failure. Driving it
 * through `parseEngineError` (not a hand-built prop) proves the whole seam: a
 * real structured 402 body becomes a card that names the plan you are on and the
 * plan the feature needs, a blocked license reads as a renew (not upgrade)
 * state, and an ordinary error never wears the card at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { UpgradeGate } from '../UpgradeGate';
import { parseEngineError } from '../../engine/paywall';

afterEach(cleanup);

const TIER_402 = {
  detail: {
    error: 'tier_upgrade_required',
    message: 'This feature requires the Institutional tier or higher. Your install is on Community.',
    current_tier: 'community',
    required_tier: 'institutional',
    upgrade_url: 'https://auracle-engine.com/pricing',
  },
};

describe('UpgradeGate', () => {
  it('renders a tier 402 as a card with current and required plan context', () => {
    render(<UpgradeGate info={parseEngineError(402, TIER_402, 'x')} />);

    const gate = screen.getByTestId('upgrade-gate');
    expect(gate.getAttribute('data-paywall-kind')).toBe('paywall');
    // Engine-aligned display names, not raw tier strings.
    const plans = screen.getByTestId('upgrade-gate-plans');
    expect(plans.textContent).toContain('Community'); // current
    expect(plans.textContent).toContain('Institutional'); // required
    const link = screen.getByTestId('upgrade-gate-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://auracle-engine.com/pricing');
  });

  it('renders a blocked license as a renew state, not an upgrade paywall', () => {
    const body = {
      detail: { error: 'license_blocked', message: 'License is no longer active.', state: 'blocked', reason: 'expired' },
    };
    render(<UpgradeGate info={parseEngineError(402, body, 'x')} />);

    const gate = screen.getByTestId('upgrade-gate');
    expect(gate.getAttribute('data-paywall-kind')).toBe('license');
    expect(gate.textContent).toContain('expired');
    // A license block is not an upgrade — no plan-context row, no upgrade link.
    expect(screen.queryByTestId('upgrade-gate-plans')).toBeNull();
    expect(screen.queryByTestId('upgrade-gate-link')).toBeNull();
  });

  it('does not render the card for a generic error', () => {
    render(<UpgradeGate info={parseEngineError(400, { detail: 'body must be an object' }, 'x')} />);
    expect(screen.queryByTestId('upgrade-gate')).toBeNull();
    expect(screen.getByText('body must be an object')).toBeTruthy();
  });
});
