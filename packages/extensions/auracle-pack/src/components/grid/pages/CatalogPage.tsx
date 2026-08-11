/**
 * Catalog — the Research district's data browser (Frontier #12).
 *
 * What data this install actually holds, so "can I even backtest that?" is
 * answered by looking, not guessing or re-ingesting. Every registered symbol
 * with its coverage (first→last bar, bar count), its interior gaps, and how its
 * newest bars were sourced (keyless/free vs key-gated), read through the dense
 * {@link DataGrid}. Symbols are deliberately NOT click-through: the Grid has no
 * per-symbol room to land on (the same reason the entity registry omits them).
 *
 * Honesty: the coverage half is live now (the always-deployed universe read);
 * gaps + source come from a newer engine route and show an em dash until it is
 * deployed, with a one-line note — never a fabricated figure. Registered-but-
 * never-ingested symbols are listed with "no data" rather than hidden, so the
 * distinction between "unknown" and "empty" stays visible.
 */
import { useCallback, useEffect, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';

import { dataCatalog, type CatalogSymbol, type DataCatalog } from '../../../engine/client';
import {
  Button,
  CenterState,
  InlineNote,
  PanelShell,
  SectionLabel,
  SkeletonRows,
  ToolbarSpring,
  tone,
} from '../../panelkit';
import { DataGrid, type Column, type HeatScale } from '../DataGrid';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

const EM = '—';

type State =
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'ready'; catalog: DataCatalog };

/** Deeper gap counts read redder, derived from the column so it is right at any
 *  scale; undefined when nothing has an interior gap (nothing to shade). */
function gapsScale(rows: CatalogSymbol[]): HeatScale | undefined {
  const gaps = rows
    .map((r) => r.gaps)
    .filter((g): g is number => typeof g === 'number' && g > 0);
  if (gaps.length === 0) return undefined;
  return { min: 0, max: Math.max(...gaps), mid: 0, invert: true };
}

function coverageLabel(r: CatalogSymbol): string {
  if (r.firstBar && r.lastBar) return `${r.firstBar} → ${r.lastBar}`;
  return r.barCount === 0 ? 'no data' : EM;
}

/** Keyless (free to pull) vs key-gated, coloured; em dash when not yet known. */
function accessCell(keyed: boolean | null): JSX.Element {
  if (keyed === null) return <span style={{ color: tone.text3 }}>{EM}</span>;
  return (
    <span style={{ color: keyed ? tone.caution : tone.ok, fontWeight: 600 }}>
      {keyed ? 'key' : 'free'}
    </span>
  );
}

export function catalogColumns(rows: CatalogSymbol[]): Column<CatalogSymbol>[] {
  const gscale = gapsScale(rows);
  return [
    { key: 'symbol', header: 'Symbol', value: (r) => r.symbol, title: (r) => r.name ?? r.symbol },
    { key: 'class', header: 'Class', value: (r) => r.assetClass || EM },
    {
      key: 'coverage',
      header: 'Coverage',
      value: (r) => coverageLabel(r),
      title: (r) => (r.firstBar && r.lastBar ? `${r.firstBar} → ${r.lastBar}` : undefined),
    },
    {
      key: 'bars',
      header: 'Bars',
      numeric: true,
      value: (r) => (r.barCount ? r.barCount.toLocaleString() : EM),
    },
    {
      key: 'gaps',
      header: 'Gaps',
      numeric: true,
      value: (r) => (r.gaps === null ? EM : String(r.gaps)),
      scalar: (r) => r.gaps,
      ...(gscale ? { heat: gscale } : null),
    },
    { key: 'source', header: 'Source', value: (r) => r.source ?? EM },
    { key: 'access', header: 'Access', value: (r) => accessCell(r.keyed) },
  ];
}

function Chip({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 6,
        alignItems: 'baseline',
        padding: '4px 9px',
        borderRadius: 7,
        background: tone.surface2,
        border: `1px solid ${tone.border}`,
        fontSize: 11.5,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: tone.text3 }}>{label}</span>
      <span style={{ color: tone.text, fontWeight: 600 }}>{value}</span>
    </span>
  );
}

