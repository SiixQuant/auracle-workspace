/**
 * Saveable workspaces in the ⌘K palette (Frontier #3).
 *
 * Pinned: a view becomes a labelled, de-dupable workspace; the provider offers a
 * Save row for the active room, an Open row per saved workspace, and Remove rows
 * only when the query asks; and a saved workspace round-trips — reopening it
 * restores the exact room and focus it was captured from.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { focusStore, type Focus } from '../../engine/focusStore';
import { workspaceStore } from '../../engine/workspaceStore';
import { getActiveRoom, openGridHome } from '../grid/gridNav';
import { buildWorkspaceCommands, workspaceFromView } from '../grid/gridWorkspaceCommands';

const PATH = 'strategies.desk.fund_pair.FundPair';
const FOCUS: Focus = { strategy: { dottedPath: PATH } };

afterEach(() => {
  workspaceStore.__resetForTest();
  focusStore.clear();
  openGridHome();
});

describe('workspaceFromView', () => {
  it('labels a view "Room · Strategy" and folds its coordinates into a stable id', () => {
    const ws = workspaceFromView('factors', FOCUS);
    expect(ws.label).toBe('Factors · FundPair');
    expect(ws.room).toBe('factors');
    // The same view re-derives the same id (so re-saving upserts)…
    expect(workspaceFromView('factors', FOCUS).id).toBe(ws.id);
    // …but a different room is a different view.
    expect(workspaceFromView('backtest', FOCUS).id).not.toBe(ws.id);
  });

  it('names the specific run when a backtest is focused', () => {
    const ws = workspaceFromView('backtest', {
      strategy: { dottedPath: PATH },
      run: { kind: 'backtest', id: '42' },
    });
    expect(ws.label).toContain('(run 42)');
  });
});

describe('buildWorkspaceCommands', () => {
  const saved = [workspaceFromView('factors', FOCUS)];

  it('offers a Save row for the active room and an Open row per saved workspace', () => {
    const cmds = buildWorkspaceCommands(saved, 'validation', FOCUS, '');
    expect(cmds.find((c) => c.id === 'workspace-save')?.label).toContain('Validation');
    expect(cmds.some((c) => c.id.startsWith('workspace-open-'))).toBe(true);
  });

  it('omits the Save row on the plan itself (no single view to save)', () => {
    const cmds = buildWorkspaceCommands(saved, null, FOCUS, '');
    expect(cmds.some((c) => c.id === 'workspace-save')).toBe(false);
  });

  it('surfaces Remove rows only once the query asks', () => {
    expect(
      buildWorkspaceCommands(saved, 'factors', FOCUS, '').some((c) =>
        c.id.startsWith('workspace-remove-')
      )
    ).toBe(false);
    expect(
      buildWorkspaceCommands(saved, 'factors', FOCUS, 'delete').some((c) =>
        c.id.startsWith('workspace-remove-')
      )
    ).toBe(true);
  });
});

describe('save → reopen round-trip', () => {
  it('reopening a saved workspace restores its room and focus', () => {
    const save = buildWorkspaceCommands([], 'factors', FOCUS, '').find((c) => c.id === 'workspace-save');
    save!.run();
    expect(workspaceStore.list()).toHaveLength(1);

    // Wander off — different room, no focus.
    focusStore.clear();
    const open = buildWorkspaceCommands(workspaceStore.list(), 'blotter', {}, '').find((c) =>
      c.id.startsWith('workspace-open-')
    );
    open!.run();

    expect(getActiveRoom()).toBe('factors');
    expect(focusStore.getSnapshot().strategy?.dottedPath).toBe(PATH);
  });

  it('a Remove row forgets the workspace', () => {
    workspaceStore.save(workspaceFromView('factors', FOCUS));
    const remove = buildWorkspaceCommands(workspaceStore.list(), 'factors', FOCUS, 'remove').find((c) =>
      c.id.startsWith('workspace-remove-')
    );
    remove!.run();
    expect(workspaceStore.list()).toHaveLength(0);
  });
});
