// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDossier } from '../client';

/**
 * The dossier seam, tested against the wire rather than against a mock of
 * itself.
 *
 * ★ WHY THIS FILE EXISTS. The card's own test mocks `buildDossier` and asserts
 * what the panel does with a well-formed result — so it passed for months
 * while the real parsing rejected every successful build. The engine returns
 * the report's DATABASE ROW ID, a number; the guard here required a string, so
 * a 200 carrying a finished PDF was read as a failure and the card printed
 * "The dossier could not be generated." The PDF was on disk the whole time.
 *
 * A mock of the thing under test cannot catch a disagreement about the wire.
 * These cases feed the real bridge shape.
 */

function mockBridge(response: { ok: boolean; status: number; body: unknown }) {
  const invoke = vi.fn(async () => response);
  (window as unknown as { electronAPI?: unknown }).electronAPI = { invoke };
  return invoke;
}

const REPORT = {
  strategy_path: 'strategies/t25composite.py',
  job_id: 38,
  filename: '2026-08-19_t25composite_38.pdf',
  path: '/data/reports/2026-08-19_t25composite_38.pdf',
  created_at: '2026-08-19T19:51:00Z',
  cached: false,
};

describe('buildDossier', () => {
  beforeEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });
  afterEach(() => vi.restoreAllMocks());

  it('accepts the numeric id the engine actually sends', async () => {
    // The regression. `int(row.id)` on the engine → a number here.
    mockBridge({ ok: true, status: 200, body: { ok: true, report: { ...REPORT, id: 42 } } });

    const res = await buildDossier('strategies/t25composite.py', 38);

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    // Normalised to a string at the seam, so everything downstream keeps one type.
    expect(res.report.id).toBe('42');
    expect(res.report.filename).toBe(REPORT.filename);
  });

  it('still accepts a string id', async () => {
    mockBridge({ ok: true, status: 200, body: { ok: true, report: { ...REPORT, id: 'abc' } } });
    const res = await buildDossier('s.py', 1);
    expect(res.ok && res.report.id).toBe('abc');
  });

  it('refuses a report with no usable id', async () => {
    // A 200 with a malformed body is a real failure, and must stay one.
    mockBridge({ ok: true, status: 200, body: { ok: true, report: { ...REPORT } } });
    const res = await buildDossier('s.py', 1);
    expect(res.ok).toBe(false);
  });

  it('does not mistake id 0 for a missing id', async () => {
    // `!0` is true — a truthiness check here would have called this absent.
    mockBridge({ ok: true, status: 200, body: { ok: true, report: { ...REPORT, id: 0 } } });
    const res = await buildDossier('s.py', 1);
    expect(res.ok && res.report.id).toBe('0');
  });

  it('keeps the status and reason when the engine really fails', async () => {
    // 503 is what the card turns into "not available on this engine build".
    mockBridge({ ok: false, status: 503, body: { ok: false, error: 'WeasyPrint missing' } });
    const res = await buildDossier('s.py', 1);
    expect(res).toEqual({ ok: false, status: 503, error: 'WeasyPrint missing' });
  });

  it('reports an unreachable engine as status 0', async () => {
    // No bridge at all — the card maps this to "make sure your stack is running".
    const res = await buildDossier('s.py', 1);
    expect(res).toEqual({ ok: false, status: 0, error: undefined });
  });
});
