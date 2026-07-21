import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../engine/backtestStore', () => ({ backtestStore: { choose: vi.fn() } }));
vi.mock('../../engine/deployStore', () => ({ deployStore: { deploy: vi.fn(), choose: vi.fn() } }));
vi.mock('../hub', () => ({ openHubTab: vi.fn() }));
vi.mock('../panelVisibility', () => ({
  isBacktestPanelOpen: vi.fn(() => false),
  isLivePanelOpen: vi.fn(() => false),
}));

import { backtestStore } from '../../engine/backtestStore';
import { deployStore } from '../../engine/deployStore';
import { focusStore } from '../../engine/focusStore';
import { openHubTab } from '../hub';
import { isBacktestPanelOpen, isLivePanelOpen } from '../panelVisibility';
import { backtestOption, deployFile, deployOption, handOffNode } from '../spineActions';

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
  vi.clearAllMocks();
  vi.mocked(isBacktestPanelOpen).mockReturnValue(false);
  vi.mocked(isLivePanelOpen).mockReturnValue(false);
});

describe('deployFile — Backtest results "Deploy"', () => {
  it('publishes focus, resolves the file through deployStore, and fronts the Live Desk', () => {
    deployFile('strategies/momentum.py', 'strategies.momentum.Mom');

    expect(focusStore.getSnapshot().strategy).toEqual({
      filePath: 'strategies/momentum.py',
      dottedPath: 'strategies.momentum.Mom',
    });
    expect(deployStore.deploy).toHaveBeenCalledWith('strategies/momentum.py');
    expect(openHubTab).toHaveBeenCalledWith('live-desk', 'deployments');
    expect(toggledPanelIds()).toEqual(['com.auracle.pack.live-desk']);
  });

  it('does not toggle the Live Desk when it is already the mounted surface', () => {
    vi.mocked(isLivePanelOpen).mockReturnValue(true);
    deployFile('strategies/momentum.py');
    // The hub tab is still fronted, but no bare toggle that would close it.
    expect(openHubTab).toHaveBeenCalledWith('live-desk', 'deployments');
    expect(toggledPanelIds()).toEqual([]);
  });
});

describe('deployOption — Flow node "Deploy"', () => {
  it('binds the resolved option to the wizard and fronts the Live Desk', () => {
    deployOption(OPTION, { filePath: 'strategies/momentum.py', dottedPath: OPTION.path });

    expect(deployStore.choose).toHaveBeenCalledWith(OPTION);
    expect(focusStore.getSnapshot().strategy).toEqual({
      filePath: 'strategies/momentum.py',
      dottedPath: OPTION.path,
    });
    expect(toggledPanelIds()).toEqual(['com.auracle.pack.live-desk']);
  });

  it('omits focus when none is supplied (e.g. an unmappable node)', () => {
    deployOption(OPTION);
    expect(deployStore.choose).toHaveBeenCalledWith(OPTION);
    expect(focusStore.getSnapshot().strategy).toBeUndefined();
  });
});

describe('backtestOption — Flow node "Metrics" (view metrics)', () => {
  it('runs the option in the Backtest panel and fronts it', () => {
    backtestOption(OPTION, { filePath: 'strategies/momentum.py', dottedPath: OPTION.path });

    expect(backtestStore.choose).toHaveBeenCalledWith(OPTION);
    expect(focusStore.getSnapshot().strategy).toEqual({
      filePath: 'strategies/momentum.py',
      dottedPath: OPTION.path,
    });
    expect(toggledPanelIds()).toEqual(['com.auracle.pack.backtest']);
  });

  it('does not re-toggle the Backtest panel when it is already open', () => {
    vi.mocked(isBacktestPanelOpen).mockReturnValue(true);
    backtestOption(OPTION);
    expect(backtestStore.choose).toHaveBeenCalledWith(OPTION);
    expect(toggledPanelIds()).toEqual([]);
  });
});

describe('handOffNode — Flow "Metrics" / "Deploy"', () => {
  const node = { path: 'strategies.momentum.Mom', name: 'Mom' };
  const option = { path: 'strategies.momentum.Mom', cls: 'Mom', label: 'Mom' };
  const focus = { filePath: 'strategies/momentum.py', dottedPath: 'strategies.momentum.Mom' };

  it('builds the option + workspace focus and runs it in the Backtest panel', () => {
    handOffNode(node, 'backtest');
    expect(backtestStore.choose).toHaveBeenCalledWith(option);
    expect(focusStore.getSnapshot().strategy).toEqual(focus);
    expect(toggledPanelIds()).toEqual(['com.auracle.pack.backtest']);
  });

  it('builds the option + workspace focus and binds the Deploy wizard', () => {
    handOffNode(node, 'deploy');
    expect(deployStore.choose).toHaveBeenCalledWith(option);
    expect(focusStore.getSnapshot().strategy).toEqual(focus);
    expect(toggledPanelIds()).toEqual(['com.auracle.pack.live-desk']);
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
