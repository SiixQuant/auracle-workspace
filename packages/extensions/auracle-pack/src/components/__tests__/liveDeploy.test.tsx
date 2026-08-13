/**
 * The Live tab's deploy pane — the gate the owner asked for.
 *
 * The property under test is the honesty of the connect gate: a live trading
 * account reads as connected ONLY when a real (non-simulator, non-paywalled)
 * broker is up. Until then the pane shows the connect card (its write-only field
 * is the one route a credential has), and the wizard is always present so paper
 * deploy never waits on an account. The heavy DeployWizardView and the engine
 * client are the seams cut; the gate itself is the shipped module.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/client')>();
  return { ...actual, getJson: vi.fn(), onConnectGeneration: vi.fn(() => () => {}) };
});
vi.mock('../../engine/connectionTools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/connectionTools')>();
  return { ...actual, pendingFieldsFor: vi.fn(async () => []) };
});
// The full wizard fetches connections/entitlements/strategies of its own; stub
// it to a marker so this suite pins the gate, not the wizard.
vi.mock('../LivePanel', () => ({
  DeployWizardView: () => <div data-testid="deploy-wizard-stub" />,
}));

import { getJson } from '../../engine/client';
import { normalizeConnector, type Connector } from '../../engine/model';
import { LiveDeployPane, liveAccountConnected, liveBrokers } from '../grid/pages/LiveDeploy';

function conn(id: string, kind: string, state: string, over: Partial<Connector> = {}): Connector {
  return normalizeConnector({ id, kind, status: { state, detail: null }, ...over });
}

function mockRegistry(rows: Connector[]): void {
  vi.mocked(getJson).mockResolvedValue({ connections: rows } as never);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the live-account gate (pure)', () => {
  it('excludes the paper simulator from the live brokers', () => {
    const rows = [
      conn('simulator', 'broker', 'connected'),
      conn('ibkr', 'broker', 'not_configured'),
      conn('polygon', 'data_provider', 'connected'),
    ];
    expect(liveBrokers(rows).map((b) => b.id)).toEqual(['ibkr']);
  });

  it('is connected only when a real broker is up and not paywalled', () => {
    expect(liveAccountConnected([conn('simulator', 'broker', 'connected')])).toBe(false);
    expect(liveAccountConnected([conn('ibkr', 'broker', 'not_configured')])).toBe(false);
    expect(liveAccountConnected([conn('ibkr', 'broker', 'connected', { gated: true })])).toBe(false);
    expect(liveAccountConnected([conn('ibkr', 'broker', 'connected')])).toBe(true);
  });
});

describe('the live-account gate (rendered)', () => {
  it('shows the connect card — not a connected account — until a live broker is up', async () => {
    mockRegistry([conn('simulator', 'broker', 'connected'), conn('ibkr', 'broker', 'not_configured')]);
    render(<LiveDeployPane strategyPath="strategies.momentum.Momentum" />);

    await waitFor(() => expect(screen.getByTestId('tearsheet-live-deploy')).toBeTruthy());
    // No account is connected — the connect card stands, not the connected note.
    expect(screen.getByTestId('live-connect-card')).toBeTruthy();
    expect(screen.queryByTestId('live-account-connected')).toBeNull();
    // The wizard is always there so paper deploy never waits on an account.
    expect(screen.getByTestId('deploy-wizard-stub')).toBeTruthy();
  });

  it('shows the connected note and drops the connect card once a live broker is up', async () => {
    mockRegistry([conn('simulator', 'broker', 'connected'), conn('ibkr', 'broker', 'connected')]);
    render(<LiveDeployPane strategyPath="strategies.momentum.Momentum" />);

    await waitFor(() => expect(screen.getByTestId('live-account-connected')).toBeTruthy());
    expect(screen.queryByTestId('live-connect-card')).toBeNull();
    expect(screen.getByTestId('deploy-wizard-stub')).toBeTruthy();
  });
});
