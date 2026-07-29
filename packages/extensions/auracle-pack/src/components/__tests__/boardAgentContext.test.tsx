/**
 * Selecting a card tells the chat what it is — the Board's half of the ambient
 * lane.
 *
 * The mechanics are the room router's, and these tests pin the three rules that
 * make them safe to reuse on a surface that SELECTS rather than navigates:
 *
 *  - a selection writes the envelope, and a deselection clears it. A stale card
 *    envelope would have the chat answering about a card nobody is looking at;
 *  - a Board that mounts with nothing selected clears NOTHING. The lane is one
 *    last-writer-wins document, so a hook that cleared on arrival would wipe
 *    whatever surface wrote before it — the same "never clobber a richer
 *    payload" rule the focus fallback follows;
 *  - a write cancels the pending focus fallback. The minimal `{panel:'focus'}`
 *    payload lands 600ms after a focus change, and it must not land on top of
 *    an envelope that says strictly more (`engine/focusStore`).
 *
 * The gesture itself is exercised through the real Board at the end: on this
 * surface "selected" means the card whose editor is open, and nothing else must
 * have to know that.
 *
 * WHAT THIS FILE CANNOT SEE: jsdom measures every box at zero, so the canvas is
 * never engaged and no card is ever positioned. Selection here is the press on
 * the card face, which is the route that exists at every width.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authState: vi.fn(async () => ({ signedIn: false })),
  engineConfig: vi.fn(async () => ({ engineUrl: '', hasKey: false })),
  getJson: vi.fn(async () => null),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 404, body: null })),
  postJson: vi.fn(async () => ({ ok: true, status: 200, body: {} })),
  putJson: vi.fn(async () => ({ ok: true, status: 200, body: null })),
  connectCheck: vi.fn(async () => null),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { GridPanel } from '../grid/GridPanel';
import { useBoardCardAiContext } from '../grid/gridFocus';
import type { PanelHostLike } from '../aiPanel';
import type { BoardGraph } from '../../engine/boardGraph';
import { boardGraphStore } from '../../engine/boardGraphStore';
import type { BoardGraphTransport } from '../../engine/boardPersistence';
import { ensureFocusAmbient, focusStore } from '../../engine/focusStore';
import { gridVitals } from '../../engine/gridVitals';
import { openGridHome } from '../grid/gridNav';
import { resetFaceStore, setFace } from '../grid/gridFaceStore';
import { closePalette } from '../grid/gridCommands';
import { SECRET_PROBE, secretFindings } from '../../engine/__tests__/boardSecretProbe';

/* ── fixtures ────────────────────────────────────────────────────────────── */

const GRAPH: BoardGraph = {
  nodes: [
    {
      id: 'src-1',
      kind: 'source',
      source: {
        name: 'Filings stream',
        connectorKind: 'http_api',
        endpoint: 'https://example.invalid/filings',
        payloadType: 'news',
        credentialSlot: 'filings_key',
      },
    },
    { id: 'q-1', kind: 'research', research: { hypothesis: 'Do late filings predict drift?' } },
    { id: 's-1', kind: 'strategy', ref: { kind: 'strategy', id: 'desk.drift.Drift' }, label: 'Drift' },
  ],
  edges: [
    { id: 'w-1', from: 'src-1', to: 'q-1', origin: 'user' },
    { id: 'p-1', from: 'q-1', to: 's-1', origin: 'system' },
  ],
};

function aiHost(): { host: PanelHostLike; setContext: ReturnType<typeof vi.fn>; clearContext: ReturnType<typeof vi.fn> } {
  const setContext = vi.fn();
  const clearContext = vi.fn();
  return { host: { ai: { setContext, clearContext } }, setContext, clearContext };
}

/** The hook, on its own, with the selection driven from the outside. */
function Harness({
  host,
  nodeId,
  graph = GRAPH,
}: {
  host?: PanelHostLike;
  nodeId: string | null;
  graph?: BoardGraph;
}): JSX.Element {
  useBoardCardAiContext(host, graph, nodeId);
  return <div data-testid="harness" />;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  focusStore.clear();
  boardGraphStore.reset();
});

/* ── the contract ────────────────────────────────────────────────────────── */

