import { describe, expect, it } from 'vitest';

import {
  normalizeFinding,
  scanSummaryText,
  scoreOrigin,
  sourceLabel,
  splitTerms,
  fmtWhen,
  fmtDate,
  type ScanStatus,
} from '../research';

describe('normalizeFinding', () => {
  it('coerces a sparse engine row to safe defaults', () => {
    const f = normalizeFinding({ id: 7, paper_id: '2406.01234', title: 'T' });
    expect(f.id).toBe(7);
    expect(f.paper_id).toBe('2406.01234');
    expect(f.source).toBe('arxiv');
    expect(f.status).toBe('surfaced');
    expect(f.model).toBe('heuristic');
    expect(f.asset_classes).toEqual([]);
    expect(f.composite).toBe(0);
    expect(f.citation_count).toBeNull();
  });

  it('keeps engine-computed numbers untouched', () => {
    const f = normalizeFinding({
      id: 1,
      paper_id: 'beef0001',
      source: 's2',
      title: 'Carry',
      score: 0.62,
      composite: 71,
      band: 'candidate',
      citation_count: 12,
      asset_classes: ['futures', 'fx'],
    });
    expect(f.score).toBe(0.62);
    expect(f.composite).toBe(71);
    expect(f.band).toBe('candidate');
    expect(f.source).toBe('s2');
    expect(f.citation_count).toBe(12);
    expect(f.asset_classes).toEqual(['futures', 'fx']);
  });
});

describe('scoreOrigin', () => {
  it('labels the three origins and never dresses a keyword match as judgment', () => {
    expect(scoreOrigin('heuristic')).toBe('heuristic');
    expect(scoreOrigin('agent:claude')).toBe('agent');
    expect(scoreOrigin('ollama:llama3')).toBe('llm');
  });
});

describe('sourceLabel', () => {
  it('names known sources and passes unknown ones through honestly', () => {
    expect(sourceLabel('arxiv')).toBe('arXiv');
    expect(sourceLabel('s2')).toBe('Semantic Scholar');
    expect(sourceLabel('ssrn')).toBe('ssrn');
  });
});

const base: ScanStatus = {
  running: false,
  started_at: null,
  finished_at: null,
  result: null,
  error: null,
  last_scan: null,
};

describe('scanSummaryText', () => {
  it('is silent when nothing ran this session', () => {
    expect(scanSummaryText(null)).toBe('');
    expect(scanSummaryText(base)).toBe('');
  });

  it('reports running and failure states honestly', () => {
    expect(scanSummaryText({ ...base, running: true })).toBe('Scanning…');
    expect(
      scanSummaryText({ ...base, error: 'RuntimeError: arXiv exploded' })
    ).toBe('Scan failed — RuntimeError: arXiv exploded');
  });

  it('distinguishes "found nothing" from a real result', () => {
    expect(
      scanSummaryText({ ...base, result: { fetched: 0, stored: 0 } })
    ).toBe('Scan complete — no new papers for your interests.');
    expect(
      scanSummaryText({ ...base, result: { fetched: 12, stored: 9, deduped: 3 } })
    ).toBe('Scan complete — 12 papers fetched, 3 duplicates collapsed, 9 findings stored.');
    expect(
      scanSummaryText({ ...base, result: { fetched: 5, stored: 5 } })
    ).toBe('Scan complete — 5 papers fetched, 5 findings stored.');
  });
});

describe('splitTerms', () => {
  it('parses comma/newline fields like the engine does', () => {
    expect(splitTerms('q-fin.TR, q-fin.PM,q-fin.ST')).toEqual([
      'q-fin.TR',
      'q-fin.PM',
      'q-fin.ST',
    ]);
    expect(splitTerms('momentum\nmean reversion')).toEqual(['momentum', 'mean reversion']);
    expect(splitTerms(' a , a , b ')).toEqual(['a', 'b']);
    expect(splitTerms('')).toEqual([]);
    expect(splitTerms(Array.from({ length: 100 }, (_, i) => `k${i}`).join(','))).toHaveLength(40);
  });
});

describe('timestamps', () => {
  it('formats UTC stamps like the engine label and stays empty on junk', () => {
    expect(fmtWhen('2026-06-07T14:30:00+00:00')).toBe('Jun 07, 14:30 UTC');
    expect(fmtWhen(null)).toBe('');
    expect(fmtWhen('not-a-date')).toBe('');
    expect(fmtDate('2026-06-03T00:00:00+00:00')).toBe('Jun 3, 2026');
    expect(fmtDate(null)).toBe('');
  });
});
