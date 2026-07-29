/**
 * The research loop's engine lane, as a contract.
 *
 * The routes land in a parallel engine change and the render harness serves
 * them meanwhile, so what is pinned here is what that change has to honour: the
 * paths, the request bodies, and the readings taken from the answers.
 *
 * Two of those readings are load-bearing beyond their shape:
 *  - A COUNT NOBODY TOOK IS NOT ZERO. An engine that did not answer leaves the
 *    counter null, and a badge drawn from null is no badge at all. Reading
 *    silence as "nothing new" would tell somebody their question had gathered
 *    nothing when in fact nobody had looked.
 *  - A BUDGET IS ONLY PAUSED WHEN IT SAYS SO. `paused` is never inferred from
 *    cap and spent, because a raised cap or a rolled-over month would leave a
 *    surface insisting on a stall the engine had already lifted.
 *
 * The mocked seam is the main-process bridge — the client's only I/O — so the
 * real request path is exercised rather than replaced.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  BOARD_BUDGET_PATH,
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
  const path = `${BOARD_QUESTIONS_PATH}/counters`;

  it('reads the rows the engine counted', async () => {
    installBridge({
      [path]: ok({
        counters: [{ node_id: 'research-1', new_material: 4, as_of: '2026-07-28T10:00:00Z' }],
      }),
    });

    await expect(readMaterialCounters()).resolves.toEqual([
      { nodeId: 'research-1', newMaterial: 4, asOf: '2026-07-28T10:00:00Z' },
    ]);
  });

  it('separates an engine that counted nothing from one that never answered', async () => {
    installBridge({ [path]: ok({}) });
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

  it('resets one card counter through its own route', async () => {
    const path = `${BOARD_QUESTIONS_PATH}/research-1/counter/reset`;
    const calls = installBridge({ [path]: ok({ ok: true }) });

    await expect(resetMaterialCounter('research-1')).resolves.toMatchObject({ ok: true });
    expect(calls).toEqual([{ method: 'POST', path, body: undefined }]);
  });
});

/* ── the dispatch record and the budget ──────────────────────────────────── */

describe('recording a dispatch', () => {
  it('declares the card, the kind, the question and the source NAMES', async () => {
    const calls = installBridge({ [BOARD_SYNTHESIS_PATH]: ok({ ok: true }) });

    await recordSynthesis({
      nodeId: 'research-1',
      kind: 'synthesize',
      hypothesis: 'Overnight gaps mean-revert.',
      sources: ['Yahoo Finance', 'Desk drop'],
    });

    expect(calls).toEqual([
      {
        method: 'POST',
        path: BOARD_SYNTHESIS_PATH,
        body: {
          node_id: 'research-1',
          kind: 'synthesize',
          hypothesis: 'Overnight gaps mean-revert.',
          sources: ['Yahoo Finance', 'Desk drop'],
        },
      },
    ]);
  });

  it('takes the budget back from the reply, however the engine nested it', async () => {
    installBridge({
      [BOARD_SYNTHESIS_PATH]: ok({ ok: true, budget: { cap: 20, spent: 18, paused: false } }),
    });

    const result = await recordSynthesis({
      nodeId: 'research-1',
      kind: 'scan',
      hypothesis: 'anything',
      sources: [],
    });

    expect(result.budget).toEqual({ cap: 20, spent: 18, paused: false });
  });

  it('reports a refused record rather than a spend that never happened', async () => {
    installBridge({
      [BOARD_SYNTHESIS_PATH]: { ok: false, status: 402, body: { detail: 'monthly budget spent' } },
    });

    await expect(
      recordSynthesis({ nodeId: 'r', kind: 'scan', hypothesis: 'q', sources: [] })
    ).resolves.toEqual({ ok: false, status: 402, message: 'monthly budget spent', budget: null });
  });
});

describe('the budget', () => {
  it('reads the three fields, and nothing it was not told', async () => {
    installBridge({ [BOARD_BUDGET_PATH]: ok({ cap: 20, spent: 20, paused: true }) });

    await expect(readSynthesisBudget()).resolves.toEqual({ cap: 20, spent: 20, paused: true });
  });

  it('never infers a pause from the figures', () => {
    // Spent equals cap and the engine did not say paused: this client does not
    // decide that on the engine's behalf.
    expect(readSynthesisBudgetBody({ cap: 20, spent: 20 })).toEqual({
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
  });

  it('is null when nothing answered, so no surface claims a stall', async () => {
    installDeadBridge();
    await expect(readSynthesisBudget()).resolves.toBeNull();
  });
});