describe('a selected card, published to the chat', () => {
  it('writes the envelope: what the card is, what feeds it, what came of it', () => {
    const { host, setContext } = aiHost();
    render(<Harness host={host} nodeId="q-1" />);

    expect(setContext).toHaveBeenCalledTimes(1);
    expect(setContext.mock.calls[0][0]).toEqual({
      panel: 'grid',
      face: 'board',
      card: { id: 'q-1', kind: 'research', config: { hypothesis: 'Do late filings predict drift?' } },
      upstream: [
        {
          id: 'src-1',
          kind: 'source',
          config: {
            name: 'Filings stream',
            connector_kind: 'http_api',
            endpoint: 'https://example.invalid/filings',
            payload_type: 'news',
            credential_slot: 'filings_key',
          },
        },
      ],
      artifacts: [{ node_id: 's-1', kind: 'strategy', id: 'desk.drift.Drift', label: 'Drift' }],
    });
  });

  it('clears when the selection is dropped', () => {
    const { host, setContext, clearContext } = aiHost();
    const view = render(<Harness host={host} nodeId="q-1" />);
    view.rerender(<Harness host={host} nodeId={null} />);

    expect(setContext).toHaveBeenCalledTimes(1);
    expect(clearContext).toHaveBeenCalledTimes(1);
  });

  it('clears nothing on arrival, so a richer document from elsewhere survives', () => {
    const { host, setContext, clearContext } = aiHost();
    render(<Harness host={host} nodeId={null} />);

    expect(setContext).not.toHaveBeenCalled();
    expect(clearContext).not.toHaveBeenCalled();
  });

  it('rewrites when the selection moves, and stays quiet when it does not', () => {
    const { host, setContext } = aiHost();
    const view = render(<Harness host={host} nodeId="q-1" />);
    view.rerender(<Harness host={host} nodeId="src-1" />);
    view.rerender(<Harness host={host} nodeId="src-1" />);

    expect(setContext).toHaveBeenCalledTimes(2);
    expect(setContext.mock.calls[1][0]).toMatchObject({ card: { id: 'src-1', kind: 'source' } });
  });

  it('writes nothing for a card that is no longer on the Board', () => {
    const { host, setContext, clearContext } = aiHost();
    render(<Harness host={host} nodeId="gone" />);

    expect(setContext).not.toHaveBeenCalled();
    expect(clearContext).not.toHaveBeenCalled();
  });

  it('is a silent no-op on a host with no AI lane', () => {
    expect(() => render(<Harness host={{}} nodeId="q-1" />)).not.toThrow();
    expect(() => render(<Harness host={undefined} nodeId="q-1" />)).not.toThrow();
  });

  it('carries no credential value and no slot state', () => {
    const { host, setContext } = aiHost();
    const fattened: BoardGraph = {
      nodes: [
        {
          ...GRAPH.nodes[0],
          source: {
            ...GRAPH.nodes[0].source,
            secret: SECRET_PROBE,
            credentialSet: true,
          } as never,
        },
        ...GRAPH.nodes.slice(1),
      ],
      edges: GRAPH.edges,
    };
    render(<Harness host={host} nodeId="src-1" graph={fattened} />);

    expect(secretFindings('envelope', setContext.mock.calls[0][0])).toEqual([]);
    expect(JSON.stringify(setContext.mock.calls[0][0])).not.toContain(SECRET_PROBE);
  });
});

/* ── the precedence rule ─────────────────────────────────────────────────── */

describe('the pending focus fallback', () => {
  it('cannot land on top of an envelope that says more', () => {
    vi.useFakeTimers();
    const { host, setContext } = aiHost();
    // The bridge, armed exactly as a mounted panel arms it.
    ensureFocusAmbient(host.ai as never, 600);
    focusStore.publish({ strategy: { filePath: 'strategies/drift.py' } });

    render(<Harness host={host} nodeId="q-1" />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(setContext).toHaveBeenCalledTimes(1);
    expect(setContext.mock.calls[0][0]).toMatchObject({ face: 'board' });
  });

  it('still lands when no card was selected, so the lane is not left dead', () => {
    vi.useFakeTimers();
    const { host, setContext } = aiHost();
    ensureFocusAmbient(host.ai as never, 600);
    focusStore.publish({ strategy: { filePath: 'strategies/drift.py' } });

    render(<Harness host={host} nodeId={null} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(setContext).toHaveBeenCalledTimes(1);
    expect(setContext.mock.calls[0][0]).toMatchObject({ panel: 'focus' });
  });
});

/* ── the gesture, on the real Board ──────────────────────────────────────── */

describe('the Board itself', () => {
  const lane: BoardGraphTransport = {
    async load() {
      return null;
    },
    async save() {
      return true;
    },
  };

  function hostProps(host: PanelHostLike): PanelHostProps {
    return {
      host: { panelId: 'grid', extensionId: 'pack', workspacePath: '', ...host },
    } as unknown as PanelHostProps;
  }

  beforeEach(async () => {
    gridVitals.reset();
    resetFaceStore();
    setFace('board');
    await boardGraphStore.open('', { transport: lane, saveDelayMs: 5000 });
  });

  afterEach(() => {
    closePalette();
    openGridHome();
    resetFaceStore();
    gridVitals.reset();
  });

  it('publishes on a press and clears when the same press closes the card', async () => {
    const { host, setContext, clearContext } = aiHost();
    const nodeId = boardGraphStore.createNode({
      kind: 'research',
      research: { hypothesis: 'Do late filings predict drift?' },
    });
    await act(async () => {
      render(<GridPanel {...hostProps(host)} />);
    });

    // Mounting on a Board with nothing selected says nothing to the chat.
    expect(setContext).not.toHaveBeenCalled();
    expect(clearContext).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`board-card-face-${nodeId}`));
    });
    expect(setContext).toHaveBeenCalledTimes(1);
    expect(setContext.mock.calls[0][0]).toMatchObject({
      panel: 'grid',
      face: 'board',
      card: { id: nodeId, kind: 'research' },
    });

    // The same control both ways: a second press closes the card, which is the
    // deselection.
    await act(async () => {
      fireEvent.click(screen.getByTestId(`board-card-face-${nodeId}`));
    });
    expect(clearContext).toHaveBeenCalledTimes(1);
  });
});
