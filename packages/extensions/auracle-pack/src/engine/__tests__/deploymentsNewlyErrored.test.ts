import { describe, expect, it } from 'vitest';

import { deploymentsNewlyErrored, type Deployment } from '../live';

function dep(id: number, state: string): Deployment {
  return {
    id,
    name: `d${id}`,
    strategy_path: `s.${id}`,
    broker: 'paper',
    mode: 'paper',
    state,
    positions: [],
  };
}

describe('deploymentsNewlyErrored', () => {
  it('returns errored rows not yet reported', () => {
    const rows = [dep(1, 'running'), dep(2, 'errored'), dep(3, 'stopped')];
    expect(deploymentsNewlyErrored(rows, new Set()).map((r) => r.id)).toEqual([2]);
  });

  it('suppresses an errored row already reported (fires once per transition)', () => {
    const rows = [dep(2, 'errored')];
    expect(deploymentsNewlyErrored(rows, new Set([2]))).toEqual([]);
  });

  it('ignores non-failed states', () => {
    const rows = [dep(1, 'running'), dep(2, 'starting'), dep(3, 'liquidating')];
    expect(deploymentsNewlyErrored(rows, new Set())).toEqual([]);
  });

  it('reports a fresh failure even when a prior one is already tracked', () => {
    const rows = [dep(2, 'errored'), dep(5, 'errored')];
    expect(deploymentsNewlyErrored(rows, new Set([2])).map((r) => r.id)).toEqual([5]);
  });
});
