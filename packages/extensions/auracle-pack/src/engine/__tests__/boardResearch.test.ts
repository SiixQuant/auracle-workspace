/**
 * The research loop's engine lane, against the engine's landed API.
 *
 * What is pinned here is the wire: the paths asked for, the keys sent, and the
 * readings taken from the answers. The engine's Board API is the authority for
 * all three, so a case that disagrees with it is this file's bug and not the
 * engine's.
 *
 * Three readings are load-bearing beyond their shape:
 *  - A COUNT NOBODY TOOK IS NOT ZERO. An engine that did not answer leaves the
 *    counter null, and a badge drawn from null is no badge at all. Reading
 *    silence as "nothing new" would tell somebody their question had gathered
 *    nothing when in fact nobody had looked.
 *  - A BUDGET IS ONLY PAUSED WHEN IT SAYS SO. `paused` is never inferred from
 *    cap and spent, because a raised cap or a rolled-over month would leave a
 *    surface insisting on a stall the engine had already lifted.
 *  - A REFUSAL IS AN ANSWER ABOUT THE BUDGET. The engine turns an automatic
 *    dispatch away with the figures that turned it away; throwing them out
 *    would mean going back to ask for what it had just said.
 *
 * The mocked seam is the main-process bridge — the client's only I/O — so the
 * real request path is exercised rather than replaced.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  BOARD_BUDGET_PATH,
  BOARD_COUNTERS_PATH,
  BOARD_QUESTIONS_PATH,
  BOARD_SYNTHESIS_PATH,
  deregisterStandingQuery,
  readMaterialCounter,
  readMaterialCounters,
  readSynthesisBudget,
  readSynthesisBudgetBody,
  recordSynthesis,
  registerStandingQuery,
  resetMaterialCounter,
} from '../boardResearch';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Answer = { ok: boolean; status: number; body: unknown };

function installBridge(routes: Record<string, Answer>): Call[] {
  const calls: Call[] = [];
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    invoke: async (channel: string, ...args: unknown[]) => {
      if (channel !== 'auracle:engine-request') return null;
      const [method, path, body] = args as [string, string, unknown];
      calls.push({ method, path, body });
      return routes[path] ?? { ok: false, status: 404, body: null };
    },
  };
  return calls;
}

/** Nothing answers at all — an engine that is not running. */
function installDeadBridge(): void {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
}

const ok = (body: unknown): Answer => ({ ok: true, status: 200, body });

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

/* ── the standing query ──────────────────────────────────────────────────── */

