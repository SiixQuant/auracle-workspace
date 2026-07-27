/**
 * The sheet's readings, as pure derivation. What is pinned here is the
 * honesty policy rather than the wording: a source that has not answered
 * produces NO note (so nothing on the plan can be read as a measurement that
 * was never taken), a source that answered with nothing produces a stated
 * zero, and only conditions the engine actually reported raise a dot above
 * nominal.
 */
import { describe, expect, it } from 'vitest';
import { deriveRooms, worseHealth, type VitalSources } from '../gridVitals';
import type { BacktestSnapshot } from '../backtestStore';

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

function sources(patch: Partial<VitalSources> = {}): VitalSources {
  return {
    findings: null,
    qc: null,
    strategies: null,
    run: IDLE_RUN,
    deployments: null,
    orders: null,
    incidents: null,
    schedules: null,
    runway: null,
    connections: null,
    ...patch,
  };
}

/** A deployment row, trimmed to the fields the reading uses. */
function deployment(id: number, state: string) {
  return {
    id,
    name: `s${id}`,
    strategy_path: `strategies.s${id}.S`,
    broker: 'paper',
    mode: 'paper',
    state,
    positions: [],
  };
}

describe('an unanswered source says nothing', () => {
  const rooms = deriveRooms(sources());

  it.each(Object.keys(rooms))('%s reads quiet and nominal', (id) => {
    const vital = rooms[id as keyof typeof rooms];
    expect(vital.health).toBe('nominal');
    expect(vital.fact).toBeNull();
  });

  it('every fetched room carries no note at all', () => {
    // The two store-fed rooms (backtest, validation) always have a session
    // state to state; every route-fed room stays blank until its route answers.
    for (const id of ['findings', 'qc', 'strategies', 'deploys', 'blotter', 'incidents', 'schedules', 'runway', 'conns'] as const) {
      expect(rooms[id].note).toBeNull();
    }
  });
});

describe('an answered source states what it found', () => {
  it('distinguishes an empty feed from an absent one', () => {
    expect(deriveRooms(sources({ deployments: [] })).deploys.note).toBe('nothing deployed');
    expect(deriveRooms(sources({ deployments: null })).deploys.note).toBeNull();
    expect(deriveRooms(sources({ incidents: 0 })).incidents.note).toBe('none open');
    expect(deriveRooms(sources({ incidents: null })).incidents.note).toBeNull();
  });

  it('faults on an errored deployment and on an open incident', () => {
    const rooms = deriveRooms(
      sources({ deployments: [deployment(1, 'running'), deployment(2, 'errored')], incidents: 3 })
    );
    expect(rooms.deploys.health).toBe('fault');
    expect(rooms.deploys.note).toBe('1 running · 1 errored');
    expect(rooms.incidents.health).toBe('fault');
    expect(rooms.incidents.note).toBe('3 open');
  });

  it('caps the findings count rather than claiming a total the route never gave', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ score: 90 - i }));
    expect(deriveRooms(sources({ findings: many })).findings.note).toBe('20+ findings · top 90');
    expect(deriveRooms(sources({ findings: [{ score: 71.4 }] })).findings.note).toBe(
      '1 finding · top 71'
    );
    expect(deriveRooms(sources({ findings: [{}] })).findings.note).toBe('1 finding');
  });

  it('reads a connector in error as a fault and a wobbling one as degraded', () => {
    const conn = (id: string, state: string) => ({
      id,
      display_label: id,
      blurb: '',
      kind: 'broker',
      status: { state },
      fields: [],
      asset_kinds: [],
      test_supported: false,
      gated: false,
      gated_reason: '',
    });
    expect(deriveRooms(sources({ connections: [conn('a', 'error'), conn('b', 'connected')] })).conns).toMatchObject({
      health: 'fault',
      note: '1 of 2 in error',
    });
    expect(deriveRooms(sources({ connections: [conn('a', 'degraded')] })).conns.health).toBe('degraded');
    // Keyless by default: an unconfigured connector is a choice, not a problem.
    expect(deriveRooms(sources({ connections: [conn('a', 'not_configured')] })).conns).toMatchObject({
      health: 'nominal',
      note: '0 of 1 connected',
    });
  });

  it('reports the run and its validation from the session store', () => {
    const failed = deriveRooms(sources({ run: { ...IDLE_RUN, phase: 'failed' } }));
    expect(failed.backtest.health).toBe('degraded');

    const red = deriveRooms(
      sources({
        run: {
          ...IDLE_RUN,
          validation: {
            phase: 'done',
            verdict: {
              as_of: null,
              strategy_path: 'strategies.s.S',
              fired_details: [],
              plain: '',
              signals: [
                { signal: 'a', name: 'A', tier: 'red', value: null, threshold: null, plain: '', what_usually_fixes_it: '' },
                { signal: 'b', name: 'B', tier: 'green', value: null, threshold: null, plain: '', what_usually_fixes_it: '' },
              ],
            },
          },
        },
      })
    );
    expect(red.validation.health).toBe('degraded');
    expect(red.validation.note).toBe('1 of 2 checks need attention');
  });
});

describe('worseHealth ranks a district by its unhappiest room', () => {
  it('lets a fault beat a degradation, and a degradation beat nominal', () => {
    expect(worseHealth('nominal', 'nominal')).toBe('nominal');
    expect(worseHealth('nominal', 'degraded')).toBe('degraded');
    expect(worseHealth('degraded', 'fault')).toBe('fault');
    expect(worseHealth('fault', 'nominal')).toBe('fault');
  });
});
