/**
 * Spine cross-panel actions — the side-effecting navigation edges panels fire
 * to hand a strategy or run to another surface. Each mirrors the editor header
 * (RunStrategyHeader): publish focus FIRST, drive the target domain store, then
 * open the destination room in the Grid. Centralised so the routing plumbing
 * lives in one tested place.
 *
 * `openGridRoom` addresses the room's alias id, which the host reads as
 * navigation rather than a toggle — so a repeated hand-off opens the room it
 * names and can never close the Grid out from under the user.
 */
import { backtestStore } from '../engine/backtestStore';
import { deployStore } from '../engine/deployStore';
import { focusStore, type FocusedStrategy } from '../engine/focusStore';
import type { StrategyOption } from '../engine/deploy';
import { strategySourceFromDotted } from '../engine/spineNav';
import { openGridRoom } from './grid/gridNav';

/**
 * Deploy the strategy in `filePath` (the Backtest results "Deploy"): resolve
 * the file to a strategy through deployStore and front the Deploy wizard,
 * exactly as the editor header does. Publishes the strategy focus first.
 */
export function deployFile(filePath: string, dottedPath?: string): void {
  focusStore.publish({ strategy: { filePath, dottedPath } });
  void deployStore.deploy(filePath);
  openGridRoom('deploys');
}

/**
 * Hand an already-resolved strategy option to the Deploy wizard (a Flow node
 * "Deploy"). The option carries the dotted `module.Class`, so it binds the
 * wizard directly without a file round-trip.
 */
export function deployOption(option: StrategyOption, focus?: FocusedStrategy): void {
  if (focus) focusStore.publish({ strategy: focus });
  deployStore.choose(option);
  openGridRoom('deploys');
}

/**
 * Run an already-resolved strategy option and open the Backtest room (a Flow
 * node "Metrics"): that room renders the full metrics and overfit check — the
 * surface a backtest run's metrics live on.
 */
export function backtestOption(option: StrategyOption, focus?: FocusedStrategy): void {
  if (focus) focusStore.publish({ strategy: focus });
  void backtestStore.choose(option);
  openGridRoom('backtest');
}

/**
 * Open an already-persisted run by its job id in the Backtest room's Metrics
 * Viewer — the QC library's single outbound edge.
 *
 * Unlike the strategy hand-offs above it publishes NO Spine focus: the QC
 * library stays OFF the Spine, so it loads the run straight into the viewer
 * store (which frames a by-id load as a saved run) and lets the Backtest panel
 * name the run it shows. `source` is the run's non-local provenance (e.g.
 * "quantconnect"), threaded through so the viewer labels it and hides local
 * verbs even though the standard result read serves the run source-blind.
 */
export function openRunInViewer(jobId: number, source?: string): void {
  void backtestStore.loadJob(jobId, source ? { source } : undefined);
  openGridRoom('backtest');
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