describe('registering a question', () => {
  it('posts the card id and the question, and nothing else', async () => {
    const calls = installBridge({ [BOARD_QUESTIONS_PATH]: ok({ ok: true }) });

    const result = await registerStandingQuery({
      nodeId: 'research-1',
      hypothesis: 'Overnight gaps mean-revert.',
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        method: 'POST',
        path: BOARD_QUESTIONS_PATH,
        body: { node_id: 'research-1', hypothesis: 'Overnight gaps mean-revert.' },
      },
    ]);
  });

  it('reports the engine own refusal rather than claiming it is watching', async () => {
    installBridge({
      [BOARD_QUESTIONS_PATH]: { ok: false, status: 422, body: { detail: 'question is too short' } },
    });

    await expect(
      registerStandingQuery({ nodeId: 'research-1', hypothesis: 'x' })
    ).resolves.toEqual({ ok: false, status: 422, message: 'question is too short' });
  });

  it('does not read an unreachable engine as a registration', async () => {
    installDeadBridge();

    const result = await registerStandingQuery({ nodeId: 'research-1', hypothesis: 'anything' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });

  it('withdraws through the card own id, escaped', async () => {
    const path = `${BOARD_QUESTIONS_PATH}/${encodeURIComponent('research 1/a')}/delete`;
    const calls = installBridge({ [path]: ok({ ok: true }) });

    await expect(deregisterStandingQuery('research 1/a')).resolves.toMatchObject({ ok: true });
    expect(calls[0].path).toBe(path);
  });

  it('sends nothing when there is no card to withdraw', async () => {
    const calls = installBridge({});
    await expect(deregisterStandingQuery('')).resolves.toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});

/* ── the counter ─────────────────────────────────────────────────────────── */

describe('the new-material counter', () => {
  /** One question as the engine states it: the registration and the count are
   *  the same row, which is why the badge is read off the question list. */
  const question = (over: Record<string, unknown> = {}) => ({
    node_id: 'research-1',
    hypothesis: 'Overnight gaps mean-revert.',
    sources: ['Yahoo Finance'],
    threshold: 1,
    enabled: true,
    new_material: 4,
    last_match_at: '2026-07-28T09:40:00Z',
    last_scored_at: '2026-07-28T10:00:00Z',
    last_reset_at: null,
    created_at: '2026-07-20T08:00:00Z',
    ...over,
  });

  it('reads every badge off the question list, in one request', async () => {
    const calls = installBridge({
      [BOARD_QUESTIONS_PATH]: ok({
        questions: [question(), question({ node_id: 'research-2', new_material: 0 })],
      }),
    });

    await expect(readMaterialCounters()).resolves.toEqual([
      { nodeId: 'research-1', newMaterial: 4, asOf: '2026-07-28T10:00:00Z' },
      { nodeId: 'research-2', newMaterial: 0, asOf: '2026-07-28T10:00:00Z' },
    ]);
    // One read for the whole board, and no counters route to ask for.
    expect(calls).toEqual([{ method: 'GET', path: BOARD_QUESTIONS_PATH, body: undefined }]);
  });

  it('dates a count by as_of, or by when the engine last scored it', async () => {
    // The counter routes state `as_of` outright; a question row says when it
    // was last scored. Both answer the same question: when was this true.
    expect(readMaterialCounter(question({ as_of: '2026-07-29T00:00:00Z' }))?.asOf).toBe(
      '2026-07-29T00:00:00Z'
    );
    expect(readMaterialCounter(question())?.asOf).toBe('2026-07-28T10:00:00Z');
    expect(readMaterialCounter(question({ last_scored_at: null }))?.asOf).toBeNull();
  });

  it('separates an engine that counted nothing from one that never answered', async () => {
    installBridge({ [BOARD_QUESTIONS_PATH]: ok({}) });
    // The engine spoke and listed nothing: an empty list, not silence.
    await expect(readMaterialCounters()).resolves.toEqual([]);

    installDeadBridge();
    await expect(readMaterialCounters()).resolves.toBeNull();
  });

  it('drops a row that names no card or states no count', () => {
    expect(readMaterialCounter({ new_material: 3 })).toBeNull();
    expect(readMaterialCounter({ node_id: 'research-1' })).toBeNull();
    expect(readMaterialCounter({ node_id: 'research-1', new_material: 'lots' })).toBeNull();
    expect(readMaterialCounter(null)).toBeNull();
  });

  it('reads a count as a whole number of items, never a negative one', () => {
    expect(readMaterialCounter({ node_id: 'r', new_material: 2.7 })?.newMaterial).toBe(2);
    expect(readMaterialCounter({ node_id: 'r', new_material: -5 })?.newMaterial).toBe(0);
    expect(readMaterialCounter({ node_id: 'r', new_material: 0 })).toEqual({
      nodeId: 'r',
      newMaterial: 0,
      asOf: null,
    });
  });

  it('resets one card counter through the counters route, escaped', async () => {
    const path = `${BOARD_COUNTERS_PATH}/${encodeURIComponent('research 1/a')}/reset`;
    const calls = installBridge({ [path]: ok({ node_id: 'research 1/a', cleared: 4 }) });

    await expect(resetMaterialCounter('research 1/a')).resolves.toMatchObject({ ok: true });
    expect(calls).toEqual([{ method: 'POST', path, body: undefined }]);
  });

  it('sends nothing when there is no counter to reset', async () => {
    const calls = installBridge({});
    await expect(resetMaterialCounter('')).resolves.toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});

/* ── the dispatch record and the budget ──────────────────────────────────── */

describe('recording a dispatch', () => {
  /** The engine's own status block, as both routes state it. */
  const status = (over: Record<string, unknown> = {}) => ({
    period: '2026-07',
    period_start: '2026-07-01T00:00:00Z',
    resets_at: '2026-08-01T00:00:00Z',
    unit: 'agent_sessions',
    cap: 20,
    unlimited: false,
    used: 18,
    remaining: 2,
    paused: false,
    ...over,
  });

  it('declares the card, who asked and which look — and nothing else', async () => {
    const calls = installBridge({ [BOARD_SYNTHESIS_PATH]: ok({ ok: true, recorded: true }) });

    await recordSynthesis({ nodeId: 'research-1', kind: 'synthesize', trigger: 'manual' });

    // A ledger entry, not a copy of the question. The hypothesis and the source
    // names travel in the agent-session prompt, which is where they are read.
    expect(calls).toEqual([
      {
        method: 'POST',
        path: BOARD_SYNTHESIS_PATH,
        body: { node_id: 'research-1', trigger: 'manual', detail: 'synthesize' },
      },
    ]);
  });

  it('takes the budget back from the reply, however the engine nested it', async () => {
    installBridge({
      [BOARD_SYNTHESIS_PATH]: ok({ ok: true, recorded: true, over_budget: false, budget: status() }),
    });

    const result = await recordSynthesis({ nodeId: 'research-1', kind: 'scan', trigger: 'manual' });

    expect(result.budget).toEqual({ cap: 20, spent: 18, paused: false });
  });

  it('runs a person over the cap, and is refused only when the loop asked', async () => {
    // The locked behaviour, both halves. A person's dispatch is RECORDED past
    // the cap and marked over budget...
    const spent = status({ used: 20, remaining: 0, paused: true });
    installBridge({
      [BOARD_SYNTHESIS_PATH]: ok({
        ok: true,
        recorded: true,
        over_budget: true,
        budget: status({ used: 21, remaining: 0, paused: true }),
      }),
    });

    const byHand = await recordSynthesis({ nodeId: 'r', kind: 'scan', trigger: 'manual' });

    expect(byHand.ok).toBe(true);
    expect(byHand.budget).toEqual({ cap: 20, spent: 21, paused: true });

    // ...while the standing loop is turned away, and the refusal still carries
    // the figures that refused it rather than leaving the surface to guess.
    installBridge({
      [BOARD_SYNTHESIS_PATH]: {
        ok: false,
        status: 429,
        body: { detail: 'the monthly dispatch budget is spent', recorded: false, budget: spent },
      },
    });

    await expect(
      recordSynthesis({ nodeId: 'r', kind: 'synthesize', trigger: 'auto' })
    ).resolves.toEqual({
      ok: false,
      status: 429,
      message: 'the monthly dispatch budget is spent',
      budget: { cap: 20, spent: 20, paused: true },
    });
  });

  it('reports a refused record rather than a spend that never happened', async () => {
    installBridge({
      [BOARD_SYNTHESIS_PATH]: { ok: false, status: 402, body: { detail: 'monthly budget spent' } },
    });

    const refused = await recordSynthesis({ nodeId: 'r', kind: 'scan', trigger: 'manual' });
    expect(refused).toMatchObject({ ok: false, status: 402, message: 'monthly budget spent' });

    // Nothing answered at all: no status, and therefore no budget to believe.
    installDeadBridge();
    await expect(
      recordSynthesis({ nodeId: 'r', kind: 'scan', trigger: 'manual' })
    ).resolves.toMatchObject({ ok: false, budget: null });
  });
});

describe('the budget', () => {
  it('reads the spend the engine states, under the engine own name for it', async () => {
    installBridge({
      [BOARD_BUDGET_PATH]: ok({
        period: '2026-07',
        unit: 'agent_sessions',
        cap: 20,
        unlimited: false,
        used: 20,
        remaining: 0,
        paused: true,
      }),
    });

    await expect(readSynthesisBudget()).resolves.toEqual({ cap: 20, spent: 20, paused: true });
  });

  it('reads no cap as no cap, however the engine says it', () => {
    // Both of the engine's ways of saying "there is no limit here" — and a
    // surface that read the zero as a figure would draw "3 of 0 used".
    expect(readSynthesisBudgetBody({ cap: 0, unlimited: true, used: 3 })).toEqual({
      cap: null,
      spent: 3,
      paused: false,
    });
    expect(readSynthesisBudgetBody({ cap: 0, used: 3 })?.cap).toBeNull();
    expect(readSynthesisBudgetBody({ cap: -1, used: 3 })?.cap).toBeNull();
  });

  it('never infers a pause from the figures', () => {
    // Used equals cap and the engine did not say paused: this client does not
    // decide that on the engine's behalf.
    expect(readSynthesisBudgetBody({ cap: 20, used: 20 })).toEqual({
      cap: 20,
      spent: 20,
      paused: false,
    });
    // And "probably" is not a state.
    expect(readSynthesisBudgetBody({ paused: 'yes' })?.paused).toBe(false);
  });

  it('states no figure the engine did not give, rather than a zero', () => {
    expect(readSynthesisBudgetBody({ paused: false })).toEqual({
      cap: null,
      spent: null,
      paused: false,
    });
    // A stated `used` of nothing is a figure, and stays one.
    expect(readSynthesisBudgetBody({ cap: 20, used: 0 })?.spent).toBe(0);
  });

  it('is null when nothing answered, so no surface claims a stall', async () => {
    installDeadBridge();
    await expect(readSynthesisBudget()).resolves.toBeNull();
  });
});
