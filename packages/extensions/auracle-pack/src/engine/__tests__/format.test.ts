import { describe, expect, it } from 'vitest';

import { duration, money, percent, price, qty } from '../format';

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

describe('duration', () => {
  const S = 1000;
  const M = 60 * S;
  const H = 60 * M;
  const D = 24 * H;
  it('shows the two largest non-zero units', () => {
    expect(duration(3 * D + 4 * H + 30 * M)).toBe('3d 4h');
    expect(duration(5 * H + 12 * M)).toBe('5h 12m');
    expect(duration(45 * M + 20 * S)).toBe('45m');
    expect(duration(30 * S)).toBe('30s');
  });
  it('drops a trailing zero unit', () => {
    expect(duration(3 * D)).toBe('3d');
    expect(duration(2 * H)).toBe('2h');
  });
  it('renders an em dash for non-finite or negative spans', () => {
    expect(duration(-1)).toBe('—');
    expect(duration(NaN)).toBe('—');
    expect(duration(null)).toBe('—');
  });
});
