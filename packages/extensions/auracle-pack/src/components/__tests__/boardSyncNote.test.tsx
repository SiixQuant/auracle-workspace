/**
 * The line the Board shows when it is not on the engine.
 *
 * A real install running an engine one release older than the IDE met a RED
 * sentence saying the board was "not synced", on a board they had just opened
 * for the first time. Nothing was wrong: the engine simply did not know how to
 * keep a board yet, and the board was being kept anyway. What is pinned here is
 * that the surface never says that in the colour of failure again, and that the
 * two situations behind it get their own sentence:
 *
 *  - AN ENGINE THAT ANSWERED AND REFUSED is a build older than this one. The
 *    line names the update and where to get it, because that is the one action
 *    that changes anything;
 *  - AN ENGINE THAT HAS NOT ANSWERED needs nothing but time, and sending that
 *    person to the launcher would be sending them after a problem they do not
 *    have;
 *  - and NEITHER is drawn as an error, because in both the board is kept on
 *    this machine and no work is at risk.
 *
 * The words are asserted against the exported constants rather than retyped, so
 * a change to the copy cannot pass here while shipping something else.
 *
 * WHAT THIS FILE CANNOT SEE: jsdom applies no stylesheet, so the note's COLOUR
 * is checked as the rule the Board's own sheet carries for its state, not as a
 * computed pixel. The visual result is a browser check.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const stub = vi.hoisted(() => ({ feeds: {} as Record<string, unknown> }));

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authState: vi.fn(async () => ({ signedIn: false })),
  engineConfig: vi.fn(async () => ({ engineUrl: '', hasKey: false })),
  getJson: vi.fn(async (path: string) => {
    for (const [prefix, body] of Object.entries(stub.feeds)) {
      if (path.startsWith(prefix)) return body;
    }
    return null;
  }),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: true, status: 200, body: null })),
  connectCheck: vi.fn(async () => null),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import type { PanelHost } from '@nimbalyst/extension-sdk';
import { boardGraphStore } from '../../engine/boardGraphStore';
import type { BoardGraphTransport, BoardSaveResult } from '../../engine/boardPersistence';
import { gridVitals } from '../../engine/gridVitals';
import { GridBoard } from '../grid/GridBoard';
import { BOARD_SYNC_NOTE } from '../grid/boardCopy';

/* ── fixtures ────────────────────────────────────────────────────────────── */

/** A lane that answers a write however the test needs it answered. */
function lane(answer: BoardSaveResult): BoardGraphTransport {
  return {
    async load() {
      return null;
    },
    async save() {
      return answer;
    },
  };
}

function host(): PanelHost {
  return { panelId: 'grid', extensionId: 'pack', workspacePath: '' } as unknown as PanelHost;
}

async function paint(): Promise<void> {
  await act(async () => {
    render(<GridBoard host={host()} />);
  });
}

/**
 * Open the Board on a lane that answers `answer`, then make one edit and let it
 * reach the lane. That is the whole route by which the note appears.
 */
async function boardAfterWrite(answer: BoardSaveResult): Promise<void> {
  await boardGraphStore.open('', { transport: lane(answer), saveDelayMs: 5000 });
  await paint();
  await act(async () => {
    boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Gaps revert.' } });
    await boardGraphStore.flush();
  });
}

function note(): HTMLElement | null {
  return screen.queryByTestId('board-sync-note');
}

beforeEach(() => {
  stub.feeds = {};
  gridVitals.reset();
});

afterEach(() => {
  cleanup();
  boardGraphStore.reset();
  gridVitals.reset();
  vi.restoreAllMocks();
});

/* ── nothing to report ───────────────────────────────────────────────────── */

describe('a board that is on the engine says nothing at all', () => {
  it('shows no note before anything has been written', async () => {
    await boardGraphStore.open('', { transport: lane(true), saveDelayMs: 5000 });
    await paint();

    expect(note()).toBeNull();
  });

  it('shows no note once a write lands', async () => {
    await boardAfterWrite(true);

    expect(note()).toBeNull();
    expect(boardGraphStore.getSnapshot().sync).toBe('synced');
  });
});

/* ── the two readings ────────────────────────────────────────────────────── */

