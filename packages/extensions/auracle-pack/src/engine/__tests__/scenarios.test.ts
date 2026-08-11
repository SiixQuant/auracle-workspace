/**
 * Stress-window replay (Frontier #11): slicing a stored equity curve to each
 * named historical window and reading the in-window return + drawdown. Pure.
 */
import { describe, expect, it } from 'vitest';

import { STRESS_WINDOWS, runScenarios, sliceScenario } from '../scenarios';

const COVID = STRESS_WINDOWS.find((w) => w.id === 'covid')!; // 2020-02-19 … 2020-03-23

describe('sliceScenario', () => {
  it('reads in-window return and drawdown off the sliced curve', () => {
    const labels = ['2020-02-18', '2020-02-19', '2020-03-01', '2020-03-23', '2020-03-24'];
    const points = [1.0, 1.0, 0.9, 0.8, 0.85]; // growth-of-$1
    const r = sliceScenario(labels, points, COVID);
    expect(r.covered).toBe(true);
    expect(r.nDays).toBe(3); // 02-19, 03-01, 03-23 (the 18th and 24th are outside)
    expect(r.ret).toBeCloseTo(0.8 / 1.0 - 1, 6); // -0.20 over the window
    expect(r.maxDrawdown).toBeCloseTo(-0.2, 6); // trough vs the in-window peak
    expect(r.series[0]).toBe(1); // rebased to 1.0 at the window's start
  });

  it('marks a window outside the run history as not covered', () => {
    const r = sliceScenario(['2021-01-04', '2021-01-05'], [1.0, 1.1], COVID);
    expect(r.covered).toBe(false);
    expect(r.ret).toBeNull();
    expect(r.maxDrawdown).toBeNull();
    expect(r.series).toEqual([]);
  });
});

describe('runScenarios', () => {
  it('returns one result per named window, in order', () => {
    const results = runScenarios(['2020-03-01'], [1.0]); // a single point covers nothing
    expect(results.map((r) => r.window.id)).toEqual(STRESS_WINDOWS.map((w) => w.id));
    expect(results.every((r) => !r.covered)).toBe(true);
  });
});
