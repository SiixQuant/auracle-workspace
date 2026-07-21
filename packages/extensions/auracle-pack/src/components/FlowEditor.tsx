/**
 * Flow canvas — a custom editor over `*.flow.json`. Nodes are the user's
 * strategies; the signature moves are FORK (client-side draft child) and
 * COMPARE (honest metric diff — a delta exists only when both runs report the
 * metric). Layout, drafts, and run summaries persist in the file; the node
 * list seeds from the engine's strategy registry when the file is empty.
 */
import { useEffect, useRef, useState } from 'react';
import type { EditorHostProps } from '@nimbalyst/extension-sdk';
import { useEditorLifecycle } from '@nimbalyst/extension-sdk';
import { getJson, postJson } from '../engine/client';
import {
  FlowView,
  NODE_H,
  NODE_W,
  buildFlow,
  centerOf,
  compareMetrics,
  displayName,
  fork,
  improved,
  moveNode,
  setSummary,
} from '../engine/flow';
import { runFlowBacktest } from '../engine/flowRun';
import { handOffNode } from './spineActions';
import { EquityChart, tone } from './panelkit';

const styles = {
  root: {
    position: 'relative' as const,
    width: '100%',
    height: '100%',
    overflow: 'auto',
    background: tone.bg,
    color: tone.text,
    font: `12px/1.45 ${tone.font}`,
  },
  node: (kind: string, selected: boolean) => ({
    position: 'absolute' as const,
    width: NODE_W,
    height: NODE_H,
    borderRadius: 8,
    border: `1px solid ${selected ? tone.accent : tone.borderStrong}`,
    background:
      kind === 'draft'
        ? tone.accentSoft
        : tone.surface,
    padding: 10,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    cursor: 'grab',
    userSelect: 'none' as const,
  }),
  small: { fontSize: 11, color: tone.text3 },
  button: (primary?: boolean) => ({
    padding: '2px 8px',
    borderRadius: 5,
    fontSize: 11,
    cursor: 'pointer',
    border: `1px solid ${tone.borderStrong}`,
    background: primary ? tone.accent : 'transparent',
    // Black ink on the white accent fill — a white label would be unreadable.
    color: primary ? tone.accentInk : tone.text,
  }),
  drawer: {
    position: 'fixed' as const,
    right: 0,
    top: 0,
    bottom: 0,
    width: 340,
    overflow: 'auto',
    padding: 14,
    borderLeft: `1px solid ${tone.borderStrong}`,
    background: tone.surface,
    zIndex: 20,
  },
};

function metric(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toFixed(2) : '—';
}