describe('an engine one release behind', () => {
  /** The refusal a real install answered with: the engine validates the setting
   *  name against its own defaults and says so. */
  const REFUSED: BoardSaveResult = {
    ok: false,
    status: 400,
    message: 'unknown setting: board_graph',
  };

  it('names the state on the note itself', async () => {
    await boardAfterWrite(REFUSED);

    expect(note()?.getAttribute('data-state')).toBe('engine-behind');
  });

  it('says exactly what the copy says, and nothing the copy does not', async () => {
    await boardAfterWrite(REFUSED);

    expect(note()?.textContent).toBe(BOARD_SYNC_NOTE['engine-behind']);
    // The engine's own rejection is not a sentence to put in front of a person
    // who has done nothing wrong.
    expect(note()?.textContent).not.toContain('board_graph');
    expect(note()?.textContent).not.toContain('400');
  });

  it('names the one action that changes anything, and promises nothing is lost', () => {
    expect(BOARD_SYNC_NOTE['engine-behind']).toContain('Update the engine');
    expect(BOARD_SYNC_NOTE['engine-behind']).toContain('launcher');
    expect(BOARD_SYNC_NOTE['engine-behind']).toContain('Nothing here is lost');
  });
});

describe('an engine that has not answered', () => {
  it('names the state on the note itself', async () => {
    await boardAfterWrite({ ok: false, status: 0, message: null });

    expect(note()?.getAttribute('data-state')).toBe('offline');
  });

  it('says the calm version and does not send anybody to the launcher', async () => {
    await boardAfterWrite({ ok: false, status: 0, message: null });

    expect(note()?.textContent).toBe(BOARD_SYNC_NOTE.offline);
    expect(BOARD_SYNC_NOTE.offline).not.toContain('launcher');
    expect(BOARD_SYNC_NOTE.offline).toContain('Nothing here is lost');
  });

  it('is what a rejected credential or a timeout reads as too', async () => {
    for (const status of [401, 408, 503]) {
      await boardAfterWrite({ ok: false, status });
      expect(note()?.textContent, `${status}`).toBe(BOARD_SYNC_NOTE.offline);
      cleanup();
      boardGraphStore.reset();
    }
  });
});

/* ── never an error ──────────────────────────────────────────────────────── */

describe('neither reading is drawn as failure', () => {
  const STATES: Array<[string, BoardSaveResult]> = [
    ['engine-behind', { ok: false, status: 400, message: 'unknown setting' }],
    ['offline', { ok: false, status: 0, message: null }],
  ];

  it.each(STATES)('%s is not marked as an error on the element', async (_name, answer) => {
    await boardAfterWrite(answer);

    // `err` is the kind the Board's sheet paints in the danger tone. The sync
    // note must never carry it: nothing here has failed.
    expect(note()?.getAttribute('data-kind')).toBe('wait');
    expect(note()?.getAttribute('data-kind')).not.toBe('err');
  });

  it('the sheet paints the sync note in the caution tone, never the danger one', async () => {
    await boardAfterWrite(STATES[0][1]);

    const sheet = document.getElementById('auracle-grid-board-styles')?.textContent ?? '';
    const rule = sheet.split('\n').find((line) => line.includes(".aboard__notice[data-kind='wait']"));
    const danger = sheet.split('\n').find((line) => line.includes(".aboard__notice[data-kind='err']"));
    expect(rule).toBeDefined();
    expect(danger).toBeDefined();
    // Whatever the token table says the two colours are, they are not the same
    // one, and the note takes the quieter of them.
    const dangerColour = /color:\s*([^;]+);/.exec(danger ?? '')?.[1]?.trim();
    expect(dangerColour).toBeTruthy();
    expect(rule).not.toContain(dangerColour as string);
  });

  it('says nothing about lost work, in either reading', () => {
    for (const copy of Object.values(BOARD_SYNC_NOTE)) {
      const lower = copy.toLowerCase();
      for (const word of ['error', 'failed', 'not synced', 'unable', 'cannot']) {
        expect(lower, copy).not.toContain(word);
      }
      // The voice rules the rest of this surface keeps.
      expect(copy).not.toMatch(/[—–]/);
      expect(copy).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});
