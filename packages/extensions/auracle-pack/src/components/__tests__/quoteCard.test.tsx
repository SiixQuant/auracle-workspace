/**
 * The live-quote card, drawn — the streaming surface and its honesty rule.
 *
 * What is pinned here:
 *  - AC1: a realtime quote streams onto the card behind a "Live" badge;
 *  - AC5 / I1: a delayed quote reads "Delayed", and nothing on the card claims
 *    it is live — not a word, not a market-data-type contradiction;
 *  - AC2: specifying an option, in the on-canvas editor, writes the contract the
 *    engine needs to qualify the right instrument;
 *  - AC12 / I7: adding a quote card leaves the cards already on the Board — and
 *    the Plan — exactly as they were.
 *
 * The stream is a fake EventSource injected into the card; the GridPanel tests
 * mock the engine client, so nothing here touches a live engine.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const stub = vi.hoisted(() => ({
  feeds: {} as Record<string, unknown>,
  posts: [] as Array<{ path: string; body: unknown }>,
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
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 404, body: null })),
  postJson: vi.fn(async (path: string, body: unknown) => {
    stub.posts.push({ path, body });
    return { ok: true, status: 200, body: {} };
  }),
  connectCheck: vi.fn(async () => null),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { GridPanel } from '../grid/GridPanel';
import { QuoteCard } from '../grid/QuoteCard';
import { CARD_HEIGHT, CARD_WIDTH, type PlacedCard } from '../grid/boardLayout';
import { boardGraphStore } from '../../engine/boardGraphStore';
import type { BoardGraph, BoardNode } from '../../engine/boardGraph';
import type { BoardGraphTransport } from '../../engine/boardPersistence';
import { contractKey, contractToWire, type ContractRef } from '../../engine/liveQuotes';
import type { QuoteEventSource, QuoteStreamDeps } from '../../engine/quoteStream';
import { gridVitals } from '../../engine/gridVitals';
import { openGridHome } from '../grid/gridNav';
import { resetFaceStore, setFace } from '../grid/gridFaceStore';
import { closePalette } from '../grid/gridCommands';

/* ── a fake stream ───────────────────────────────────────────────────────── */

class FakeEventSource implements QuoteEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.onopen?.();
  }

  emitQuote(payload: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function fakeStream(): { deps: QuoteStreamDeps; sources: FakeEventSource[] } {
  const sources: FakeEventSource[] = [];
  return {
    sources,
    deps: {
      createStream: () => {
        const es = new FakeEventSource();
        sources.push(es);
        return es;
      },
      snapshot: async () => [],
      backoffMs: [1000],
      snapshotEveryMs: 60_000,
    },
  };
}

const STOCK: ContractRef = { symbol: 'AAPL', secType: 'STK' };

function quoteNode(contracts: ContractRef[], id = 'q-1'): BoardNode {
  return { id, kind: 'quote', quote: { contracts } };
}

function placedCard(id: string): PlacedCard {
  return { id, kind: 'quote', rank: 0, x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT, placed: false };
}

function renderCard(node: BoardNode, deps: QuoteStreamDeps): void {
  render(
    <QuoteCard
      node={node}
      card={placedCard(node.id)}
      editing={false}
      drop="none"
      onOpen={() => {}}
      onWireEnd={() => {}}
      deps={deps}
    />
  );
}

afterEach(() => {
  cleanup();
});

/* ── AC1 / AC5 / I1: the badge ───────────────────────────────────────────── */

describe('the card streams a quote and badges its quality', () => {
  it('shows a streaming realtime quote behind a Live badge (AC1)', () => {
    const { deps, sources } = fakeStream();
    const node = quoteNode([STOCK]);
    renderCard(node, deps);

    act(() => {
      sources[0].emitOpen();
      sources[0].emitQuote({ symbol: 'AAPL', sec_type: 'STK', last: 190.25, bid: 190.2, ask: 190.3, quality: 'realtime', market_data_type: 1 });
    });

    const key = contractKey(STOCK);
    const badge = screen.getByTestId(`quote-badge-${node.id}-${key}`);
    expect(badge.textContent).toBe('Live');
    expect(badge.getAttribute('data-quality')).toBe('realtime');
    expect(screen.getByTestId(`quote-last-${node.id}-${key}`).textContent).toContain('190.25');
    expect(screen.getByTestId(`board-card-dot-${node.id}`).getAttribute('data-health')).toBe('nominal');
  });

  it('labels a delayed quote Delayed and never as live (AC5 / I1)', () => {
    const { deps, sources } = fakeStream();
    const node = quoteNode([STOCK]);
    renderCard(node, deps);

    act(() => {
      sources[0].emitOpen();
      sources[0].emitQuote({ symbol: 'AAPL', sec_type: 'STK', last: 190.25, quality: 'delayed', market_data_type: 3 });
    });

    const key = contractKey(STOCK);
    const badge = screen.getByTestId(`quote-badge-${node.id}-${key}`);
    expect(badge.textContent).toBe('Delayed');
    expect(badge.getAttribute('data-quality')).toBe('delayed');

    // I1: nothing anywhere on the card presents this as live.
    const card = screen.getByTestId(`board-card-${node.id}`);
    expect(card.textContent).not.toMatch(/\bLive\b/);
    expect((card.textContent ?? '').toLowerCase()).not.toContain('realtime');
    expect(card.getAttribute('data-health')).toBe('degraded');
  });

  it('downgrades a realtime tag its market-data type contradicts (I1)', () => {
    const { deps, sources } = fakeStream();
    const node = quoteNode([STOCK]);
    renderCard(node, deps);

    act(() => {
      sources[0].emitOpen();
      // Tag says realtime; market-data type 3 says delayed. The card believes
      // the market-data type.
      sources[0].emitQuote({ symbol: 'AAPL', sec_type: 'STK', last: 190.25, quality: 'realtime', market_data_type: 3 });
    });

    const badge = screen.getByTestId(`quote-badge-${node.id}-${contractKey(STOCK)}`);
    expect(badge.textContent).toBe('Delayed');
  });

  it('opens no stream and says so for a card with no contract yet', () => {
    const { deps, sources } = fakeStream();
    const node = quoteNode([]);
    renderCard(node, deps);
    expect(sources).toHaveLength(0);
    expect(screen.getByTestId(`quote-empty-${node.id}`)).toBeTruthy();
  });
});

/* ── AC2 / AC12: placement and the on-canvas editor ──────────────────────── */

const lane: BoardGraphTransport = {
  async load() {
    return null;
  },
  async save() {
    return true;
  },
};

function hostProps(): PanelHostProps {
  return { host: { panelId: 'grid', extensionId: 'pack', workspacePath: '' } } as unknown as PanelHostProps;
}

async function paint(): Promise<void> {
  await act(async () => {
    render(<GridPanel {...hostProps()} />);
  });
}

function graph(): BoardGraph {
  return boardGraphStore.getSnapshot().graph;
}

function seedSource(): string {
  return boardGraphStore.createNode({
    kind: 'source',
    source: { name: 'Yahoo Finance', connectorKind: 'feed', endpoint: 'yfinance', payloadType: 'daily bars' },
  });
}

async function change(testId: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
  });
}

