/**
 * workspaceStore — saved views of the Grid (Frontier #3).
 *
 * The persistence rules that matter are pinned here: save upserts by id (a view
 * re-saved does not pile duplicates), remove forgets one, and the set is mirrored
 * to the renderer's own storage so it survives an app restart — the whole point
 * of "saveable", and the reason it is not held only in memory.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { workspaceStore, type Workspace } from '../workspaceStore';

const WS = (id: string, label = id): Workspace => ({
  id,
  label,
  room: 'factors',
  focus: { strategy: { dottedPath: 'strategies.x.Y' } },
});

afterEach(() => workspaceStore.__resetForTest());

describe('workspaceStore', () => {
  it('saves and lists', () => {
    workspaceStore.save(WS('a'));
    expect(workspaceStore.list().map((w) => w.id)).toEqual(['a']);
  });

  it('upserts by id — re-saving the same view replaces, never duplicates', () => {
    workspaceStore.save(WS('a', 'first'));
    workspaceStore.save(WS('a', 'second'));
    const list = workspaceStore.list();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('second');
  });

  it('removes by id', () => {
    workspaceStore.save(WS('a'));
    workspaceStore.save(WS('b'));
    workspaceStore.remove('a');
    expect(workspaceStore.list().map((w) => w.id)).toEqual(['b']);
  });

  it('mirrors to renderer storage so a saved view survives a restart', () => {
    workspaceStore.save(WS('a'));
    const raw = window.localStorage.getItem('auracle.grid_workspaces');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).map((w: Workspace) => w.id)).toEqual(['a']);
  });

  it('notifies subscribers on every change', () => {
    let n = 0;
    const off = workspaceStore.subscribe(() => {
      n += 1;
    });
    workspaceStore.save(WS('a'));
    workspaceStore.remove('a');
    expect(n).toBe(2);
    off();
  });

  it('ignores malformed stored data rather than throwing', () => {
    window.localStorage.setItem('auracle.grid_workspaces', '{not json');
    // A fresh read path (after reset clears the cache) tolerates the garbage.
    workspaceStore.__resetForTest();
    window.localStorage.setItem('auracle.grid_workspaces', '{not json');
    expect(workspaceStore.list()).toEqual([]);
  });
});
