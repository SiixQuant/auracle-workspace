import { describe, expect, it } from 'vitest';

import { compilePhase, headlineStats, normalizeProject } from '../quantconnect';

describe('normalizeProject', () => {
  it('coerces id shapes and defaults the name', () => {
    expect(normalizeProject({ projectId: 42, name: 'Alpha', language: 'Py' })).toEqual({
      projectId: 42,
      name: 'Alpha',
      language: 'Py',
    });
    expect(normalizeProject({ id: '7' })).toEqual({
      projectId: 7,
      name: 'Project 7',
      language: '',
    });
    expect(normalizeProject({ name: 'no id' })).toBeNull();
  });
});

describe('compilePhase', () => {
  it('reads QC build states, defaulting to still-building', () => {
    expect(compilePhase('BuildSuccess')).toBe('success');
    expect(compilePhase('BuildError')).toBe('error');
    expect(compilePhase('InQueue')).toBe('building');
    expect(compilePhase(null)).toBe('building');
    expect(compilePhase(undefined)).toBe('building');
  });
});

describe('headlineStats', () => {
  it('picks the headline keys in order and skips blanks/missing', () => {
    const stats = headlineStats({
      'Sharpe Ratio': '1.23',
      'Total Return': '45%',
      'Drawdown': '',
      'Win Rate': '58%',
      'Some Other Stat': '9',
    });
    expect(stats).toEqual([
      { label: 'Sharpe Ratio', value: '1.23' },
      { label: 'Total Return', value: '45%' },
      { label: 'Win Rate', value: '58%' },
    ]);
  });

  it('never throws on missing statistics', () => {
    expect(headlineStats(null)).toEqual([]);
    expect(headlineStats(undefined)).toEqual([]);
    expect(headlineStats({})).toEqual([]);
  });
});
