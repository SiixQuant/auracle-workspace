import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../engine/backtestStore', () => ({ backtestStore: { choose: vi.fn(), loadJob: vi.fn() } }));
vi.mock('../../engine/deployStore', () => ({ deployStore: { deploy: vi.fn(), choose: vi.fn() } }));

import { backtestStore } from '../../engine/backtestStore';
import { deployStore } from '../../engine/deployStore';
import { focusStore } from '../../engine/focusStore';
import { getActiveRoom, openGridHome } from '../grid/gridNav';
import { backtestOption, deployFile, deployOption, handOffNode, openRunInViewer } from '../spineActions';

/** The alias ids the hand-offs address — never the Grid's own id, which the
 *  host would read as a toggle and could close the Grid mid-hand-off. */
const DEPLOYS_ROUTE = 'com.auracle.pack.live-algorithms';
const BACKTEST_ROUTE = 'com.auracle.pack.backtest';

const OPTION = { path: 'strategies.momentum.Mom', cls: 'Mom', label: 'Mom' };

function toggledPanelIds(): string[] {
  return vi.mocked(window.dispatchEvent).mock.calls
    .map((c) => c[0] as CustomEvent)
    .filter((e) => e.type === 'nimbalyst:toggle-panel')
    .map((e) => e.detail?.panelId);
}

beforeEach(() => {
  vi.spyOn(window, 'dispatchEvent');
});

afterEach(() => {
  focusStore.clear();
  openGridHome();
  vi.clearAllMocks();
});

describe('deployFile — Backtest results "Deploy"', () => {
  it('publishes focus, resolves the file through deployStore, and opens the Deployments room', () => {
    deployFile('strategies/momentum.py', 'strategies.momentum.Mom');

    expect(focusStore.getSnapshot().strategy).toEqual({
      filePath: 'strategies/momentum.py',
      dottedPath: 'strategies.momentum.Mom',
    });
    expect(deployStore.deploy).toHaveBeenCalledWith('strategies/momentum.py');
    expect(getActiveRoom()).toBe('deploys');
    expect(toggledPanelIds()).toEqual([DEPLOYS_ROUTE]);
  });

  it('re-firing keeps naming the room, so the host navigates instead of closing', () => {
    deployFile('strategies/momentum.py');
    deployFile('strategies/momentum.py');
    // Both requests are aliased: the host reads them as navigation, so a
    // second Deploy cannot toggle the open Grid shut.
    expect(toggledPanelIds()).toEqual([DEPLOYS_ROUTE, DEPLOYS_ROUTE]);
    expect(getActiveRoom()).toBe('deploys');
  });
});

describe('deployOption — Flow node "Deploy"', () => {
  it('binds the resolved option to the wizard and opens the Deployments room', () => {
    deployOption(OPTION, { filePath: 'strategies/momentum.py', dottedPath: OPTION.path });

    expect(deployStore.choose).toHaveBeenCalledWith(OPTION);
    expect(focusStore.getSnapshot().strategy).toEqual({
      filePath: 'strategies/momentum.py',
      dottedPath: OPTION.path,
    });
    expect(toggledPanelIds()).toEqual([DEPLOYS_ROUTE]);
    expect(getActiveRoom()).toBe('deploys');
  });

  it('omits focus when none is supplied (e.g. an unmappable node)', () => {
    deployOption(OPTION);
    expect(deployStore.choose).toHaveBeenCalledWith(OPTION);
    expect(focusStore.getSnapshot().strategy).toBeUndefined();
  });
});

describe('backtestOption — Flow node "Metrics" (view metrics)', () => {
  it('runs the option and opens the Backtest room', () => {
    backtestOption(OPTION, { filePath: 'strategies/momentum.py', dottedPath: OPTION.path });

    expect(backtestStore.choose).toHaveBeenCalledWith(OPTION);
    expect(focusStore.getSnapshot().strategy).toEqual({
      filePath: 'strategies/momentum.py',
      dottedPath: OPTION.path,
    });
    expect(toggledPanelIds()).toEqual([BACKTEST_ROUTE]);
    expect(getActiveRoom()).toBe('backtest');
  });
});

describe('handOffNode — Flow "Metrics" / "Deploy"', () => {
  const node = { path: 'strategies.momentum.Mom', name: 'Mom' };
  const option = { path: 'strategies.momentum.Mom', cls: 'Mom', label: 'Mom' };
  const focus = { filePath: 'strategies/momentum.py', dottedPath: 'strategies.momentum.Mom' };

  it('builds the option + workspace focus and runs it in the Backtest room', () => {
    handOffNode(node, 'backtest');
    expect(backtestStore.choose).toHaveBeenCalledWith(option);
    expect(focusStore.getSnapshot().strategy).toEqual(focus);
    expect(toggledPanelIds()).toEqual([BACKTEST_ROUTE]);
    expect(getActiveRoom()).toBe('backtest');
  });

  it('builds the option + workspace focus and binds the Deploy wizard', () => {
    handOffNode(node, 'deploy');
    expect(deployStore.choose).toHaveBeenCalledWith(option);
    expect(focusStore.getSnapshot().strategy).toEqual(focus);
    expect(toggledPanelIds()).toEqual([DEPLOYS_ROUTE]);
    expect(getActiveRoom()).toBe('deploys');
  });

  it('still hands off a desk-grafted node, focus carrying its (non-openable) path', () => {
    handOffNode({ path: 'strategies.desk.p.a3.T25', name: 'T25' }, 'deploy');
    expect(deployStore.choose).toHaveBeenCalledWith({
      path: 'strategies.desk.p.a3.T25',
      cls: 'T25',
      label: 'T25',
    });
    expect(focusStore.getSnapshot().strategy).toEqual({
      filePath: 'strategies/desk/p/a3.py',
      dottedPath: 'strategies.desk.p.a3.T25',
    });
  });

  it('is a no-op for a node without a path', () => {
    handOffNode({ path: null, name: 'draft' }, 'backtest');
    expect(backtestStore.choose).not.toHaveBeenCalled();
    expect(focusStore.getSnapshot().strategy).toBeUndefined();
  });
});

describe('openRunInViewer — QC library "Open in Metrics Viewer" (the one outbound edge)', () => {
  it('loads the persisted run by id (with its source) and opens the Backtest room', () => {
    openRunInViewer(4242, 'quantconnect');

    expect(backtestStore.loadJob).toHaveBeenCalledWith(4242, { source: 'quantconnect' });
    expect(toggledPanelIds()).toEqual([BACKTEST_ROUTE]);
    expect(getActiveRoom()).toBe('backtest');
  });

  it('publishes NO Spine focus — the QC library stays off the Spine', () => {
    openRunInViewer(4242, 'quantconnect');

    // The single outbound edge drives the viewer store directly; it must not
    // publish strategy or run focus the way the strategy hand-offs do.
    expect(focusStore.getSnapshot().strategy).toBeUndefined();
    expect(focusStore.getSnapshot().run).toBeUndefined();
  });

  it('omits the source hint when none is given', () => {
    openRunInViewer(7);
    expect(backtestStore.loadJob).toHaveBeenCalledWith(7, undefined);
  });
});