function Summary({ catalog }: { catalog: DataCatalog }): JSX.Element {
  const s = catalog.summary;
  const span =
    s.span.earliest && s.span.latest ? `${s.span.earliest} → ${s.span.latest}` : EM;
  const classes = Object.entries(s.assetClasses).sort((a, b) => b[1] - a[1]);
  return (
    <div data-testid="catalog-summary" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Chip label="symbols" value={String(s.nSymbols)} />
        <Chip label="with data" value={String(s.nBacktestable)} />
        {s.nRegisteredNoBars > 0 ? (
          <Chip label="no data" value={String(s.nRegisteredNoBars)} />
        ) : null}
        <Chip label="span" value={span} />
      </div>
      {classes.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {classes.map(([cls, n]) => (
            <Chip key={cls} label={cls} value={String(n)} />
          ))}
        </div>
      ) : null}
      {catalog.enriched && s.sources.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {s.sources.map((src) => (
            <Chip
              key={src.name}
              label={src.name}
              value={`${src.nSymbols}${src.keyed === null ? '' : src.keyed ? ' · key' : ' · free'}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function state(list: State): { status: RoomStatus; label?: string } {
  if (list.phase === 'loading') return { status: 'degraded', label: 'reading' };
  if (list.phase === 'failed') return { status: 'attention', label: 'engine unreachable' };
  if (list.catalog.summary.nSymbols === 0) return { status: 'degraded', label: 'no data yet' };
  if (list.catalog.summary.nRegisteredNoBars > 0) {
    return { status: 'nominal', label: `${list.catalog.summary.nRegisteredNoBars} empty` };
  }
  return { status: 'nominal' };
}

export function CatalogPage(_: PanelHostProps): JSX.Element {
  const [list, setList] = useState<State>({ phase: 'loading' });

  const load = useCallback(async () => {
    setList({ phase: 'loading' });
    const catalog = await dataCatalog();
    setList(catalog ? { phase: 'ready', catalog } : { phase: 'failed' });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { status, label } = state(list);
  const ready = list.phase === 'ready' ? list.catalog : null;

  const vitals: PageVital[] = [
    { label: 'symbols', value: ready ? String(ready.summary.nSymbols) : null },
    { label: 'with data', value: ready ? String(ready.summary.nBacktestable) : null },
    {
      label: 'no data',
      value: ready ? String(ready.summary.nRegisteredNoBars) : null,
      emphasis: ready && ready.summary.nRegisteredNoBars > 0 ? 'warn' : undefined,
    },
  ];

  return (
    <RoomPage
      room="catalog"
      status={status}
      statusLabel={label}
      context={`${ROOM_CONTEXT.catalog} A backtest can only run on symbols listed here with data.`}
      vitals={vitals}
    >
      <PanelShell
        title="Catalog"
        toolbar={
          <>
            <Button variant="ghost" onClick={() => void load()}>
              Refresh
            </Button>
            <ToolbarSpring />
          </>
        }
      >
        {list.phase === 'loading' ? (
          <SkeletonRows rows={6} />
        ) : list.phase === 'failed' ? (
          <CenterState
            title="The engine didn't respond"
            detail="The catalog is read from your local Auracle engine. Make sure the stack is running, then retry."
            actions={
              <Button variant="primary" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        ) : list.catalog.symbols.length === 0 ? (
          <CenterState
            title="No data yet"
            detail="Nothing has been ingested. Add symbols and pull their history, and everything this install can backtest shows up here."
          />
        ) : (
          <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Summary catalog={list.catalog} />
            {!list.catalog.enriched ? (
              <InlineNote kind="muted">
                Gaps and data source appear once the engine update is deployed — coverage is live now.
              </InlineNote>
            ) : null}
            <SectionLabel meta={`${list.catalog.symbols.length}`}>Symbols</SectionLabel>
            <DataGrid
              testId="catalog-grid"
              label="Data catalog"
              columns={catalogColumns(list.catalog.symbols)}
              rows={list.catalog.symbols}
              rowKey={(r) => `${r.symbol}:${r.exchange}`}
            />
          </div>
        )}
      </PanelShell>
    </RoomPage>
  );
}
