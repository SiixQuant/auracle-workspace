import { AuracleStatusChip } from './components/StatusChip';
import { AuracleConnections } from './components/ConnectionsSettings';
import { AuracleFlowEditor } from './components/FlowEditor';
import { BacktestPanel } from './components/BacktestPanel';
import { LiveDeskPanel, StrategyLabPanel } from './components/hubPanels';
import { RunStrategyHeader } from './components/RunStrategyHeader';

export async function activate() {}

export async function deactivate() {}

export const hostComponents = {
  AuracleStatusChip,
};

export const settingsPanel = {
  AuracleConnections,
};

// Three rail surfaces (PRD #59 addendum). The absorbed panels live on as
// hub tabs — their old ids still resolve via manifest aliases + hub.tsx.
export const panels = {
  backtest: {
    component: BacktestPanel,
  },
  'strategy-lab': {
    component: StrategyLabPanel,
  },
  'live-desk': {
    component: LiveDeskPanel,
  },
};

export const components = {
  AuracleFlowEditor,
  RunStrategyHeader,
};
