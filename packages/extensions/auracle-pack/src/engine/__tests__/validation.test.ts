import { describe, expect, it } from 'vitest';

import {
  normalizeSignal,
  normalizeVerdict,
  railHeadline,
  validationContext,
  validationPrompt,
} from '../validation';

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

const sampleVerdict = normalizeVerdict({
  as_of: '2026-07-08T00:00:00Z',
  strategy_path: 'strategies.desk.momo.Momo',
  plain: 'Two signals need attention.',
  signals: [
    { signal: 'is_oos', tier: 'green', name: 'In-vs-out-of-sample', plain: 'Holds up.' },
    {
      signal: 'sharpe_decay',
      tier: 'red',
      name: 'Sharpe decay',
      plain: 'Out-of-sample Sharpe collapses.',
      what_usually_fixes_it: 'fewer parameters',
    },
    { signal: 'turnover', tier: 'unknown', name: 'Turnover', plain: '' },
  ],
});

describe('validationContext (ambient bus payload)', () => {
  it('is compact, panel-tagged, and preserves every signal + fix', () => {
    const ctx = validationContext(sampleVerdict);
    expect(ctx.panel).toBe('validation');
    expect(ctx.strategy_path).toBe('strategies.desk.momo.Momo');
    expect(ctx.summary).toBe('Two signals need attention.');
    expect(ctx).toHaveProperty('signals');
    const signals = ctx.signals as Array<{ name: string; tier: string; fix: string }>;
    expect(signals).toHaveLength(3);
    expect(signals[1]).toMatchObject({ name: 'Sharpe decay', tier: 'red', fix: 'fewer parameters' });
  });

  it('falls back to the rail headline when the engine gives no plain summary', () => {
    const noPlain = normalizeVerdict({ strategy_path: 'x.Y', signals: [{ tier: 'green' }] });
    expect(validationContext(noPlain).summary).toBe('1 of 1 checks look healthy');
  });
});

describe('validationPrompt (agent hand-off)', () => {
  it('names the strategy, lists only the red signals with their fixes, and points at the engine', () => {
    const prompt = validationPrompt(sampleVerdict);
    expect(prompt).toContain('strategies.desk.momo.Momo');
    expect(prompt).toContain('Sharpe decay: Out-of-sample Sharpe collapses. (usually fixed by: fewer parameters)');
    // Green signals are not dragged into the "needs attention" list.
    expect(prompt).not.toContain('In-vs-out-of-sample:');
    // Unchecked signals are surfaced, but separately.
    expect(prompt).toContain("Couldn't be checked on this history: Turnover.");
    expect(prompt).toContain('re-run validation through the Auracle engine');
  });

  it('omits the attention section entirely when nothing is red', () => {
    const clean = normalizeVerdict({
      strategy_path: 'x.Y',
      plain: 'All clear.',
      signals: [{ signal: 'a', tier: 'green', name: 'A' }],
    });
    const prompt = validationPrompt(clean);
    expect(prompt).not.toContain('need attention');
  });
});
