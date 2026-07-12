import { describe, expect, it } from 'vitest';

import { money, percent, price, qty } from '../format';

describe('money', () => {
  it('formats whole dollars with separators', () => {
    expect(money(250000)).toBe('$250,000');
    expect(money(533550)).toBe('$533,550');
    expect(money(0)).toBe('$0');
  });
  it('rounds to whole dollars', () => {
    expect(money(1234.5)).toBe('$1,235');
  });
  it('renders an em dash for missing / non-finite values', () => {
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
    expect(money(NaN)).toBe('—');
    expect(money(Infinity)).toBe('—');
  });
});

describe('price', () => {
  it('formats with two decimals', () => {
    expect(price(228.44)).toBe('$228.44');
    expect(price(228)).toBe('$228.00');
  });
  it('renders an em dash for missing values', () => {
    expect(price(null)).toBe('—');
  });
});

describe('qty', () => {
  it('formats integers with separators', () => {
    expect(qty(1204)).toBe('1,204');
    expect(qty(60)).toBe('60');
  });
  it('renders an em dash for missing values', () => {
    expect(qty(null)).toBe('—');
    expect(qty(undefined)).toBe('—');
  });
});

describe('percent', () => {
  it('signs and fixes to two decimals by default', () => {
    expect(percent(12.34)).toBe('+12.34%');
    expect(percent(-3.1)).toBe('-3.10%');
    expect(percent(0)).toBe('+0.00%');
  });
  it('respects a custom digit count', () => {
    expect(percent(6.7, 1)).toBe('+6.7%');
  });
  it('renders an em dash for missing values', () => {
    expect(percent(null)).toBe('—');
    expect(percent(NaN)).toBe('—');
  });
});
