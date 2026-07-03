import { AuracleStatusChip } from './components/StatusChip';
import { AuracleConnections } from './components/ConnectionsSettings';

export async function activate() {}

export async function deactivate() {}

export const hostComponents = {
  AuracleStatusChip,
};

export const settingsPanel = {
  AuracleConnections,
};
