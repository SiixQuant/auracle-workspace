import { AuracleStatusChip } from './components/StatusChip';
import { AuracleConnections } from './components/ConnectionsSettings';
import { LiveAlgorithmsPanel } from './components/LivePanel';
import {
  BlotterPanel,
  IncidentsPanel,
  RunwayPanel,
  SchedulesPanel,
} from './components/MonitorPanels';
import { AuracleFlowEditor } from './components/FlowEditor';
import { QcImportPanel } from './components/QcImportPanel';
import { ResearchPanel } from './components/ResearchPanel';
import { ValidationPanel } from './components/ValidationPanel';
import { BacktestPanel } from './components/BacktestPanel';
import { RunStrategyHeader } from './components/RunStrategyHeader';

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
  research: {
    component: ResearchPanel,
  },
  backtest: {
    component: BacktestPanel,
  },
};

export const components = {
  AuracleFlowEditor,
  RunStrategyHeader,
};
