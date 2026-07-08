import { describe, expect, it } from 'vitest';

import { normalizeSignal, normalizeVerdict, railHeadline } from '../validation';

describe('normalizeSignal', () => {
  it('keeps green/red and defaults everything else to unknown', () => {
    expect(normalizeSignal({ tier: 'green' }).tier).toBe('green');
    expect(normalizeSignal({ tier: 'red' }).tier).toBe('red');
    expect(normalizeSignal({ tier: 'weird' }).tier).toBe('unknown');
    expect(normalizeSignal({}).tier).toBe('unknown');
  });

  it('falls back to the signal id for a missing name and nulls bad numbers', () => {
    const s = normalizeSignal({ signal: 'is_oos', value: 'nope', threshold: 2 });
    expect(s.name).toBe('is_oos');
    expect(s.value).toBeNull();
    expect(s.threshold).toBe(2);
  });
});

describe('normalizeVerdict', () => {
  it('coerces the whole payload and tolerates junk', () => {
    const v = normalizeVerdict({
      as_of: '2026-07-08T00:00:00Z',
      strategy_path: 'strategies.desk.a.A',
      signals: [{ signal: 's1', tier: 'red', name: 'One' }],
      fired_details: ['s1', 7],
      plain: 'x',
    });
    expect(v.strategy_path).toBe('strategies.desk.a.A');
    expect(v.signals).toHaveLength(1);
    expect(v.fired_details).toEqual(['s1']); // the non-string is dropped
  });

  it('never throws on an empty body', () => {
    const v = normalizeVerdict({});
    expect(v.signals).toEqual([]);
    expect(v.strategy_path).toBe('');
  });
});

describe('railHeadline', () => {
  it('counts healthy vs attention vs unchecked', () => {
    const sig = (tier: 'green' | 'red' | 'unknown') =>
      normalizeSignal({ signal: tier, tier });
    expect(railHeadline([sig('green'), sig('green'), sig('red'), sig('unknown')])).toBe(
      '2 of 4 checks look healthy · 1 need attention · 1 couldn\'t be checked'
    );
    expect(railHeadline([sig('green'), sig('green')])).toBe('2 of 2 checks look healthy');
    expect(railHeadline([])).toBe('No signals returned.');
  });
});
