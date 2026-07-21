import { describe, expect, it } from 'vitest';

import {
  DEEP_RANK_PROMPT,
  TRANSMOG_NO_KEY_REASON,
  TRANSMOG_SIGNED_OUT_REASON,
  transmogAction,
  transmogPrompt,
  normalizeFinding,
  scanSummaryText,
  scoreOrigin,
  sourceLabel,
  fmtWhen,
  fmtDate,
  type ScanStatus,
  classifyLoadFailure,
  researchContext,
  scanStartError,
  type ResearchFeed,
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

describe('timestamps', () => {
  it('formats UTC stamps like the engine label and stays empty on junk', () => {
    expect(fmtWhen('2026-06-07T14:30:00+00:00')).toBe('Jun 07, 14:30 UTC');
    expect(fmtWhen(null)).toBe('');
    expect(fmtWhen('not-a-date')).toBe('');
    expect(fmtDate('2026-06-03T00:00:00+00:00')).toBe('Jun 3, 2026');
    expect(fmtDate(null)).toBe('');
  });
});


describe('transmogAction', () => {
  const f = (status: string, strategy_path: string | null = null) => ({
    status,
    strategy_path,
  });

  it('drafted with a recorded link opens the strategies file', () => {
    expect(transmogAction(f('drafted', 'momentum_from_paper.py'), true)).toEqual({
      kind: 'open',
      path: 'strategies/momentum_from_paper.py',
    });
    expect(transmogAction(f('backtested', 'x.py'), false)).toEqual({
      kind: 'open',
      path: 'strategies/x.py',
    });
  });

  it('drafted without a link offers nothing rather than a dead control', () => {
    expect(transmogAction(f('drafted'), true)).toEqual({ kind: 'none' });
  });

  it('signed-out transmog is disabled with the reason', () => {
    const action = transmogAction(f('surfaced'), false);
    expect(action).toEqual({
      kind: 'transmog',
      disabled: true,
      reason: TRANSMOG_SIGNED_OUT_REASON,
    });
  });

  it('signed-in surfaced and watchlist findings can transmog', () => {
    expect(transmogAction(f('surfaced'), true)).toEqual({
      kind: 'transmog',
      disabled: false,
      reason: null,
    });
    expect(transmogAction(f('watchlist'), true)).toEqual({
      kind: 'transmog',
      disabled: false,
      reason: null,
    });
  });

  it('signed-in with no agent model shows the connect-a-key gate', () => {
    expect(transmogAction(f('surfaced'), true, 'absent')).toEqual({
      kind: 'gate',
      reason: TRANSMOG_NO_KEY_REASON,
    });
    expect(transmogAction(f('watchlist'), true, 'absent')).toEqual({
      kind: 'gate',
      reason: TRANSMOG_NO_KEY_REASON,
    });
  });

  it('a present or unknown key state does not gate — unknown never blocks', () => {
    for (const presence of ['present', 'unknown'] as const) {
      expect(transmogAction(f('surfaced'), true, presence)).toEqual({
        kind: 'transmog',
        disabled: false,
        reason: null,
      });
    }
    // The default (no host lane wired) behaves like 'unknown'.
    expect(transmogAction(f('surfaced'), true)).toEqual({
      kind: 'transmog',
      disabled: false,
      reason: null,
    });
  });

  it('the sign-in gate wins over the key gate — signed out is untouched', () => {
    // Even with no key, a signed-out finding keeps the existing sign-in gate.
    expect(transmogAction(f('surfaced'), false, 'absent')).toEqual({
      kind: 'transmog',
      disabled: true,
      reason: TRANSMOG_SIGNED_OUT_REASON,
    });
  });

  it('terminal states never transmog', () => {
    expect(transmogAction(f('dismissed'), true)).toEqual({ kind: 'none' });
    expect(transmogAction(f('dismissed'), true, 'absent')).toEqual({ kind: 'none' });
  });
});

describe('transmogPrompt', () => {
  it('prefills the namespaced plugin command with the id only', () => {
    expect(transmogPrompt(42)).toBe('/auracle:transmog 42');
  });
});

describe('normalizeFinding strategy_path', () => {
  it('passes a recorded path through and nulls everything else', () => {
    expect(normalizeFinding({ strategy_path: 'a.py' }).strategy_path).toBe('a.py');
    expect(normalizeFinding({}).strategy_path).toBeNull();
    expect(normalizeFinding({ strategy_path: '' }).strategy_path).toBeNull();
  });
});


describe('deep-rank origin labeling and feed order', () => {
  it('labels agent-origin models as agent, everything else honestly', () => {
    expect(scoreOrigin('heuristic')).toBe('heuristic');
    expect(scoreOrigin('agent')).toBe('agent');
    expect(scoreOrigin('agent-refined')).toBe('agent');
    expect(scoreOrigin('gpt-4o')).toBe('llm');
  });

  it('pins the deep-rank hand-off command', () => {
    expect(DEEP_RANK_PROMPT).toBe('/auracle:deep-rank');
  });

  it('renders the feed in server order — no client re-scoring', () => {
    const rows = [
      { id: 2, composite: 90, model: 'agent' },
      { id: 1, composite: 55, model: 'heuristic' },
    ];
    const normalized = rows.map(normalizeFinding);
    expect(normalized.map((f) => f.id)).toEqual([2, 1]);
    expect(normalized[0].composite).toBe(90);
    expect(normalized[0].model).toBe('agent');
  });
});

describe('classifyLoadFailure separates an old engine from a dead one', () => {
  it('routes missing-route statuses to the outdated state', () => {
    expect(classifyLoadFailure(404)).toBe('outdated');
    expect(classifyLoadFailure(405)).toBe('outdated');
  });

  it('routes everything else to unreachable', () => {
    expect(classifyLoadFailure(0)).toBe('unreachable');
    expect(classifyLoadFailure(500)).toBe('unreachable');
    expect(classifyLoadFailure(502)).toBe('unreachable');
  });
});

describe('scanStartError names the cause and the fix', () => {
  it('tells an outdated engine to update, not to retry the network', () => {
    expect(scanStartError(404)).toContain('update the Auracle stack');
  });

  it('reports a dead socket as no response', () => {
    expect(scanStartError(0)).toContain('did not respond');
  });

  it('surfaces other refusals with their status', () => {
    expect(scanStartError(403)).toContain('403');
  });
});

describe('researchContext (ambient)', () => {
  it('publishes a bounded, panel-tagged view of the feed', () => {
    const feed: ResearchFeed = {
      last_scan: '2026-07-08T00:00:00Z',
      findings: Array.from({ length: 10 }, (_, i) =>
        normalizeFinding({ id: i, title: `Paper ${i}`, composite: 90 - i, band: 'candidate' })
      ),
    };
    const ctx = researchContext(feed);
    expect(ctx.panel).toBe('research');
    expect(ctx.count).toBe(10);
    // top is capped at 8 so the ambient doc stays small
    expect((ctx.top as unknown[]).length).toBe(8);
    expect((ctx.top as Array<{ title: string }>)[0].title).toBe('Paper 0');
  });
});
