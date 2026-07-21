/**
 * The factor-battery view model — coercion only, no statistical judgment.
 *
 * The engine owns every verdict and reading (auracle.backtest.factor_verdict);
 * these helpers must pass those strings through untouched and never re-derive
 * significance from a p-value. The absent-reason helper must surface the
 * engine's own explanation for a 4xx rather than invent one.
 */
import { describe, expect, it } from 'vitest';
import type { FactorBatteryBody } from '../client';
import {
  batteryAbsence,
  humanizeVerdict,
  measureFigure,
  normalizeBattery,
  normalizeMeasure,
} from '../factorBattery';

const BODY: FactorBatteryBody = {
  ok: true,
  job_id: 42,
  n_obs: 250,
  factor_set: ['Mkt-RF', 'SMB', 'HML', 'UMD'],
  window: { start: '2015-01-02', end: '2016-06-30' },
  factor_data: {
    source: 'Ken French Data Library',
    coverage_start: '1926-07-01',
    coverage_end: '2024-12-31',
    stale: false,
    note: 'Bundled factors cover 1926-07-01 to 2024-12-31.',
  },
  hac_lags: 5,
  periods_per_year: 252,
  measures: [
    {
      measure: 'alpha',
      label: 'Alpha (annualized)',
      verdict: 'significant_positive',
      reading: 'It added about 6.1% a year the factors do not explain (p = 0.030).',
      annual: 0.061,
      per_period: 0.00024,
      tstat: 2.17,
      pvalue: 0.03,
    },
    {
      measure: 'market_exposure',
      label: 'Market exposure (Mkt-RF)',
      verdict: 'market_like',
      reading: 'It moves about one-for-one with the market. (beta 1.00, p < 0.001).',
      beta: 1.0,
      tstat: 20.1,
      pvalue: 0.0002,
    },
    {
      measure: 'fit',
      label: 'Factor fit (R-squared)',
      verdict: 'well_explained',
      reading: 'The factors explain most of the return swings (86.0% of the variance).',
      r_squared: 0.86,
      r_squared_adj: 0.858,
    },
  ],
};

describe('normalizeBattery', () => {
  it('carries the metadata and every measure through unchanged', () => {
    const b = normalizeBattery(BODY);
    expect(b.jobId).toBe(42);
    expect(b.nObs).toBe(250);
    expect(b.factorSet).toEqual(['Mkt-RF', 'SMB', 'HML', 'UMD']);
    expect(b.window).toEqual({ start: '2015-01-02', end: '2016-06-30' });
    expect(b.factorNote).toBe('Bundled factors cover 1926-07-01 to 2024-12-31.');
    expect(b.stale).toBe(false);
    expect(b.measures.map((m) => m.measure)).toEqual(['alpha', 'market_exposure', 'fit']);
  });

  it('passes the engine verdict and reading through verbatim', () => {
    const b = normalizeBattery(BODY);
    const alpha = b.measures[0];
    expect(alpha.verdict).toBe('significant_positive');
    expect(alpha.reading).toBe('It added about 6.1% a year the factors do not explain (p = 0.030).');
  });

  it('keeps a verdict that contradicts its own p-value — no client recompute', () => {
    // An insignificant p-value with a "significant" verdict: the model must NOT
    // second-guess the engine. Whatever the engine said is what we carry.
    const measure = normalizeMeasure({
      measure: 'alpha',
      label: 'Alpha (annualized)',
      verdict: 'significant_positive',
      reading: 'Engine says significant.',
      annual: 0.02,
      pvalue: 0.9,
    });
    expect(measure.verdict).toBe('significant_positive');
    expect(measure.pvalue).toBe(0.9);
  });

  it('defaults an unusable row honestly without inventing a verdict', () => {
    const m = normalizeMeasure({});
    expect(m.measure).toBe('');
    expect(m.label).toBe('(measure)');
    expect(m.verdict).toBe('');
    expect(m.reading).toBe('');
    expect(m.beta).toBeNull();
  });

  it('tolerates a missing measures array', () => {
    expect(normalizeBattery({ ok: true }).measures).toEqual([]);
  });
});

describe('batteryAbsence', () => {
  it('surfaces the engine explanation verbatim for a 4xx', () => {
    const reason = batteryAbsence(400, {
      ok: false,
      error: 'cannot run factor regression: not enough overlapping observations (5) to regress on 4 factors',
    });
    expect(reason).toBe(
      'cannot run factor regression: not enough overlapping observations (5) to regress on 4 factors'
    );
  });

  it('surfaces the not-found and quant-extra messages verbatim too', () => {
    expect(batteryAbsence(404, { ok: false, error: 'job not found' })).toBe('job not found');
    expect(batteryAbsence(503, { ok: false, error: 'Factor regression needs statsmodels.' })).toBe(
      'Factor regression needs statsmodels.'
    );
  });

  it('falls back to a transport message only when nothing came back', () => {
    expect(batteryAbsence(0, null)).toContain('Auracle engine');
  });
});

describe('humanizeVerdict', () => {
  it('reads the snake_case verdict as words, meaning unchanged', () => {
    expect(humanizeVerdict('significant_positive')).toBe('significant positive');
    expect(humanizeVerdict('mostly_idiosyncratic')).toBe('mostly idiosyncratic');
    expect(humanizeVerdict('market_neutral')).toBe('market neutral');
  });
});

describe('measureFigure', () => {
  it('reads alpha as a signed annual percent', () => {
    const b = normalizeBattery(BODY);
    expect(measureFigure(b.measures[0])).toBe('+6.1% / yr');
  });

  it('reads a loading as its beta and fit as R-squared', () => {
    const b = normalizeBattery(BODY);
    expect(measureFigure(b.measures[1])).toBe('β 1.00');
    expect(measureFigure(b.measures[2])).toBe('R² 86%');
  });

  it('has no figure for a row with no headline number', () => {
    expect(measureFigure(normalizeMeasure({ measure: 'x', verdict: 'neutral', reading: 'r' }))).toBeNull();
  });
});
