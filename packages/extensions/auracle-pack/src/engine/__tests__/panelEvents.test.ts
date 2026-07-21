import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PANEL_EVENT_ENVELOPE_VERSION,
  backtestFinishedEvent,
  deployFailedEvent,
  validationCompletedEvent,
  emitPanelEvent,
  emitCapturedPanelEvent,
  registerPanelEventSink,
  toEnvelope,
  __resetPanelEventSinkForTests,
} from '../panelEvents';
import type { ValidationVerdict } from '../validation';

afterEach(() => {
  __resetPanelEventSinkForTests();
});

describe('toEnvelope', () => {
  it('wraps an event in the versioned envelope, mirroring type + subject', () => {
    const env = toEnvelope(
      backtestFinishedEvent({ subject: '42', strategy: 'Atlas', outcome: 'succeeded', stats: { sharpe: 1.3 } })
    );
    expect(env).toEqual({
      v: PANEL_EVENT_ENVELOPE_VERSION,
      type: 'backtest.finished',
      subject: '42',
      payload: { strategy: 'Atlas', outcome: 'succeeded', stats: { sharpe: 1.3 } },
    });
  });
});

describe('builders', () => {
  it('includes stats only on success', () => {
    const ok = backtestFinishedEvent({ subject: '1', strategy: 'S', outcome: 'succeeded', stats: { sharpe: 2 } });
    expect(ok.payload.stats).toEqual({ sharpe: 2 });
    expect(ok.payload.detail).toBeUndefined();
  });

  it('includes detail only on failure, never stats', () => {
    const bad = backtestFinishedEvent({
      subject: '1',
      strategy: 'S',
      outcome: 'failed',
      stats: { sharpe: 2 },
      detail: 'engine refused',
    });
    expect(bad.payload.detail).toBe('engine refused');
    expect(bad.payload.stats).toBeUndefined();
  });

  it('shapes a deploy.failed event with the state it landed in', () => {
    const evt = deployFailedEvent({ subject: '7', strategy: 'Atlas', state: 'errored' });
    expect(evt).toEqual({
      type: 'deploy.failed',
      subject: '7',
      payload: { strategy: 'Atlas', state: 'errored' },
    });
  });

  it('shapes validation.completed from a verdict, listing only red signals', () => {
    const verdict: ValidationVerdict = {
      as_of: '2026-01-02',
      strategy_path: 'strategies.desk.atlas.Atlas',
      plain: 'Overfit risk',
      fired_details: [],
      signals: [
        { signal: 'a', name: 'In-sample edge', tier: 'red', value: null, threshold: null, plain: '', what_usually_fixes_it: '' },
        { signal: 'b', name: 'Walk-forward', tier: 'green', value: null, threshold: null, plain: '', what_usually_fixes_it: '' },
        { signal: 'c', name: 'Deflated Sharpe', tier: 'red', value: null, threshold: null, plain: '', what_usually_fixes_it: '' },
      ],
    };
    const evt = validationCompletedEvent(verdict);
    expect(evt.subject).toBe('strategies.desk.atlas.Atlas');
    expect(evt.payload.verdict).toBe('Overfit risk');
    expect(evt.payload.redSignals).toEqual(['In-sample edge', 'Deflated Sharpe']);
  });
});

describe('emitPanelEvent — the notifyChange seam', () => {
  it('emits type + envelope through a host that supports notifyChange', () => {
    const notifyChange = vi.fn();
    emitPanelEvent({ notifyChange }, deployFailedEvent({ subject: '7', strategy: 'S', state: 'errored' }));
    expect(notifyChange).toHaveBeenCalledTimes(1);
    const [event, data] = notifyChange.mock.calls[0];
    expect(event).toBe('deploy.failed');
    expect(data).toMatchObject({ v: PANEL_EVENT_ENVELOPE_VERSION, type: 'deploy.failed', subject: '7' });
  });

  it('is an honest no-op on an older host (no notifyChange) and on no sink', () => {
    // Neither of these should throw.
    expect(() => emitPanelEvent({}, deployFailedEvent({ subject: '7', strategy: 'S', state: 'errored' }))).not.toThrow();
    expect(() => emitPanelEvent(undefined, deployFailedEvent({ subject: '7', strategy: 'S', state: 'errored' }))).not.toThrow();
  });

  it('swallows a throwing host so a panel render is never broken by emission', () => {
    const notifyChange = vi.fn(() => {
      throw new Error('host blew up');
    });
    expect(() =>
      emitPanelEvent({ notifyChange }, deployFailedEvent({ subject: '7', strategy: 'S', state: 'errored' }))
    ).not.toThrow();
  });
});

describe('captured sink — the store-side entry point', () => {
  it('routes emitCapturedPanelEvent through the last-registered sink', () => {
    const notifyChange = vi.fn();
    registerPanelEventSink({ notifyChange });
    emitCapturedPanelEvent(deployFailedEvent({ subject: '9', strategy: 'S', state: 'errored' }));
    expect(notifyChange).toHaveBeenCalledTimes(1);
  });

  it('ignores a sink without notifyChange, leaving the prior sink in place', () => {
    const good = vi.fn();
    registerPanelEventSink({ notifyChange: good });
    registerPanelEventSink({}); // older host — must not clobber the working sink
    emitCapturedPanelEvent(deployFailedEvent({ subject: '9', strategy: 'S', state: 'errored' }));
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('no-ops when nothing has registered a sink', () => {
    expect(() =>
      emitCapturedPanelEvent(deployFailedEvent({ subject: '9', strategy: 'S', state: 'errored' }))
    ).not.toThrow();
  });
});
