import { AuracleStatusChip } from './components/StatusChip';
import { AuracleConnections } from './components/ConnectionsSettings';
import { LiveAlgorithmsPanel } from './components/LivePanel';

export async function activate() {}

export async function deactivate() {}

export const hostComponents = {
  AuracleStatusChip,
};

export const settingsPanel = {
  AuracleConnections,
};

export const panels = {
  'live-algorithms': {
    component: LiveAlgorithmsPanel,
  },
};
