/**
 * The words that make the Board self-explaining.
 *
 * The Board ships no tour and no documentation of its own, so the copy IS the
 * feature here: a first-time person reaching this face has the three ghost
 * slots, the line above them and the panel's help entry, and nothing else. Four
 * things are asserted, because each is a way that promise could quietly break:
 *
 *  - THE MODEL IS WHOLE. Connect, ask, watch, in that order, with the cost of
 *    each said plainly. A slot that stopped naming its step would leave a third
 *    of the feature unexplained and nothing else would fail;
 *  - IT SURVIVES EVERY TIER. The tiers are read out of the Board's own
 *    stylesheet rather than guessed at, and the copy is asserted at each of
 *    them — a rule that hid a line on a narrow pane would be hiding the manual;
 *  - THE HELP ENTRY IS CURRENT. It names both faces, the control and key that
 *    switch them, and the rule that configuring never navigates;
 *  - AND NOTHING IT NAMES IS DEAD. Every card kind, verb word and key the copy
 *    mentions is checked against the code that would have to honour it: the
 *    kinds against the graph's own list, the verbs against the verb table, and
 *    the key by pressing it and watching the face flip.
 *
 * WHAT THIS FILE CANNOT SEE: jsdom implements no container queries and measures
 * every box at zero, so nothing here can claim a LAYOUT at a tier. What it can
 * claim, and does, is that the copy is not conditioned on width in JS (the same
 * nodes are present at every tier width) and that no tier rule in the sheet
 * hides one. The visual result is a browser check.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

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

import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import manifest from '../../../manifest.json';
import { BOARD_NODE_KINDS } from '../../engine/boardGraph';
import { boardGraphStore } from '../../engine/boardGraphStore';
import { builtInNodeId } from '../../engine/boardBuiltins';
import type { BoardGraphTransport } from '../../engine/boardPersistence';
import { gridVitals } from '../../engine/gridVitals';
import { GridPanel } from '../grid/GridPanel';
import {
  BOARD_HINT,
  BUILT_IN_SOURCE_NOTE,
  GHOSTS,
  RESEARCH_GHOST,
  RESEARCH_PLACEHOLDER,
  SOURCE_GHOST,
} from '../grid/boardCopy';
import { SCAN_WORD } from '../grid/boardScan';
import { closePalette } from '../grid/gridCommands';
import { resetFaceStore, setFace } from '../grid/gridFaceStore';
import { openGridHome } from '../grid/gridNav';

/* ── fixtures ────────────────────────────────────────────────────────────── */

const lane: BoardGraphTransport = {
  async load() {
    return null;
  },
  async save() {
    return true;
  },
};

function hostProps(): PanelHostProps {
  return {
    host: { panelId: 'grid', extensionId: 'pack', workspacePath: '' },
  } as unknown as PanelHostProps;
}

async function paint(): Promise<void> {
  await act(async () => {
    render(<GridPanel {...hostProps()} />);
  });
}

/** The registry answering, the way the pack's own poll delivers it. */
async function registry(rows: Array<Record<string, unknown>>): Promise<void> {
  stub.feeds['/ui/api/connections'] = { connections: rows };
  await act(async () => {
    await gridVitals.refresh();
  });
}

/** A keyless connector as a fresh install reports it. */
function keyless(id: string, label: string, blurb: string): Record<string, unknown> {
  return {
    id,
    display_label: label,
    blurb,
    kind: 'data_provider',
    status: { state: 'connected', detail: null },
    fields: [],
  };
}

function hint(): string {
  return screen.getByTestId('board-hint').textContent ?? '';
}

/** Every user-facing word the empty Board puts on screen. */
function emptyStateCopy(): string {
  return `${hint()} ${screen.getByTestId('board-ghosts').textContent ?? ''}`;
}

/** The panel's help entry: the tooltip the host reads out of the manifest and
 *  serves as this panel's help content. */
const helpEntry: string =
  (manifest as { contributions: { panels: Array<{ id: string; tooltip?: string }> } }).contributions
    .panels[0].tooltip ?? '';

beforeEach(async () => {
  stub.feeds = {};
  gridVitals.reset();
  resetFaceStore();
  setFace('board');
  await boardGraphStore.open('', { transport: lane, saveDelayMs: 5000 });
});

afterEach(() => {
  cleanup();
  closePalette();
  openGridHome();
  resetFaceStore();
  boardGraphStore.reset();
  gridVitals.reset();
  vi.restoreAllMocks();
});

/* ── the model, in three slots ───────────────────────────────────────────── */

