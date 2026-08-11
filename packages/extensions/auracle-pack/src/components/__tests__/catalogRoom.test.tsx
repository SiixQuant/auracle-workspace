/**
 * Catalog room (Frontier #12): the data browser + its mappers.
 *
 * Pins the two engine-shape mappers (the rich `/catalog` route and the always-
 * deployed `/ide/universe` fallback → one `DataCatalog`), the column shape, and
 * the room: coverage renders live, gaps/source show an em dash with a one-line
 * note when running against the fallback, and the empty / engine-down states are
 * honest rather than a fabricated row.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/client')>();
  return { ...actual, dataCatalog: vi.fn() };
});

import {
  dataCatalog,
  mapRichCatalog,
  mapUniverseCatalog,
  type DataCatalog,
} from '../../engine/client';
import { CatalogPage, catalogColumns } from '../grid/pages/CatalogPage';
import { openGridHome } from '../grid/gridNav';

const catalogMock = dataCatalog as unknown as Mock;
const Page = CatalogPage as unknown as () => JSX.Element;

afterEach(() => {
  cleanup();
  openGridHome();
  vi.clearAllMocks();
});

describe('mapUniverseCatalog (fallback shape)', () => {
  it('merges backtestable + registered-no-bars, sorted, gaps/source absent', () => {
    const cat = mapUniverseCatalog({
      backtestable: [
        { symbol: 'SPY', exchange: 'ARCA', asset_class: 'ETF', first_bar: '2010-01-04', last_bar: '2026-08-01', bar_count: 4100 },
      ],
      registered_no_bars: ['AAPL'],
      n_backtestable: 1,
      span: { earliest: '2010-01-04', latest: '2026-08-01' },
      asset_classes: { ETF: 1 },
    });
    expect(cat.enriched).toBe(false);
    expect(cat.symbols.map((s) => s.symbol)).toEqual(['AAPL', 'SPY']); // sorted
    const spy = cat.symbols.find((s) => s.symbol === 'SPY')!;
    expect(spy.barCount).toBe(4100);
    expect(spy.gaps).toBeNull();
    expect(spy.source).toBeNull();
    const aapl = cat.symbols.find((s) => s.symbol === 'AAPL')!;
    expect(aapl.barCount).toBe(0); // registered-but-empty stays visible
    expect(cat.summary.nRegisteredNoBars).toBe(1);
  });
});

describe('mapRichCatalog (enriched shape)', () => {
  it('carries gaps, source and keyed through', () => {
    const cat = mapRichCatalog({
      symbols: [
        { symbol: 'SPY', exchange: 'ARCA', asset_class: 'ETF', name: 'SPDR', first_bar: '2010-01-04', last_bar: '2026-08-01', bar_count: 4100, gaps: 3, source: 'yfinance', keyed: false },
      ],
      summary: {
        n_symbols: 1, n_backtestable: 1, n_registered_no_bars: 0,
        span: { earliest: '2010-01-04', latest: '2026-08-01' },
        asset_classes: { ETF: 1 },
        sources: [{ name: 'yfinance', keyed: false, n_symbols: 1 }],
      },
    });
    expect(cat.enriched).toBe(true);
    expect(cat.symbols[0]).toMatchObject({ gaps: 3, source: 'yfinance', keyed: false, name: 'SPDR' });
    expect(cat.summary.sources).toEqual([{ name: 'yfinance', keyed: false, nSymbols: 1 }]);
  });
});

describe('catalogColumns', () => {
  const rows = [
    { symbol: 'SPY', exchange: 'ARCA', assetClass: 'ETF', name: null, firstBar: '2010-01-04', lastBar: '2026-08-01', barCount: 4100, gaps: 3, source: 'yfinance', keyed: false },
  ];
  it('is the seven-column symbol shape', () => {
    expect(catalogColumns(rows).map((c) => c.key)).toEqual([
      'symbol', 'class', 'coverage', 'bars', 'gaps', 'source', 'access',
    ]);
  });
  it('heat-shades gaps only when something has an interior gap', () => {
    expect(catalogColumns(rows).find((c) => c.key === 'gaps')?.heat).toBeTruthy();
    const clean = [{ ...rows[0], gaps: 0 }];
    expect(catalogColumns(clean).find((c) => c.key === 'gaps')?.heat).toBeUndefined();
  });
});

function catalog(over: Partial<DataCatalog> = {}): DataCatalog {
  return {
    enriched: true,
    symbols: [
      { symbol: 'SPY', exchange: 'ARCA', assetClass: 'ETF', name: 'SPDR', firstBar: '2010-01-04', lastBar: '2026-08-01', barCount: 4100, gaps: 3, source: 'yfinance', keyed: false },
      { symbol: 'AAPL', exchange: 'NASDAQ', assetClass: 'STK', name: null, firstBar: null, lastBar: null, barCount: 0, gaps: null, source: null, keyed: null },
    ],
    summary: {
      nSymbols: 2, nBacktestable: 1, nRegisteredNoBars: 1,
      span: { earliest: '2010-01-04', latest: '2026-08-01' },
      assetClasses: { ETF: 1 },
      sources: [{ name: 'yfinance', keyed: false, nSymbols: 1 }],
    },
    ...over,
  };
}

describe('CatalogPage', () => {
  it('renders the coverage grid and the summary', async () => {
    catalogMock.mockResolvedValue(catalog());
    render(<Page />);
    await screen.findByTestId('catalog-grid');
    expect(screen.getByTestId('catalog-grid-row-SPY:ARCA')).toBeTruthy();
    expect(screen.getByText('SPY')).toBeTruthy();
    // registered-but-empty symbol reads "no data" in its row, not a fake range
    const aaplRow = screen.getByTestId('catalog-grid-row-AAPL:NASDAQ');
    expect(within(aaplRow).getByText('no data')).toBeTruthy();
    // the summary band renders its own coverage figures (scoped: the same
    // values also appear as vitals and grid cells)
    const summary = screen.getByTestId('catalog-summary');
    expect(within(summary).getByText('with data')).toBeTruthy();
    expect(within(summary).getByText('2010-01-04 → 2026-08-01')).toBeTruthy();
  });

  it('shows the deploy-pending note only against the fallback', async () => {
    catalogMock.mockResolvedValue(catalog({ enriched: false }));
    render(<Page />);
    await screen.findByTestId('catalog-grid');
    expect(screen.getByText(/appear once the engine update is deployed/)).toBeTruthy();
  });

  it('hides the note when the rich catalog answered', async () => {
    catalogMock.mockResolvedValue(catalog({ enriched: true }));
    render(<Page />);
    await screen.findByTestId('catalog-grid');
    expect(screen.queryByText(/appear once the engine update is deployed/)).toBeNull();
  });

  it('states engine-down honestly', async () => {
    catalogMock.mockResolvedValue(null);
    render(<Page />);
    await waitFor(() => expect(screen.getByText("The engine didn't respond")).toBeTruthy());
  });
});
