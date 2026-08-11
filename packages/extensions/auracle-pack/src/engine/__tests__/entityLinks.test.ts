/**
 * entityLinks — the shared entity→view resolver (Frontier S3).
 *
 * The rules that matter are pure: what focus an entity lands a room on, and
 * which room a verb means. Both are asserted here so the palette grammar (#1)
 * and cross-links (#2) can trust one target list.
 */
import { describe, expect, it } from 'vitest';
import {
  ENTITY_VERBS,
  entityFocus,
  entityFromFocus,
  resolveVerb,
  type EntityRef,
} from '../entityLinks';

const PATH = 'strategies.desk.fund_pair.FundPair';
const STRATEGY: EntityRef = { kind: 'strategy', id: PATH, label: 'FundPair', strategyPath: PATH };
const RUN: EntityRef = { kind: 'run', id: '77', label: 'FundPair', strategyPath: PATH, runId: '77' };

describe('entityFocus', () => {
  it('focuses only the strategy for a strategy entity', () => {
    expect(entityFocus(STRATEGY)).toEqual({
      strategy: { filePath: PATH, dottedPath: PATH },
    });
  });

  it('focuses the strategy AND the backtest run for a run entity', () => {
    expect(entityFocus(RUN)).toEqual({
      strategy: { filePath: PATH, dottedPath: PATH },
      run: { kind: 'backtest', id: '77' },
    });
  });
});

describe('entityFromFocus (the #2 inverse)', () => {
  it('recovers a strategy entity from a bare strategy focus', () => {
    expect(entityFromFocus({ strategy: { filePath: PATH, dottedPath: PATH } }, 'FundPair')).toEqual(
      STRATEGY
    );
  });

  it('recovers a run entity when a backtest run is focused', () => {
    const ref = entityFromFocus(
      { strategy: { filePath: PATH, dottedPath: PATH }, run: { kind: 'backtest', id: '77' } },
      'FundPair'
    );
    expect(ref).toEqual(RUN);
    // round-trips back to the same focus it came from.
    expect(entityFocus(ref!)).toEqual({
      strategy: { filePath: PATH, dottedPath: PATH },
      run: { kind: 'backtest', id: '77' },
    });
  });

  it('treats a non-backtest run (deployment/validation) as a bare strategy pivot', () => {
    const ref = entityFromFocus(
      { strategy: { filePath: PATH }, run: { kind: 'deployment', id: '9' } },
      'FundPair'
    );
    expect(ref?.kind).toBe('strategy');
    expect(ref?.runId).toBeUndefined();
  });

  it('is null when no strategy is focused — nothing to link to', () => {
    expect(entityFromFocus({})).toBeNull();
    expect(entityFromFocus({ run: { kind: 'backtest', id: '5' } })).toBeNull();
  });

  it('defaults the label to the path so the resolver stays humanizer-free', () => {
    expect(entityFromFocus({ strategy: { dottedPath: PATH } })?.label).toBe(PATH);
  });
});

describe('resolveVerb', () => {
  it('resolves the canonical code to its room', () => {
    expect(resolveVerb('risk')?.room).toBe('factors');
    expect(resolveVerb('bt')?.room).toBe('backtest');
    expect(resolveVerb('ts')?.room).toBe('strategy');
  });

  it('resolves an alias, case-insensitively', () => {
    expect(resolveVerb('Factor')?.room).toBe('factors');
    expect(resolveVerb('DEPLOY')?.room).toBe('deploys');
    expect(resolveVerb('overfit')?.room).toBe('validation');
  });

  it('is null for an unknown token, so the grammar degrades to fuzzy search', () => {
    expect(resolveVerb('zzz')).toBeNull();
    expect(resolveVerb('')).toBeNull();
    expect(resolveVerb('   ')).toBeNull();
  });
});

describe('the verb table', () => {
  it('maps each verb to a distinct, real room', () => {
    const rooms = ENTITY_VERBS.map((v) => v.room);
    expect(rooms).toEqual(['strategy', 'backtest', 'factors', 'validation', 'deploys']);
    expect(new Set(rooms).size).toBe(ENTITY_VERBS.length);
  });
});