describe('the three slots teach the whole model', () => {
  it('draws them in the order a person meets them: connect, ask, watch', async () => {
    await paint();

    const slots = Array.from(
      screen.getByTestId('board-ghosts').querySelectorAll<HTMLElement>('[data-ghost]')
    ).map((el) => el.getAttribute('data-ghost'));

    expect(slots).toEqual(GHOSTS.map((ghost) => ghost.id));
    expect(slots).toEqual(['source', 'research', 'materialized']);
  });

  it('names connecting a source, and does not claim the free ones are here yet', async () => {
    await paint();

    const body = screen.getByTestId('board-ghost-source').textContent ?? '';
    expect(body).toContain(SOURCE_GHOST.title);
    expect(body).toContain('worth reading');
    // The keyless cards land only once the engine has answered, and on this
    // screen it has not: the slot promises they arrive rather than saying they
    // are already on the board.
    expect(body).toContain('arrive on their own');
    expect(body).not.toContain('already');
  });

  it('names asking, and says the question stands', async () => {
    await paint();

    const body = screen.getByTestId('board-ghost-research').textContent ?? '';
    expect(body).toContain(RESEARCH_GHOST.title);
    expect(body).toContain('The question stands');
    expect(body).toContain('read against it');
  });

  it('names watching, and prices it: gathering free, one agent session per verb', async () => {
    await paint();

    const body = screen.getByTestId('board-ghost-materialized').textContent ?? '';
    expect(body).toContain('costs nothing');
    expect(body).toContain('one agent session');
    // The cards nobody places still have to be accounted for.
    expect(body).toContain('appear here');
  });

  it('is the whole model: connect, ask and the cost of watching, all on one screen', async () => {
    await paint();

    const copy = emptyStateCopy();
    expect(copy).toContain(SOURCE_GHOST.title);
    expect(copy).toContain(RESEARCH_GHOST.title);
    expect(copy).toContain('costs nothing');
    expect(copy).toContain('one agent session');
  });
});

/* ── the voice ───────────────────────────────────────────────────────────── */

