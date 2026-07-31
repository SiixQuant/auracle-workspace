/**
 * The Board's two user-placed cards, and the promise the whole feature is
 * built on: configuring something never leaves the Board.
 *
 * What is pinned here:
 *  - a card says what it is and how it is doing, and a SOURCE card's reading is
 *    the connections feed the pack already polls — never a second opinion;
 *  - every field round-trips through the store, so what a person typed is what
 *    the next window opens;
 *  - the secret goes one way. It is posted, it is dropped, and no surface can
 *    show it again — not the editor, not the graph, not a re-open;
 *  - the wire gesture is a press on a source and a release on a question, and
 *    the STORE decides whether that pairing is allowed;
 *  - removing a card says what stays behind before it happens, in numbers;
 *  - and none of the above changes which room, face or page is showing.
 *
 * WHAT THIS FILE CANNOT SEE: jsdom measures every box at zero, so the canvas is
 * never engaged here — the wire OVERLAY, the ghost line that follows the
 * pointer and the cut buttons drawn on the trunk are not rendered at this
 * width. Their geometry is asserted as arithmetic in boardLayout.test.ts, and
 * the same cut is exercised below through the editor's own list, which is the
 * route that exists at every width.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const stub = vi.hoisted(() => ({
  feeds: {} as Record<string, unknown>,
  posts: [] as Array<{ path: string; body: unknown }>,
  postAnswer: { ok: true, status: 200, body: {} as unknown },
}));

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
  getJsonDetailed: vi.fn(async (path: string) => {
    for (const [prefix, body] of Object.entries(stub.feeds)) {
      if (path.startsWith(prefix)) return { ok: true, body };
    }
    return { ok: false, status: 404, body: null };
  }),
  postJson: vi.fn(async (path: string, body: unknown) => {
    stub.posts.push({ path, body });
    return stub.postAnswer;
  }),
  putJson: vi.fn(async () => ({ ok: true, status: 200, body: null })),
  connectCheck: vi.fn(async () => null),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { GridPanel } from '../grid/GridPanel';
import { boardGraphStore } from '../../engine/boardGraphStore';
import type { BoardGraphTransport } from '../../engine/boardPersistence';
import { gridVitals } from '../../engine/gridVitals';
import { getActiveRoom, openGridHome } from '../grid/gridNav';
import { resetFaceStore, setFace } from '../grid/gridFaceStore';
import { closePalette } from '../grid/gridCommands';
import { builtInNodeId } from '../../engine/boardBuiltins';

/* ── fixtures ────────────────────────────────────────────────────────────── */

const SECRET = 'polygon-live-key-9f2';

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

function connector(id: string, label: string, state: string, detail: string | null = null) {
  return {
    id,
    display_label: label,
    blurb: '',
    kind: 'data_provider',
    status: { state, detail },
    fields: [],
  };
}

/** Open the Board on the same workspace key the panel uses, so the panel's own
 *  open() finds it already open and does not reload over the seeded graph. */
async function openBoard(): Promise<void> {
  await boardGraphStore.open('', { transport: lane, saveDelayMs: 5000 });
}

async function paint(): Promise<void> {
  await act(async () => {
    render(<GridPanel {...hostProps()} />);
  });
}

/** Let the registry answer, the way the sheet's poll does. */
async function registry(rows: ReturnType<typeof connector>[]): Promise<void> {
  stub.feeds['/ui/api/connections'] = { connections: rows };
  await act(async () => {
    await gridVitals.refresh();
  });
}

function graph() {
  return boardGraphStore.getSnapshot().graph;
}

/** A described source card, already on the Board. */
function seedSource(overrides: Record<string, string> = {}): string {
  return boardGraphStore.createNode({
    kind: 'source',
    source: {
      name: 'Yahoo Finance',
      connectorKind: 'feed',
      endpoint: 'yfinance',
      payloadType: 'daily bars',
      ...overrides,
    },
  });
}

function seedResearch(hypothesis = 'Overnight gaps mean-revert.'): string {
  return boardGraphStore.createNode({ kind: 'research', research: { hypothesis } });
}

