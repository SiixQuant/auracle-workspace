/**
 * The parity proof.
 *
 * The Board was deleted on one promise: task parity, proven. This suite is that
 * proof, and it is wired to the inventory rather than to a memory of it. It
 * reads PARITY.md, and for every task the document marks carried or subsumed it
 * runs the real new path and asserts the outcome; for every task marked dropped
 * it asserts the thing is gone. A coverage pass then checks the mapping is one
 * to one: a row with no proof, or a proof with no row, fails the suite, and the
 * suite is in the standard test lane the release is cut behind. So a parity
 * task without a passing test blocks the swap rather than shipping on trust.
 *
 * The proofs exercise REAL modules. The only thing stubbed is the engine client
 * seam (so nothing reaches the network); every store, tool, and component under
 * a claim is the shipped one. Where the old control enforced a guardrail, the
 * new path is made to prove the same guardrail: card-3 stays write-only, card-5
 * shows the consequence before it removes anything, card-6 relays the budget
 * verdict without inventing one.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DROPPED_ROWS,
  PARITY_ROWS,
  PROVABLE_ROWS,
  rowsByDisposition,
} from './parityInventory';

// The engine client is the one seam we cut, so no proof reaches the network.
// Everything else in a claim is the real module.
vi.mock('../../engine/client', () => ({
  authState: vi.fn(async () => ({ signedIn: false })),
  engineConfig: vi.fn(async () => ({ engineUrl: '', hasKey: false })),
  getJson: vi.fn(async () => null),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 404, body: null })),
  postJson: vi.fn(async () => ({ ok: true, status: 200, body: {} })),
  putJson: vi.fn(async () => ({ ok: true, status: 200, body: {} })),
  runBacktest: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  backtestJobStatus: vi.fn(async () => null),
  backtestJobResult: vi.fn(async () => null),
  backtestJobFactors: vi.fn(async () => null),
  resolveRunSource: vi.fn(() => undefined),
  connectCheck: vi.fn(async () => null),
  bumpConnectGeneration: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import { getJson, getJsonDetailed, postJson } from '../../engine/client';

import { panels } from '../../index';
import { boardGraphStore } from '../../engine/boardGraphStore';
import type { BoardGraphTransport } from '../../engine/boardPersistence';
import { findNode } from '../../engine/boardGraph';
import {
  boardCreateCard,
  boardDeleteCard,
  boardReadOutputs,
  boardUpdateCard,
  boardWire,
  type BoardToolOutcome,
} from '../../engine/boardTools';
import { graphArtifacts } from '../../engine/boardArtifacts';
import { backtestStore } from '../../engine/backtestStore';
import { boardRuns } from '../../engine/boardRuns';
import { alertStore } from '../../engine/alertStore';
import {
  engineFeeds,
  gridVitals,
  type GridVitals,
  type RoomVital,
} from '../../engine/gridVitals';
import { readSynthesisBudgetBody, recordSynthesis } from '../../engine/boardResearch';
import { focusStore } from '../../engine/focusStore';

import { GridHome } from '../grid/GridHome';
import { GridHealthLine } from '../grid/GridHealthLine';
import { GridSteps, runSteps } from '../grid/GridSteps';
import { GridScope, scopeReading } from '../grid/GridScope';
import { GridLedger } from '../grid/GridLedger';
import { AiApprovalDialog, fieldSlug } from '../grid/AiApprovalDialog';
import { CredentialPaste } from '../grid/CredentialPaste';
import { GridGutterButton } from '../grid/GridGutterButton';
import {
  aiRunStore,
  availableActions,
  requestAiAction,
  type AiAction,
  type AiRunState,
} from '../grid/gridAiActions';
import { registerAgentHost } from '../grid/gridAiExecutors';
import { getActiveRoom, openGridHome, openRoom } from '../grid/gridNav';
import { ROOMS, type RoomId } from '../grid/rooms';
import { deployFile } from '../spineActions';

/* ── shared scaffolding ──────────────────────────────────────────────── */

