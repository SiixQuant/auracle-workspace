/**
 * Engine status chip, mounted app-wide as a host component. Honesty contract
 * ported from the previous native client: "Connected" renders only after a
 * completed engine round-trip; every other state says exactly what is known.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { connectCheck, engineConfig, onConnectGeneration } from '../engine/client';
import type { ConnectCheck } from '../engine/model';

const POLL_MS = 30_000;

type ChipState =
  | { kind: 'not-configured' }
  | { kind: 'checking' }
  | { kind: 'connected'; check: ConnectCheck }
  | { kind: 'unreachable' };

function chipText(state: ChipState): string {
  switch (state.kind) {
    case 'not-configured':
      return 'engine: not configured';
    case 'checking':
      return 'engine: checking…';
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
    case 'unreachable':
      return 'The Auracle engine did not respond. Is the stack running?';
    case 'connected': {
      const version = state.check.engine?.version ? ` v${state.check.engine.version}` : '';
      return `Connected to the Auracle engine${version}. Click to re-check.`;
    }
  }
}

const DOT_COLOR: Record<ChipState['kind'], string> = {
  'not-configured': '#8a8f98',
  checking: '#d4a017',
  connected: '#2ea043',
  unreachable: '#c4554d',
};

export function AuracleStatusChip(): JSX.Element {
  const [state, setState] = useState<ChipState>({ kind: 'checking' });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    const config = await engineConfig();
    if (!config.hasKey && !config.engineUrl) {
      setState({ kind: 'not-configured' });
      return;
    }
    const check = await connectCheck();
    if (check && check.ok !== false) {
      setState({ kind: 'connected', check });
    } else if (!config.hasKey) {
      setState({ kind: 'not-configured' });
    } else {
      setState({ kind: 'unreachable' });
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
        position: 'fixed',
        left: 12,
        bottom: 12,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 999,
        border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
        background: 'var(--bg-secondary, rgba(20,20,22,0.85))',
        color: 'var(--text-secondary, #b9bec7)',
        font: '11px/1.4 var(--font-family-ui, system-ui, sans-serif)',
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: DOT_COLOR[state.kind],
          display: 'inline-block',
        }}
      />
      {chipText(state)}
    </button>
  );
}
