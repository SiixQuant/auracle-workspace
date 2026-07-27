import { AuracleStatusChip } from './components/StatusChip';
import { AuracleConnections } from './components/ConnectionsSettings';
import { AuracleFlowEditor } from './components/FlowEditor';
import { GridPanel } from './components/grid/GridPanel';
import { GridGutterButton } from './components/grid/GridGutterButton';
import { RunStrategyHeader } from './components/RunStrategyHeader';

export async function activate() {}

export async function deactivate() {}

export const hostComponents = {
  AuracleStatusChip,
};

export const settingsPanel = {
  AuracleConnections,
};

// ONE rail surface: the Grid. Every panel the pack used to register is a room
// inside it, and every retired id is declared as a manifest alias — so the host
// resolves an old toggle to this panel and the Grid selects the matching room
// (components/grid/gridNav). The custom gutter button is what lets the single
// rail entry carry the open-alert count.
export const panels = {
  grid: {
    component: GridPanel,
    gutterButton: GridGutterButton,
  },
};

export const components = {
  AuracleFlowEditor,
  RunStrategyHeader,
};
