import { describe, expect, it } from 'vitest';

import {
  isPanelChangeEnvelope,
  isRoutablePanelEvent,
} from '../panelChangeEnvelope';

describe('isPanelChangeEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    expect(isPanelChangeEnvelope({ v: 1, type: 'backtest.finished', subject: '42', payload: {} })).toBe(true);
  });

  it('rejects non-objects and null', () => {
    expect(isPanelChangeEnvelope(null)).toBe(false);
    expect(isPanelChangeEnvelope('x')).toBe(false);
    expect(isPanelChangeEnvelope(42)).toBe(false);
    expect(isPanelChangeEnvelope(undefined)).toBe(false);
  });

  it('rejects a missing or empty type/subject and a non-finite version', () => {
    expect(isPanelChangeEnvelope({ v: 1, subject: '42' })).toBe(false);
    expect(isPanelChangeEnvelope({ v: 1, type: '', subject: '42' })).toBe(false);
    expect(isPanelChangeEnvelope({ v: 1, type: 'x', subject: '' })).toBe(false);
    expect(isPanelChangeEnvelope({ v: NaN, type: 'x', subject: '42' })).toBe(false);
    expect(isPanelChangeEnvelope({ type: 'x', subject: '42' })).toBe(false);
  });
});

describe('isRoutablePanelEvent', () => {
  it('routes the v1 event set', () => {
    for (const type of ['backtest.finished', 'deploy.failed', 'validation.completed']) {
      expect(isRoutablePanelEvent({ v: 1, type, subject: 's' })).toBe(true);
    }
  });

  it('drops an unknown version (forward-compat)', () => {
    expect(isRoutablePanelEvent({ v: 2, type: 'backtest.finished', subject: 's' })).toBe(false);
  });

  it('drops an unknown type', () => {
    expect(isRoutablePanelEvent({ v: 1, type: 'order.filled', subject: 's' })).toBe(false);
  });
});
