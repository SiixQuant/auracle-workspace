/**
 * Keeping the engine's watched questions equal to the Board's, and costing
 * nothing to do it.
 *
 * The claims held still here:
 *  - a question is registered on a REST, not on a keystroke, so writing a
 *    sentence is one request rather than forty;
 *  - a pass that finds nothing changed sends NOTHING. That is what makes
 *    re-opening a Board, or a poll landing beside it, free;
 *  - a card that leaves the Board is withdrawn, and a card nobody wrote on was
 *    never registered in the first place;
 *  - a refused registration is not believed: the next pass tries again;
 *  - and closing a Board, or opening a different workspace, withdraws NOTHING.
 *    Losing sight of a question is not the same as deleting it, and a window
 *    that tidied up on the way out would silently stop a colleague's research.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardGraphStore } from '../boardGraphStore';
import type { BoardGraphTransport } from '../boardPersistence';
import { BOARD_QUESTIONS_PATH } from '../boardResearch';
import {
  flushStandingQueries,
  hasStandingQueries,
  questionsOf,
  resetStandingQueries,
  standingQueryIds,
  standingQueryPlan,
  startStandingQueries,
} from '../boardStandingQueries';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const calls: Call[] = [];
let answer: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: {} };

function installBridge(): void {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    invoke: async (channel: string, ...args: unknown[]) => {
      if (channel !== 'auracle:engine-request') return null;
      const [method, path, body] = args as [string, string, unknown];
      calls.push({ method, path, body });
      return answer;
    },
  };
}

/** The graph store's own lane, stubbed so nothing here touches the settings
 *  route: this file is about the QUESTION lane. */
const lane: BoardGraphTransport = {
  async load() {
    return null;
  },
  async save() {
    return true;
  },
};

function registrations(): unknown[] {
  return calls.filter((call) => call.path === BOARD_QUESTIONS_PATH).map((call) => call.body);
}

function withdrawals(): string[] {
  return calls
    .filter((call) => call.path.endsWith('/delete'))
    .map((call) => call.path.slice(BOARD_QUESTIONS_PATH.length + 1, -'/delete'.length));
}

async function openBoard(workspaceId = 'ws-1'): Promise<void> {
  await boardGraphStore.open(workspaceId, { transport: lane, saveDelayMs: 5000 });
}

beforeEach(async () => {
  calls.length = 0;
  answer = { ok: true, status: 200, body: {} };
  installBridge();
  resetStandingQueries();
  await openBoard();
});

afterEach(() => {
  resetStandingQueries();
  boardGraphStore.reset();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.useRealTimers();
});

/* ── the plan (pure) ─────────────────────────────────────────────────────── */

describe('what a pass would send', () => {
  it('reads a graph as the questions it is asking', () => {
    const questions = questionsOf({
      nodes: [
        { id: 'r1', kind: 'research', research: { hypothesis: '  Do gaps revert?  ' } },
        { id: 'r2', kind: 'research', research: { hypothesis: '   ' } },
        { id: 's1', kind: 'source', source: { name: 'x', connectorKind: '', endpoint: '', payloadType: '' } },
      ],
      edges: [],
    });

    // Trimmed, and a card nobody wrote on is not a question.
    expect([...questions]).toEqual([['r1', 'Do gaps revert?']]);
  });

  it('sends nothing at all when the two sides already agree', () => {
    const same = new Map([['r1', 'Do gaps revert?']]);
    expect(standingQueryPlan(same, new Map(same))).toEqual({ register: [], deregister: [] });
  });

  it('registers what is new or changed, and withdraws what has gone', () => {
    const known = new Map([
      ['r1', 'Do gaps revert?'],
      ['r2', 'Does momentum pay?'],
    ]);
    const wanted = new Map([
      ['r1', 'Do gaps revert in liquid futures?'],
      ['r3', 'Is carry seasonal?'],
    ]);

    expect(standingQueryPlan(known, wanted)).toEqual({
      register: [
        { nodeId: 'r1', hypothesis: 'Do gaps revert in liquid futures?' },
        { nodeId: 'r3', hypothesis: 'Is carry seasonal?' },
      ],
      deregister: ['r2'],
    });
  });
});

/* ── the lifecycle ───────────────────────────────────────────────────────── */