describe('the product voice holds', () => {
  /** The words this surface never uses. They are how the thing is built, not
   *  what it does, and a person reading them learns nothing. */
  const JARGON = [
    'RAG',
    'vector',
    'pgvector',
    'embedding',
    'corpus',
    'ingest',
    'endpoint',
    'API',
  ];

  const SURFACES: Array<[string, string]> = [
    ['the empty state', [...GHOSTS.map((g) => `${g.title} ${g.body}`), ...Object.values(BOARD_HINT)].join(' ')],
    ['the question placeholder', RESEARCH_PLACEHOLDER],
    ['the keyless note', BUILT_IN_SOURCE_NOTE],
    ['the help entry', helpEntry],
  ];

  it.each(SURFACES)('%s carries no jargon', (_name, copy) => {
    const lower = copy.toLowerCase();
    for (const word of JARGON) {
      expect(lower).not.toContain(word.toLowerCase());
    }
  });

  it.each(SURFACES)('%s carries no emoji and no em-dash', (_name, copy) => {
    expect(copy).not.toMatch(/[—–]/);
    expect(copy).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('never promises a key can be read back', () => {
    // The one claim about secrets this pack makes, and the shape of it: stored,
    // and gone from every surface afterwards.
    const copy = SURFACES.map(([, text]) => text).join(' ').toLowerCase();
    expect(copy).not.toContain('shown again');
    expect(copy).not.toContain('view your key');
  });
});

/* ── every tier ──────────────────────────────────────────────────────────── */

/**
 * The tiers the Board actually renders at, read out of its own stylesheet: the
 * base one plus every `@container` breakpoint in the sheet. Guessing them here
 * would let a new tier ship with copy nobody ever asserted.
 */
function boardTiers(): number[] {
  const sheet = document.getElementById('auracle-grid-board-styles')?.textContent ?? '';
  const widths = Array.from(sheet.matchAll(/@container auracle-grid \(min-width: (\d+)px\)/g)).map(
    (match) => Number(match[1])
  );
  return [0, ...new Set(widths)].sort((a, b) => a - b);
}

describe('the copy renders at every tier the Board renders at', () => {
  it('reads more than one tier out of the sheet, so the sweep is not vacuous', async () => {
    await paint();

    const tiers = boardTiers();
    expect(tiers.length).toBeGreaterThanOrEqual(3);
    expect(tiers[0]).toBe(0);
  });

  it('says the same thing at each of them', async () => {
    await paint();

    for (const width of boardTiers()) {
      // jsdom applies no container query, so this documents the tier rather
      // than producing it; what is asserted is that the copy is not width-
      // conditional in JS, which is the part a component can get wrong.
      const panel = screen.getByTestId('auracle-grid');
      act(() => {
        panel.style.width = `${width}px`;
      });

      expect(hint(), `hint at ${width}px`).toBe(BOARD_HINT.empty);
      for (const ghost of GHOSTS) {
        const slot = screen.getByTestId(`board-ghost-${ghost.id}`);
        expect(slot.textContent, `${ghost.id} at ${width}px`).toContain(ghost.title);
        expect(slot.textContent, `${ghost.id} body at ${width}px`).toContain(ghost.body);
      }
    }
  });

  it('no tier rule hides a line of it', async () => {
    await paint();

    const sheet = document.getElementById('auracle-grid-board-styles')?.textContent ?? '';
    expect(sheet).not.toBe('');
    // Every rule inside a tier block, against the selectors that carry words.
    const COPY_SELECTORS = ['.aboard__hint', '.aboard__ghosts', '.aboard__ghost', '.aboard__gbody', '.aboard__gtitle'];
    for (const block of sheet.split('@container').slice(1)) {
      for (const rule of block.split('}')) {
        if (!COPY_SELECTORS.some((selector) => rule.includes(selector))) continue;
        expect(rule).not.toMatch(/display\s*:\s*none/);
        expect(rule).not.toMatch(/visibility\s*:\s*hidden/);
        expect(rule).not.toMatch(/font-size\s*:\s*0/);
      }
    }
  });

  it('keeps the two moves within reach once the ghosts are gone', async () => {
    boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Gaps revert.' } });
    await paint();

    expect(screen.queryByTestId('board-ghosts')).toBeNull();
    // The same two names, so nobody has to learn a second vocabulary.
    expect(screen.getByTestId('board-add-source').textContent).toContain(SOURCE_GHOST.title);
    expect(screen.getByTestId('board-add-research').textContent).toContain(RESEARCH_GHOST.title);
  });
});

/* ── first run ───────────────────────────────────────────────────────────── */

describe('the sources that came with the engine introduce themselves', () => {
  it('greets an untouched board with them rather than describing work nobody did', async () => {
    await paint();
    expect(hint()).toBe(BOARD_HINT.empty);

    await registry([
      keyless('yfinance', 'Yahoo Finance', 'Free daily bars, zero config'),
      keyless('simulator', 'Simulator', 'Paper fills'),
    ]);

    // The bootstrap has laid them down, so the ghosts are gone — and the line
    // above the cards is the one that says where they came from.
    expect(screen.getByTestId(`board-card-title-${builtInNodeId('yfinance')}`)).toBeTruthy();
    expect(screen.queryByTestId('board-ghosts')).toBeNull();
    expect(hint()).toBe(BOARD_HINT.firstRun);
    // And it names the move that is still outstanding, in the words the
    // control for it uses.
    expect(hint()).toContain(RESEARCH_GHOST.title);
    expect(hint()).toContain('no key');
  });

  it('turns to the working line the moment a person puts something down', async () => {
    await paint();
    await registry([keyless('yfinance', 'Yahoo Finance', 'Free daily bars, zero config')]);
    expect(hint()).toBe(BOARD_HINT.firstRun);

    await act(async () => {
      boardGraphStore.createNode({ kind: 'research', research: { hypothesis: 'Gaps revert.' } });
    });

    expect(hint()).toBe(BOARD_HINT.working);
  });

  it('says in the card own editor that nothing was typed there and nothing needs to be', async () => {
    await paint();
    await registry([keyless('yfinance', 'Yahoo Finance', 'Free daily bars, zero config')]);

    fireEvent.click(screen.getByTestId(`board-card-face-${builtInNodeId('yfinance')}`));

    expect(screen.getByTestId('board-editor-builtin').textContent).toBe(BUILT_IN_SOURCE_NOTE);
    expect(BUILT_IN_SOURCE_NOTE).toContain('No key');
  });
});

/* ── the question field ──────────────────────────────────────────────────── */

describe('the question field shows what a question looks like', () => {
  async function openQuestionEditor(): Promise<HTMLTextAreaElement> {
    const id = boardGraphStore.createNode({ kind: 'research', research: { hypothesis: '' } });
    await paint();
    fireEvent.click(screen.getByTestId(`board-card-face-${id}`));
    return screen.getByTestId('board-editor-hypothesis') as HTMLTextAreaElement;
  }

  it('asks the question and then shows one', async () => {
    const field = await openQuestionEditor();

    expect(field.placeholder).toBe(RESEARCH_PLACEHOLDER);
    expect(field.placeholder).toContain('what would show it');
    expect(field.placeholder).toContain('Example:');
  });

  it('the example is a measurable claim, not a ticker list and not a theme', async () => {
    const field = await openQuestionEditor();
    const example = field.placeholder.split('Example:')[1] ?? '';

    expect(example.trim()).not.toBe('');
    // A measurable subject and a measurable outcome, in one sentence.
    expect(example).toMatch(/filing language|spread|momentum|volatility|returns?/i);
    expect(example).toMatch(/underperforms|outperforms|widen|predicts|is followed by/i);
    // No tickers: neither the $-prefixed form nor a bare run of capitals.
    expect(example).not.toMatch(/\$[A-Z]{1,5}\b/);
    expect(example).not.toMatch(/\b[A-Z]{2,5}\b/);
  });
});

/* ── the help entry ──────────────────────────────────────────────────────── */

describe('the panel help entry covers both faces', () => {
  it('exists, and is the tooltip the host serves as this panel help', () => {
    expect(helpEntry).not.toBe('');
    expect(
      (manifest as { contributions: { panels: Array<{ id: string }> } }).contributions.panels[0].id
    ).toBe('grid');
  });

  it('names both faces, under the names the control gives them', async () => {
    await paint();

    const plan = screen.getByTestId('grid-face-plan').textContent ?? '';
    const board = screen.getByTestId('grid-face-board').textContent ?? '';
    expect(plan).not.toBe('');
    expect(board).not.toBe('');
    expect(helpEntry).toContain(plan);
    expect(helpEntry).toContain(board);
    // And says what each of them is FOR, not only that it exists.
    expect(helpEntry).toContain('what you are working on');
    expect(helpEntry).toContain('floor plan');
  });

  it('names the control and the key that switch them', () => {
    expect(helpEntry).toMatch(/Plan and Board control/);
    expect(helpEntry).toContain('Cmd B');
    expect(helpEntry).toContain('Ctrl B');
  });

  it('states the rule that configuring never navigates', () => {
    expect(helpEntry).toContain('canvas');
    expect(helpEntry).toMatch(/navigates away/);
  });

  it('is written in the host help format: paragraphs, not one wall', () => {
    // The host tooltip splits on blank lines and renders **bold**; a single
    // block would arrive as an unreadable paragraph.
    expect(helpEntry.split(/\n\n+/).length).toBeGreaterThanOrEqual(3);
    expect(helpEntry).toMatch(/\*\*[^*]+\*\*/);
  });
});

/* ── nothing the copy names is dead ──────────────────────────────────────── */

describe('the copy names nothing that does not exist', () => {
  it('names only kinds the graph knows', () => {
    for (const ghost of GHOSTS.filter((entry) => entry.acts)) {
      expect(BOARD_NODE_KINDS as readonly string[]).toContain(ghost.id);
    }
  });

  it.each([
    ['board-ghost-source', SOURCE_GHOST.id],
    ['board-ghost-research', RESEARCH_GHOST.id],
  ])('%s lays down exactly the kind it names', async (testId, kind) => {
    await paint();

    fireEvent.click(screen.getByTestId(testId));

    expect(boardGraphStore.getSnapshot().graph.nodes[0].kind).toBe(kind);
  });

  it('the verbs it names are the verbs the card wears', async () => {
    const body = GHOSTS[2].body;
    for (const word of Object.values(SCAN_WORD)) {
      expect(body).toContain(word);
    }

    const id = boardGraphStore.createNode({
      kind: 'research',
      research: { hypothesis: 'Gaps revert.' },
    });
    await paint();

    // What the card actually says, on a question with nothing counted for it.
    // The button carries its icon glyph as text too, so this is a containment
    // check rather than an equality one.
    const verb = screen.getByTestId(`board-scan-${id}`).textContent ?? '';
    expect(Object.values(SCAN_WORD).some((word) => verb.includes(word))).toBe(true);
  });

  it('the key the help entry names is the key the panel listens for', async () => {
    await paint();

    // Read the letter out of the help entry rather than assuming it: a help
    // entry naming a key nothing listens for is the exact failure this pins.
    const named = /\b(?:Cmd|Ctrl) ([A-Z])\b/.exec(helpEntry);
    expect(named).not.toBeNull();
    const key = (named?.[1] ?? '').toLowerCase();

    const panel = screen.getByTestId('auracle-grid');
    expect(panel.getAttribute('data-face')).toBe('board');
    act(() => panel.focus());
    fireEvent.keyDown(window, { key, metaKey: true });

    expect(panel.getAttribute('data-face')).toBe('plan');
  });

  it('the free-source promise is one the bootstrap can keep', async () => {
    await paint();
    // The empty state says they arrive when the engine answers. This is that
    // sentence, executed.
    expect(screen.getByTestId('board-ghost-source').textContent).toContain('the engine answers');

    await registry([keyless('yfinance', 'Yahoo Finance', 'Free daily bars, zero config')]);

    expect(boardGraphStore.getSnapshot().graph.nodes.map((node) => node.id)).toEqual([
      builtInNodeId('yfinance'),
    ]);
  });
});
