/**
 * The research loop's visible half: what a question card counts, what pressing
 * its verb sends, and what it says when the month's budget is gone.
 *
 * The claims worth holding still, in the order they matter:
 *
 *  - ACCUMULATION IS FREE. Counters arrive on the poll the panel already runs
 *    and the badge is a READ. With auto-synthesize off, polling forever
 *    dispatches nothing — no session, no record, no spend. That is asserted
 *    against the dispatch lane itself rather than against a flag.
 *  - THE VERB IS SCOPED TO ITS CARD. The payload names the card, quotes the
 *    question and lists the NAMES of the sources wired into it. It carries no
 *    credential value, no slot name, and not even whether a slot is set — and
 *    neither does the prompt that goes to the agent session.
 *  - A DISPATCH CONSUMES WHAT IT READ. The engine is told, the counter is put
 *    back, and the badge clears on the next read rather than optimistically.
 *  - AND IT SAYS WHO ASKED. A press is recorded as manual and the standing
 *    loop's pass as auto, because the engine spends the two differently: it
 *    refuses the loop once the month is gone and runs the press anyway.
 *  - AN EXHAUSTED BUDGET IS VISIBLE. It says so on the card and it gates the
 *    toggle — the one thing this feature may never do is stall quietly.
 *  - AND IT IS STILL A DRAFT. Scan and synthesize open a prefilled session; no
 *    approval dialog stands between a person and their own evidence.
 *
 * WHAT THIS FILE CANNOT SEE: jsdom measures every box at zero, so the canvas is
 * never engaged and none of the badge's real geometry is exercised here. What
 * is asserted is presence, text and wiring.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const stub = vi.hoisted(() => ({
  /** Exact-path reads, so a route is only served where it was asked for. */
  gets: {} as Record<string, unknown>,
  posts: [] as Array<{ path: string; body: unknown }>,
  /** How much the engine currently counts for the one question under test. */
  material: 0,
  /**
   * What the engine answers a dispatch record with. Default: it recorded. Set
   * to a refusal to play the month running out mid-loop.
   */
  synthesis: null as { ok: boolean; status: number; body: unknown } | null,
}));

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authState: vi.fn(async () => ({ signedIn: false })),
  engineConfig: vi.fn(async () => ({ engineUrl: '', hasKey: false })),
  getJson: vi.fn(async (path: string) => stub.gets[path] ?? null),
  getJsonDetailed: vi.fn(async (path: string) =>
    path in stub.gets
      ? { ok: true, body: stub.gets[path] }
      : { ok: false, status: 404, body: null }
  ),
  postJson: vi.fn(async (path: string, body: unknown) => {
    stub.posts.push({ path, body });
    // The engine's own behaviour, mocked at the two points that matter: a reset
    // puts the count back, so the badge clears because the ENGINE says it is
    // back to nothing rather than because the surface assumed so...
    if (path.endsWith('/reset')) stub.material = 0;
    // ...and a dispatch record answers however the case under test needs.
    if (path === '/ui/api/board/synthesis' && stub.synthesis !== null) return stub.synthesis;
    return { ok: true, status: 200, body: { ok: true, recorded: true } };
  }),
  putJson: vi.fn(async () => ({ ok: true, status: 200, body: null })),
  connectCheck: vi.fn(async () => null),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { GridPanel } from '../grid/GridPanel';
import { getJsonDetailed } from '../../engine/client';
import { boardGraphStore } from '../../engine/boardGraphStore';
import type { BoardGraphTransport } from '../../engine/boardPersistence';
import {
  BOARD_COUNTERS_PATH,
  BOARD_QUESTIONS_PATH,
  BOARD_SYNTHESIS_PATH,
} from '../../engine/boardResearch';
import { flushStandingQueries, resetStandingQueries } from '../../engine/boardStandingQueries';
import { gridVitals } from '../../engine/gridVitals';
import { aiRunStore } from '../grid/gridAiActions';
import { resetAutoSynthesis } from '../grid/boardScan';
import { openGridHome } from '../grid/gridNav';
import { resetFaceStore, setFace } from '../grid/gridFaceStore';
import { closePalette } from '../grid/gridCommands';

