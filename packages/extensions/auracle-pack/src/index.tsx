import { AuracleStatusChip } from './components/StatusChip';
import { AuracleConnections } from './components/ConnectionsSettings';
import { LiveAlgorithmsPanel } from './components/LivePanel';
import {
  BlotterPanel,
  IncidentsPanel,
  RunwayPanel,
  SchedulesPanel,
  ValidationPanel,
} from './components/MonitorPanels';
import { AuracleFlowEditor } from './components/FlowEditor';
import { QcImportPanel } from './components/QcImportPanel';

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
  blotter: {
    component: BlotterPanel,
  },
  incidents: {
    component: IncidentsPanel,
  },
  schedules: {
    component: SchedulesPanel,
  },
  validation: {
    component: ValidationPanel,
  },
  runway: {
    component: RunwayPanel,
  },
  'qc-import': {
    component: QcImportPanel,
  },
};

export const components = {
  AuracleFlowEditor,
};
