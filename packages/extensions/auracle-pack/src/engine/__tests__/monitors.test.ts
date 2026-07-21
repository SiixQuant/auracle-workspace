import { describe, expect, it } from 'vitest';

import {
  blotterContext,
  incidentDismissTarget,
  incidentJobId,
  incidentsContext,
  runwayContext,
} from '../monitors';

describe('blotterContext', () => {
  it('counts and bounds the order feed to 20', () => {
    const orders = Array.from({ length: 25 }, (_, i) => ({
      symbol: 'SPY',
      action: 'buy',
      status: 'filled',
      plain: `order ${i}`,
    }));
    const ctx = blotterContext(orders);
    expect(ctx.panel).toBe('blotter');
    expect(ctx.count).toBe(25);
    expect((ctx.orders as unknown[]).length).toBe(20);
  });

  it('defaults a missing status honestly', () => {
    const ctx = blotterContext([{ symbol: 'AAPL' }]);
    expect((ctx.orders as Array<{ status: string }>)[0].status).toBe('unknown');
  });
});

describe('incidentsContext', () => {
  it('passes severity/cause/detail through with an info default', () => {
    const ctx = incidentsContext([
      { cause: 'stale data' },
      { severity: 'critical', cause: 'broker down', detail: 'timeout' },
    ]);
    expect(ctx.count).toBe(2);
    const rows = ctx.incidents as Array<{ severity: string; cause: string | null }>;
    expect(rows[0].severity).toBe('info');
    expect(rows[1].severity).toBe('critical');
  });
});

describe('incidentDismissTarget', () => {
  it('prefers the engine\'s nested dismiss object', () => {
    expect(incidentDismissTarget({ dismiss: { kind: 'failed_job', id: 42 } })).toEqual({
      kind: 'failed_job',
      id: 42,
    });
  });

  it('falls back to the legacy flat fields when there is no nested object', () => {
    expect(incidentDismissTarget({ dismiss_kind: 'error_log', dismiss_id: 9 })).toEqual({
      kind: 'error_log',
      id: 9,
    });
  });

  it('is null when neither a kind nor an id is present', () => {
    expect(incidentDismissTarget({})).toBeNull();
    expect(incidentDismissTarget({ dismiss: { kind: 'x' } })).toBeNull();
    expect(incidentDismissTarget({ dismiss_id: 3 })).toBeNull();
  });
});

describe('incidentJobId', () => {
  it('returns the job id of an open_job action', () => {
    expect(incidentJobId({ action: { kind: 'open_job', job_id: 7 } })).toBe(7);
  });

  it('is null for any other action, or none', () => {
    expect(incidentJobId({})).toBeNull();
    expect(incidentJobId({ action: null })).toBeNull();
    expect(incidentJobId({ action: { kind: 'open_job' } })).toBeNull();
    expect(incidentJobId({ action: { kind: 'other', job_id: 7 } })).toBeNull();
  });
});

describe('runwayContext', () => {
  it('normalizes each stage truth with unknown/empty defaults', () => {
    const ctx = runwayContext({
      research: { reached: 'yes', evidence: '3 findings' },
      build: {},
    });
    expect(ctx.panel).toBe('runway');
    const stages = ctx.stages as Record<string, { reached: string; evidence: string }>;
    expect(stages.research).toEqual({ reached: 'yes', evidence: '3 findings' });
    expect(stages.build).toEqual({ reached: 'unknown', evidence: '' });
  });
});