function openEditor(nodeId: string): void {
  fireEvent.click(screen.getByTestId(`board-card-face-${nodeId}`));
}

beforeEach(async () => {
  stub.feeds = {};
  stub.posts = [];
  stub.postAnswer = { ok: true, status: 200, body: {} };
  gridVitals.reset();
  resetFaceStore();
  setFace('board');
  await openBoard();
});

afterEach(() => {
  cleanup();
  closePalette();
  openGridHome();
  resetFaceStore();
  boardGraphStore.reset();
  gridVitals.reset();
  vi.restoreAllMocks();
  gridVitals.reset();
});

/* ── the cards ───────────────────────────────────────────────────────────── */

describe('a card says what it is', () => {
  it('draws the title and the one line, and drops the ghosts', async () => {
    const id = seedSource();
    await paint();

    expect(screen.queryByTestId('board-ghosts')).toBeNull();
    expect(screen.getByTestId(`board-card-title-${id}`).textContent).toBe('Yahoo Finance');
    expect(screen.getByTestId(`board-card-note-${id}`).textContent).toBe('daily bars · yfinance');
  });

  it('names a source nobody has described yet rather than drawing a blank card', async () => {
    const id = boardGraphStore.createNode({
      kind: 'source',
      source: { name: '', connectorKind: '', endpoint: '', payloadType: '' },
    });
    await paint();

    expect(screen.getByTestId(`board-card-title-${id}`).textContent).toBe('Unnamed source');
    expect(screen.getByTestId(`board-card-note-${id}`).textContent).toBe('nothing described yet');
  });

  it('leads a question with its first line', async () => {
    const id = seedResearch('Do overnight gaps revert?\nCheck liquid futures first.');
    await paint();

    expect(screen.getByTestId(`board-card-title-${id}`).textContent).toBe('Do overnight gaps revert?');
    expect(screen.getByTestId(`board-card-note-${id}`).textContent).toBe('Check liquid futures first.');
  });

  it('draws a card kind this build does not know, rather than hiding it', async () => {
    boardGraphStore.materialize({
      kind: 'strategy',
      ref: { kind: 'strategy', id: '7' },
      from: seedResearch(),
      label: 'Gap reversion',
    });
    await paint();

    expect(screen.getByText('Gap reversion')).toBeTruthy();
  });
});

describe('the board reads as a pipeline', () => {
  it('captions each rank that has a card in it, in order', async () => {
    seedSource();
    seedResearch();
    await paint();

    expect(screen.getByTestId('board-column-0').textContent).toBe('Sources');
    expect(screen.getByTestId('board-column-1').textContent).toBe('Questions');
  });

  it('captions nothing for a rank with nothing in it', async () => {
    seedSource();
    await paint();

    expect(screen.getByTestId('board-column-0')).toBeTruthy();
    expect(screen.queryByTestId('board-column-1')).toBeNull();
  });

  it('names the last column where the system writes its cards', async () => {
    boardGraphStore.materialize({
      kind: 'strategy',
      ref: { kind: 'strategy', id: '9' },
      label: 'Gap reversion',
    });
    await paint();

    expect(screen.getByTestId('board-section-materialized').textContent).toBe('Materialized');
  });

  it('keeps a clamped name whole on the element that carries it', async () => {
    const long = 'ContinuousCashOverlayFiltersForAStaticGrowthDefensiveSleeve';
    const id = seedSource({ name: long });
    await paint();

    // The card shows two lines and an ellipsis; nothing may lose the name.
    expect(screen.getByTestId(`board-card-title-${id}`).getAttribute('title')).toBe(long);
  });
});

