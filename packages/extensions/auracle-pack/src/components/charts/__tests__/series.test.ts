import { describe, expect, it } from 'vitest';
import { finitePoints } from '../series';

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
