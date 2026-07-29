/**
 * The next move is always named, and nothing empty is ever left behind.
 *
 * These are the two halves of one promise: a person who cannot develop anything
 * should be able to open this face and see exactly one obvious thing to do. It
 * broke in two places at once on a real install, and both are pinned here.
 *
 *  - AN ABANDONED CLICK LEFT A CARD. The add row lays a card down BEFORE it has
 *    been described, because the editor has to open on something real, and a
 *    person who pressed it and thought better of it was left with a card
 *    reading "Unnamed source" for good. So a card this session placed and
 *    nobody typed into is taken back when its editor closes, whichever way it
 *    closes. What is asserted below is the pair: the untouched card goes, and a
 *    card carrying one typed field stays, because a rule that discarded
 *    somebody's half-written card would be worse than the bug it fixes;
 *
 *  - AND THE LINE WENT QUIET. The hint above the cards used to have one state
 *    for every board that was not brand new, so the moment any card landed it
 *    stopped teaching. It is a state machine over what the board is MISSING
 *    now, asserted at each state through the exported copy rather than against
 *    strings typed out again here, and the chip that performs the outstanding
 *    move is dressed as the answer exactly while it is one.
 *
 * WHAT THIS FILE CANNOT SEE: jsdom applies no stylesheet from an injected
 * <style> to computed values in the way a browser does, and measures every box
 * at zero, so nothing here can claim how the primary chip LOOKS. What it claims
 * is the pair that decides it: the state the component puts on the chip, and a
 * rule in the Board's own sheet keyed on that state. The visual result is a
 * browser check.
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
import { boardGraphStore } from '../../engine/boardGraphStore';
import { builtInNodeId } from '../../engine/boardBuiltins';
import type { BoardGraphTransport } from '../../engine/boardPersistence';
import { gridVitals } from '../../engine/gridVitals';
import { GridPanel } from '../grid/GridPanel';
import { BOARD_HINT, RESEARCH_GHOST, type BoardHintState } from '../grid/boardCopy';
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

function graph() {
  return boardGraphStore.getSnapshot().graph;
}

function hint(): HTMLElement {
  return screen.getByTestId('board-hint');
}

/** A described source, already on the Board before this session started. */
function seedSource(overrides: Record<string, string> = {}): string {
  return boardGraphStore.createNode({
    kind: 'source',
    source: {
      name: 'Desk filings',
      connectorKind: 'http_api',
      endpoint: 'https://example.invalid/filings',
      payloadType: 'filings',
      ...overrides,
    },
  });
}

function seedResearch(hypothesis: string): string {
  return boardGraphStore.createNode({ kind: 'research', research: { hypothesis } });
}

/** A keyless connector as a fresh install reports it, and the registry answering
 *  with it — the one route by which built-in cards reach a Board. */
async function registry(ids: string[]): Promise<void> {
  stub.feeds['/ui/api/connections'] = {
    connections: ids.map((id) => ({
      id,
      display_label: id,
      blurb: 'free daily bars',
      kind: 'data_provider',
      status: { state: 'connected', detail: null },
      fields: [],
    })),
  };
  await act(async () => {
    await gridVitals.refresh();
  });
}

/** Press one of the two moves, whichever control is on screen for it. */
async function place(kind: 'source' | 'research'): Promise<void> {
  const ghost = screen.queryByTestId(`board-ghost-${kind}`);
  await act(async () => {
    fireEvent.click(ghost ?? screen.getByTestId(`board-add-${kind}`));
  });
}

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

/* ── nothing abandoned ───────────────────────────────────────────────────── */