/* ── fixtures ────────────────────────────────────────────────────────────── */

const SECRET_SLOT = 'desk_bars_key';
/** Every badge on the board comes off the question list — see the engine's API
 *  and {@link ../../engine/boardResearch}. There is no counters list to read. */
const QUESTIONS_PATH = BOARD_QUESTIONS_PATH;
const BUDGET_PATH = '/ui/api/board/budget';

const lane: BoardGraphTransport = {
  async load() {
    return null;
  },
  async save() {
    return true;
  },
};

let launch = vi.fn(async () => ({ ok: true, sessionId: 's-1' }));

function hostProps(): PanelHostProps {
  return {
    host: {
      panelId: 'grid',
      extensionId: 'pack',
      workspacePath: '',
      launchAgentSession: launch,
    },
  } as unknown as PanelHostProps;
}

async function paint(): Promise<void> {
  await act(async () => {
    render(<GridPanel {...hostProps()} />);
  });
}

/** Register the questions now instead of waiting out the editor's debounce. */
async function watch(): Promise<void> {
  await act(async () => {
    await flushStandingQueries();
  });
}

/** One turn of the poll the panel already runs. */
async function poll(): Promise<void> {
  await act(async () => {
    await gridVitals.refresh();
  });
}

/** What the engine currently counts and allows, in the engine's own shapes. */
function engineSays(options: {
  nodeId: string;
  material?: number;
  cap?: number;
  used?: number;
  unlimited?: boolean;
  paused?: boolean;
}): void {
  stub.material = options.material ?? 0;
  stub.gets[QUESTIONS_PATH] = {
    get questions() {
      return [
        {
          node_id: options.nodeId,
          hypothesis: 'Overnight gaps mean-revert.',
          sources: [],
          threshold: 1,
          enabled: true,
          new_material: stub.material,
          last_match_at: '2026-07-28T09:40:00Z',
          last_scored_at: '2026-07-28T10:00:00Z',
          last_reset_at: null,
          created_at: '2026-07-20T08:00:00Z',
        },
      ];
    },
  };
  const cap = options.cap ?? 20;
  const used = options.used ?? 3;
  const unlimited = options.unlimited ?? false;
  stub.gets[BUDGET_PATH] = {
    period: '2026-07',
    unit: 'agent_sessions',
    cap,
    unlimited,
    used,
    remaining: unlimited ? null : Math.max(0, cap - used),
    paused: options.paused ?? false,
  };
}

function seedResearch(hypothesis = 'Overnight gaps mean-revert.', autoSynthesize = false): string {
  return boardGraphStore.createNode({
    kind: 'research',
    research: autoSynthesize ? { hypothesis, autoSynthesize } : { hypothesis },
  });
}

/** A described source, keyed, wired into the question — the one card on the
 *  Board that has a secret anywhere near it. */
function seedWiredSource(researchId: string): string {
  const id = boardGraphStore.createNode({
    kind: 'source',
    source: {
      name: 'Yahoo Finance',
      connectorKind: 'feed',
      endpoint: 'yfinance',
      payloadType: 'daily bars',
      credentialSlot: SECRET_SLOT,
    },
  });
  boardGraphStore.wire(id, researchId);
  return id;
}

function synthesisPosts(): Array<Record<string, unknown>> {
  return stub.posts
    .filter((call) => call.path === BOARD_SYNTHESIS_PATH)
    .map((call) => call.body as Record<string, unknown>);
}

function resetPosts(): string[] {
  return stub.posts
    .filter((call) => call.path.startsWith(BOARD_COUNTERS_PATH))
    .map((call) => call.path);
}

beforeEach(async () => {
  stub.gets = {};
  stub.posts = [];
  stub.material = 0;
  stub.synthesis = null;
  launch = vi.fn(async () => ({ ok: true, sessionId: 's-1' }));
  vi.mocked(getJsonDetailed).mockClear();
  gridVitals.reset();
  aiRunStore.reset();
  resetStandingQueries();
  resetAutoSynthesis();
  resetFaceStore();
  setFace('board');
  await boardGraphStore.open('', { transport: lane, saveDelayMs: 5000 });
});