describe('placing and configuring a quote card', () => {
  beforeEach(async () => {
    stub.feeds = {};
    stub.posts = [];
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

  it('adds a quote card without disturbing the cards already there (AC12 / I7)', async () => {
    const srcId = seedSource();
    await paint();

    await act(async () => {
      fireEvent.click(screen.getByTestId('board-add-quote'));
    });

    const quote = graph().nodes.find((node) => node.kind === 'quote');
    expect(quote).toBeDefined();
    // The source card, and the source node, are untouched.
    expect(screen.getByTestId(`board-card-title-${srcId}`).textContent).toBe('Yahoo Finance');
    expect(graph().nodes.find((node) => node.id === srcId)?.source?.name).toBe('Yahoo Finance');
    // Both cards coexist on the Board.
    expect(screen.getByTestId(`board-card-face-${quote!.id}`)).toBeTruthy();
  });

  it('specifying an option writes the contract the engine needs (AC2)', async () => {
    // A source on the board so the add row (and its quote chip) is showing —
    // the same state a person is in once they have connected anything.
    seedSource();
    await paint();
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-add-quote'));
    });
    const id = graph().nodes.find((node) => node.kind === 'quote')!.id;

    // The editor auto-opened on the fresh card; describe an option in place.
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-quote-add'));
    });
    await change('board-editor-quote-symbol-0', 'AAPL');
    await change('board-editor-quote-sectype-0', 'OPT');
    await change('board-editor-quote-expiry-0', '20260117');
    await change('board-editor-quote-strike-0', '200');
    await change('board-editor-quote-right-0', 'C');

    const contract = graph().nodes.find((node) => node.id === id)!.quote!.contracts[0];
    expect(contract).toMatchObject({ symbol: 'AAPL', secType: 'OPT', expiry: '20260117', strike: 200, right: 'C' });
    expect(contractToWire(contract)).toMatchObject({
      symbol: 'AAPL',
      sec_type: 'OPT',
      expiry: '20260117',
      strike: 200,
      right: 'C',
    });
  });

  it('specifying a future writes its expiry and exchange (AC2)', async () => {
    seedSource();
    await paint();
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-add-quote'));
    });
    const id = graph().nodes.find((node) => node.kind === 'quote')!.id;

    await act(async () => {
      fireEvent.click(screen.getByTestId('board-editor-quote-add'));
    });
    await change('board-editor-quote-symbol-0', 'ES');
    await change('board-editor-quote-sectype-0', 'FUT');
    await change('board-editor-quote-expiry-0', '202603');
    await change('board-editor-quote-exchange-0', 'CME');

    const contract = graph().nodes.find((node) => node.id === id)!.quote!.contracts[0];
    expect(contractToWire(contract)).toMatchObject({ symbol: 'ES', sec_type: 'FUT', expiry: '202603', exchange: 'CME' });
  });
});
