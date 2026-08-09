/**
 * The `<entity> <verb>` command grammar (Frontier #1, the entity half).
 *
 * Two promises. PURE: `buildEntityCommands` is silent until a two-token phrase,
 * then offers one row per (known strategy × verb), and the palette's own
 * token-AND filter narrows a phrase to the single room meant — so the grammar
 * reuses the palette's one matching path, adds nothing to the resting palette,
 * and can't regress the mnemonics. END TO END: typing `fundpair risk` in the
 * open palette and pressing Enter lands on the Factors room, focused on
 * FundPair's latest run — the issue's own acceptance line.
 *
 * The engine client is mocked at its seam (like the palette suite) so mounting
 * the Grid makes no real reads; the entity cache is seeded through its test seam
 * rather than the network, so the grammar under test is deterministic.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getJson: vi.fn(async () => null),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
}));

import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { GridPanel } from '../grid/GridPanel';
import { closePalette, filterCommands } from '../grid/gridCommands';
import { getActiveRoom, openGridHome } from '../grid/gridNav';
import { __setEntitiesForTest, buildEntityCommands, ENTITY_SECTION } from '../grid/gridEntityCommands';
import { focusStore } from '../../engine/focusStore';
import { gridVitals } from '../../engine/gridVitals';
import type { EntityRef } from '../../engine/entityLinks';

const PATH = 'strategies.desk.fund_pair.FundPair';
const FUNDPAIR: EntityRef = { kind: 'run', id: '77', label: 'FundPair', strategyPath: PATH, runId: '77' };

describe('buildEntityCommands — the grammar, pure', () => {
  it('is silent until the query is a two-token phrase', () => {
    expect(buildEntityCommands([FUNDPAIR], '')).toEqual([]);
    expect(buildEntityCommands([FUNDPAIR], undefined)).toEqual([]);
    expect(buildEntityCommands([FUNDPAIR], 'fundpair')).toEqual([]); // one token → leave the palette alone
  });

  it('is silent when no strategies are known', () => {
    expect(buildEntityCommands([], 'fundpair risk')).toEqual([]);
  });

  it('offers one command per (entity × verb) for a phrase', () => {
    const commands = buildEntityCommands([FUNDPAIR], 'fundpair risk');
    expect(commands).toHaveLength(5); // the five verbs
    const risk = commands.find((c) => c.label === 'Factors · FundPair');
    expect(risk).toBeTruthy();
    expect(risk?.section).toBe(ENTITY_SECTION);
    expect(risk?.keywords).toEqual(expect.arrayContaining(['FundPair', PATH, 'risk']));
  });

  it("the palette's own filter narrows a phrase to the one room meant", () => {
    const shown = filterCommands(buildEntityCommands([FUNDPAIR], 'fundpair risk'), 'fundpair risk');
    expect(shown.map((c) => c.label)).toEqual(['Factors · FundPair']);
  });
});

describe('the grammar in the open palette (end to end)', () => {
  beforeEach(() => {
    __setEntitiesForTest([FUNDPAIR]);
    focusStore.clear();
    gridVitals.reset();
  });

  afterEach(() => {
    cleanup();
    closePalette();
    openGridHome();
    __setEntitiesForTest([]);
    focusStore.clear();
    gridVitals.reset();
  });

  it('`fundpair risk` opens the Factors room focused on that strategy’s run', () => {
    render(<GridPanel {...({} as PanelHostProps)} />);
    act(() => screen.getByTestId('auracle-grid').focus());
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    fireEvent.change(screen.getByTestId('grid-palette-input'), { target: { value: 'fundpair risk' } });

    // Exactly the one grammar row survives — the room commands lack "fundpair".
    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Factors · FundPair');

    // Enter runs the highlighted row → the room, with the entity's focus.
    fireEvent.keyDown(screen.getByTestId('grid-palette-input'), { key: 'Enter' });
    expect(getActiveRoom()).toBe('factors');
    const focus = focusStore.getSnapshot();
    expect(focus.strategy?.dottedPath).toBe(PATH);
    expect(focus.run).toEqual({ kind: 'backtest', id: '77' });
  });

  it('a bare mnemonic is untouched — one token adds no grammar rows', () => {
    render(<GridPanel {...({} as PanelHostProps)} />);
    act(() => screen.getByTestId('auracle-grid').focus());
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    fireEvent.change(screen.getByTestId('grid-palette-input'), { target: { value: 'bt' } });
    // No "Jump to" rows for a single token; the Backtest room command still leads.
    expect(screen.queryByText('Backtest · FundPair')).toBeNull();
    expect(screen.getByTestId('grid-palette-item-room-backtest')).toBeTruthy();
  });
});