afterEach(() => {
  cleanup();
  closePalette();
  openGridHome();
  resetFaceStore();
  resetStandingQueries();
  resetAutoSynthesis();
  aiRunStore.reset();
  boardGraphStore.reset();
  gridVitals.reset();
  vi.restoreAllMocks();
});

/* ── the badge ───────────────────────────────────────────────────────────── */

describe('what a question card counts', () => {
  it('asks for no counters at all until a question is registered', async () => {
    engineSays({ nodeId: 'nobody' });
    await paint();
    await poll();

    // A Board with nothing on it costs nothing: the route is there to be read,
    // and the lane does not read it.
    expect(stub.gets[QUESTIONS_PATH]).toBeDefined();
    const asked = vi.mocked(getJsonDetailed).mock.calls.map((call) => call[0]);
    expect(asked).not.toContain(QUESTIONS_PATH);
    expect(asked).not.toContain(BUDGET_PATH);
  });

  it('wears the count the engine took, and changes the verb word for it', async () => {
    const id = seedResearch();
    engineSays({ nodeId: id, material: 4 });
    await paint();
    await watch();
    await poll();

    expect(screen.getByTestId(`board-material-${id}`).textContent).toBe('4');
    const scan = screen.getByTestId(`board-scan-${id}`);
    expect(scan.getAttribute('data-kind')).toBe('synthesize');
    expect(scan.textContent).toContain('Synthesize');
    // The dot fills in once something real is behind it.
    expect(screen.getByTestId(`board-card-dot-${id}`).getAttribute('data-health')).toBe('nominal');
  });

  it('draws no badge for a count of nothing, and none at all before one is taken', async () => {
    const id = seedResearch();
    await paint();
    // Nobody has counted yet: not a zero, an absence.
    expect(screen.queryByTestId(`board-material-${id}`)).toBeNull();
    expect(screen.getByTestId(`board-card-dot-${id}`).getAttribute('data-health')).toBe('unknown');

    engineSays({ nodeId: id, material: 0 });
    await watch();
    await poll();

    expect(screen.queryByTestId(`board-material-${id}`)).toBeNull();
    expect(screen.getByTestId(`board-scan-${id}`).getAttribute('data-kind')).toBe('scan');
    expect(screen.getByTestId(`board-card-dot-${id}`).getAttribute('data-health')).toBe('nominal');
  });
});

/* ── the deliberate-spend promise ────────────────────────────────────────── */

describe('with auto-synthesize off, the standing loop spends nothing', () => {
  it('polls and polls and never reaches the dispatch lane', async () => {
    const id = seedResearch();
    engineSays({ nodeId: id, material: 12 });
    await paint();
    await watch();
    await poll();
    await poll();
    await poll();

    expect(screen.getByTestId(`board-material-${id}`).textContent).toBe('12');
    // The whole claim, stated three ways: no session, no record, no reset.
    expect(launch).not.toHaveBeenCalled();
    expect(synthesisPosts()).toEqual([]);
    expect(resetPosts()).toEqual([]);
  });
});

