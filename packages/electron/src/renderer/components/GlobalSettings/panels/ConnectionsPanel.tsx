import React, { useCallback, useEffect, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

/**
 * Where prices come from, and where orders go.
 *
 * ★ THE ONLY PLACE A CONNECTION CAN BE CHANGED. The Grid's connection line
 * and the browser desk's composer unit both state what is wired up and
 * offer no control at all. A switch living in three surfaces is three
 * places to leave a stale opinion, and a toggle under a passing cursor on
 * the thing that routes orders is one somebody hits by accident. Status is
 * everywhere it is useful; configuration is here.
 *
 * ★ GROUPED BY WHAT A CONNECTOR IS FOR, not alphabetically. Execution and
 * market data are separate concerns and the engine models them separately:
 * ClearStreet is execution-only, and a desk that blurred the two would let
 * somebody arm a venue and assume prices came with it — the exact state
 * the real-time gate exists to refuse.
 *
 * ★ THERE IS NO ENABLE SWITCH, and that is not an omission. The engine's
 * only "off" is `POST /disconnect`, which CLEARS THE STORED CREDENTIALS.
 * Rendering that as an innocent toggle would put credential deletion one
 * stray click from a hover, with no undo and a re-key to recover. It is a
 * named button behind a confirmation instead, which is what a destructive
 * action looks like when it is honest about itself.
 *
 * Self-contained, like AdvancedPanel: it talks to the engine over the same
 * IPC bridge the Grid uses rather than taking chat-provider props it has
 * no use for.
 */

interface ElectronBridge {
  electronAPI?: { invoke?: (channel: string, ...args: unknown[]) => Promise<unknown> };
}

interface BridgeResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

interface ConnStatus {
  state: string;
  detail?: string | null;
  paper_mode?: boolean | null;
}

interface Connector {
  id: string;
  display_label: string;
  blurb: string;
  kind: 'broker' | 'data_provider' | 'integration' | string;
  provides_data?: boolean;
  supports_live_data?: boolean;
  gated: boolean;
  gated_reason?: string;
  status: ConnStatus;
  cli_command_hint?: string;
}

async function engineRequest(method: string, path: string, body?: unknown): Promise<BridgeResponse> {
  const invoke = (window as unknown as ElectronBridge).electronAPI?.invoke;
  if (!invoke) return { ok: false, status: 0, body: null };
  try {
    return (await invoke('auracle:engine-request', method, path, body)) as BridgeResponse;
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/** The engine's own words for a state, kept as words rather than colours. */
const STATE_WORD: Record<string, string> = {
  connected: 'Connected',
  disconnected: 'Not connected',
  not_configured: 'No credentials',
  error: 'Error',
};

function stateColour(state: string, gated: boolean): string {
  if (gated) return 'var(--nim-text-muted)';
  if (state === 'connected') return 'var(--nim-success)';
  if (state === 'error') return 'var(--nim-error)';
  if (state === 'disconnected') return 'var(--nim-warning)';
  return 'var(--nim-text-muted)';
}

function Dot({ state, gated }: { state: string; gated: boolean }) {
  const connected = state === 'connected' && !gated;
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        flex: 'none',
        marginTop: 6,
        // Shape as well as colour: a hollow ring for "nothing here"
        // survives a colourblind eye where a grey dot does not.
        background: connected ? stateColour(state, gated) : 'transparent',
        border: connected ? undefined : `1.5px solid ${stateColour(state, gated)}`,
      }}
    />
  );
}

function Group({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--nim-text-muted)] m-0">
        {title}
      </h4>
      <p className="text-[11.5px] text-[var(--nim-text-muted)] mt-1 mb-2 max-w-[54ch]">{note}</p>
      <div className="border-t border-[var(--nim-border)]">{children}</div>
    </section>
  );
}

