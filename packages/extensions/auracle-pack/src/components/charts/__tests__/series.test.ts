import { describe, expect, it } from 'vitest';
import { canUseLogScale, finitePoints, logTicks } from '../series';

describe('finitePoints', () => {
  it('keeps a clean numeric series intact, paired by index', () => {
    expect(finitePoints([1, 1.5, 2])).toEqual([
      { x: '0', v: 1 },
      { x: '1', v: 1.5 },
      { x: '2', v: 2 },
    ]);
  });

  it('drops non-finite points (the engine serialises NaN/Inf as null)', () => {
    // A backtest equity gap or blowup bar arrives as null / NaN / Infinity.
    expect(finitePoints([1, null, 1.1] as unknown as number[])).toEqual([
      { x: '0', v: 1 },
      { x: '2', v: 1.1 },
    ]);
    expect(finitePoints([NaN, 2, Infinity, 3])).toEqual([
      { x: '1', v: 2 },
      { x: '3', v: 3 },
    ]);
  });

  it('honours labels by ORIGINAL index, so gaps do not misalign them', () => {
    expect(finitePoints([1, null, 3] as unknown as number[], ['Jan', 'Feb', 'Mar'])).toEqual([
      { x: 'Jan', v: 1 },
      { x: 'Mar', v: 3 },
    ]);
  });

  it('collapses a one-real-point series so the honesty gate renders nothing', () => {
    // [1, null] must NOT read as two points — the chart requires two REAL ones.
    expect(finitePoints([1, null] as unknown as number[]).length).toBe(1);
    expect(finitePoints([null, null] as unknown as number[])).toEqual([]);
  });

  it('is defensive about a missing or non-array series', () => {
    expect(finitePoints(undefined)).toEqual([]);
    expect(finitePoints(null)).toEqual([]);
    expect(finitePoints([] as number[])).toEqual([]);
  });
});

describe('log scale helpers', () => {
  const pts = (vals: number[]) => finitePoints(vals);

  it('permits a log axis only on strictly-positive data', () => {
    expect(canUseLogScale(pts([1, 2, 74]))).toBe(true);
    // A wiped-out curve touches zero; log(0) is -Infinity.
    expect(canUseLogScale(pts([1, 0.5, 0]))).toBe(false);
    expect(canUseLogScale(pts([1, -0.2]))).toBe(false);
    // The two-real-point gate still applies.
    expect(canUseLogScale(pts([5]))).toBe(false);
  });

  it('builds 1-2-5 decade ticks across the span', () => {
    // The real case: $10,000 growing to $740,400 over the backtest.
    expect(logTicks(10_000, 740_400)).toEqual([
      10_000, 20_000, 50_000, 100_000, 200_000, 500_000,
    ]);
  });

  it('keeps every tick inside the data range', () => {
    for (const t of logTicks(3, 900)) {
      expect(t).toBeGreaterThanOrEqual(3);
      expect(t).toBeLessThanOrEqual(900);
    }
  });

  it('refuses a domain a log axis cannot express', () => {
    expect(logTicks(0, 100)).toEqual([]);
    expect(logTicks(-5, 100)).toEqual([]);
    expect(logTicks(100, 10)).toEqual([]);
  });
});
