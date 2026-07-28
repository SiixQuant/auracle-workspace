/**
 * What the Board's metrics peek is allowed to say.
 *
 * The badge is the case worth the most care: it has TWO states and the test
 * suite's job is to prove there is no third. A run the engine declares a source
 * for is certified and names it; a run with no declared source is a local dev
 * run; nothing in between exists, and nothing can produce a badge that mixes
 * the two. That rule is the house's honesty doctrine in one function — a local
 * number must never be able to borrow a certified one's authority.
 *
 * The figures are pinned by VALUE rather than by shape, because the whole point
 * of a peek is that it quotes the same measurement the full page shows. Any
 * drift in rounding, in the sub-annual withholding rule, or in what a missing
 * stat prints would show up here as a changed string.
 */
import { describe, expect, it } from 'vitest';

import type { BacktestResultData, BacktestSnapshot } from '../backtestStore';
import {
  peekMetrics,
  provenanceBadge,
  sparklinePath,
  validationReading,
} from '../boardMetrics';
import type { ValidationSignal } from '../validation';

function result(patch: Partial<BacktestResultData> = {}): BacktestResultData {
  return {
    equity: [1, 1.2, 1.5],
    drawdown: [0, -4.2, -1.1],
    labels: ['2016-01-04', '2016-01-05', '2016-01-06'],
    stats: { annualized_return: 0.2689, sharpe: 1.4231, max_drawdown: -0.3034 },
    asOf: '2026-07-28',
    nBars: 1890,
    trades: 128,
    ...patch,
  };
}

const IDLE_RUN: BacktestSnapshot = {
  file: null,
  strategyPath: null,
  cls: null,
  phase: 'idle',
  options: [],
  excluded: [],
  jobId: null,
  detail: null,
  outdated: false,
  result: null,
  origin: 'live',
  validation: { phase: 'idle' },
};

function signal(tier: ValidationSignal['tier']): ValidationSignal {
  return {
    signal: 'oos_gap',
    name: 'Out-of-sample gap',
    tier,
    value: null,
    threshold: null,
    plain: '',
    what_usually_fixes_it: '',
  };
}

function values(data: BacktestResultData): Record<string, string> {
  return Object.fromEntries(peekMetrics(data).map((metric) => [metric.label, metric.value]));
}

/* ── the badge ───────────────────────────────────────────────────────── */

describe('the provenance badge', () => {
  it('calls a QuantConnect run certified, and names QC', () => {
    expect(provenanceBadge('quantconnect')).toMatchObject({
      kind: 'certified',
      label: 'QC-certified',
    });
    expect(provenanceBadge('qc').label).toBe('QC-certified');
    expect(provenanceBadge('QuantConnect').label).toBe('QC-certified');
  });

  it('calls a run with no declared source a local dev run', () => {
    expect(provenanceBadge(undefined)).toMatchObject({ kind: 'local', label: 'local dev run' });
    expect(provenanceBadge('')).toMatchObject({ kind: 'local' });
  });

  it.each(['local', 'engine', 'backtest', '  LOCAL  '])(
    'reads %s as local rather than as a source that certified anything',
    (source) => {
      expect(provenanceBadge(source).kind).toBe('local');
    }
  );

  it('names a source this build has never heard of instead of calling it local', () => {
    // A future engine source must not be silently demoted to "local dev run" —
    // that would be the one direction of error the doctrine cannot tolerate.
    expect(provenanceBadge('lean')).toMatchObject({ kind: 'certified', label: 'Lean-certified' });
  });

  it('has exactly two kinds and never blends them', () => {
    const badges = ['quantconnect', 'lean', undefined, '', 'local'].map((source) =>
      provenanceBadge(source)
    );
    expect(new Set(badges.map((badge) => badge.kind))).toEqual(new Set(['certified', 'local']));
    // The note follows the badge; a local badge never mentions another platform
    // and a certified one never claims a local run.
    expect(provenanceBadge('quantconnect').note).toContain('QuantConnect');
    expect(provenanceBadge(undefined).note).toContain('this machine');
  });
});

/* ── the figures ─────────────────────────────────────────────────────── */