describe('a card nobody typed into does not survive its editor', () => {
  it.each(['source', 'research'] as const)(
    'takes a %s card back when the editor is closed with nothing in it',
    async (kind) => {
      await paint();
      await place(kind);
      expect(graph().nodes).toHaveLength(1);
      expect(screen.getByTestId('board-editor').getAttribute('data-kind')).toBe(kind);

      await act(async () => {
        fireEvent.click(screen.getByTestId('board-editor-close'));
      });

      expect(graph().nodes).toEqual([]);
      // And the Board is back to the state that explains itself.
      expect(screen.getByTestId('board-ghosts')).toBeTruthy();
      expect(screen.queryByTestId('board-editor')).toBeNull();
    }
  );

  it.each(['source', 'research'] as const)(
    'takes a %s card back on Escape as well as on the close button',
    async (kind) => {
      await paint();
      await place(kind);

      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });

      expect(graph().nodes).toEqual([]);
    }
  );

  it('takes it back when a click lands somewhere else on the Board', async () => {
    await paint();
    await place('source');

    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('board-stage'));
    });

    expect(graph().nodes).toEqual([]);
  });

  it('takes it back rather than leaving it behind for the next move', async () => {
    await paint();
    await place('source');
    // The editor is still open on the empty source when the other move is
    // pressed, which is exactly how one gets abandoned.
    await place('research');

    expect(graph().nodes.map((node) => node.kind)).toEqual(['research']);
    expect(screen.getByTestId('board-editor').getAttribute('data-kind')).toBe('research');
  });

  it('takes it back when the Board goes off screen', async () => {
    await paint();
    await place('source');

    await act(async () => {
      fireEvent.click(screen.getByTestId('grid-face-plan'));
    });

    expect(graph().nodes).toEqual([]);
  });

  it('removes it silently: nothing to lose, so nothing to confirm and nothing to report', async () => {
    await paint();
    await place('source');

    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-close'));
    });

    expect(graph().nodes).toEqual([]);
    expect(screen.queryByTestId('board-delete-confirm')).toBeNull();
    expect(screen.queryByTestId('board-notice')).toBeNull();
  });
});

describe('a card carrying anything at all is kept', () => {
  it('keeps a source the moment it is named', async () => {
    await paint();
    await place('source');

    fireEvent.change(screen.getByTestId('board-editor-name'), {
      target: { value: 'Desk filings' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-close'));
    });

    expect(graph().nodes).toHaveLength(1);
    expect(graph().nodes[0].source?.name).toBe('Desk filings');
    expect(screen.getByTestId(`board-card-title-${graph().nodes[0].id}`).textContent).toBe(
      'Desk filings'
    );
  });

  it('keeps a source described in any field, not only the name', async () => {
    await paint();
    await place('source');

    fireEvent.change(screen.getByTestId('board-editor-slot'), { target: { value: 'filings_key' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-close'));
    });

    expect(graph().nodes).toHaveLength(1);
    expect(graph().nodes[0].source?.credentialSlot).toBe('filings_key');
  });

  it('keeps a question the moment it has words in it', async () => {
    await paint();
    await place('research');

    fireEvent.change(screen.getByTestId('board-editor-hypothesis'), {
      target: { value: 'Filings drift.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-close'));
    });

    expect(graph().nodes).toHaveLength(1);
    expect(graph().nodes[0].research?.hypothesis).toBe('Filings drift.');
  });

  it('never touches a card that was already on the Board when it opened', async () => {
    // The blank card a previous build left behind: opened, closed, and still
    // there. Only the ordinary removal, with its confirm, takes that away.
    const id = boardGraphStore.createNode({
      kind: 'source',
      source: { name: '', connectorKind: '', endpoint: '', payloadType: '' },
    });
    await paint();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`board-card-face-${id}`));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-close'));
    });

    expect(graph().nodes.map((node) => node.id)).toEqual([id]);
  });

  it('stops second-guessing a card once it has survived one close', async () => {
    await paint();
    await place('source');
    fireEvent.change(screen.getByTestId('board-editor-name'), { target: { value: 'Desk' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-close'));
    });
    const id = graph().nodes[0].id;

    // Emptied again by hand: the card is the person's now, and emptying a field
    // is an edit rather than an abandoned click.
    await act(async () => {
      fireEvent.click(screen.getByTestId(`board-card-face-${id}`));
    });
    fireEvent.change(screen.getByTestId('board-editor-name'), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-close'));
    });

    expect(graph().nodes.map((node) => node.id)).toEqual([id]);
  });
});

/* ── the line names the next move ────────────────────────────────────────── */

/** Set the Board up in one situation, and read back which one it thinks it is
 *  in. The seeding never goes through the add row, so nothing here is a card
 *  this session placed and nothing can be reaped out from under the assertion. */
