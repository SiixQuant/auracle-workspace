/**
 * Engine status chip, mounted app-wide as a host component. Honesty contract
 * ported from the previous native client: "Connected" renders only after a
 * completed engine round-trip; every other state says exactly what is known.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { connectCheckDetailed, engineConfig, onConnectGeneration } from '../engine/client';
import { ensurePanelKitStyles, tint, tone } from './panelkit';
import { classifyChipState, type ChipState } from './statusChipState';

const POLL_MS = 30_000;

function chipText(state: ChipState): string {
  switch (state.kind) {
    case 'not-configured':
      return 'engine: not configured';
    case 'checking':
      return 'engine: checking…';
    case 'key-rejected':
      return 'engine: key rejected';
    case 'unreachable':
      return 'engine: unreachable';
    case 'connected': {
      const broker = state.check.active_broker || 'none';
      const live = state.check.live_allowed ? 'live ok' : 'paper only';
      return `engine: on · broker: ${broker} · ${live}`;
    }
  }
}

function chipTitle(state: ChipState): string {
  switch (state.kind) {
    case 'not-configured':
      return 'No engine credentials found. Install through the Auracle launcher or set the engine connection in the config file.';
    case 'checking':
      return 'Contacting the local Auracle engine…';
    case 'key-rejected':
      return 'The Auracle engine rejected your credentials. Re-provision through the launcher, or sign in again.';
    case 'unreachable':
      return 'The Auracle engine did not respond. Is the stack running?';
    case 'connected': {
      const version = state.check.engine?.version ? ` v${state.check.engine.version}` : '';
      return `Connected to the Auracle engine${version}. Click to re-check.`;
    }
  }
}

const DOT_COLOR: Record<ChipState['kind'], string> = {
  'not-configured': tone.text3,
  checking: tone.caution,
  connected: tone.ok,
  // Amber (caution), not red: a rejected key is a fix-it-yourself state
  // (re-provision / re-auth), distinct from a genuinely unreachable engine.
  'key-rejected': tone.caution,
  unreachable: tone.danger,
};

export function AuracleStatusChip(): JSX.Element {
  ensurePanelKitStyles();
  const [state, setState] = useState<ChipState>({ kind: 'checking' });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    const config = await engineConfig();
    if (!config.hasKey && !config.engineUrl) {
      setState({ kind: 'not-configured' });
      return;
    }
    // Detailed variant keeps the HTTP status, so a 401/403 reads as a rejected
    // key instead of a dead engine.
    const detailed = await connectCheckDetailed();
    const check = detailed.ok ? detailed.body : null;
    const ok = detailed.ok && check?.ok !== false;
    const status = detailed.ok ? 200 : detailed.status;
    const kind = classifyChipState({ hasKey: config.hasKey, status, ok });
    switch (kind) {
      case 'connected':
        setState(check ? { kind: 'connected', check } : { kind: 'unreachable' });
        break;
      case 'key-rejected':
        setState({ kind: 'key-rejected' });
        break;
      case 'not-configured':
        setState({ kind: 'not-configured' });
        break;
      case 'unreachable':
        setState({ kind: 'unreachable' });
        break;
    }
  }, []);

  useEffect(() => {
    void poll();
    timer.current = setInterval(() => void poll(), POLL_MS);
    const offGeneration = onConnectGeneration(() => void poll());
    return () => {
      if (timer.current) clearInterval(timer.current);
      offGeneration();
    };
  }, [poll]);

  return (
    <button
      type="button"
      onClick={() => {
        setState({ kind: 'checking' });
        void poll();
      }}
      title={chipTitle(state)}
      style={{
        // Anchored bottom-left, clear of the ~48px activity bar. The bottom-right
        // corner is taken by the update toast (bottom-5 right-5) and the agent
        // composer's send control, so a chip there overlaps live UI; the bottom of
        // the left rail is the one persistently empty gutter in this shell.
        position: 'fixed',
        left: 56,
        bottom: 10,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 999,
        border: `1px solid ${tone.borderStrong}`,
        background: 'rgba(11,12,14,0.88)',
        backdropFilter: 'blur(6px)',
        color: tone.text2,
        font: `11px/1.4 ${tone.font}`,
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden
        className={state.kind === 'checking' ? 'apk-pulse' : undefined}
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: DOT_COLOR[state.kind],
          boxShadow: state.kind === 'connected' ? `0 0 0 3px ${tint(tone.ok, 22)}` : 'none',
          display: 'inline-block',
        }}
      />
      {chipText(state)}
    </button>
  );
}