const Grid = panels.grid.component;

function hostProps() {
  return { panelId: 'com.auracle.pack.grid', extensionId: 'com.auracle.pack' } as never;
}

function renderPanel(): { container: HTMLElement } {
  const { container } = render(<Grid host={hostProps()} />);
  return { container };
}

/** A settings lane in memory — the Board must be OPEN for any tool to write. */
function mockLane(): BoardGraphTransport {
  const docs: Record<string, string> = {};
  return {
    async load(workspaceId: string) {
      return docs[workspaceId] ?? null;
    },
    async save(workspaceId: string, json: string) {
      docs[workspaceId] = json;
      return true;
    },
  };
}

async function openBoard(): Promise<void> {
  await boardGraphStore.open('ws-1', { transport: mockLane(), saveDelayMs: 10_000 });
}

function graph() {
  return boardGraphStore.getSnapshot().graph;
}

function expectOk(outcome: BoardToolOutcome): { message: string; data: Record<string, unknown> } {
  if (!outcome.ok) throw new Error(`expected success, got refusal: ${outcome.error}`);
  return outcome;
}

/** Every testid currently in the tree. */
function testIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid]')).map(
    (el) => el.getAttribute('data-testid') ?? ''
  );
}

function assertNoTestIdMatching(container: HTMLElement, pattern: RegExp): void {
  const hits = testIds(container).filter((id) => pattern.test(id));
  expect(hits, `expected no testid matching ${pattern}, found: ${hits.join(', ')}`).toEqual([]);
}

function gridFile(name: string): string {
  return fileURLToPath(new URL(`../grid/${name}`, import.meta.url));
}

function assertGridFileGone(name: string): void {
  expect(existsSync(gridFile(name)), `${name} must stay deleted`).toBe(false);
}

/** A full vitals snapshot, quiet everywhere but the rooms named. */
function vitalsWith(overrides: Partial<Record<RoomId, Partial<RoomVital>>>): GridVitals {
  gridVitals.reset();
  const base = gridVitals.getSnapshot();
  const next = { ...base } as Record<RoomId, RoomVital>;
  for (const key of Object.keys(overrides) as RoomId[]) {
    next[key] = { ...base[key], ...overrides[key] } as RoomVital;
  }
  return next as GridVitals;
}

function running(action: AiAction): AiRunState {
  return {
    pending: null,
    running: action,
    step: `Sending the intent for ${action.intent.operation}`,
    outcome: null,
  };
}

/** The shipped mutation: liquidate, offered when deploys has deployments. */
function liquidateAction(): AiAction {
  const vitals = vitalsWith({
    deploys: {
      health: 'fault',
      note: '2 deployments errored',
      fact: 'two deployments live',
      subjects: ['algo-a', 'algo-b'],
    },
  });
  const action = availableActions(vitals).find((a) => a.id === 'deploys-liquidate');
  if (!action) throw new Error('the liquidate action was not offered');
  return action;
}

/** The shipped draft: write a strategy from the top finding, offered when the
 *  feed has ranked something. */
function draftAction(): AiAction {
  const vitals = vitalsWith({ findings: { fact: 'a top finding is ranked' } });
  const action = availableActions(vitals).find((a) => a.id === 'findings-draft');
  if (!action) throw new Error('the draft action was not offered');
  return action;
}

/* ── proofs: carried and subsumed tasks, one working path each ───────── */

