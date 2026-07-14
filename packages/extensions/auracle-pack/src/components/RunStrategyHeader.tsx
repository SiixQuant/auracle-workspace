/**
 * RunStrategyHeader — a slim control strip the host mounts ABOVE a .py editor
 * (the `documentHeaders` contribution; there is no editor-toolbar/gutter
 * contribution point for extensions). Two everyday actions for the strategy in
 * the open file: Run backtest (hands the file to backtestStore + opens the
 * Backtest panel) and Deploy (hands the file to deployStore + opens the Live
 * Algorithms panel's wizard, pre-bound to this file's strategy). Each panel
 * owns its own lifecycle + results; the header only launches.
 */
import React, { useCallback, useState } from 'react';
import { backtestStore } from '../engine/backtestStore';
import { deployStore } from '../engine/deployStore';
import { tone } from './panelkit';
import { isBacktestPanelOpen, isLivePanelOpen } from './panelVisibility';

/** Full panel ids (extensionId.panelId) — the toggle-panel event routes by id. */
const BACKTEST_PANEL_ID = 'com.auracle.pack.backtest';
const LIVE_PANEL_ID = 'com.auracle.pack.live-algorithms';

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

export const RunStrategyHeader: React.FC<DocumentHeaderComponentProps> = ({ filePath }) => {
  const [pinged, setPinged] = useState<null | 'run' | 'deploy'>(null);

  const ping = useCallback((which: 'run' | 'deploy') => {
    setPinged(which);
    window.setTimeout(() => setPinged((prev) => (prev === which ? null : prev)), 1000);
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
    // Same toggle guard as Run: don't shut an already-open Live panel; it
    // re-renders into the pre-bound wizard when the binding lands.
    if (!isLivePanelOpen()) togglePanel(LIVE_PANEL_ID);
    ping('deploy');
  }, [filePath, ping]);

  const btnBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 26,
    padding: '0 11px',
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  return (
    <div
      className="auracle-run-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 12px',
        borderBottom: `1px solid ${tone.border}`,
        background: tone.surface,
        font: `12px/1.4 ${tone.font}`,
        color: tone.text2,
      }}
    >
      <span
        className="material-symbols-outlined"
        aria-hidden
        style={{ fontSize: 16, color: tone.accent }}
      >
        bolt
      </span>
      <span style={{ color: tone.text3 }}>Auracle strategy</span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className="auracle-run-header__run"
        onClick={onRun}
        title="Backtest the strategy in this file"
        style={{
          ...btnBase,
          border: '1px solid transparent',
          background: tone.accent,
          color: '#fff',
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
        className="auracle-run-header__deploy"
        onClick={onDeploy}
        title="Deploy the strategy in this file to paper or live"
        style={{
          ...btnBase,
          border: `1px solid ${tone.borderStrong}`,
          background: 'transparent',
          color: tone.text2,
          opacity: pinged === 'deploy' ? 0.7 : 1,
        }}
      >
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 15 }}>
          rocket_launch
        </span>
        Deploy
      </button>
    </div>
  );
};
