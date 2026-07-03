import { describe, expect, it } from 'vitest';
import {
  MARGIN,
  NODE_W,
  StrategyListItem,
  buildFlow,
  centerOf,
  compareMetrics,
  compareRow,
  displayName,
  emptySummary,
  fork,
  improved,
  moveNode,
  setSummary,
  summaryFromEngine,
} from '../flow';

function item(path: string, bundled: boolean): StrategyListItem {
  return { name: displayName(path), path, doc: '', bundled };
}

function summary(net: number | null, sharpe: number | null, dd: number | null) {
  return { ...emptySummary('s'), net_profit: net, sharpe, max_drawdown: dd };
}

describe('flow canvas core (ported native tests)', () => {
  it('build_flow makes one node per strategy', () => {
    const view = buildFlow([item('a.b.C', false), item('a.b.D', false)]);
    expect(view.nodes).toHaveLength(2);
    expect(view.nodes[0].name).toBe('C');
    expect(view.nodes[0].kind).toBe('strategy');
    expect(view.nodes[0].summary).toBeNull();
    expect(view.edges).toHaveLength(0);
  });

  it('build_flow lays out a grid', () => {
    const view = buildFlow([0, 1, 2, 3].map((i) => item(`p.S${i}`, false)));
    expect(view.nodes[0].pos).toEqual({ x: MARGIN, y: MARGIN });
    expect(view.nodes[1].pos.x).toBeGreaterThan(view.nodes[0].pos.x);
    expect(view.nodes[1].pos.y).toBe(view.nodes[0].pos.y);
    expect(view.nodes[3].pos.x).toBe(view.nodes[0].pos.x);
    expect(view.nodes[3].pos.y).toBeGreaterThan(view.nodes[0].pos.y);
  });

  it('compare produces a delta only when both sides have the metric', () => {
    const rows = compareMetrics(summary(100, 1, null), summary(150, null, -0.2));
    expect(rows.find((r) => r.label === 'Net profit')?.delta).toBe(50);
    expect(rows.find((r) => r.label === 'Sharpe')?.delta).toBeNull();
    expect(rows.find((r) => r.label === 'Max drawdown')?.delta).toBeNull();
  });

  it('improvement tone respects metric direction', () => {
    expect(improved(compareRow('Net profit', 100, 120, 'higher-better'))).toBe(true);
    expect(improved(compareRow('Max drawdown', -0.3, -0.2, 'closer-to-zero-better'))).toBe(true);
    expect(improved(compareRow('Max drawdown', 0.3, 0.2, 'closer-to-zero-better'))).toBe(true);
    expect(improved(compareRow('Max drawdown', -0.2, -0.35, 'closer-to-zero-better'))).toBe(false);
    expect(improved(compareRow('Trades', 10, 99, 'neutral'))).toBeNull();
    expect(improved(compareRow('Sharpe', 1, null, 'higher-better'))).toBeNull();
  });

  it('fork adds a draft child and an edge', () => {
    const view = buildFlow([item('strategies.m.Mom', false)]);
    const parentId = view.nodes[0].id;
    const draft = fork(view, parentId, 1);
    expect(draft).not.toBeNull();
    expect(view.nodes).toHaveLength(2);
    const child = view.nodes.find((n) => n.id === draft);
    expect(child?.kind).toBe('draft');
    expect(child?.name).toBe('Mom (fork)');
    expect(child?.path).toBe('strategies.m.Mom');
    expect(child?.summary).toBeNull();
    expect(view.edges).toEqual([{ from: parentId, to: draft, kind: 'fork' }]);
  });

  it('fork of a missing node is a no-op', () => {
    const view = buildFlow([item('a.B', false)]);
    expect(fork(view, 'nope', 1)).toBeNull();
    expect(view.nodes).toHaveLength(1);
    expect(view.edges).toHaveLength(0);
  });

  it('set_summary fills only the named node', () => {
    const view = buildFlow([item('a.B', false), item('a.C', false)]);
    expect(setSummary(view, view.nodes[1].id, summary(1, null, null))).toBe(true);
    expect(view.nodes[0].summary).toBeNull();
    expect(view.nodes[1].summary).not.toBeNull();
    expect(setSummary(view, 'missing', summary(null, null, null))).toBe(false);
  });

  it('move_node translates position', () => {
    const view = buildFlow([item('a.B', false)]);
    const before = { ...view.nodes[0].pos };
    expect(moveNode(view, view.nodes[0].id, 12, -5)).toBe(true);
    expect(view.nodes[0].pos.x).toBe(before.x + 12);
    expect(view.nodes[0].pos.y).toBe(before.y - 5);
    expect(moveNode(view, 'missing', 1, 1)).toBe(false);
  });

  it('center_of resolves edge endpoints', () => {
    const view = buildFlow([item('a.B', false)]);
    const center = centerOf(view, view.nodes[0].id);
    expect(center?.x).toBe(MARGIN + NODE_W / 2);
    expect(centerOf(view, 'missing')).toBeNull();
  });

  it('summary_from_engine leaves absent stats null', () => {
    const parsed = summaryFromEngine('s', { stats: { sharpe: 1.2, net_profit: 'bad' } });
    expect(parsed.sharpe).toBe(1.2);
    expect(parsed.net_profit).toBeNull();
    expect(parsed.max_drawdown).toBeNull();
  });
});