const PROOFS: Record<string, () => Promise<void>> = {
  // Panel chrome ------------------------------------------------------------
  'chrome-2': async () => {
    const { container } = renderPanel();
    const panel = container.querySelector('[data-testid="auracle-grid"]') as HTMLElement;
    await act(async () => {
      panel.focus();
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    expect(screen.getByTestId('grid-palette')).toBeTruthy();
    expect(panel.getAttribute('data-palette')).toBe('open');
  },

  'chrome-3': async () => {
    const { container } = renderPanel();
    const panel = container.querySelector('[data-testid="auracle-grid"]') as HTMLElement;
    await act(async () => {
      panel.focus();
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    const roomRow = await screen.findByTestId('grid-palette-item-room-backtest');
    expect(roomRow.textContent).toContain(ROOMS.backtest.title);
    await act(async () => {
      fireEvent.click(roomRow);
    });
    expect(getActiveRoom()).toBe('backtest');
  },

  'chrome-4': async () => {
    vi.mocked(getJson).mockResolvedValue({ open_alerts: 3 } as never);
    render(<GridGutterButton isActive={false} onActivate={() => {}} />);
    await act(async () => {
      await alertStore.refresh();
    });
    const badge = await screen.findByTestId('auracle-grid-gutter-badge');
    expect(badge.textContent).toBe('3');
  },

  // Plan face ---------------------------------------------------------------
  'plan-2': async () => {
    // rooms are reached on purpose now; opening one shows its page and a way back
    openRoom('strategies');
    const { container } = renderPanel();
    expect(container.querySelector('[data-testid="grid-room-strategies"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="grid-back"]')).toBeTruthy();
  },

  'plan-1': async () => {
    const seeded = vitalsWith({
      deploys: { health: 'fault', note: '2 deployments errored', fact: 'live', subjects: ['a'] },
    });
    vi.spyOn(gridVitals, 'getSnapshot').mockReturnValue(seeded);
    render(<GridHealthLine />);
    expect(screen.getByTestId('grid-health').getAttribute('data-health')).toBe('fault');
    await act(async () => {
      fireEvent.click(screen.getByTestId('grid-health-chip'));
    });
    expect(screen.getByTestId('grid-health-list')).toBeTruthy();
    expect(screen.getByTestId('grid-health-deploys').textContent).toContain('errored');
  },

  'plan-5': async () => {
    const seeded = vitalsWith({
      deploys: { health: 'fault', note: '2 deployments errored', fact: 'live', subjects: ['a'] },
      conns: { health: 'degraded', note: 'engine reachable, broker is not' },
    });
    vi.spyOn(gridVitals, 'getSnapshot').mockReturnValue(seeded);
    render(<GridHealthLine />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('grid-health-chip'));
    });
    // per-room readings live in the expansion, worst-first, each with its note
    expect(screen.getByTestId('grid-health-deploys').textContent).toContain('errored');
    expect(screen.getByTestId('grid-health-conns').textContent).toContain('broker');
  },

  'plan-6': async () => {
    const action = liquidateAction();
    const steps = runSteps(running(action));
    expect(steps.length).toBeGreaterThan(0);
    render(<GridSteps state={running(action)} />);
    expect(screen.getByTestId('grid-step-0')).toBeTruthy();
    // a mutation's step is priced as capital
    expect(screen.getByTestId('grid-step-cost-0').getAttribute('data-cost')).toBe('capital');
  },

  'plan-7': async () => {
    const seeded = vitalsWith({
      deploys: { health: 'fault', note: '2 deployments errored', fact: 'live', subjects: ['a'] },
    });
    vi.spyOn(gridVitals, 'getSnapshot').mockReturnValue(seeded);
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByTestId('grid-health-chip'));
    });
    const fix = screen.getByTestId('grid-health-fix-deploys');
    // the offered repair is a button, not a form
    expect(fix.closest('form')).toBeNull();
    await act(async () => {
      fireEvent.click(fix);
    });
    // the repair enters the same agent lane rather than a dialog of fields
    await waitFor(() => {
      const run = aiRunStore.getSnapshot();
      expect(run.running !== null || run.outcome !== null).toBe(true);
    });
  },

  'plan-8': async () => {
    const action = draftAction();
    await act(async () => {
      await requestAiAction(action);
    });
    await waitFor(() => expect(aiRunStore.getSnapshot().outcome).not.toBeNull());
    expect(aiRunStore.getSnapshot().outcome?.action.id).toBe('findings-draft');
  },

  // Board face: canvas ------------------------------------------------------
  'canvas-3': async () => {
    await openBoard();
    const created = expectOk(
      boardCreateCard({
        kind: 'source',
        config: {
          name: 'Filings',
          connector_kind: 'http_api',
          endpoint: 'https://example.invalid/f',
          payload_type: 'news',
        },
      })
    );
    const node = findNode(graph(), created.data.node_id as string);
    expect(node?.kind).toBe('source');
    expect(node?.source?.name).toBe('Filings');
  },

  'canvas-4': async () => {
    await openBoard();
    const created = expectOk(
      boardCreateCard({ kind: 'research', config: { hypothesis: 'Does momentum persist?' } })
    );
    const node = findNode(graph(), created.data.node_id as string);
    expect(node?.research?.hypothesis).toBe('Does momentum persist?');
  },

  // Board face: wires -------------------------------------------------------
  'wire-3': async () => {
    await openBoard();
    const source = expectOk(
      boardCreateCard({
        kind: 'source',
        config: {
          name: 'Filings',
          connector_kind: 'http_api',
          endpoint: 'https://example.invalid/f',
          payload_type: 'news',
        },
      })
    ).data.node_id as string;
    const research = expectOk(
      boardCreateCard({ kind: 'research', config: { hypothesis: 'Do late filings drift?' } })
    ).data.node_id as string;
    expectOk(boardWire({ from: source, to: research }));
    const outputs = expectOk(boardReadOutputs({ node_id: research }));
    const upstream = outputs.data.upstream as unknown[];
    expect(Array.isArray(upstream)).toBe(true);
    expect(upstream.length).toBeGreaterThan(0);
    // provenance names the source it reads from (by id or by name)
    const blob = JSON.stringify(outputs.data);
    expect(blob.includes(source) || blob.includes('Filings')).toBe(true);
  },

  // Board face: cards and forms --------------------------------------------
  'card-2': async () => {
    await openBoard();
    const source = expectOk(
      boardCreateCard({
        kind: 'source',
        config: {
          name: 'Filings',
          connector_kind: 'http_api',
          endpoint: 'https://example.invalid/f',
          payload_type: 'news',
        },
      })
    ).data.node_id as string;
    expectOk(boardUpdateCard({ node_id: source, config: { payload_type: 'filings' } }));
    const node = findNode(graph(), source);
    expect(node?.source?.payloadType).toBe('filings');
    expect(node?.source?.name).toBe('Filings'); // the other fields are untouched
  },

  'card-3': async () => {
    vi.mocked(getJsonDetailed).mockResolvedValue({
      ok: true,
      status: 200,
      body: { name: 'polygon', set: false, updated_at: null },
    } as never);
    vi.mocked(postJson).mockResolvedValue({
      ok: true,
      status: 200,
      body: { name: 'polygon', set: true, updated_at: '2026-07-30T00:00:00Z' },
    } as never);
    render(<CredentialPaste slot="polygon" sourceName="Polygon" />);
    const input = (await screen.findByTestId('credential-input-polygon')) as HTMLInputElement;
    expect(input.type).toBe('password'); // a secret field, not text
    fireEvent.change(input, { target: { value: 'sk-live-xyz' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('credential-save-polygon'));
    });
    // posted exactly what was typed, to the slot's own route
    const call = vi
      .mocked(postJson)
      .mock.calls.find((c) => String(c[0]).includes('/credentials/polygon'));
    expect(call).toBeTruthy();
    expect((call?.[1] as { secret: string }).secret).toBe('sk-live-xyz');
    // write-only in earnest: once stored, the field is gone and nothing holds
    // the value; the slot answers with state, never a value
    await waitFor(() =>
      expect(screen.getByTestId('credential-state-polygon').textContent).toContain('key stored')
    );
    expect(screen.queryByTestId('credential-input-polygon')).toBeNull();
  },

  'card-4': async () => {
    const action = draftAction();
    const state = running(action);
    // the scope line RESTATES the intent's summary, display-only
    expect(scopeReading(state)).toBe(action.intent.summary);
    render(<GridScope state={state} />);
    expect(screen.getByTestId('grid-scope-reading').textContent).toContain(action.intent.summary);
    const scope = screen.getByTestId('grid-scope');
    expect(scope.querySelector('input,select,textarea,button,[contenteditable]')).toBeNull();
  },

  'card-5': async () => {
    await openBoard();
    const research = expectOk(
      boardCreateCard({ kind: 'research', config: { hypothesis: 'Do late filings drift?' } })
    ).data.node_id as string;
    const source = expectOk(
      boardCreateCard({
        kind: 'source',
        config: {
          name: 'Filings',
          connector_kind: 'http_api',
          endpoint: 'https://example.invalid/f',
          payload_type: 'news',
        },
      })
    ).data.node_id as string;
    expectOk(boardWire({ from: source, to: research }));
    // the consequence must be SHOWN before anything is removed
    const preview = expectOk(boardDeleteCard({ node_id: source, preview: true }));
    expect(preview.data.previewed).toBe(true);
    expect(preview.message.length).toBeGreaterThan(0);
    // and nothing is gone yet
    expect(findNode(graph(), source)).toBeTruthy();
  },

  'card-6': async () => {
    // a MANUAL scan is recorded even past the cap, and carries the budget back
    vi.mocked(postJson).mockResolvedValue({
      ok: true,
      status: 200,
      body: { cap: 5, spent: 6, paused: true },
    } as never);
    const manual = await recordSynthesis({ nodeId: 'q1', kind: 'scan', trigger: 'manual' });
    expect(manual.ok).toBe(true);
    expect(manual.budget).toEqual({ cap: 5, spent: 6, paused: true });
    // an AUTOMATIC scan past the cap is refused, and the refusal still carries it
    vi.mocked(postJson).mockResolvedValue({
      ok: false,
      status: 429,
      body: { cap: 5, spent: 6, paused: true },
    } as never);
    const auto = await recordSynthesis({ nodeId: 'q1', kind: 'scan', trigger: 'auto' });
    expect(auto.ok).toBe(false);
    expect(auto.budget).toEqual({ cap: 5, spent: 6, paused: true });
    // the accounting record carried the trigger and the look
    const body = vi.mocked(postJson).mock.calls.at(-1)?.[1] as { trigger: string; detail: string };
    expect(body.trigger).toBe('auto');
    expect(body.detail).toBe('scan');
    // and a reading never INFERS a pause from cap and spend
    expect(readSynthesisBudgetBody({ cap: 5, spent: 6 })).toEqual({
      cap: 5,
      spent: 6,
      paused: false,
    });
  },

  'card-7': async () => {
    const launch = vi.fn(async () => ({ ok: true, sessionId: 's-1' }));
    registerAgentHost({ launchAgentSession: launch } as never);
    try {
      await act(async () => {
        await requestAiAction(draftAction());
      });
      await waitFor(() => expect(launch).toHaveBeenCalled());
    } finally {
      registerAgentHost(undefined);
    }
  },

  'card-9': async () => {
    const graphSnap = {
      graph: {
        nodes: [
          { id: 'q1', kind: 'research', research: { hypothesis: 'Does momentum persist?' } },
          { id: 'q2', kind: 'research', research: { hypothesis: 'Do late filings drift?' } },
        ],
        edges: [],
      },
      status: 'ready',
    };
    vi.spyOn(boardGraphStore, 'getSnapshot').mockReturnValue(graphSnap as never);
    const feedsBase = engineFeeds.getSnapshot();
    vi.spyOn(engineFeeds, 'getSnapshot').mockReturnValue({
      ...feedsBase,
      material: [{ nodeId: 'q1', newMaterial: 4, asOf: null }],
    } as never);
    render(<GridHome />);
    expect(screen.getByTestId('resting-watch-count-q1').textContent).toContain('+4 new');
    // a question with nothing gathered shows no count, not a zero
    expect(screen.queryByTestId('resting-watch-count-q2')).toBeNull();
  },

  'card-10': async () => {
    const action = liquidateAction();
    render(<AiApprovalDialog action={action} onApprove={() => {}} onDecline={() => {}} />);
    expect(screen.getByTestId('ai-approval-operation').textContent).toContain('deploy.liquidate-all');
    // the spend is disclosed before approval: the capital field is on the dialog
    const capital = screen.getByTestId(`ai-approval-field-${fieldSlug('Affects capital')}`);
    expect(capital.textContent).toContain('yes');
  },

  'card-11': async () => {
    // a materialized artifact hands off into its room
    deployFile('strategies/momentum.py', 'strategies.momentum.Mom');
    expect(focusStore.getSnapshot().strategy?.filePath).toBe('strategies/momentum.py');
    expect(getActiveRoom()).toBe('deploys');
  },

  'card-12': async () => {
    const feedsBase = engineFeeds.getSnapshot();
    vi.spyOn(engineFeeds, 'getSnapshot').mockReturnValue({
      ...feedsBase,
      budget: { cap: 100, spent: 3, paused: false },
    } as never);
    render(<GridLedger />);
    // spend against the monthly budget rides the ledger header
    expect(screen.getByTestId('grid-ledger-toggle').textContent).toContain('3 agent');
  },
};

