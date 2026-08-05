/**
 * The SignalFact → thesis composer (WS-G / FR-B6, INV-2). The contract pinned
 * here is the honesty wall: a clause only ever restates the logged facts (the
 * humanized rule plus its values), and a trade that logged NO signal composes
 * to null — never an empty string, never a fabricated sentence.
 */
import { describe, expect, it } from 'vitest';
import type { SignalFact } from '../client';
import { composeSignalClause, composeThesis } from '../signalThesis';

describe('composeSignalClause', () => {
  it('renders the reference example: rule + gap, the confirming flag elided', () => {
    const fact: SignalFact = { rule: 'ma_cross_20_50', values: { crossed: true, gap_pct: 0.031 } };
    // `crossed:true` merely restates the "MA cross" rule, so it is dropped; the
    // gap is a real added fact, rendered as a signed percent.
    expect(composeSignalClause(fact)).toBe('20/50 MA cross · gap +3.1%');
  });

  it('renders a plain (non-percent) numeric value at trimmed precision', () => {
    const fact: SignalFact = { rule: 'ma_cross_20_100', values: { crossed: true, breadth: 0.62 } };
    expect(composeSignalClause(fact)).toBe('20/100 MA cross · breadth 0.62');
  });

  it('keeps a non-confirming boolean, and negates a false flag', () => {
    const fact: SignalFact = { rule: 'breakout_high', values: { volume_surge: true, overbought: false } };
    expect(composeSignalClause(fact)).toBe('breakout high · volume surge · not overbought');
  });

  it('uppercases known indicator tokens and lifts numeric params to the front', () => {
    expect(composeSignalClause({ rule: 'rsi_oversold', values: { level: 28 } })).toBe(
      'RSI oversold · level 28'
    );
    expect(composeSignalClause({ rule: 'ema_cross_9_21', values: {} })).toBe('9/21 EMA cross');
  });

  it('falls back to a bare label for an unknown rule, still restating its values', () => {
    expect(composeSignalClause({ rule: 'custom_edge', values: { z_score: 1.5 } })).toBe(
      'custom edge · z score 1.5'
    );
  });
});

describe('composeThesis', () => {
  it('composes one clause per SignalFact, in order', () => {
    const signals: SignalFact[] = [
      { rule: 'ma_cross_20_50', values: { gap_pct: 0.031 } },
      { rule: 'rsi_oversold', values: { level: 30 } },
    ];
    expect(composeThesis(signals)).toEqual(['20/50 MA cross · gap +3.1%', 'RSI oversold · level 30']);
  });

  it('is NULL for a trade that logged no signal — no sentence, no fabrication', () => {
    expect(composeThesis([])).toBeNull();
    expect(composeThesis(null)).toBeNull();
    expect(composeThesis(undefined)).toBeNull();
  });
});
