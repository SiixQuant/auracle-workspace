import { describe, expect, it } from 'vitest';
import { nextAvailableName, sanitizeStrategyModuleName } from '../strategyModuleName';

describe('sanitizeStrategyModuleName', () => {
  it('lowercases and turns spaces into underscores', () => {
    expect(sanitizeStrategyModuleName('My Strategy')).toBe('my_strategy');
  });

  it('turns hyphens into underscores', () => {
    expect(sanitizeStrategyModuleName('mean-reversion')).toBe('mean_reversion');
  });

  it('treats dots as separators, not module boundaries', () => {
    expect(sanitizeStrategyModuleName('mean.reversion')).toBe('mean_reversion');
  });

  it('prefixes a name that starts with a digit (invalid Python module)', () => {
    expect(sanitizeStrategyModuleName('2fast')).toBe('strategy_2fast');
  });

  it('strips a leading underscore so the file stays visible to engine discovery', () => {
    // Engine module discovery SKIPS files that start with "_".
    expect(sanitizeStrategyModuleName('_wip')).toBe('wip');
  });

  it('strips trailing underscores too', () => {
    expect(sanitizeStrategyModuleName('wip_')).toBe('wip');
    expect(sanitizeStrategyModuleName('__wip__')).toBe('wip');
  });

  it('collapses repeated separators into a single underscore', () => {
    expect(sanitizeStrategyModuleName('a   b')).toBe('a_b');
    expect(sanitizeStrategyModuleName('a - b')).toBe('a_b');
    expect(sanitizeStrategyModuleName('a...b')).toBe('a_b');
  });

  it('drops non-ascii characters rather than turning them into separators', () => {
    // "Ütf" -> the accented character is stripped, leaving the ascii tail.
    expect(sanitizeStrategyModuleName('Ütf')).toBe('tf');
    expect(sanitizeStrategyModuleName('café')).toBe('caf');
    expect(sanitizeStrategyModuleName('résumé strategy')).toBe('rsum_strategy');
  });

  it('strips characters outside [a-z0-9_]', () => {
    expect(sanitizeStrategyModuleName('alpha@beta!')).toBe('alpha_beta');
    expect(sanitizeStrategyModuleName('price$momentum')).toBe('price_momentum');
  });

  it('falls back to my_strategy when the input reduces to nothing', () => {
    expect(sanitizeStrategyModuleName('')).toBe('my_strategy');
    expect(sanitizeStrategyModuleName('   ')).toBe('my_strategy');
    expect(sanitizeStrategyModuleName('___')).toBe('my_strategy');
    expect(sanitizeStrategyModuleName('...')).toBe('my_strategy');
    expect(sanitizeStrategyModuleName('東京')).toBe('my_strategy');
  });

  it('leaves an already-valid module name untouched', () => {
    expect(sanitizeStrategyModuleName('momentum_v2')).toBe('momentum_v2');
    expect(sanitizeStrategyModuleName('macd_cross_9')).toBe('macd_cross_9');
  });

  it('never returns a name that would be hidden or malformed', () => {
    const samples = ['My Strategy', '2fast', '_wip', 'mean.reversion', 'Ütf', '', '9', '-', '__'];
    for (const sample of samples) {
      const result = sanitizeStrategyModuleName(sample);
      expect(result).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(result.startsWith('_')).toBe(false);
      expect(result.endsWith('_')).toBe(false);
    }
  });
});

describe('nextAvailableName', () => {
  it('returns the base name when it is free', () => {
    expect(nextAvailableName('my_strategy', () => false)).toBe('my_strategy');
  });

  it('suffixes _2 when the base is taken', () => {
    const taken = new Set(['my_strategy']);
    expect(nextAvailableName('my_strategy', (n) => taken.has(n))).toBe('my_strategy_2');
  });

  it('walks up to the first free suffix', () => {
    const taken = new Set(['s', 's_2', 's_3']);
    expect(nextAvailableName('s', (n) => taken.has(n))).toBe('s_4');
  });

  it('returns null when the base and all suffixes _2.._9 are taken', () => {
    const taken = new Set(['s', 's_2', 's_3', 's_4', 's_5', 's_6', 's_7', 's_8', 's_9']);
    expect(nextAvailableName('s', (n) => taken.has(n))).toBeNull();
  });

  it('honors a custom max suffix', () => {
    const taken = new Set(['s', 's_2']);
    expect(nextAvailableName('s', (n) => taken.has(n), 2)).toBeNull();
  });
});