describe('the lifecycle of one question', () => {
  it('registers on a rest rather than on a keystroke', async () => {
    vi.useFakeTimers();
    const stop = startStandingQueries({ delayMs: 700 });
    try {
      const id = boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'D' } });
      // Somebody typing: every character is a store write.
      for (const text of ['Do', 'Do g', 'Do gaps revert?']) {
        boardGraphStore.updateNode(id, { research: { hypothesis: text } });
        await vi.advanceTimersByTimeAsync(120);
      }
      expect(registrations()).toEqual([]);

      await vi.advanceTimersByTimeAsync(700);

      expect(registrations()).toEqual([{ node_id: id, hypothesis: 'Do gaps revert?' }]);
    } finally {
      stop();
    }
  });

  it('sends nothing on a second pass that found the same question', async () => {
    const stop = startStandingQueries({ delayMs: 5 });
    try {
      boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Do gaps revert?' } });
      await flushStandingQueries();
      expect(registrations()).toHaveLength(1);

      await flushStandingQueries();
      await flushStandingQueries();

      expect(registrations()).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it('re-states a question that was edited, once', async () => {
    const stop = startStandingQueries({ delayMs: 5 });
    try {
      const id = boardGraphStore.createNode({
        kind: 'research',
        research: { hypothesis: 'Do gaps revert?' },
      });
      await flushStandingQueries();

      boardGraphStore.updateNode(id, { research: { hypothesis: 'Do gaps revert in futures?' } });
      await flushStandingQueries();
      await flushStandingQueries();

      expect(registrations()).toEqual([
        { node_id: id, hypothesis: 'Do gaps revert?' },
        { node_id: id, hypothesis: 'Do gaps revert in futures?' },
      ]);
    } finally {
      stop();
    }
  });

  it('never registers a card nobody has written on', async () => {
    const stop = startStandingQueries({ delayMs: 5 });
    try {
      boardGraphStore.createNode({ kind: 'research', research: { hypothesis: '' } });
      boardGraphStore.createNode({
        kind: 'source',
        source: { name: 'Yahoo', connectorKind: 'feed', endpoint: 'yfinance', payloadType: 'bars' },
      });
      await flushStandingQueries();

      expect(calls).toEqual([]);
      expect(hasStandingQueries()).toBe(false);
    } finally {
      stop();
    }
  });

  it('withdraws a question whose card was removed', async () => {
    const stop = startStandingQueries({ delayMs: 5 });
    try {
      const id = boardGraphStore.createNode({
        kind: 'research',
        research: { hypothesis: 'Do gaps revert?' },
      });
      await flushStandingQueries();
      expect(standingQueryIds()).toEqual([id]);

      boardGraphStore.deleteNode(id);
      await flushStandingQueries();

      expect(withdrawals()).toEqual([id]);
      expect(hasStandingQueries()).toBe(false);
    } finally {
      stop();
    }
  });

  it('withdraws a question whose text was emptied', async () => {
    const stop = startStandingQueries({ delayMs: 5 });
    try {
      const id = boardGraphStore.createNode({
        kind: 'research',
        research: { hypothesis: 'Do gaps revert?' },
      });
      await flushStandingQueries();

      boardGraphStore.updateNode(id, { research: { hypothesis: '' } });
      await flushStandingQueries();

      expect(withdrawals()).toEqual([id]);
    } finally {
      stop();
    }
  });

  it('does not believe a registration the engine refused', async () => {
    answer = { ok: false, status: 500, body: { detail: 'retriever is down' } };
    const stop = startStandingQueries({ delayMs: 5 });
    try {
      boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Do gaps revert?' } });
      await flushStandingQueries();
      expect(hasStandingQueries()).toBe(false);

      answer = { ok: true, status: 200, body: {} };
      await flushStandingQueries();

      expect(registrations()).toHaveLength(2);
      expect(hasStandingQueries()).toBe(true);
    } finally {
      stop();
    }
  });
});

/* ── what it refuses to do ───────────────────────────────────────────────── */

describe('what losing sight of a Board does not do', () => {
  it('withdraws nothing when a different workspace opens', async () => {
    const stop = startStandingQueries({ delayMs: 5 });
    try {
      boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Do gaps revert?' } });
      await flushStandingQueries();
      calls.length = 0;

      await openBoard('ws-2');
      await flushStandingQueries();

      expect(withdrawals()).toEqual([]);
      // The other Board's questions are simply no longer this window's to see.
      expect(hasStandingQueries()).toBe(false);
    } finally {
      stop();
    }
  });

  it('sends nothing at all while no workspace is open', async () => {
    const stop = startStandingQueries({ delayMs: 5 });
    try {
      boardGraphStore.reset();
      await flushStandingQueries();

      expect(calls).toEqual([]);
    } finally {
      stop();
    }
  });
});
