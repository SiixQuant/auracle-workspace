/**
 * The sheet's readings, as pure derivation. What is pinned here is the
 * honesty policy rather than the wording: a source that has not answered
 * produces NO note (so nothing on the plan can be read as a measurement that
 * was never taken), a source that answered with nothing produces a stated
 * zero, and only conditions the engine actually reported raise a dot above
 * nominal.
 *
 * Most of the table now comes from ONE consolidated call, so the honesty rule
 * has a second half worth pinning: a district the engine could not read comes
 * back as a null BLOCK inside an otherwise healthy payload, and that has to
 * land as quiet — not as a zero, and not as the last number the block held.
 */
import { describe, expect, it } from 'vitest';
import { deriveRooms, erroredNames, worseHealth, type VitalSources } from '../gridVitals';
import type { BacktestSnapshot } from '../backtestStore';
import { summaryBody } from './summaryFixture';

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
    summary: null,
    errored: null,
    deployments: null,
    qc: null,
    strategies: null,
    orders: null,
    connections: null,
    run: IDLE_RUN,
    ...patch,
  };
}

/** An answered engine, with one block patched to whatever the case is about. */
function answered(patch: Parameters<typeof summaryBody>[0] = {}): Partial<VitalSources> {
  return { summary: summaryBody(patch), errored: [] };
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
    // state to state; every fetched room stays blank until the engine answers.
    for (const id of ['findings', 'qc', 'strategies', 'deploys', 'blotter', 'incidents', 'schedules', 'runway', 'conns'] as const) {
      expect(rooms[id].note).toBeNull();
    }
  });
});

describe('a district the engine could not read stays quiet', () => {
  it('reads a null block as nothing, never as zero', () => {
    const rooms = deriveRooms(
      sources(
        answered({
          deployments: null,
          schedules: null,
          research: null,
          runway: null,
          open_alerts: null,
          degraded: ['deployments', 'schedules', 'research', 'runway', 'incidents'],
        })
      )
    );
    for (const id of ['deploys', 'schedules', 'findings', 'runway', 'incidents'] as const) {
      expect(rooms[id]).toMatchObject({ health: 'nominal', note: null, fact: null });
    }
  });
});

describe('an answered source states what it found', () => {
  it('distinguishes an empty district from an absent one', () => {
    expect(deriveRooms(sources(answered())).deploys.note).toBe('nothing deployed');
    expect(deriveRooms(sources()).deploys.note).toBeNull();
    expect(deriveRooms(sources(answered())).incidents.note).toBe('none open');
    expect(deriveRooms(sources({ summary: summaryBody({ open_alerts: null }) })).incidents.note).toBeNull();
  });

  it('faults on an errored deployment and on an open incident', () => {
    const rooms = deriveRooms(
      sources({
        ...answered({
          deployments: { total: 2, running: 1, errored: 1 },
          open_alerts: 3,
        }),
        errored: ['strategy-2'],
      })
    );
    expect(rooms.deploys.health).toBe('fault');
    expect(rooms.deploys.note).toBe('1 running · 1 errored');
    // The names travel with the reading, so an annotation can say WHICH one.
    expect(rooms.deploys.subjects).toEqual(['strategy-2']);
    expect(rooms.incidents.health).toBe('fault');
    expect(rooms.incidents.note).toBe('3 open');
  });

  it('faults on the count alone, before the names have landed', () => {
    const rooms = deriveRooms(
      sources({
        summary: summaryBody({ deployments: { total: 1, running: 0, errored: 1 } }),
        errored: null,
      })
    );
    expect(rooms.deploys.health).toBe('fault');
    expect(rooms.deploys.subjects).toEqual([]);
  });

  it('states the findings total the engine established, with its top score', () => {
    expect(deriveRooms(sources(answered({ research: { findings: 37, top_score: 90 } }))).findings.note).toBe(
      '37 findings · top 90'
    );
    expect(deriveRooms(sources(answered({ research: { findings: 1, top_score: 71.4 } }))).findings.note).toBe(
      '1 finding · top 71'
    );
    expect(deriveRooms(sources(answered({ research: { findings: 1 } }))).findings.note).toBe('1 finding');
  });

  it('reads a connector in error as a fault and a wobbling one as degraded', () => {
    // Connections keeps the registry read the room itself uses: the
    // consolidated call counts brokers only, and the card must not disagree
    // with the room it opens.
    const conn = (id: string, state: string, kind = 'broker') => ({
      id,
      display_label: id,
      blurb: '',
      kind,
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
    // A data provider counts too — the room lists it, so the card must.
    expect(
      deriveRooms(sources({ connections: [conn('yf', 'error', 'data_provider')] })).conns.health
    ).toBe('fault');
  });

  it('counts the schedules and the stages the engine reported', () => {
    expect(deriveRooms(sources(answered({ schedules: { total: 2, active: 1 } }))).schedules.note).toBe(
      '1 enabled of 2'
    );
    expect(
      deriveRooms(sources(answered({ runway: { reached: { research: 'yes', monitor: 'no' } } }))).runway.note
    ).toBe('1 of 2 stages reached');
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

describe('the naming read behind a reported fault', () => {
  it('names the errored rows, and falls back to the id when the engine sent none', () => {
    expect(
      erroredNames([
        { id: 1, name: 'alpha', strategy_path: 's.A', broker: 'paper', mode: 'paper', state: 'errored', positions: [] },
        { id: 2, name: '', strategy_path: 's.B', broker: 'paper', mode: 'paper', state: 'errored', positions: [] },
        { id: 3, name: 'gamma', strategy_path: 's.C', broker: 'paper', mode: 'paper', state: 'running', positions: [] },
      ])
    ).toEqual(['alpha', 'deployment 2']);
    expect(erroredNames(null)).toBeNull();
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