describe('a source card reads the connections feed', () => {
  it('goes healthy when the registry says its counterpart is up', async () => {
    const id = seedSource();
    await paint();
    // Before the registry answers, the card claims nothing.
    expect(screen.getByTestId(`board-card-dot-${id}`).getAttribute('data-health')).toBe('unknown');

    await registry([connector('yfinance', 'Yahoo Finance', 'connected')]);

    expect(screen.getByTestId(`board-card-dot-${id}`).getAttribute('data-health')).toBe('nominal');
    expect(screen.getByTestId(`board-card-face-${id}`).getAttribute('aria-label')).toContain(
      'connected'
    );
  });

  it('faults in the engine own words', async () => {
    const id = seedSource({ name: 'Polygon.io', endpoint: 'polygon' });
    await paint();
    await registry([connector('polygon', 'Polygon.io', 'error', 'token expired')]);

    expect(screen.getByTestId(`board-card-dot-${id}`).getAttribute('data-health')).toBe('fault');
    expect(screen.getByTestId(`board-card-face-${id}`).getAttribute('aria-label')).toContain(
      'token expired'
    );
  });

  it('stays neutral for a source with no live counterpart', async () => {
    const id = seedSource({ name: 'Desk drop', endpoint: '/desk/inbox' });
    await paint();
    await registry([connector('yfinance', 'Yahoo Finance', 'connected')]);

    expect(screen.getByTestId(`board-card-dot-${id}`).getAttribute('data-health')).toBe('unknown');
    expect(screen.getByTestId(`board-card-face-${id}`).getAttribute('aria-label')).toContain(
      'not linked to a connector'
    );
  });

  it('gives a question the neutral mark until something has counted for it', async () => {
    const id = seedResearch();
    await paint();

    // Nothing has been counted, so the dot claims nothing and the verb offers
    // the first look rather than a synthesis of material nobody measured.
    expect(screen.getByTestId(`board-card-dot-${id}`).getAttribute('data-health')).toBe('unknown');
    const scan = screen.getByTestId(`board-scan-${id}`) as HTMLButtonElement;
    expect(scan.disabled).toBe(false);
    expect(scan.textContent).toContain('Scan');
    expect(screen.queryByTestId(`board-material-${id}`)).toBeNull();
  });

  it('will not send a question nobody has written', async () => {
    const id = boardGraphStore.createNode({ kind: 'research', research: { hypothesis: '' } });
    await paint();

    expect((screen.getByTestId(`board-scan-${id}`) as HTMLButtonElement).disabled).toBe(true);
  });

  it('raises the peek on a rest, and says more than the card had room for', async () => {
    const id = seedSource({ credentialSlot: 'desk_key' });
    await paint();
    vi.useFakeTimers();
    try {
      fireEvent.mouseEnter(screen.getByTestId(`board-card-${id}`));
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByTestId('board-peek-title').textContent).toBe('Yahoo Finance');
      const lines = screen.getAllByTestId('board-peek-line').map((el) => el.textContent);
      expect(lines).toContain('Key slot: desk_key');
      expect(lines).toContain('Arrives as: feed');
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ── the ghosts perform the moves ────────────────────────────────────────── */

describe('the empty state lays the first card down', () => {
  it('turns the connect-data ghost into a source card, open for editing', async () => {
    await paint();

    await act(async () => {
      fireEvent.click(screen.getByTestId('board-ghost-source'));
    });

    expect(graph().nodes).toHaveLength(1);
    expect(graph().nodes[0].kind).toBe('source');
    // Placed AND open: the card arrives with its editor up, so the first thing
    // a person does is describe it rather than hunt for how.
    expect(screen.getByTestId('board-editor').getAttribute('data-kind')).toBe('source');
    expect(screen.getByTestId('board-editor-name')).toBeTruthy();
  });

  it('turns the pose-a-question ghost into a research card, open for editing', async () => {
    await paint();

    await act(async () => {
      fireEvent.click(screen.getByTestId('board-ghost-research'));
    });

    expect(graph().nodes[0].kind).toBe('research');
    expect(screen.getByTestId('board-editor').getAttribute('data-kind')).toBe('research');
    expect(screen.getByTestId('board-editor-hypothesis')).toBeTruthy();
  });

  it('keeps both moves within reach once the board has something on it', async () => {
    seedSource();
    await paint();

    await act(async () => {
      fireEvent.click(screen.getByTestId('board-add-research'));
    });

    expect(graph().nodes.map((node) => node.kind)).toEqual(['source', 'research']);
  });
});

describe('the keyless sources arrive on a first open', () => {
  it('lays them down when the registry answers, and never twice', async () => {
    await paint();
    await registry([
      connector('yfinance', 'Yahoo Finance', 'connected'),
      connector('ibkr', 'Interactive Brokers', 'not_configured'),
    ]);

    expect(screen.getByTestId(`board-card-${builtInNodeId('yfinance')}`)).toBeTruthy();
    expect(graph().nodes).toHaveLength(1);

    // The poll comes round again with the same answer.
    await registry([
      connector('yfinance', 'Yahoo Finance', 'connected'),
      connector('ibkr', 'Interactive Brokers', 'not_configured'),
    ]);

    expect(graph().nodes).toHaveLength(1);
  });
});

/* ── the editor ──────────────────────────────────────────────────────────── */

describe('every field is edited on the card', () => {
  it('round-trips a source description through the store', async () => {
    const id = seedSource({ name: '', connectorKind: '', endpoint: '', payloadType: '' });
    await paint();
    openEditor(id);

    fireEvent.change(screen.getByTestId('board-editor-name'), { target: { value: 'Desk filings' } });
    fireEvent.change(screen.getByTestId('board-editor-connector'), { target: { value: 'http_api' } });
    fireEvent.change(screen.getByTestId('board-editor-endpoint'), {
      target: { value: 'https://example.invalid/filings' },
    });
    fireEvent.change(screen.getByTestId('board-editor-payload'), { target: { value: 'filings' } });
    fireEvent.change(screen.getByTestId('board-editor-slot'), { target: { value: 'filings_key' } });

    expect(graph().nodes[0].source).toEqual({
      name: 'Desk filings',
      connectorKind: 'http_api',
      endpoint: 'https://example.invalid/filings',
      payloadType: 'filings',
      credentialSlot: 'filings_key',
    });
    // And the card behind the editor has already moved with it.
    expect(screen.getByTestId(`board-card-title-${id}`).textContent).toBe('Desk filings');
    expect((screen.getByTestId('board-editor-name') as HTMLInputElement).value).toBe('Desk filings');
  });

  it('round-trips a hypothesis, in plain words, across a close and re-open', async () => {
    const id = seedResearch('');
    await paint();
    openEditor(id);

    fireEvent.change(screen.getByTestId('board-editor-hypothesis'), {
      target: { value: 'Liquid futures revert overnight moves intraday.' },
    });
    fireEvent.click(screen.getByTestId('board-editor-close'));
    openEditor(id);

    expect((screen.getByTestId('board-editor-hypothesis') as HTMLTextAreaElement).value).toBe(
      'Liquid futures revert overnight moves intraday.'
    );
    expect(graph().nodes[0].research?.hypothesis).toBe(
      'Liquid futures revert overnight moves intraday.'
    );
  });

  it('describes the source to the engine when asked, and says what it answered', async () => {
    const id = seedSource({ credentialSlot: 'desk_key' });
    await paint();
    openEditor(id);

    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-connect'));
    });

    expect(stub.posts).toEqual([
      {
        path: '/ui/api/board/sources',
        body: {
          id,
          name: 'Yahoo Finance',
          connector_kind: 'feed',
          endpoint: 'yfinance',
          payload_type: 'daily bars',
          credential_slot: 'desk_key',
        },
      },
    ]);
    expect(screen.getByTestId('board-editor-connect-state').textContent).toContain(
      'Described to the engine'
    );
  });

  it('does not claim a source was described when the engine refused', async () => {
    const id = seedSource();
    stub.postAnswer = { ok: false, status: 422, body: { detail: 'endpoint is not reachable' } };
    await paint();
    openEditor(id);

    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-connect'));
    });

    expect(screen.getByTestId('board-editor-connect-state').textContent).toBe(
      'endpoint is not reachable'
    );
  });

  it('closes on Escape without losing a word of it', async () => {
    const id = seedResearch('');
    await paint();
    openEditor(id);
    fireEvent.change(screen.getByTestId('board-editor-hypothesis'), {
      target: { value: 'Half a thought' },
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByTestId('board-editor')).toBeNull();
    expect(graph().nodes[0].research?.hypothesis).toBe('Half a thought');
  });
});

describe('the secret is write-only', () => {
  it('posts it, drops it, and never shows it again', async () => {
    const id = seedSource({ credentialSlot: 'polygon_key' });
    await paint();
    openEditor(id);

    fireEvent.change(screen.getByTestId('board-editor-secret'), { target: { value: SECRET } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-secret-store'));
    });

    // It went to the vault, by slot name, and nowhere else.
    expect(stub.posts).toEqual([
      { path: '/ui/api/board/credentials/polygon_key', body: { secret: SECRET } },
    ]);
    // The input is empty again, and the surface says only that something is
    // stored — never what.
    expect((screen.getByTestId('board-editor-secret') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('board-editor-secret-state').textContent).toBe(
      'A secret is stored in this slot.'
    );
    expect(screen.getByTestId('board-editor').textContent).not.toContain(SECRET);
    // And it is nowhere in what gets persisted: the graph has no field for it.
    expect(JSON.stringify(graph())).not.toContain(SECRET);
    expect(graph().nodes[0].source?.credentialSlot).toBe('polygon_key');
  });

  it('is typed into a password field, never seeded, never re-displayed on re-open', async () => {
    const id = seedSource({ credentialSlot: 'polygon_key' });
    stub.feeds['/ui/api/board/credentials/polygon_key'] = {
      name: 'polygon_key',
      set: true,
      updated_at: '2026-07-28T10:00:00Z',
      // An engine that misbehaved and echoed the value: the client drops it
      // before anything can render it.
      secret: SECRET,
    };
    await paint();

    await act(async () => {
      openEditor(id);
    });

    const input = screen.getByTestId('board-editor-secret') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
    expect(screen.getByTestId('board-editor').textContent).not.toContain(SECRET);
    expect(screen.getByTestId('board-editor-secret-state').textContent).toBe(
      'A secret is stored in this slot.'
    );
  });

  it('refuses to send a secret with no slot to put it in', async () => {
    const id = seedSource();
    await paint();
    openEditor(id);

    fireEvent.change(screen.getByTestId('board-editor-secret'), { target: { value: SECRET } });

    expect((screen.getByTestId('board-editor-secret-store') as HTMLButtonElement).disabled).toBe(true);
    expect(stub.posts).toEqual([]);
  });

  it('says a rejected write was rejected', async () => {
    const id = seedSource({ credentialSlot: 'polygon_key' });
    stub.postAnswer = { ok: false, status: 403, body: { detail: 'vault is locked' } };
    await paint();
    openEditor(id);
    fireEvent.change(screen.getByTestId('board-editor-secret'), { target: { value: SECRET } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-secret-store'));
    });

    expect(screen.getByTestId('board-editor-secret-note').textContent).toBe('vault is locked');
    expect(screen.getByTestId('board-editor-secret-state').textContent).toBe(
      'No secret stored in this slot.'
    );
  });
});

/* ── wires ───────────────────────────────────────────────────────────────── */

describe('the wire gesture', () => {
  it('presses on a source and releases on a question', async () => {
    const sourceId = seedSource();
    const researchId = seedResearch();
    await paint();

    fireEvent.mouseDown(screen.getByTestId(`board-wire-handle-${sourceId}`));
    expect(screen.getByTestId('board-stage').getAttribute('data-wiring')).toBe('true');
    fireEvent.mouseUp(screen.getByTestId(`board-card-${researchId}`));

    expect(graph().edges).toHaveLength(1);
    expect(graph().edges[0]).toMatchObject({ from: sourceId, to: researchId, origin: 'user' });
    expect(screen.getByTestId('board-notice').textContent).toBe('Wired.');
    expect(screen.getByTestId('board-stage').getAttribute('data-wiring')).toBe('false');
  });

  it('marks which cards a wire in progress could land on', async () => {
    const sourceId = seedSource();
    const otherSource = seedSource({ name: 'Second feed' });
    const researchId = seedResearch();
    await paint();

    fireEvent.mouseDown(screen.getByTestId(`board-wire-handle-${sourceId}`));

    expect(screen.getByTestId(`board-card-${researchId}`).getAttribute('data-drop')).toBe('ok');
    expect(screen.getByTestId(`board-card-${otherSource}`).getAttribute('data-drop')).toBe('no');
    expect(screen.getByTestId(`board-card-${sourceId}`).getAttribute('data-drop')).toBe('origin');
  });

  it('carries the store refusal rather than inventing its own rule', async () => {
    const sourceId = seedSource();
    const otherSource = seedSource({ name: 'Second feed' });
    await paint();

    fireEvent.mouseDown(screen.getByTestId(`board-wire-handle-${sourceId}`));
    fireEvent.mouseUp(screen.getByTestId(`board-card-${otherSource}`));

    expect(graph().edges).toEqual([]);
    expect(screen.getByTestId('board-notice').textContent).toBe('Wires end at a research card.');
    expect(screen.getByTestId('board-notice').getAttribute('data-kind')).toBe('err');
  });

  it('refuses to draw the same wire twice', async () => {
    const sourceId = seedSource();
    const researchId = seedResearch();
    boardGraphStore.wire(sourceId, researchId);
    await paint();

    fireEvent.mouseDown(screen.getByTestId(`board-wire-handle-${sourceId}`));
    fireEvent.mouseUp(screen.getByTestId(`board-card-${researchId}`));

    expect(graph().edges).toHaveLength(1);
    expect(screen.getByTestId('board-notice').textContent).toBe('These cards are already wired.');
  });

  it('ends the gesture when the release lands on empty ground', async () => {
    const sourceId = seedSource();
    seedResearch();
    await paint();

    fireEvent.mouseDown(screen.getByTestId(`board-wire-handle-${sourceId}`));
    fireEvent.mouseUp(window);

    expect(graph().edges).toEqual([]);
    expect(screen.getByTestId('board-stage').getAttribute('data-wiring')).toBe('false');
  });

  it('cuts a wire from either card it touches, and counts what is left', async () => {
    const sourceId = seedSource();
    const researchId = seedResearch();
    const wired = boardGraphStore.wire(sourceId, researchId);
    await paint();
    expect(screen.getByTestId(`board-card-wires-${sourceId}`).textContent).toBe('1 wire');

    openEditor(researchId);
    fireEvent.click(screen.getByTestId(`board-wire-cut-${wired.ok ? wired.edgeId : ''}`));

    expect(graph().edges).toEqual([]);
    expect(screen.getByTestId(`board-card-wires-${sourceId}`).textContent).toBe('not wired yet');
  });

  it('will not let a provenance wire be pulled, and says why', async () => {
    const researchId = seedResearch();
    boardGraphStore.materialize({
      kind: 'strategy',
      ref: { kind: 'strategy', id: '7' },
      from: researchId,
      label: 'Gap reversion',
    });
    const traced = graph().edges[0];
    await paint();
    openEditor(researchId);

    fireEvent.click(screen.getByTestId(`board-wire-cut-${traced.id}`));

    expect(graph().edges).toHaveLength(1);
    expect(screen.getByTestId('board-wire-refusal').textContent).toBe(
      'This wire records where the work came from and cannot be cut.'
    );
  });
});

/* ── removing a card ─────────────────────────────────────────────────────── */

describe('removing a card says what stays behind', () => {
  it('states the wires and the work that survive it, before anything happens', async () => {
    const sourceId = seedSource();
    const researchId = seedResearch();
    boardGraphStore.wire(sourceId, researchId);
    boardGraphStore.materialize({
      kind: 'strategy',
      ref: { kind: 'strategy', id: '7' },
      from: researchId,
      label: 'Gap reversion',
    });
    await paint();
    openEditor(researchId);

    fireEvent.click(screen.getByTestId('board-editor-delete'));

    expect(screen.getByTestId('board-delete-detail').textContent).toBe(
      'Removing this question takes the card and 2 wires off the Board. 1 card downstream stays where it is, still pointing at 1 saved result.'
    );
    // Nothing has happened yet: the plan is a preview.
    expect(graph().nodes).toHaveLength(3);
  });

  it('keeps the card when the answer is keep', async () => {
    const id = seedResearch();
    await paint();
    openEditor(id);
    fireEvent.click(screen.getByTestId('board-editor-delete'));

    fireEvent.click(screen.getByTestId('board-delete-cancel'));

    expect(screen.queryByTestId('board-delete-confirm')).toBeNull();
    expect(graph().nodes).toHaveLength(1);
  });

  it('removes only that card, and reports what it kept', async () => {
    const researchId = seedResearch();
    boardGraphStore.materialize({
      kind: 'strategy',
      ref: { kind: 'strategy', id: '7' },
      from: researchId,
      label: 'Gap reversion',
    });
    await paint();
    openEditor(researchId);
    fireEvent.click(screen.getByTestId('board-editor-delete'));

    fireEvent.click(screen.getByTestId('board-delete-apply'));

    expect(graph().nodes.map((node) => node.kind)).toEqual(['strategy']);
    expect(screen.queryByTestId('board-editor')).toBeNull();
    expect(screen.getByTestId('board-notice').textContent).toBe(
      'Card removed. 1 card downstream stayed, still pointing at 1 saved result.'
    );
  });
});

/* ── the invariant ───────────────────────────────────────────────────────── */

describe('configuration never leaves the Board', () => {
  it('describes, keys, wires, cuts and removes without changing what is showing', async () => {
    await paint();
    const panel = screen.getByTestId('auracle-grid');

    // Every configuration gesture the feature has, in one pass.
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-ghost-source'));
    });
    fireEvent.change(screen.getByTestId('board-editor-name'), { target: { value: 'Desk filings' } });
    fireEvent.change(screen.getByTestId('board-editor-slot'), { target: { value: 'filings_key' } });
    fireEvent.change(screen.getByTestId('board-editor-secret'), { target: { value: SECRET } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-secret-store'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-connect'));
    });
    fireEvent.click(screen.getByTestId('board-editor-close'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('board-add-research'));
    });
    fireEvent.change(screen.getByTestId('board-editor-hypothesis'), {
      target: { value: 'Filings drift.' },
    });
    fireEvent.click(screen.getByTestId('board-editor-close'));

    const [sourceId, researchId] = graph().nodes.map((node) => node.id);
    fireEvent.mouseDown(screen.getByTestId(`board-wire-handle-${sourceId}`));
    fireEvent.mouseUp(screen.getByTestId(`board-card-${researchId}`));
    openEditor(researchId);
    fireEvent.click(screen.getByTestId(`board-wire-cut-${graph().edges[0].id}`));
    fireEvent.click(screen.getByTestId('board-editor-delete'));
    fireEvent.click(screen.getByTestId('board-delete-apply'));

    // Same face, same home, no room opened, and the board still on screen.
    expect(getActiveRoom()).toBeNull();
    expect(panel.getAttribute('data-face')).toBe('board');
    expect(panel.getAttribute('data-room')).toBe('home');
    expect(screen.getByTestId('auracle-grid-board')).toBeTruthy();
    expect(screen.queryByTestId('grid-room-page')).toBeNull();
  });

  it('leaves the Plan alone', async () => {
    seedSource();
    await paint();
    openEditor(graph().nodes[0].id);
    fireEvent.change(screen.getByTestId('board-editor-name'), { target: { value: 'Renamed' } });

    act(() => setFace('plan'));

    expect(screen.getByTestId('auracle-grid-home')).toBeTruthy();
    // The editor went with the face it belonged to rather than floating over
    // the plan.
    expect(screen.queryByTestId('board-editor')).toBeNull();
  });
});