/* ── absence checks: dropped tasks, each asserted gone ───────────────── */

const ABSENCE: Record<string, () => Promise<void>> = {
  'chrome-1': async () => {
    assertGridFileGone('gridFaceStore.ts');
    expect(Object.keys(panels)).toEqual(['grid']); // one surface, no second face
    openGridHome();
    const { container } = renderPanel();
    assertNoTestIdMatching(container, /face/);
  },

  'plan-3': async () => {
    assertGridFileGone('GridBoard.tsx');
    assertGridFileGone('boardLayout.ts');
    openGridHome();
    const { container } = renderPanel();
    assertNoTestIdMatching(container, /district|fold/);
  },

  'plan-4': async () => {
    assertGridFileGone('RoomPeek.tsx');
    openGridHome();
    const { container } = renderPanel();
    assertNoTestIdMatching(container, /peek/);
  },

  'canvas-1': async () => {
    assertGridFileGone('gridCanvas.ts');
    assertGridFileGone('useGridCanvas.ts');
    openGridHome();
    const { container } = renderPanel();
    assertNoTestIdMatching(container, /canvas|pan/);
  },

  'canvas-2': async () => {
    assertGridFileGone('gridCanvas.ts');
    openGridHome();
    const { container } = renderPanel();
    assertNoTestIdMatching(container, /zoom/);
  },

  'canvas-5': async () => {
    assertGridFileGone('QuoteCard.tsx');
    // a quote node on the graph materializes NO artifact on the stage
    const quoteGraph = { nodes: [{ id: 'qq', kind: 'quote', quote: { contracts: [] } }], edges: [] };
    const arts = graphArtifacts(
      quoteGraph as never,
      backtestStore.getSnapshot(),
      boardRuns.getSnapshot()
    );
    expect(arts.length).toBe(0);
    openGridHome();
    const { container } = renderPanel();
    assertNoTestIdMatching(container, /quote/);
  },

  'canvas-6': async () => {
    assertGridFileGone('BoardCards.tsx');
    openGridHome();
    const { container } = renderPanel();
    // the resting state opens on status, not ghost slots
    assertNoTestIdMatching(container, /ghost|empty-board|placement|onboard/);
    expect(container.querySelector('[data-testid="grid-resting"]')).toBeTruthy();
  },

  'wire-1': async () => {
    assertGridFileGone('BoardWires.tsx');
    assertGridFileGone('gridWires.ts');
    openGridHome();
    const { container } = renderPanel();
    assertNoTestIdMatching(container, /wire/);
  },

  'wire-2': async () => {
    assertGridFileGone('WireOverlay.tsx');
    openGridHome();
    const { container } = renderPanel();
    assertNoTestIdMatching(container, /wire-cut|cut-wire/);
  },

  'card-1': async () => {
    assertGridFileGone('BoardCard.tsx');
    assertGridFileGone('BoardCardEditor.tsx');
    openGridHome();
    const { container } = renderPanel();
    assertNoTestIdMatching(container, /card-editor|board-card/);
  },

  'card-8': async () => {
    // the quote widget carried the watch toggle and its quality badge away
    assertGridFileGone('QuoteCard.tsx');
    openGridHome();
    const { container } = renderPanel();
    assertNoTestIdMatching(container, /quote/);
  },
};

