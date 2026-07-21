import { describe, expect, it, vi } from 'vitest';
import type { PanelChangeEnvelope } from '@nimbalyst/runtime';

import {
  ProactiveNotificationService,
  buildProactivePrompt,
  isPaidTier,
  type ProactiveNotificationDeps,
} from '../proactiveNotificationService';
import { ProactiveNotificationGovernor } from '../proactiveNotificationGovernor';

function env(over: Partial<PanelChangeEnvelope> = {}): PanelChangeEnvelope {
  return { v: 1, type: 'backtest.finished', subject: '42', payload: { strategy: 'Atlas', outcome: 'succeeded' }, ...over };
}

function deps(over: Partial<ProactiveNotificationDeps> = {}): {
  deps: ProactiveNotificationDeps;
  queuePrompt: ReturnType<typeof vi.fn>;
  triggerProcessing: ReturnType<typeof vi.fn>;
  isPaid: ReturnType<typeof vi.fn>;
} {
  const queuePrompt = vi.fn(async () => undefined);
  const triggerProcessing = vi.fn(async () => undefined);
  const isPaid = vi.fn(async () => true);
  const base: ProactiveNotificationDeps = {
    listSessions: async () => [{ id: 'sess-1' }],
    getOptIn: () => true,
    isPaid,
    queuePrompt,
    triggerProcessing,
    now: () => 0,
    log: () => {},
    ...over,
  };
  return { deps: base, queuePrompt, triggerProcessing, isPaid: over.isPaid ? (over.isPaid as any) : isPaid };
}

describe('ProactiveNotificationService — decision → delivery', () => {
  it('drives the agent when opted-in, paid, and a session exists', async () => {
    const { deps: d, queuePrompt, triggerProcessing } = deps();
    const svc = new ProactiveNotificationService(d);

    const result = await svc.handlePanelEvent({ workspacePath: '/ws', envelope: env() });

    expect(result).toEqual({ drove: true });
    expect(queuePrompt).toHaveBeenCalledTimes(1);
    expect(queuePrompt).toHaveBeenCalledWith('sess-1', expect.stringContaining('backtest'));
    expect(triggerProcessing).toHaveBeenCalledWith('sess-1', '/ws');
  });

  it('does not drive (and never checks the plan) when opted-out', async () => {
    const isPaid = vi.fn(async () => true);
    const { deps: d, queuePrompt } = deps({ getOptIn: () => false, isPaid });
    const svc = new ProactiveNotificationService(d);

    const result = await svc.handlePanelEvent({ workspacePath: '/ws', envelope: env() });

    expect(result).toEqual({ drove: false, reason: 'opt-out' });
    expect(queuePrompt).not.toHaveBeenCalled();
    expect(isPaid).not.toHaveBeenCalled();
  });

  it('does not drive a community/unpaid plan (enforcement is host-side)', async () => {
    const { deps: d, queuePrompt } = deps({ isPaid: vi.fn(async () => false) });
    const svc = new ProactiveNotificationService(d);

    const result = await svc.handlePanelEvent({ workspacePath: '/ws', envelope: env() });

    expect(result).toEqual({ drove: false, reason: 'gated' });
    expect(queuePrompt).not.toHaveBeenCalled();
  });

  it('is an honest no-op when no session exists — no spawn, no plan check', async () => {
    const isPaid = vi.fn(async () => true);
    const { deps: d, queuePrompt } = deps({ listSessions: async () => [], isPaid });
    const svc = new ProactiveNotificationService(d);

    const result = await svc.handlePanelEvent({ workspacePath: '/ws', envelope: env() });

    expect(result).toEqual({ drove: false, reason: 'no-session' });
    expect(queuePrompt).not.toHaveBeenCalled();
    expect(isPaid).not.toHaveBeenCalled();
  });

  it('records a backoff on delivery failure and does not retry', async () => {
    let now = 0;
    const queuePrompt = vi.fn(async () => {
      throw new Error('queue down');
    });
    const governor = new ProactiveNotificationGovernor({ debounceMs: 1000, backoffBaseMs: 10_000, backoffMaxMs: 60_000 });
    const { deps: d } = deps({ queuePrompt, now: () => now });
    const svc = new ProactiveNotificationService(d, governor);

    const first = await svc.handlePanelEvent({ workspacePath: '/ws', envelope: env({ subject: 'A' }) });
    expect(first).toEqual({ drove: false, reason: 'delivery-failed' });
    expect(queuePrompt).toHaveBeenCalledTimes(1);

    // A different subject would normally drive, but the session is backed off.
    now = 5_000;
    const second = await svc.handlePanelEvent({ workspacePath: '/ws', envelope: env({ subject: 'B' }) });
    expect(second).toEqual({ drove: false, reason: 'backoff' });
    // Still only the one attempt — the failure was NOT retried.
    expect(queuePrompt).toHaveBeenCalledTimes(1);
  });

  it('dedups a repeat of the same event in the same session', async () => {
    const { deps: d, queuePrompt } = deps({ now: () => 0 });
    const svc = new ProactiveNotificationService(d, new ProactiveNotificationGovernor({ debounceMs: 0 }));

    await svc.handlePanelEvent({ workspacePath: '/ws', envelope: env({ subject: '42' }) });
    const again = await svc.handlePanelEvent({ workspacePath: '/ws', envelope: env({ subject: '42' }) });

    expect(again).toEqual({ drove: false, reason: 'duplicate' });
    expect(queuePrompt).toHaveBeenCalledTimes(1);
  });
});

describe('buildProactivePrompt', () => {
  it('names the run and outcome for a finished backtest', () => {
    const p = buildProactivePrompt(env({ payload: { strategy: 'Atlas', outcome: 'succeeded' } }));
    expect(p).toContain('Atlas');
    expect(p).toContain('run 42');
    expect(p).toContain('succeeded');
  });

  it('surfaces the engine detail on a failed backtest', () => {
    const p = buildProactivePrompt(
      env({ payload: { strategy: 'Atlas', outcome: 'failed', detail: 'divide by zero' } })
    );
    expect(p).toContain('failed');
    expect(p).toContain('divide by zero');
  });

  it('names the deployment and state for a failed deploy', () => {
    const p = buildProactivePrompt(
      env({ type: 'deploy.failed', subject: '7', payload: { strategy: 'Atlas', state: 'errored' } })
    );
    expect(p).toContain('id 7');
    expect(p).toContain('errored');
  });

  it('names the strategy, verdict, and red signals for a validation', () => {
    const p = buildProactivePrompt(
      env({
        type: 'validation.completed',
        subject: 'strategies.desk.atlas.Atlas',
        payload: { strategy: 'strategies.desk.atlas.Atlas', verdict: 'Overfit risk', redSignals: ['Deflated Sharpe'] },
      })
    );
    expect(p).toContain('Overfit risk');
    expect(p).toContain('Deflated Sharpe');
  });
});

describe('isPaidTier (host-side, allow-list)', () => {
  it('accepts only the engine paid ranks', () => {
    expect(isPaidTier('pro')).toBe(true);
    expect(isPaidTier('institutional')).toBe(true);
    expect(isPaidTier('enterprise')).toBe(true);
    expect(isPaidTier('Institutional')).toBe(true);
  });

  it('rejects community, free, unknown, and empty (fail-closed)', () => {
    expect(isPaidTier('community')).toBe(false);
    expect(isPaidTier('free')).toBe(false);
    expect(isPaidTier('team')).toBe(false);
    expect(isPaidTier('')).toBe(false);
    expect(isPaidTier(null)).toBe(false);
    expect(isPaidTier(undefined)).toBe(false);
  });
});
