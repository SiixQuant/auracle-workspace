/**
 * RunStrategyHeader — the control strip the host mounts ABOVE a .py editor
 * (the `documentHeaders` contribution; there is no editor-toolbar/gutter
 * contribution point for extensions). The flagship surface of the Hermes
 * design pass (PRD #59): a brand tile, the strategy's name, and the two
 * everyday actions — Run backtest (hands the file to backtestStore + opens
 * the Backtest panel) and Deploy (hands the file to deployStore + fronts
 * the Live Desk's Deployments tab, pre-bound to this file's strategy).
 * Each panel owns its own lifecycle + results; the header only launches.
 */
import React, { useCallback, useState } from 'react';
import { backtestStore } from '../engine/backtestStore';
import { deployStore } from '../engine/deployStore';
import { ensurePanelKitStyles, tone } from './panelkit';
import { openHubTab } from './hub';
import { isBacktestPanelOpen, isLivePanelOpen } from './panelVisibility';

/** Full panel ids (extensionId.panelId) — the toggle-panel event routes by id. */
const BACKTEST_PANEL_ID = 'com.auracle.pack.backtest';
const LIVE_DESK_PANEL_ID = 'com.auracle.pack.live-desk';

/** Props the host hands every document-header component. */
interface DocumentHeaderComponentProps {
  filePath: string;
  fileName: string;
  getContent: () => string;
  contentVersion: number;
  onContentChange?: (next: string) => void;
  editor?: unknown;
}

function togglePanel(panelId: string): void {
  window.dispatchEvent(
    new CustomEvent('nimbalyst:toggle-panel', { detail: { panelId } })
  );
}

export const RunStrategyHeader: React.FC<DocumentHeaderComponentProps> = ({
  filePath,
  fileName,
}) => {
  ensurePanelKitStyles();
  const [pinged, setPinged] = useState<null | 'run' | 'deploy'>(null);

  const ping = useCallback((which: 'run' | 'deploy') => {
    setPinged(which);
    window.setTimeout(() => setPinged(prev => (prev === which ? null : prev)), 1000);
  }, []);

  const onRun = useCallback(() => {
    void backtestStore.run(filePath);
    // The host event is a pure toggle, so only dispatch it when the panel is
    // closed — otherwise a re-run would toggle the open results panel shut.
    if (!isBacktestPanelOpen()) togglePanel(BACKTEST_PANEL_ID);
    ping('run');
  }, [filePath, ping]);

  const onDeploy = useCallback(() => {
    void deployStore.deploy(filePath);
    // Front the wizard's tab regardless of desk state, then open the desk
    // only when it's closed — the same toggle guard as Run, hub-aware.
    openHubTab('live-desk', 'deployments');
    if (!isLivePanelOpen()) togglePanel(LIVE_DESK_PANEL_ID);
    ping('deploy');
  }, [filePath, ping]);

  const strategyName = fileName?.replace(/\.py$/i, '') || 'Strategy';

  const btnGeometry: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 26,
    padding: '0 12px',
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      className="auracle-run-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '5px 14px',
        borderBottom: `1px solid ${tone.border}`,
        background: tone.surface,
        font: `12px/1.4 ${tone.font}`,
        color: tone.text2,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          borderRadius: 6,
          background: tone.accentSoft,
          border: `1px solid ${tone.accentDim}`,
          color: tone.accentText,
          flex: 'none',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          bolt
        </span>
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 7,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: tone.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {strategyName}
        </span>
        <span style={{ color: tone.text3, flex: 'none' }}>Auracle strategy</span>
      </span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className="apk-btn apk-btn-primary auracle-run-header__run"
        onClick={onRun}
        title="Backtest the strategy in this file"
        style={{
          ...btnGeometry,
          border: '1px solid transparent',
          opacity: pinged === 'run' ? 0.85 : 1,
        }}
      >
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 15 }}>
          play_arrow
        </span>
        Run backtest
      </button>
      <button
        type="button"
        className="apk-btn apk-btn-ghost auracle-run-header__deploy"
        onClick={onDeploy}
        title="Deploy the strategy in this file to paper or live"
        style={{
          ...btnGeometry,
          border: `1px solid ${tone.borderStrong}`,
          background: 'transparent',
          color: tone.text,
          opacity: pinged === 'deploy' ? 0.7 : 1,
        }}
      >
        <span
          className="material-symbols-outlined"
          aria-hidden
          style={{ fontSize: 15, color: tone.accentText }}
        >
          rocket_launch
        </span>
        Deploy
      </button>
    </div>
  );
};
