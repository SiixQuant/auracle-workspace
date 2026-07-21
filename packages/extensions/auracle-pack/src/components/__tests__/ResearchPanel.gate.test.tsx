/**
 * The Transmog affordance gates at the mocked host seam: a signed-in user with
 * no agent model connected sees a connect-a-key explanation instead of a dead
 * click, a configured (or older, lane-less) host keeps the button, and the
 * existing signed-out gate is untouched.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ResearchPanel } from '../ResearchPanel';
import type { PanelHostLike } from '../aiPanel';

vi.mock('../../engine/client', () => ({
  authState: vi.fn(),
  getJsonDetailed: vi.fn(),
  postJson: vi.fn(),
}));

import { authState, getJsonDetailed, postJson } from '../../engine/client';

const FEED = {
  findings: [
    {
      id: 1,
      paper_id: 'p1',
      title: 'A tradable momentum signal',
      status: 'surfaced',
      composite: 72,
      band: 'candidate',
    },
  ],
  last_scan: '2026-07-08T00:00:00Z',
};

function hostWith(overrides: Partial<PanelHostLike> = {}): PanelHostLike {
  return {
    launchAgentSession: vi.fn().mockResolvedValue({ ok: true, sessionId: 's1' }),
    openFile: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getJsonDetailed).mockResolvedValue({ ok: true, body: FEED } as never);
  vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, body: {} });
  vi.mocked(authState).mockResolvedValue({ signedIn: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Transmog connect-a-key gate', () => {
  it('signed in with no model connected renders the gate, not the button', async () => {
    const host = hostWith({ agentKeyState: vi.fn().mockResolvedValue({ configured: false }) });
    render(<ResearchPanel host={host} />);

    expect(await screen.findByTestId('transmog-gate-1')).toBeTruthy();
    expect(screen.queryByTestId('transmog-1')).toBeNull();
  });

  it('signed in with a model connected renders the Transmog button, no gate', async () => {
    const host = hostWith({ agentKeyState: vi.fn().mockResolvedValue({ configured: true }) });
    render(<ResearchPanel host={host} />);

    const button = await screen.findByTestId('transmog-1');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('transmog-gate-1')).toBeNull();
  });

  it('falls back to the button when the host predates the key-state lane', async () => {
    // No agentKeyState on the host -> presence is unknown -> never blocks.
    const host = hostWith();
    render(<ResearchPanel host={host} />);

    expect(await screen.findByTestId('transmog-1')).toBeTruthy();
    expect(screen.queryByTestId('transmog-gate-1')).toBeNull();
  });

  it('keeps the existing signed-out gate even when no model is connected', async () => {
    vi.mocked(authState).mockResolvedValue({ signedIn: false });
    const host = hostWith({ agentKeyState: vi.fn().mockResolvedValue({ configured: false }) });
    render(<ResearchPanel host={host} />);

    const button = await screen.findByTestId('transmog-1');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('title')).toContain('Sign in');
    // The connect-a-key gate must not pre-empt the sign-in gate.
    expect(screen.queryByTestId('transmog-gate-1')).toBeNull();
  });
});
