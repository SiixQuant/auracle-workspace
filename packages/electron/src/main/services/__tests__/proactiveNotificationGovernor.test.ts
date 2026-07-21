import { describe, expect, it } from 'vitest';

import {
  ProactiveNotificationGovernor,
  type GovernorInput,
} from '../proactiveNotificationGovernor';

const DEBOUNCE = 60_000;
const BACKOFF_BASE = 30_000;
const BACKOFF_MAX = 15 * 60_000;

function gov() {
  return new ProactiveNotificationGovernor({
    debounceMs: DEBOUNCE,
    backoffBaseMs: BACKOFF_BASE,
    backoffMaxMs: BACKOFF_MAX,
  });
}

function input(overrides: Partial<GovernorInput> = {}): GovernorInput {
  return {
    sessionId: 's1',
    hasSession: true,
    type: 'backtest.finished',
    subject: 'S',
    optIn: true,
    paid: true,
    now: 0,
    ...overrides,
  };
}

describe('opt-in gate (default OFF)', () => {
  it('never drives when opt-in is off — even paid, with a session', () => {
    expect(gov().decide(input({ optIn: false }))).toEqual({ drive: false, reason: 'opt-out' });
  });

  it('opt-out wins over every other block (records no state)', () => {
    const g = gov();
    expect(g.decide(input({ optIn: false, paid: false, hasSession: false }))).toEqual({
      drive: false,
      reason: 'opt-out',
    });
    // Nothing was recorded: a later opted-in event drives immediately.
    expect(g.decide(input())).toEqual({ drive: true });
  });
});

describe('paid gate', () => {
  it('community/unpaid never auto-drives', () => {
    expect(gov().decide(input({ paid: false }))).toEqual({ drive: false, reason: 'gated' });
  });

  it('community with a session is gated', () => {
    expect(gov().decide(input({ paid: false, hasSession: true }))).toEqual({
      drive: false,
      reason: 'gated',
    });
  });
});

describe('no-session fallback (honest no-op, never a spawn)', () => {
  it('does not drive when there is no session', () => {
    expect(gov().decide(input({ hasSession: false, sessionId: '' }))).toEqual({
      drive: false,
      reason: 'no-session',
    });
  });

  it('treats an empty sessionId as no-session even if hasSession is true', () => {
    expect(gov().decide(input({ hasSession: true, sessionId: '' }))).toEqual({
      drive: false,
      reason: 'no-session',
    });
  });

  it('no-session wins over the paid gate (nothing to drive is checked first)', () => {
    expect(gov().decide(input({ hasSession: false, sessionId: '', paid: false }))).toEqual({
      drive: false,
      reason: 'no-session',
    });
  });

  it('records no state — the first event after a session opens drives', () => {
    const g = gov();
    g.decide(input({ hasSession: false, sessionId: '' }));
    expect(g.decide(input())).toEqual({ drive: true });
  });
});

describe('happy path', () => {
  it('drives when opted-in, paid, and a session exists', () => {
    expect(gov().decide(input())).toEqual({ drive: true });
  });
});

describe('dedup (per type+subject, per session)', () => {
  it('drops a repeat of the same type+subject in the same session', () => {
    const g = gov();
    expect(g.decide(input({ now: 0 }))).toEqual({ drive: true });
    // Past the debounce window so the block below is dedup, not debounce.
    expect(g.decide(input({ now: DEBOUNCE + 1 }))).toEqual({ drive: false, reason: 'duplicate' });
  });

  it('is per-session — the same event drives in a different session', () => {
    const g = gov();
    g.decide(input({ sessionId: 's1' }));
    expect(g.decide(input({ sessionId: 's2' }))).toEqual({ drive: true });
  });

  it('is per-type — a different type on the same subject drives (once past debounce)', () => {
    const g = gov();
    g.decide(input({ type: 'backtest.finished', subject: 'S', now: 0 }));
    expect(g.decide(input({ type: 'validation.completed', subject: 'S', now: DEBOUNCE + 1 }))).toEqual({
      drive: true,
    });
  });
});