export function AuracleFlowEditor({ host }: EditorHostProps): JSX.Element {
  const viewRef = useRef<FlowView>({ nodes: [], edges: [] });
  const [, forceRender] = useState(0);
  const rerender = () => forceRender((n) => n + 1);
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const draftSeq = useRef(1);
  const drag = useRef<{ id: string; lastX: number; lastY: number } | null>(null);

  const { markDirty, isLoading } = useEditorLifecycle<FlowView>(host, {
    parse: (raw) => {
      if (!raw.trim()) return { nodes: [], edges: [] };
      const parsed = JSON.parse(raw) as FlowView;
      return { nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] };
    },
    // Drop each summary's equity curve before writing: it is large and
    // re-derivable by re-running, so it stays in memory rather than bloating
    // the git-tracked *.flow.json. Scalar metrics still persist.
    serialize: (view) =>
      JSON.stringify(view, (key, value) => (key === 'equity' ? undefined : value), 2),
    applyContent: (view) => {
      viewRef.current = view;
      draftSeq.current =
        view.nodes.filter((node) => node.kind === 'draft').length + 1;
      rerender();
    },
    getCurrentContent: () => viewRef.current,
  });

  // Seed an empty canvas from the engine's strategy registry.
  useEffect(() => {
    if (isLoading) return;
    if (viewRef.current.nodes.length > 0) return;
    void (async () => {
      const body = await getJson<{
        strategies?: Array<{ path?: string; strategy_path?: string; doc?: string; bundled?: boolean }>;
      }>('/ui/api/backtest/strategies');
      const rows = (body?.strategies ?? [])
        .map((raw) => ({
          path: raw.strategy_path ?? raw.path ?? '',
          name: displayName(raw.strategy_path ?? raw.path ?? ''),
          doc: raw.doc ?? '',
          bundled: raw.bundled ?? false,
        }))
        .filter((row) => row.path.length > 0);
      if (rows.length > 0) {
        viewRef.current = buildFlow(rows);
        markDirty();
        rerender();
      }
    })();
  }, [isLoading, markDirty]);

  const runBacktest = async (id: string) => {
    const node = viewRef.current.nodes.find((n) => n.id === id);
    if (!node?.path || running) return;
    setRunning(id);
    const result = await runFlowBacktest(node.path);
    setRunning(null);
    if (result.ok) {
      setSummary(viewRef.current, id, result.summary);
      markDirty();
      rerender();
    }
  };

  const runDiagnostics = async (id: string) => {
    const node = viewRef.current.nodes.find((n) => n.id === id);
    if (!node?.path) return;
    setDiagnostics({ __loading: true });
    const response = await postJson('/backtest/studio', { strategy_path: node.path });
    setDiagnostics(
      response.ok && response.body && typeof response.body === 'object'
        ? (response.body as Record<string, unknown>)
        : { __error: `Diagnostics unavailable (${response.status || 'engine unreachable'}).` }
    );
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev.slice(-1), id]
    );
  };

  const view = viewRef.current;
  const [a, b] = selected
    .map((id) => view.nodes.find((n) => n.id === id))
    .filter((n) => n?.summary) as Array<(typeof view.nodes)[number]>;
  const compare = a?.summary && b?.summary ? compareMetrics(a.summary, b.summary) : null;

  const width = Math.max(900, ...view.nodes.map((n) => n.pos.x + NODE_W + 60));
  const height = Math.max(600, ...view.nodes.map((n) => n.pos.y + NODE_H + 60));

  if (isLoading) return <div style={{ ...styles.root, padding: 16 }}>Loading canvas…</div>;

  return (
    <div
      style={styles.root}
      onPointerMove={(event) => {
        if (!drag.current) return;
        moveNode(
          viewRef.current,
          drag.current.id,
          event.clientX - drag.current.lastX,
          event.clientY - drag.current.lastY
        );
        drag.current.lastX = event.clientX;
        drag.current.lastY = event.clientY;
        rerender();
      }}
      onPointerUp={() => {
        if (drag.current) {
          drag.current = null;
          markDirty();
        }
      }}
    >
      <div style={{ position: 'relative', width, height }}>
        <svg
          width={width}
          height={height}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {view.edges.map((edge) => {
            const from = centerOf(view, edge.from);
            const to = centerOf(view, edge.to);
            if (!from || !to) return null;
            return (
              <line
                key={`${edge.from}->${edge.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={tone.accentText}
                strokeDasharray="5 4"
                strokeWidth={1.5}
              />
            );
          })}
        </svg>
        {view.nodes.map((node) => (
          <div
            key={node.id}
            style={{
              ...styles.node(node.kind, selected.includes(node.id)),
              left: node.pos.x,
              top: node.pos.y,
            }}
            onPointerDown={(event) => {
              drag.current = { id: node.id, lastX: event.clientX, lastY: event.clientY };
            }}
            onClick={() => toggleSelect(node.id)}
          >
            <div style={{ fontWeight: 600, display: 'flex', gap: 6, alignItems: 'baseline' }}>
              {node.name}
              {node.kind === 'draft' ? <span style={styles.small}>draft</span> : null}
              {node.bundled ? <span style={styles.small}>bundled</span> : null}
            </div>
            <div style={{ ...styles.small, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.doc || node.path || ''}
            </div>
            <div style={styles.small}>
              {node.summary
                ? `Sharpe ${metric(node.summary.sharpe)} · Ret ${metric(node.summary.total_return)} · DD ${metric(node.summary.max_drawdown)}`
                : 'not run yet'}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }} onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                style={styles.button(true)}
                disabled={running !== null || !node.path}
                onClick={() => void runBacktest(node.id)}
              >
                {running === node.id ? 'Running…' : 'Backtest'}
              </button>
              <button
                type="button"
                style={styles.button()}
                onClick={() => {
                  const id = fork(viewRef.current, node.id, draftSeq.current);
                  if (id) {
                    draftSeq.current += 1;
                    markDirty();
                    rerender();
                  }
                }}
              >
                Fork
              </button>
              <button type="button" style={styles.button()} onClick={() => void runDiagnostics(node.id)}>
                OOS
              </button>
            </div>
            {/* Hand-offs to the full surfaces, mirroring the editor header:
                open this strategy's metrics in the Backtest panel, or deploy it. */}
            <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                style={styles.button()}
                disabled={!node.path}
                title="Open this strategy's full metrics and overfit check in the Backtest panel"
                data-testid="flow-metrics"
                onClick={() => handOffNode(node, 'backtest')}
              >
                Metrics
              </button>
              <button
                type="button"
                style={styles.button()}
                disabled={!node.path}
                title="Deploy this strategy to paper or live"
                data-testid="flow-deploy"
                onClick={() => handOffNode(node, 'deploy')}
              >
                Deploy
              </button>
            </div>
          </div>
        ))}
        {view.nodes.length === 0 ? (
          <div style={{ padding: 20, ...styles.small }}>
            No strategies yet — connect the Auracle engine and this canvas seeds itself from your
            strategy folder.
          </div>
        ) : null}
      </div>

      {compare ? (
        <div style={styles.drawer}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            Compare: {a.name} → {b.name}
          </div>
          {compare.map((row) => {
            const better = improved(row);
            return (
              <div key={row.label} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
                <span style={{ minWidth: 110 }}>{row.label}</span>
                <span>{metric(row.a)}</span>
                <span>→</span>
                <span>{metric(row.b)}</span>
                <span
                  style={{
                    color: better === true ? tone.ok : better === false ? tone.danger : tone.text3,
                  }}
                >
                  {row.delta === null ? '—' : `${row.delta >= 0 ? '+' : ''}${row.delta.toFixed(2)}`}
                </span>
              </div>
            );
          })}
          <div style={{ ...styles.small, marginTop: 8 }}>
            Deltas appear only for metrics both runs reported.
          </div>
        </div>
      ) : null}

      {!diagnostics && a?.summary && !b && (a.summary.equity?.length ?? 0) >= 2 ? (
        <div style={styles.drawer} data-testid="flow-equity-drawer">
          <div style={{ fontWeight: 600, marginBottom: 10 }}>{a.name}</div>
          <EquityChart points={a.summary.equity.map((point) => point.v)} label="Equity" />
          <div style={{ ...styles.small, marginTop: 8 }}>
            {`Sharpe ${metric(a.summary.sharpe)} · Ret ${metric(a.summary.total_return)} · DD ${metric(a.summary.max_drawdown)}`}
          </div>
        </div>
      ) : null}

      {diagnostics ? (
        <div style={styles.drawer}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>Out-of-sample diagnostics</span>
            <button type="button" style={styles.button()} onClick={() => setDiagnostics(null)}>
              Close
            </button>
          </div>
          {'__loading' in diagnostics ? (
            <div style={styles.small}>Running out-of-sample diagnostics…</div>
          ) : '__error' in diagnostics ? (
            <div style={{ ...styles.small, color: tone.danger }}>{String(diagnostics.__error)}</div>
          ) : (
            <pre style={{ ...styles.small, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {JSON.stringify(diagnostics, null, 2)}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
