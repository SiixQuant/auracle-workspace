/**
 * Deploy wizard + Live Algorithms reducer, ported 1:1 (with its unit tests)
 * from the previous native client. Pure logic — no host or React imports.
 *
 * One deliberate deviation from the native source: lifecycle verb endpoints
 * target the engine's ROOT-mounted live router (`/deployments/...`), which is
 * what the engine actually serves (`/ui/api/deployments/...` returns 404 —
 * verified against a running engine).
 */

export interface Position {
  symbol: string;
  quantity: number;
  avg_cost: number;
}

/** A live/paper deployment as the engine reports it. */
export interface Deployment {
  id: number;
  name: string;
  strategy_path: string;
  strategy_cls?: string | null;
  broker: string;
  mode: string;
  aum?: number | null;
  state: string;
  equity?: number | null;
  return_pct?: number | null;
  positions: Position[];
}

/** One order row in a deployment's ledger. */
export interface LedgerOrder {
  id: number;
  symbol: string;
  action: string;
  quantity?: number | null;
  filled_quantity?: number | null;
  avg_fill_price?: number | null;
  status: string;
  broker?: string | null;
  created_at?: string | null;
}

/** `GET /deployments/{id}/orders` — the per-strategy ledger payload. */
export interface DeploymentOrders {
  deployment_id: number;
  orders: LedgerOrder[];
  positions: Position[];
}

export type Mode = 'paper' | 'live';
export type Compute = 'local' | 'oci' | 'aws';

export const COMPUTE_LABELS: Record<Compute, string> = {
  local: 'This machine',
  oci: 'Oracle Cloud',
  aws: 'AWS',
};

/**
 * Tiers that unlock cloud compute (and live trading). Mirrors the engine's
 * `check_live_deploy_allowed` — community/unknown get local only. Kept here
 * so the wizard gates the cloud selectors honestly BEFORE deploy instead of
 * surfacing a 402/403 only after the user clicks Deploy.
 */
export function isPaidTier(tier: string | null | undefined): boolean {
  const t = (tier ?? '').toLowerCase();
  return t.length > 0 && t !== 'community' && t !== 'free' && t !== 'unknown';
}

/** A cloud compute target the current tier cannot run. */
export function computeLocked(compute: Compute, paid: boolean): boolean {
  return compute !== 'local' && !paid;
}

export const COMPUTE_PAID_REASON =
  'Cloud compute is a Pro feature. Run on this machine, or upgrade for Oracle Cloud or AWS.';

/**
 * Split a discovery dotted path "strategies.<module>.<Class>" into the
 * module path + class name the deploy request needs separately — the
 * discovery route hands them back combined, and the live loader does
 * import_module(path) then getattr(module, cls), so they MUST be split.
 */
export function splitStrategyPath(dotted: string): { path: string; cls: string } {
  const i = dotted.lastIndexOf('.');
  if (i <= 0) return { path: dotted, cls: '' };
  return { path: dotted.slice(0, i), cls: dotted.slice(i + 1) };
}

/** The mutable form behind the Deploy wizard. */
export interface DeployWizard {
  name: string;
  strategy_path: string;
  strategy_cls: string;
  mode: Mode;
  broker: string | null;
  /** The single most important field. Required (>0) for a live deployment. */
  aum: number | null;
  compute: Compute;
  data_providers: string[];
  resolution: string;
  auto_restart: boolean;
}

export function newWizard(): DeployWizard {
  return {
    name: '',
    strategy_path: '',
    strategy_cls: '',
    mode: 'paper',
    broker: null,
    aum: null,
    compute: 'local',
    data_providers: [],
    resolution: 'minute',
    auto_restart: true,
  };
}

/**
 * Every reason the deployment can't go out yet, in display order. Empty =
 * ready. Mirrors the engine's `preflight_live` so the UI fails the same way
 * the server would (no surprise 400 after the user clicks Deploy).
 */
