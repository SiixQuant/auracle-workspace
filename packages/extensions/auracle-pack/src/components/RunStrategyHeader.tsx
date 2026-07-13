/**
 * RunStrategyHeader — a slim control strip the host mounts ABOVE a .py editor
 * (the `documentHeaders` contribution; there is no editor-toolbar/gutter
 * contribution point for extensions). One primary action: run the strategy in
 * the open file. It hands the file to the shared backtestStore and opens the
 * Backtest panel, which owns the run lifecycle + results + the Validate action.
 */
import React, { useCallback, useState } from 'react';
import { backtestStore } from '../engine/backtestStore';
import { tone } from './panelkit';

/** Full panel id (extensionId.panelId) — the toggle-panel event routes by it. */
const BACKTEST_PANEL_ID = 'com.auracle.pack.backtest';

/** Props the host hands every document-header component. */
interface DocumentHeaderComponentProps {
  filePath: string;
  fileName: string;
  getContent: () => string;
  contentVersion: number;
  onContentChange?: (next: string) => void;
  editor?: unknown;
}

function openBacktestPanel(): void {
  window.dispatchEvent(
    new CustomEvent('nimbalyst:toggle-panel', { detail: { panelId: BACKTEST_PANEL_ID } })
  );
}

export const RunStrategyHeader: React.FC<DocumentHeaderComponentProps> = ({ filePath }) => {
  const [pinged, setPinged] = useState(false);

  const onRun = useCallback(() => {
    void backtestStore.run(filePath);
    openBacktestPanel();
    // Brief press feedback; the panel owns the real running/done state.
    setPinged(true);
    window.setTimeout(() => setPinged(false), 1000);
  }, [filePath]);

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
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 12px',
          borderRadius: 7,
          border: '1px solid transparent',
          background: tone.accent,
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          opacity: pinged ? 0.85 : 1,
        }}
      >
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 15 }}>
          play_arrow
        </span>
        Run backtest
      </button>
    </div>
  );
};
