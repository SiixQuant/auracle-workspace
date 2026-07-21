/**
 * Spine cross-panel actions — the side-effecting navigation edges panels fire
 * to hand a strategy or run to another surface. Each mirrors the editor header
 * (RunStrategyHeader): publish focus FIRST, drive the target domain store, then
 * open the destination panel via the host's toggle event and hub tab, guarded
 * so a re-fire can't toggle an already-open panel shut. Centralised so the
 * panel-id constants and toggle plumbing live in one tested place.
 */
import { backtestStore } from '../engine/backtestStore';
import { deployStore } from '../engine/deployStore';
import { focusStore, type FocusedStrategy } from '../engine/focusStore';
import type { StrategyOption } from '../engine/deploy';
import { strategySourceFromDotted } from '../engine/spineNav';
import { openHubTab } from './hub';
import { isBacktestPanelOpen, isLivePanelOpen } from './panelVisibility';

/** Full panel ids (extensionId.panelId) — the toggle-panel event routes by id. */
const BACKTEST_PANEL_ID = 'com.auracle.pack.backtest';
const LIVE_DESK_PANEL_ID = 'com.auracle.pack.live-desk';

function togglePanel(panelId: string): void {
  window.dispatchEvent(new CustomEvent('nimbalyst:toggle-panel', { detail: { panelId } }));
}

/** Open the Live Desk, only when it isn't already the mounted surface (a bare
 *  toggle would otherwise close it out from under a sibling tab). */
function frontLiveDesk(): void {
  openHubTab('live-desk', 'deployments');
  if (!isLivePanelOpen()) togglePanel(LIVE_DESK_PANEL_ID);
}

/**
 * Deploy the strategy in `filePath` (the Backtest results "Deploy"): resolve
 * the file to a strategy through deployStore and front the Deploy wizard,
 * exactly as the editor header does. Publishes the strategy focus first.
 */
export function deployFile(filePath: string, dottedPath?: string): void {
  focusStore.publish({ strategy: { filePath, dottedPath } });
  void deployStore.deploy(filePath);
  frontLiveDesk();
}

/**
 * Hand an already-resolved strategy option to the Deploy wizard (a Flow node
 * "Deploy"). The option carries the dotted `module.Class`, so it binds the
 * wizard directly without a file round-trip.
 */
export function deployOption(option: StrategyOption, focus?: FocusedStrategy): void {
  if (focus) focusStore.publish({ strategy: focus });
  deployStore.choose(option);
  frontLiveDesk();
}

/**
 * Run an already-resolved strategy option in the Backtest panel and front it
 * (a Flow node "Metrics"): the panel renders the full metrics and overfit
 * check — the surface a backtest run's metrics live on.
 */
export function backtestOption(option: StrategyOption, focus?: FocusedStrategy): void {
  if (focus) focusStore.publish({ strategy: focus });
  void backtestStore.choose(option);
  if (!isBacktestPanelOpen()) togglePanel(BACKTEST_PANEL_ID);
}

/**
 * Hand a Flow node's strategy to the Backtest ("Metrics") or Deploy surface —
 * the way the editor header does. Builds the {@link StrategyOption} and the
 * workspace focus from the node's dotted `module.Class`; a node without a path
 * is a no-op. The focus identity is derived even for a desk-grafted node whose
 * file the workspace bridge can't open, so the chat still knows what moved.
 */
export function handOffNode(
  node: { path: string | null; name: string },
  to: 'backtest' | 'deploy'
): void {
  if (!node.path) return;
  const cls = node.path.split('.').pop() ?? node.path;
  const option: StrategyOption = { path: node.path, cls, label: node.name };
  const src = strategySourceFromDotted(node.path, { hasClassSuffix: true });
  const focus = src ? { filePath: src.path, dottedPath: node.path } : undefined;
  if (to === 'backtest') backtestOption(option, focus);
  else deployOption(option, focus);
}