describe('debounce (one per subject within the window)', () => {
  it('suppresses a second subject event inside the window, regardless of type', () => {
    const g = gov();
    expect(g.decide(input({ type: 'backtest.finished', subject: 'S', now: 0 }))).toEqual({ drive: true });
    expect(g.decide(input({ type: 'validation.completed', subject: 'S', now: 1_000 }))).toEqual({
      drive: false,
      reason: 'debounced',
    });
  });

  it('allows the next subject event once the window has passed', () => {
    const g = gov();
    g.decide(input({ type: 'backtest.finished', subject: 'S', now: 0 }));
    expect(g.decide(input({ type: 'validation.completed', subject: 'S', now: DEBOUNCE + 1 }))).toEqual({
      drive: true,
    });
  });

  it('debounces per subject, not globally — a different subject drives immediately', () => {
    const g = gov();
    g.decide(input({ subject: 'S', now: 0 }));
    expect(g.decide(input({ subject: 'OTHER', now: 1_000 }))).toEqual({ drive: true });
  });
});

describe('backoff on delivery failure (never a retry loop)', () => {
  it('suppresses events inside the window after a failure', () => {
    const g = gov();
    g.decide(input({ subject: 'A', now: 0 }));
    g.recordFailure('s1', 0);
    // A brand-new subject would otherwise drive, but the session is backed off.
    expect(g.decide(input({ subject: 'B', now: BACKOFF_BASE - 1 }))).toEqual({
      drive: false,
      reason: 'backoff',
    });
  });

  it('releases after the window and drives again', () => {
    const g = gov();
    g.recordFailure('s1', 0);
    expect(g.decide(input({ subject: 'B', now: BACKOFF_BASE + 1 }))).toEqual({ drive: true });
  });

  it('doubles the window on consecutive failures (exponential)', () => {
    const g = gov();
    g.recordFailure('s1', 0); // window = base
    g.recordFailure('s1', 0); // window = base*2
    expect(g.decide(input({ subject: 'B', now: BACKOFF_BASE * 2 - 1 }))).toEqual({
      drive: false,
      reason: 'backoff',
    });
    expect(g.decide(input({ subject: 'C', now: BACKOFF_BASE * 2 + 1 }))).toEqual({ drive: true });
  });

  it('caps the window at backoffMaxMs', () => {
    const g = gov();
    for (let i = 0; i < 20; i++) g.recordFailure('s1', 0); // would explode uncapped
    expect(g.decide(input({ subject: 'B', now: BACKOFF_MAX - 1 }))).toEqual({
      drive: false,
      reason: 'backoff',
    });
    expect(g.decide(input({ subject: 'C', now: BACKOFF_MAX + 1 }))).toEqual({ drive: true });
  });

  it('success clears the backoff window', () => {
    const g = gov();
    g.recordFailure('s1', 0);
    g.recordSuccess('s1');
    expect(g.decide(input({ subject: 'B', now: 1 }))).toEqual({ drive: true });
  });

  it('backoff is per session — another session is unaffected', () => {
    const g = gov();
    g.recordFailure('s1', 0);
    expect(g.decide(input({ sessionId: 's2', now: 1 }))).toEqual({ drive: true });
  });

  it('a failed delivery is not retried — the same event stays deduped', () => {
    const g = gov();
    // Drive once (marks delivered), then delivery fails.
    expect(g.decide(input({ subject: 'A', now: 0 }))).toEqual({ drive: true });
    g.recordFailure('s1', 0);
    // Past both the backoff AND the debounce window, the same type+subject
    // still never re-drives — the block is dedup, i.e. it was never retried.
    expect(g.decide(input({ subject: 'A', now: DEBOUNCE + 1 }))).toEqual({
      drive: false,
      reason: 'duplicate',
    });
  });
});

describe('reset', () => {
  it('forgets debounce, dedup, and backoff', () => {
    const g = gov();
    g.decide(input({ now: 0 }));
    g.recordFailure('s1', 0);
    g.reset();
    expect(g.decide(input({ now: 100 }))).toEqual({ drive: true });
  });
});
