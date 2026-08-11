/**
 * Portfolio — blend several backtests into one book (Frontier #8).
 *
 * Pick two or more finished backtests, set each one's weight, and see the
 * combined portfolio: its equity curve and headline stats, the pairwise
 * CORRELATION between the strategies (the diversification story), and each
 * strategy's contribution. Every number is the engine's own, computed from the
 * runs' stored returns by `POST /ui/api/portfolio/compose` — the same seam the
 * agent's `compose_portfolio` tool reasons over, so a suggestion the assistant
 * makes and this room can never disagree.
 *
 * Weights are edited here and applied on Compose (not live), so a person sets a
 * mix deliberately. Equal weight is the default. A blend needs a common date
 * window across its members; the engine intersects it and the room states it.
 */
import { useEffect, useMemo, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';

import {
  composePortfolio,
  tearsheetRuns,
  type PortfolioBody,
  type RecentRun,
} from '../../../engine/client';
import { statDecimal, statPercent } from '../../../engine/houseStats';
import { prettifyPath } from '../../../engine/humanize';
import { Button, CenterState, SkeletonRows, tint, tone } from '../../panelkit';
import { TearsheetChart } from '../../charts/TearsheetChart';
import { GRID_ACCENT } from '../gridTheme';
import { growthToPercent } from './Tearsheet';
import { RoomPage } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

type Phase = 'idle' | 'loading' | 'loaded' | 'error';

/** Underwater curve (percent, ≤ 0) from a growth-of-$1 series — equity over its
 *  running peak. Lets the combined book reuse the tearsheet chart, which draws a
 *  drawdown band, without the engine having to send one. */
function drawdownPercent(points: number[]): number[] {
  let peak = -Infinity;
  return points.map((v) => {
    peak = Math.max(peak, v);
    return peak > 0 ? (v / peak - 1) * 100 : 0;
  });
}

/** The headline rows for the blended book — the core stats `stats.summary`
 *  always fills, formatted like the tearsheet. */
function portfolioRows(stats: Record<string, number | null>): Array<[string, string]> {
  return [
    ['Total Return', statPercent(stats.total_return)],
    ['Annualized Return', statPercent(stats.annualized_return)],
    ['Sharpe', statDecimal(stats.sharpe)],
    ['Sortino', statDecimal(stats.sortino)],
    ['Calmar', statDecimal(stats.calmar)],
    ['Annualized Volatility', statPercent(stats.annualized_vol)],
    ['Max Drawdown', statPercent(stats.max_drawdown)],
  ];
}

/** A correlation cell's tint: red where two strategies move together (little
 *  diversification), green where they diverge. Neutral near zero. */
function corrColor(v: number): string {
  if (!Number.isFinite(v)) return tone.text3;
  if (v >= 0.6) return tone.danger;
  if (v <= -0.2) return tone.ok;
  return tone.text2;
}

export function PortfolioPage(_props: PanelHostProps): JSX.Element {
  const [runs, setRuns] = useState<RecentRun[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [weights, setWeights] = useState<Record<number, number>>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [book, setBook] = useState<PortfolioBody | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await tearsheetRuns();
        if (!cancelled) setRuns(rows);
      } catch {
        if (!cancelled) setRuns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const labelFor = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of runs) map.set(r.jobId, prettifyPath(r.strategyPath) ?? r.strategyPath);
    return map;
  }, [runs]);

  const toggle = (jobId: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else {
        next.add(jobId);
        setWeights((w) => (jobId in w ? w : { ...w, [jobId]: 1 }));
      }
      return next;
    });
  };

  const compose = async (): Promise<void> => {
    const ids = [...selected];
    if (ids.length < 2) return;
    setPhase('loading');
    const w: Record<string, number> = {};
    for (const id of ids) w[String(id)] = weights[id] ?? 1;
    const result = await composePortfolio(ids, w);
    if (!result) {
      setPhase('error');
      setBook(null);
      return;
    }
    setBook(result);
    setPhase('loaded');
  };

  const canCompose = selected.size >= 2;

  return (
    <RoomPage
      room="portfolio"
      status="nominal"
      statusLabel={canCompose ? undefined : 'pick two or more runs'}
      context={ROOM_CONTEXT.portfolio}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="portfolio-room">
        {/* ── member picker ─────────────────────────────────────────── */}
        <section
          style={{
            background: tone.surface,
            border: `1px solid ${tone.border}`,
            borderRadius: 10,
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: tone.text, marginBottom: 8 }}>
            Blend backtests
          </div>
          {runs.length === 0 ? (
            <div style={{ fontSize: 12, color: tone.text3 }}>
              No saved backtests yet — run one, then combine it here.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="portfolio-picker">
              {runs.map((run) => {
                const on = selected.has(run.jobId);
                return (
                  <label
                    key={run.jobId}
                    data-testid={`portfolio-run-${run.jobId}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '6px 8px',
                      borderRadius: 7,
                      cursor: 'pointer',
                      background: on ? tint(GRID_ACCENT, 12) : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(run.jobId)}
                      data-testid={`portfolio-check-${run.jobId}`}
                    />
                    <span style={{ flex: 1, fontSize: 12.5, color: tone.text, minWidth: 0 }}>
                      {labelFor.get(run.jobId) ?? run.strategyPath}
                    </span>
                    {on ? (
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={weights[run.jobId] ?? 1}
                        aria-label={`weight for ${labelFor.get(run.jobId) ?? run.strategyPath}`}
                        data-testid={`portfolio-weight-${run.jobId}`}
                        onChange={(e) =>
                          setWeights((w) => ({ ...w, [run.jobId]: Number(e.target.value) }))
                        }
                        style={{
                          width: 58,
                          font: 'inherit',
                          fontSize: 12,
                          padding: '3px 6px',
                          borderRadius: 6,
                          border: `1px solid ${tone.border}`,
                          background: tone.surface,
                          color: tone.text,
                        }}
                      />
                    ) : null}
                  </label>
                );
              })}
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <Button variant="primary" testId="portfolio-compose" disabled={!canCompose} busy={phase === 'loading'} onClick={() => void compose()}>
              Compose portfolio
            </Button>
            <span style={{ marginLeft: 10, fontSize: 11.5, color: tone.text3 }}>
              {selected.size} selected · weights normalize to 100%
            </span>
          </div>
        </section>

        {/* ── the blended book ──────────────────────────────────────── */}
        {phase === 'loading' ? (
          <SkeletonRows rows={6} />
        ) : phase === 'error' ? (
          <CenterState
            tone="danger"
            title="Couldn't blend these runs"
            detail="The runs need a common date window and a usable equity curve. Make sure your local engine is running, then try again."
          />
        ) : phase === 'loaded' && book ? (
          <PortfolioBookView book={book} />
        ) : (
          <CenterState
            title="Pick two or more backtests to blend"
            detail="Select runs above, set their weights, and Compose to see the combined equity, its stats, and how correlated the strategies are."
          />
        )}
      </div>
    </RoomPage>
  );
}

function PortfolioBookView({ book }: { book: PortfolioBody }): JSX.Element {
  const chartable = Boolean(book.chart && book.chart.points.length > 1);
  const rows = portfolioRows(book.stats ?? {});
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 14 }} className="auracle-portfolio__dash">
        <section style={{ background: tone.surface, border: `1px solid ${tone.border}`, borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: tone.text, marginBottom: 6 }}>Combined equity</div>
          {chartable ? (
            <TearsheetChart
              data={{
                chart: { ...book.chart, points: growthToPercent(book.chart.points) },
                drawdown: { labels: book.chart.labels, points: drawdownPercent(book.chart.points) },
                benchmark: null,
              }}
            />
          ) : (
            <CenterState title="No combined curve" detail="The blended book produced no plottable equity." />
          )}
          <div style={{ marginTop: 6, fontSize: 11.5, color: tone.text3, fontVariantNumeric: 'tabular-nums' }} data-testid="portfolio-window">
            {book.n_days} shared days · {book.window.start} → {book.window.end}
          </div>
        </section>
        <section style={{ background: tone.surface, border: `1px solid ${tone.border}`, borderRadius: 10, padding: '10px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: tone.text, padding: '2px 14px 8px' }}>Combined stats</div>
          <div data-testid="portfolio-stats">
            {rows.map(([label, value]) => (
              <div
                key={label}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 14px', borderTop: `1px solid ${tone.border}` }}
                data-testid={`portfolio-stat-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`}
              >
                <span style={{ fontSize: 12.5, color: tone.text2 }}>{label}</span>
                <span style={{ fontSize: 12.5, color: tone.text, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── correlation + contribution ────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }} className="auracle-portfolio__dash">
        <section style={{ background: tone.surface, border: `1px solid ${tone.border}`, borderRadius: 10, padding: '12px 14px', overflowX: 'auto' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: tone.text, marginBottom: 8 }}>Correlation</div>
          <table style={{ borderCollapse: 'collapse', fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }} data-testid="portfolio-correlation">
            <tbody>
              <tr>
                <td />
                {book.members.map((m) => (
                  <th key={m.id} style={{ padding: '3px 7px', color: tone.text3, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {m.label}
                  </th>
                ))}
              </tr>
              {book.members.map((rowM) => (
                <tr key={rowM.id}>
                  <th style={{ padding: '3px 7px', color: tone.text3, fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap' }}>{rowM.label}</th>
                  {book.members.map((colM) => {
                    const v = book.correlation?.[rowM.id]?.[colM.id];
                    return (
                      <td key={colM.id} style={{ padding: '3px 7px', textAlign: 'right', color: corrColor(v ?? NaN) }}>
                        {Number.isFinite(v) ? (v as number).toFixed(2) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section style={{ background: tone.surface, border: `1px solid ${tone.border}`, borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: tone.text, marginBottom: 8 }}>Contribution</div>
          <div data-testid="portfolio-contribution" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {book.members.map((m) => {
              const share = book.contribution?.[m.id] ?? 0;
              const weight = book.weights?.[m.id] ?? 0;
              const pct = Math.round(share * 100);
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 12, color: tone.text2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
                  <span style={{ fontSize: 11, color: tone.text3, fontVariantNumeric: 'tabular-nums' }}>{Math.round(weight * 100)}% wt</span>
                  <span style={{ fontSize: 12.5, color: tone.text, fontVariantNumeric: 'tabular-nums', width: 46, textAlign: 'right' }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
