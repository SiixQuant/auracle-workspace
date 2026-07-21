/**
 * The incident "Open the run" edge and the repaired dismiss guard, at the
 * mocked seam. An incident carries a JOB id (its `open_job` action), never a
 * deployment id, so the honest jump hands the run to the agent. Dismiss reads
 * the engine's nested `dismiss` object.
 */
// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { IncidentsPanel } from '../MonitorPanels';

vi.mock('../../engine/client', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import { getJson, postJson } from '../../engine/client';

const FEED = {
  incidents: [
    {
      severity: 'critical',
      cause: 'scheduled run failed',
      detail: 'boom',
      kind: 'failed_job',
      id: 'failed_job:42',
      action: { kind: 'open_job', job_id: 42 },
      dismiss: { kind: 'failed_job', id: 42 },
    },
    {
      severity: 'warning',
      cause: 'error in the log',
      kind: 'error_log',
      id: 'error_log:9',
      action: null,
      dismiss: { kind: 'error_log', id: 9 },
    },
  ],
};

function wire() {
  vi.mocked(getJson).mockResolvedValue(FEED as never);
  vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, body: {} } as never);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Incident "Open the run"', () => {
  it('hands the incident\'s job to the agent, and only failed-job incidents offer it', async () => {
    wire();
    const host = { launchAgentSession: vi.fn().mockResolvedValue({ ok: true, sessionId: 's1' }) };
    render(<IncidentsPanel host={host as never} />);

    const openButtons = await screen.findAllByTestId('incident-open-run');
    expect(openButtons).toHaveLength(1); // the error_log incident has no open_job action

    fireEvent.click(openButtons[0]);
    await waitFor(() => expect(host.launchAgentSession).toHaveBeenCalledTimes(1));
    const [prompt, opts] = host.launchAgentSession.mock.calls[0];
    expect(prompt).toContain('job 42');
    expect(opts.title).toBe('Investigate job 42');
  });

  it('dismisses via the engine\'s nested {kind,id}', async () => {
    wire();
    const host = { launchAgentSession: vi.fn() };
    render(<IncidentsPanel host={host as never} />);

    const dismissButtons = await screen.findAllByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismissButtons[0]);
    await waitFor(() =>
      expect(postJson).toHaveBeenCalledWith('/ui/api/alerts/dismiss', {
        kind: 'failed_job',
        id: 42,
      })
    );
  });
});
