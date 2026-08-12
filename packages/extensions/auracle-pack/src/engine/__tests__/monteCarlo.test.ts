import { describe, expect, it } from 'vitest';
import {
  hasFan,
  mcAbsence,
  monteCarloRead,
  normalizeMonteCarlo,
  type MonteCarloBody,
} from '../monteCarlo';

const BODY: MonteCarloBody = {
  ok: true,
  n_paths: 500,
  labels: ['2020-01-02', '2020-01-03', '2020-01-06'],
  p05: [1, 0.98, 0.95],
  p50: [1, 1.01, 1.04],
  p95: [1, 1.05, 1.12],
  realised_terminal: 1.09,
  p50_terminal: 1.04,
  p05_terminal: 0.95,
  p95_terminal: 1.12,
};

describe('normalizeMonteCarlo', () => {
  it('coerces the bands and terminals, dropping non-finite values', () => {
    const mc = normalizeMonteCarlo(BODY);
    expect(mc.nPaths).toBe(500);
    expect(mc.p50).toEqual([1, 1.01, 1.04]);
    expect(mc.realised).toBeCloseTo(1.09);
    expect(mc.p95Terminal).toBeCloseTo(1.12);
  });

  it('falls back the median terminal to the last p50 point when absent', () => {
    const mc = normalizeMonteCarlo({ ok: true, p50: [1, 1.2, 1.5] });
    expect(mc.medianTerminal).toBe(1.5);
  });

  it('drops NaN/Inf from a band rather than propagating them', () => {
    const mc = normalizeMonteCarlo({ ok: true, p50: [1, Infinity, 1.3] as number[] });
    expect(mc.p50).toEqual([1, 1.3]);
  });
});

describe('hasFan', () => {
  it('is true for three aligned bands of length >= 2', () => {
    expect(hasFan(normalizeMonteCarlo(BODY))).toBe(true);
  });
  it('is false when the bands are misaligned', () => {
    expect(hasFan(normalizeMonteCarlo({ ok: true, p05: [1], p50: [1, 1.1], p95: [1, 1.2] }))).toBe(false);
  });
});

describe('mcAbsence', () => {
  it('renders the engine reason verbatim', () => {
    expect(mcAbsence(400, { ok: false, error: 'insufficient data (need ≥30 bars)' })).toMatch(/insufficient data/);
  });
  it('has an honest default and a not-found case', () => {
    expect(mcAbsence(404, {})).toMatch(/not found/i);
    expect(mcAbsence(500, {})).toMatch(/completed run/i);
  });
});

describe('monteCarloRead', () => {
  it('is a factual description with the terminals and where realised falls', () => {
    const read = monteCarloRead(normalizeMonteCarlo(BODY));
    expect(read).toContain('500');
    expect(read).toContain('0.95×');
    expect(read).toContain('1.12×');
    expect(read).toContain('1.09×');
    expect(read).toMatch(/above the resampled median/);
    // never a statistical verdict
    expect(read).not.toMatch(/luck|skill|significant|overfit/i);
  });

  it('flags a realised terminal that exceeds the 95th percentile', () => {
    const read = monteCarloRead(normalizeMonteCarlo({ ...BODY, realised_terminal: 1.2 }));
    expect(read).toMatch(/at or above the resampled 95th/);
  });
});