export function ConnectionsPanel(): React.ReactElement {
  const [conns, setConns] = useState<Connector[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  const read = useCallback(async () => {
    const res = await engineRequest('GET', '/ui/api/connections?kind=all');
    if (!res.ok || !res.body) {
      setProblem(
        res.status === 0
          ? 'The engine is unreachable from here.'
          : `The engine answered ${res.status}.`,
      );
      return;
    }
    setProblem(null);
    setConns((res.body as { connections: Connector[] }).connections ?? []);
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const test = useCallback(async (id: string) => {
    setBusy(id);
    const res = await engineRequest('POST', `/ui/api/connections/${id}/test`);
    const body = res.body as { ok?: boolean; message?: string; detail?: string } | null;
    setSaid((prev) => ({
      ...prev,
      // The engine's own sentence when it sent one. It knows why better
      // than anything written here would.
      [id]: body?.ok
        ? 'Connected.'
        : (body?.message ?? body?.detail ?? `No answer (${res.status}).`),
    }));
    setBusy(null);
    void read();
  }, [read]);

  const disconnect = useCallback(
    async (id: string) => {
      setBusy(id);
      const res = await engineRequest('POST', `/ui/api/connections/${id}/disconnect`);
      if (!res.ok) setProblem(`The engine refused that (${res.status}).`);
      setConfirming(null);
      setSaid((prev) => ({ ...prev, [id]: '' }));
      await read();
      setBusy(null);
    },
    [read],
  );

  if (problem && !conns) {
    return (
      <div className="p-1">
        <h3 className="text-[15px] font-semibold text-[var(--nim-text)] m-0">Connections</h3>
        <p className="text-xs text-[var(--nim-text-muted)] mt-2">{problem}</p>
      </div>
    );
  }
  if (!conns) {
    return (
      <div className="p-1">
        <h3 className="text-[15px] font-semibold text-[var(--nim-text)] m-0">Connections</h3>
        <p className="text-xs text-[var(--nim-text-muted)] mt-2">Asking the engine…</p>
      </div>
    );
  }

  const row = (c: Connector) => {
    const configured = c.status?.state !== 'not_configured';
    return (
      <div
        key={c.id}
        className="flex items-start gap-3 py-3 border-b border-[var(--nim-border)]"
        data-testid={`connection-${c.id}`}
      >
        <Dot state={c.status?.state ?? 'not_configured'} gated={c.gated} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[13.5px] font-medium text-[var(--nim-text)]">{c.display_label}</span>
            <span className="text-[11px]" style={{ color: stateColour(c.status?.state ?? '', c.gated) }}>
              {STATE_WORD[c.status?.state ?? ''] ?? c.status?.state}
            </span>
          </div>
          <p className="text-[11.5px] text-[var(--nim-text-muted)] mt-0.5">{c.blurb}</p>

          {/* The tier refusal in the engine's words, not a guess at why. */}
          {c.gated && c.gated_reason ? (
            <p className="text-[11px] mt-1" style={{ color: 'var(--nim-warning)' }}>
              {c.gated_reason}
            </p>
          ) : null}

          {said[c.id] ? (
            <p className="text-[11.5px] text-[var(--nim-text-muted)] mt-1">{said[c.id]}</p>
          ) : null}

          {confirming === c.id ? (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[11.5px]" style={{ color: 'var(--nim-warning)' }}>
                This deletes the stored credentials.
              </span>
              <button
                type="button"
                className="text-[11.5px] px-2.5 py-1 rounded-md border"
                style={{ borderColor: 'var(--nim-error)', color: 'var(--nim-error)', background: 'transparent' }}
                disabled={busy === c.id}
                onClick={() => void disconnect(c.id)}
              >
                Delete and disconnect
              </button>
              <button
                type="button"
                className="text-[11.5px] px-2.5 py-1 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)]"
                onClick={() => setConfirming(null)}
              >
                Keep
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="text-[11.5px] px-2.5 py-1 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] disabled:opacity-40"
            disabled={busy === c.id || c.gated}
            onClick={() => void test(c.id)}
          >
            Test
          </button>
          {configured ? (
            <button
              type="button"
              className="text-[11.5px] px-2.5 py-1 rounded-md border border-[var(--nim-border)] text-[var(--nim-text-muted)] disabled:opacity-40"
              disabled={busy === c.id}
              onClick={() => setConfirming(c.id)}
            >
              Disconnect
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const brokers = conns.filter((c) => c.kind === 'broker');
  const data = conns.filter((c) => c.kind === 'data_provider');
  const other = conns.filter((c) => c.kind !== 'broker' && c.kind !== 'data_provider');

  return (
    <div className="p-1">
      <h3 className="text-[15px] font-semibold text-[var(--nim-text)] m-0">Connections</h3>
      <p className="text-xs text-[var(--nim-text-muted)] mt-1 mb-4 max-w-[56ch]">
        Where prices come from, and where orders go. These are separate: a broker
        that cannot quote will not satisfy the real-time gate on its own.
      </p>

      {problem ? (
        <p className="text-xs mb-3 flex items-start gap-1.5" style={{ color: 'var(--nim-warning)' }}>
          <MaterialSymbol icon="warning" size={14} />
          {problem}
        </p>
      ) : null}

      <Group title="Orders" note="Execution venues. Only one can be active at a time.">
        {brokers.map(row)}
      </Group>

      <Group title="Prices" note="Market data. A live order needs a feed the engine can verify as real-time.">
        {data.map(row)}
      </Group>

      {other.length ? (
        <Group title="Research" note="Platforms the desk reads from or publishes to.">
          {other.map(row)}
        </Group>
      ) : null}

      <p className="text-[11px] text-[var(--nim-text-muted)] mt-1 flex items-start gap-1.5">
        <MaterialSymbol icon="info" size={13} />
        Credentials are held by the engine and never sent back to this window.
        Adding one is a separate step, and some venues also require this
        machine's address to be on their allow list.
      </p>
    </div>
  );
}