describe('the peek quotes the run exactly', () => {
  it('prints the four figures the way the full results page prints them', () => {
    expect(values(result())).toEqual({
      CAGR: '26.89%',
      Sharpe: '1.42',
      'Max DD': '-30.34%',
      Trades: '128',
    });
  });

  it('withholds CAGR below a year of bars, exactly as the page does', () => {
    expect(values(result({ nBars: 100 })).CAGR).toBe('—');
  });

  it('falls back to the cagr key when the engine reports that one', () => {
    expect(values(result({ stats: { cagr: 0.1 } })).CAGR).toBe('10.00%');
  });

  it('prints an em dash for a stat the engine did not report — never a zero', () => {
    expect(values(result({ stats: {} }))).toMatchObject({
      CAGR: '—',
      Sharpe: '—',
      'Max DD': '—',
    });
    expect(values(result({ trades: 0 })).Trades).toBe('—');
  });

  it('keeps the four in house order', () => {
    expect(peekMetrics(result()).map((metric) => metric.label)).toEqual([
      'CAGR',
      'Sharpe',
      'Max DD',
      'Trades',
    ]);
  });
});

/* ── the overfit check ───────────────────────────────────────────────── */

describe('the overfit check is quoted only for the run that had it', () => {
  const checked = (patch: Partial<BacktestSnapshot>): BacktestSnapshot => ({
    ...IDLE_RUN,
    jobId: 41,
    ...patch,
  });

  it('says "not checked" about any run other than the session\'s', () => {
    const session = checked({
      validation: {
        phase: 'done',
        verdict: { as_of: null, strategy_path: 'x', signals: [signal('green')], fired_details: [], plain: '' },
      },
    });

    // The session validated job 41; job 42's card must not wear its verdict.
    expect(validationReading('42', session)).toEqual({
      state: 'unchecked',
      label: 'not checked in this session',
    });
    expect(validationReading('41', session).state).toBe('clean');
  });

  it('reads a verdict the way the plan reads it', () => {
    const verdict = (signals: ValidationSignal[]) =>
      validationReading(
        '41',
        checked({
          validation: {
            phase: 'done',
            verdict: { as_of: null, strategy_path: 'x', signals, fired_details: [], plain: '' },
          },
        })
      );

    expect(verdict([signal('green'), signal('green')])).toEqual({
      state: 'clean',
      label: '2 checks healthy',
    });
    expect(verdict([signal('red'), signal('green')])).toEqual({
      state: 'attention',
      label: '1 of 2 checks need attention',
    });
    expect(verdict([])).toMatchObject({ state: 'unchecked' });
  });

  it('states the in-between phases rather than implying a verdict', () => {
    expect(validationReading('41', checked({ validation: { phase: 'running' } })).state).toBe('checking');
    expect(validationReading('41', checked({ validation: { phase: 'error' } })).state).toBe('unmeasurable');
    expect(validationReading('41', checked({ validation: { phase: 'failed' } })).state).toBe('failed');
    expect(validationReading('41', checked({ validation: { phase: 'idle' } })).state).toBe('unchecked');
  });

  it('says nothing about a session holding no run at all', () => {
    expect(validationReading('41', IDLE_RUN).state).toBe('unchecked');
  });
});

/* ── the sparkline ───────────────────────────────────────────────────── */

describe('the equity sparkline', () => {
  it('spans the box, top for the peak and bottom for the trough', () => {
    expect(sparklinePath([1, 2, 3], 100, 40)).toBe('M0 40 L50 20 L100 0');
  });

  it('draws nothing rather than a fabricated line', () => {
    // One point is not a flat curve, it is an absence of one — and a line drawn
    // through it would be a claim that the equity did not move.
    expect(sparklinePath([1], 100, 40)).toBeNull();
    expect(sparklinePath([], 100, 40)).toBeNull();
    expect(sparklinePath(null, 100, 40)).toBeNull();
    expect(sparklinePath(undefined, 100, 40)).toBeNull();
  });

  it('centres a genuinely flat series instead of pinning it to an edge', () => {
    expect(sparklinePath([1, 1, 1], 100, 40)).toBe('M0 20 L50 20 L100 20');
  });

  it('drops the nulls the engine sends for non-finite values', () => {
    // NaN and Inf arrive as JSON null; the curve is never drawn across them.
    expect(sparklinePath([1, null, 3], 100, 40)).toBe('M0 40 L100 0');
    expect(sparklinePath([1, Number.NaN, 3], 100, 40)).toBe('M0 40 L100 0');
    expect(sparklinePath([Number.POSITIVE_INFINITY, 1], 100, 40)).toBeNull();
  });
});