async function boardIn(state: BoardHintState): Promise<void> {
  if (state === 'firstRun') {
    await paint();
    await registry(['yfinance']);
    return;
  }
  if (state === 'askQuestion') {
    seedSource();
    await paint();
    return;
  }
  if (state === 'finishQuestion') {
    seedSource();
    seedResearch('');
    await paint();
    return;
  }
  if (state === 'working') {
    seedSource();
    seedResearch('Filings that turn uncertain drift the following month.');
    await paint();
    return;
  }
  await paint();
}

describe('the line above the cards names what the board is missing', () => {
  it.each(['empty', 'firstRun', 'askQuestion', 'finishQuestion', 'working'] as const)(
    'says the %s line, and says which state it is in',
    async (state) => {
      await boardIn(state);

      expect(hint().getAttribute('data-state')).toBe(state);
      expect(hint().textContent).toBe(BOARD_HINT[state]);
    }
  );

  it('every state says something, and no two of them say the same thing', () => {
    const lines = Object.values(BOARD_HINT);
    expect(new Set(lines).size).toBe(lines.length);
    for (const line of lines) expect(line.trim().length).toBeGreaterThan(20);
  });

  it('names the next move on a board that has sources and nothing to read them against', async () => {
    await boardIn('askQuestion');

    // The move, under the name the control for it uses, and the promise that
    // makes it safe to make.
    expect(hint().textContent).toContain(RESEARCH_GHOST.title);
    expect(hint().textContent).toContain('what you think is true');
    expect(hint().textContent).toContain('at no cost');
  });

  it('points at finishing the question rather than starting another one', async () => {
    await boardIn('finishQuestion');

    expect(hint().textContent).toContain('Open the card');
    expect(hint().textContent).toContain('what would show it');
    expect(hint().textContent).not.toContain(RESEARCH_GHOST.title);
  });

  it('goes quiet only once a question is actually written', async () => {
    seedSource();
    const id = seedResearch('');
    await paint();
    expect(hint().getAttribute('data-state')).toBe('finishQuestion');

    await act(async () => {
      boardGraphStore.updateNode(id, { research: { hypothesis: 'Filings drift.' } });
    });

    expect(hint().getAttribute('data-state')).toBe('working');
    expect(hint().textContent).toBe(BOARD_HINT.working);
  });

  it('reads a board of built-ins plus one card of the person own as still needing a question', async () => {
    await paint();
    await registry(['yfinance']);
    expect(hint().getAttribute('data-state')).toBe('firstRun');

    await act(async () => {
      seedSource();
    });

    // No longer a first run, and still nothing to read anything against.
    expect(graph().nodes.map((node) => node.id)).toContain(builtInNodeId('yfinance'));
    expect(hint().getAttribute('data-state')).toBe('askQuestion');
  });

  it('carries no jargon and no em-dash in the states it gained', () => {
    for (const line of [BOARD_HINT.askQuestion, BOARD_HINT.finishQuestion]) {
      expect(line).not.toMatch(/[—–]/);
      expect(line).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      for (const word of ['RAG', 'vector', 'embedding', 'corpus', 'ingest', 'endpoint', 'API']) {
        expect(line.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
  });
});

/* ── one obvious next move ───────────────────────────────────────────────── */

describe('the outstanding move is dressed as the answer', () => {
  function research(): HTMLElement {
    return screen.getByTestId('board-add-research');
  }

  it('fills the question chip on a board with sources and no question', async () => {
    await boardIn('askQuestion');

    expect(research().getAttribute('data-primary')).toBe('true');
  });

  it.each(['firstRun', 'finishQuestion', 'working'] as const)(
    'leaves it a peer in the %s state',
    async (state) => {
      await boardIn(state);

      expect(research().getAttribute('data-primary')).toBe('false');
    }
  );

  it('gives it up the moment the question is placed', async () => {
    await boardIn('askQuestion');
    expect(research().getAttribute('data-primary')).toBe('true');

    await place('research');

    // The card is down and the chip is a peer again: one answer at a time.
    expect(research().getAttribute('data-primary')).toBe('false');
  });

  it('is a state the Board own sheet actually dresses', async () => {
    await boardIn('askQuestion');

    const sheet = document.getElementById('auracle-grid-board-styles')?.textContent ?? '';
    expect(sheet).toContain(".aboard__add[data-primary='true']");
    // In the pack's own primary language rather than a colour invented here.
    const rule = sheet.split(".aboard__add[data-primary='true']")[1] ?? '';
    expect(rule).toMatch(/background:\s*#ffffff/i);
  });
});