export function validateWizard(wizard: DeployWizard): string[] {
  const errors: string[] = [];
  if (wizard.name.trim().length === 0) {
    errors.push('Give the deployment a name.');
  }
  if (wizard.strategy_path.trim().length === 0 || wizard.strategy_cls.trim().length === 0) {
    errors.push('Pick a strategy to deploy.');
  }
  if (!wizard.broker || wizard.broker.length === 0) {
    errors.push('Choose a brokerage.');
  }
  if (wizard.mode === 'live' && !(typeof wizard.aum === 'number' && wizard.aum > 0)) {
    errors.push('Starting capital (AUM) is required for live deployment and must be > 0.');
  }
  if (wizard.compute !== 'local' && wizard.data_providers.length === 0) {
    errors.push('A cloud deployment needs at least one data source.');
  }
  return errors;
}

export function canDeploy(wizard: DeployWizard): boolean {
  return validateWizard(wizard).length === 0;
}

/** The `POST /deploy/live` body. Only call when `canDeploy` is true. */
export function toRequest(wizard: DeployWizard): Record<string, unknown> {
  return {
    name: wizard.name.trim(),
    strategy_path: wizard.strategy_path.trim(),
    strategy_cls: wizard.strategy_cls.trim(),
    broker: wizard.broker ?? '',
    mode: wizard.mode,
    aum: wizard.aum,
    data_providers: wizard.data_providers,
    resolution: wizard.resolution,
    compute_kind: wizard.compute,
    risk: {},
    notifications: [],
    resilience: { auto_restart: wizard.auto_restart },
  };
}

export type LiveAction = 'stop' | 'liquidate' | 'restart';

export const ACTION_LABELS: Record<LiveAction, string> = {
  stop: 'Stop',
  liquidate: 'Liquidate',
  restart: 'Restart',
};

/** True for actions that flatten or permanently change the book — confirm first. */
export function isDestructive(action: LiveAction): boolean {
  return action === 'liquidate';
}

/**
 * Actions the engine lifecycle allows from `state` (mirrors
 * `auracle/live/lifecycle.py` ALLOWED). Anything else the API would 409.
 */
export function availableActions(state: string): LiveAction[] {
  switch (state) {
    case 'running':
    case 'starting':
    case 'restarting':
      return ['stop', 'liquidate'];
    case 'stopped':
    case 'errored':
      return ['restart', 'liquidate'];
    default:
      return []; // draft / preflight / provisioning / liquidating / archived
  }
}

/** The control-plane path for `action` on `deploymentId` (root-mounted router). */
export function verbEndpoint(deploymentId: number, action: LiveAction): string {
  return `/deployments/${deploymentId}/${action}`;
}

/** How a state should read + badge in the dashboard. */
export function stateLabel(state: string): string {
  switch (state) {
    case 'running':
      return 'Live';
    case 'starting':
      return 'Starting';
    case 'restarting':
      return 'Restarting';
    case 'preflight':
    case 'provisioning':
      return 'Preparing';
    case 'stopped':
      return 'Stopped';
    case 'liquidating':
      return 'Liquidating';
    case 'errored':
      return 'Errored';
    case 'archived':
      return 'Archived';
    case 'draft':
      return 'Draft';
    default:
      return 'Unknown';
  }
}

/** True while the deployment counts as live. Mirrors lifecycle.ACTIVE_STATES. */
export function isActive(state: string): boolean {
  return ['preflight', 'provisioning', 'starting', 'running', 'restarting'].includes(state);
}

export interface LiveAlgorithms {
  rows: Deployment[];
  selected: number | null;
}

export function setRows(model: LiveAlgorithms, rows: Deployment[]): LiveAlgorithms {
  // Drop a stale selection if the deployment is gone.
  const selected =
    model.selected !== null && rows.some((row) => row.id === model.selected)
      ? model.selected
      : null;
  return { rows, selected };
}

export function selectedDeployment(model: LiveAlgorithms): Deployment | undefined {
  if (model.selected === null) return undefined;
  return model.rows.find((row) => row.id === model.selected);
}

export function activeCount(model: LiveAlgorithms): number {
  return model.rows.filter((row) => isActive(row.state)).length;
}

/** Format a return percent for a cell, e.g. `+12.34%` / `-3.10%` / `—`. */
export function formatReturn(returnPct: number | null | undefined): string {
  if (typeof returnPct !== 'number') return '—';
  const sign = returnPct >= 0 ? '+' : '-';
  return `${sign}${Math.abs(returnPct).toFixed(2)}%`;
}
