/**
 * The two consolidated rail surfaces (PRD #59 addendum). Thin bindings:
 * HubShell owns the tab chrome; every absorbed panel renders unchanged
 * inside its tab, keeping its own store, states, and endpoints.
 */
import React, { useEffect } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { HubShell } from './hub';
import { ResearchPanel } from './ResearchPanel';
import { QcImportPanel } from './QcImportPanel';
import { ValidationPanel } from './ValidationPanel';
import { LiveAlgorithmsPanel } from './LivePanel';
import { BlotterPanel, IncidentsPanel, RunwayPanel, SchedulesPanel } from './MonitorPanels';
import { markLivePanelMounted, markLivePanelUnmounted } from './panelVisibility';

export const StrategyLabPanel: React.FC<PanelHostProps> = props => (
  <HubShell
    hubId="strategy-lab"
    defaultTab="research"
    hostProps={props}
    tabs={[
      { id: 'research', label: 'Research', component: ResearchPanel },
      { id: 'qc-import', label: 'QC Import', component: QcImportPanel },
      { id: 'validation', label: 'Validation', component: ValidationPanel },
    ]}
  />
);

export const LiveDeskPanel: React.FC<PanelHostProps> = props => {
  // The desk (not the Deployments tab) carries the "live surface is open"
  // flag: the editor header's Deploy must not toggle the desk shut just
  // because a sibling tab is frontmost — it switches tabs instead.
  useEffect(() => {
    markLivePanelMounted();
    return markLivePanelUnmounted;
  }, []);

  return (
    <HubShell
      hubId="live-desk"
      defaultTab="deployments"
      hostProps={props}
      tabs={[
        { id: 'deployments', label: 'Deployments', component: LiveAlgorithmsPanel },
        { id: 'blotter', label: 'Blotter', component: BlotterPanel },
        { id: 'incidents', label: 'Incidents', component: IncidentsPanel },
        { id: 'schedules', label: 'Schedules', component: SchedulesPanel },
        { id: 'runway', label: 'Runway', component: RunwayPanel },
      ]}
    />
  );
};