/* ── the gate: coverage maps one to one onto the inventory ───────────── */

describe('the parity suite covers the inventory one to one', () => {
  it('reads every task from PARITY.md, each dispositioned and unique', () => {
    expect(PARITY_ROWS.length).toBe(33);
    for (const row of PARITY_ROWS) {
      expect(['carried', 'subsumed', 'dropped']).toContain(row.disposition);
    }
    const ids = PARITY_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every carried or subsumed row has a proof, every dropped row an absence check', () => {
    for (const row of PROVABLE_ROWS) {
      expect(PROOFS[row.id], `no proof registered for ${row.id} (${row.task})`).toBeTypeOf(
        'function'
      );
    }
    for (const row of DROPPED_ROWS) {
      expect(ABSENCE[row.id], `no absence check for ${row.id} (${row.task})`).toBeTypeOf('function');
    }
  });

  it('no proof or absence check exists without a matching row of the right disposition', () => {
    const provable = new Set(PROVABLE_ROWS.map((r) => r.id));
    const dropped = new Set(DROPPED_ROWS.map((r) => r.id));
    for (const id of Object.keys(PROOFS)) {
      expect(provable.has(id), `proof ${id} maps to no carried/subsumed row`).toBe(true);
    }
    for (const id of Object.keys(ABSENCE)) {
      expect(dropped.has(id), `absence check ${id} maps to no dropped row`).toBe(true);
    }
    // together they cover the whole inventory, and nothing twice
    const covered = new Set([...Object.keys(PROOFS), ...Object.keys(ABSENCE)]);
    expect(covered.size).toBe(PARITY_ROWS.length);
    expect(Object.keys(PROOFS).length + Object.keys(ABSENCE).length).toBe(PARITY_ROWS.length);
  });
});

/* ── the proofs run ──────────────────────────────────────────────────── */

describe('carried and subsumed tasks each have a working path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getJson).mockResolvedValue(null as never);
    vi.mocked(getJsonDetailed).mockResolvedValue({ ok: false, status: 404, body: null } as never);
    vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, body: {} } as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    boardGraphStore.reset();
    gridVitals.reset();
    aiRunStore.reset();
    focusStore.clear();
    registerAgentHost(undefined);
    openGridHome();
  });

  it.each(PROVABLE_ROWS.map((r) => [r.id, r.task] as const))('%s — %s', async (id) => {
    await PROOFS[id]();
  });
});

describe('dropped tasks are absent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getJson).mockResolvedValue(null as never);
    vi.mocked(getJsonDetailed).mockResolvedValue({ ok: false, status: 404, body: null } as never);
    vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, body: {} } as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    boardGraphStore.reset();
    gridVitals.reset();
    aiRunStore.reset();
    openGridHome();
  });

  it.each(DROPPED_ROWS.map((r) => [r.id, r.task] as const))('%s — %s is gone', async (id) => {
    await ABSENCE[id]();
  });
});