describe('with auto-synthesize on, the loop acts once per reading', () => {
  it('dispatches for the card that armed it, and not again for the same count', async () => {
    const id = seedResearch('Overnight gaps mean-revert.', true);
    engineSays({ nodeId: id, material: 3 });
    await paint();
    await watch();
    await poll();

    expect(launch).toHaveBeenCalledTimes(1);
    // The loop asked, and the record says so: this is the dispatch the engine
    // refuses once the month is gone.
    expect(synthesisPosts()).toEqual([
      { node_id: id, trigger: 'auto', detail: 'synthesize' },
    ]);

    await poll();
    await poll();

    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('stays put while the budget is paused, and says so on the card', async () => {
    const id = seedResearch('Overnight gaps mean-revert.', true);
    engineSays({ nodeId: id, material: 6, cap: 20, used: 20, paused: true });
    await paint();
    await watch();
    await poll();

    expect(launch).not.toHaveBeenCalled();
    expect(synthesisPosts()).toEqual([]);
    // Never a silent stall: the reason is on the card.
    expect(screen.getByTestId(`board-budget-paused-${id}`).textContent).toContain(
      'the monthly dispatch budget is spent'
    );
  });

  it('takes a refused dispatch as the engine stating the month is gone', async () => {
    // The month runs out between the read the loop acted on and the record it
    // then made: the engine turns the automatic dispatch away with the figures
    // that turned it away, and the card takes its state from those.
    const id = seedResearch('Overnight gaps mean-revert.', true);
    engineSays({ nodeId: id, material: 4, cap: 20, used: 19 });
    stub.synthesis = {
      ok: false,
      status: 429,
      body: {
        detail: 'the monthly dispatch budget is spent',
        recorded: false,
        budget: { cap: 20, unlimited: false, used: 20, remaining: 0, paused: true },
      },
    };
    await paint();
    await watch();
    await poll();

    expect(launch).toHaveBeenCalledTimes(1);
    expect(synthesisPosts()).toEqual([{ node_id: id, trigger: 'auto', detail: 'synthesize' }]);
    // The outcome says the session opened AND that the engine did not record
    // it, in the engine's own words. A refusal that read as a clean dispatch
    // would be the surface inventing a spend nobody made.
    const note = aiRunStore.getSnapshot().outcome?.result;
    expect(note).toMatchObject({ kind: 'done' });
    expect(note && 'note' in note ? note.note : '').toContain('Agent session started');
    expect(note && 'note' in note ? note.note : '').toContain(
      'the monthly dispatch budget is spent'
    );

    // And the next read of the allowance — the one the settlement asked for —
    // now says paused, so the card stops offering to spend on its own.
    engineSays({ nodeId: id, material: 4, cap: 20, used: 20, paused: true });
    await poll();

    expect(screen.getByTestId(`board-budget-paused-${id}`).textContent).toContain(
      'the monthly dispatch budget is spent'
    );
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('will not spend against a budget the engine has not stated', async () => {
    const id = seedResearch('Overnight gaps mean-revert.', true);
    stub.gets[QUESTIONS_PATH] = {
      questions: [{ node_id: id, new_material: 5, last_scored_at: '2026-07-28T10:00:00Z' }],
    };
    // No budget route answers at all.
    await paint();
    await watch();
    await poll();

    expect(launch).not.toHaveBeenCalled();
  });
});

/* ── pressing the verb ───────────────────────────────────────────────────── */

describe('pressing the verb', () => {
  it('sends the card, the question and the wired source NAMES — and nothing else', async () => {
    const id = seedResearch('Do overnight gaps revert?');
    seedWiredSource(id);
    engineSays({ nodeId: id, material: 0 });
    await paint();
    await watch();
    await poll();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`board-scan-${id}`));
    });

    // A press is a MANUAL dispatch, and the ledger entry is only that: the card,
    // who asked, which look. The question and the source names are the prompt's
    // business, and they are checked there.
    expect(synthesisPosts()).toEqual([{ node_id: id, trigger: 'manual', detail: 'scan' }]);

    // The prompt is handed to an agent session, so it is held to the same rule.
    const prompt = launch.mock.calls[0][0] as unknown as string;
    expect(prompt).toContain('Do overnight gaps revert?');
    expect(prompt).toContain('Yahoo Finance');
    expect(prompt).toContain(id);
    for (const payload of [JSON.stringify(synthesisPosts()), prompt]) {
      expect(payload).not.toContain(SECRET_SLOT);
      expect(payload).not.toContain('credential');
      expect(payload).not.toContain('secret');
    }
  });

  it('opens a prefilled session and reports a session, never a finding', async () => {
    const id = seedResearch();
    await paint();
    await watch();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`board-scan-${id}`));
    });

    expect(launch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('board-notice').textContent).toContain('Agent session started');
    expect(screen.getByTestId('board-notice').textContent).toContain('nothing has been written yet');
  });

  it('is a draft, so nothing asks for approval first', async () => {
    const id = seedResearch();
    await paint();
    await watch();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`board-scan-${id}`));
    });

    expect(screen.queryByTestId('ai-approval')).toBeNull();
  });

  it('puts the counter back, so the badge clears on the next read', async () => {
    const id = seedResearch();
    engineSays({ nodeId: id, material: 5 });
    await paint();
    await watch();
    await poll();
    expect(screen.getByTestId(`board-material-${id}`).textContent).toBe('5');

    await act(async () => {
      fireEvent.click(screen.getByTestId(`board-scan-${id}`));
    });
    expect(resetPosts()).toEqual([`${BOARD_COUNTERS_PATH}/${id}/reset`]);

    await poll();

    expect(screen.queryByTestId(`board-material-${id}`)).toBeNull();
    expect(screen.getByTestId(`board-scan-${id}`).getAttribute('data-kind')).toBe('scan');
  });

  it('reports a refused hand-off rather than a scan that never ran', async () => {
    launch = vi.fn(async () => ({ ok: false, error: 'no model is connected' }) as never);
    const id = seedResearch();
    await paint();
    await watch();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`board-scan-${id}`));
    });

    expect(screen.getByTestId('board-notice').textContent).toBe('no model is connected');
    // Nothing was dispatched, so nothing is spent and nothing is consumed.
    expect(synthesisPosts()).toEqual([]);
    expect(resetPosts()).toEqual([]);
  });
});

/* ── the editor ──────────────────────────────────────────────────────────── */

describe('the card editor', () => {
  it('gates the auto toggle on an exhausted budget, and says which', async () => {
    const id = seedResearch();
    engineSays({ nodeId: id, material: 2, cap: 20, used: 20, paused: true });
    await paint();
    await watch();
    await poll();

    fireEvent.click(screen.getByTestId(`board-card-face-${id}`));

    const toggle = screen.getByTestId('board-editor-auto') as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.checked).toBe(false);
    expect(screen.getByTestId('board-editor-budget').textContent).toContain(
      'the monthly dispatch budget is spent'
    );
    // A person asking for their own evidence is still allowed to.
    expect((screen.getByTestId('board-editor-scan') as HTMLButtonElement).disabled).toBe(false);
  });

  it('arms one card without arming the Board, and the arming round-trips', async () => {
    const id = seedResearch();
    const other = seedResearch('Does momentum pay?');
    engineSays({ nodeId: id, material: 0 });
    await paint();
    await watch();
    await poll();

    fireEvent.click(screen.getByTestId(`board-card-face-${id}`));
    fireEvent.click(screen.getByTestId('board-editor-auto'));

    const graph = boardGraphStore.getSnapshot().graph;
    expect(graph.nodes.find((node) => node.id === id)?.research?.autoSynthesize).toBe(true);
    expect(graph.nodes.find((node) => node.id === other)?.research?.autoSynthesize).toBeUndefined();
    expect((screen.getByTestId('board-editor-auto') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('board-editor-budget').textContent).toBe(
      '3 of 20 dispatches used this month.'
    );
  });

  it('counts no limit as no limit rather than as a limit of nothing', async () => {
    const id = seedResearch();
    // An install with no cap: the engine says so twice over, and neither zero
    // may end up in a sentence as a figure.
    engineSays({ nodeId: id, material: 0, cap: 0, used: 6, unlimited: true });
    await paint();
    await watch();
    await poll();

    fireEvent.click(screen.getByTestId(`board-card-face-${id}`));

    expect(screen.getByTestId('board-editor-budget').textContent).toBe(
      'Each run spends one dispatch.'
    );
    expect((screen.getByTestId('board-editor-auto') as HTMLInputElement).disabled).toBe(false);
  });

  it('says what has arrived in words, and tells silence from nothing', async () => {
    const id = seedResearch();
    await paint();
    fireEvent.click(screen.getByTestId(`board-card-face-${id}`));
    expect(screen.getByTestId('board-editor-material').textContent).toContain('Nothing counted yet');

    engineSays({ nodeId: id, material: 1 });
    await watch();
    await poll();

    expect(screen.getByTestId('board-editor-material').textContent).toBe(
      '1 new item since the last look.'
    );
  });
});
