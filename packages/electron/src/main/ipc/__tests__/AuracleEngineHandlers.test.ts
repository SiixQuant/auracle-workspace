/**
 * The bridge assembles the engine credentials itself, and lets a caller add
 * only the one header family the engine expects on its guarded operations.
 *
 * What is pinned here is the reduction, because it is the whole reason the
 * lane is an allowlist rather than a passthrough: a name the bridge does not
 * know is dropped rather than forwarded, and the drop is silent so a caller
 * never has to handle it.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  callerHeaders,
  resolveEngineMcpServer,
  resolveInstallUniversePreamble,
} from '../AuracleEngineHandlers';

describe('the headers a caller may add', () => {
  it('keeps the one the engine expects, and emits it under the one spelling', () => {
    expect(callerHeaders({ 'X-Auracle-Confirmation': 'issued-1' })).toEqual({
      'X-Auracle-Confirmation': 'issued-1',
    });
    // However the caller wrote it, one canonical name reaches the request —
    // two spellings of the same header would be joined into one unreadable
    // value, and a name with stray whitespace is not a legal header at all.
    expect(callerHeaders({ 'x-auracle-confirmation': 'issued-1' })).toEqual({
      'X-Auracle-Confirmation': 'issued-1',
    });
    expect(callerHeaders({ ' X-Auracle-Confirmation ': 'issued-1' })).toEqual({
      'X-Auracle-Confirmation': 'issued-1',
    });
  });

  it('drops every name it does not know, including the credential ones', () => {
    expect(
      callerHeaders({
        'X-API-Key': 'someone-elses',
        Cookie: 'auracle_session=someone-elses',
        'X-CSRF-Token': 'anything',
        Authorization: 'Bearer x',
      })
    ).toEqual({});
  });

  it('ignores anything that is not a usable value, and anything that is not an object', () => {
    expect(callerHeaders({ 'X-Auracle-Confirmation': '' })).toEqual({});
    expect(callerHeaders({ 'X-Auracle-Confirmation': 42 })).toEqual({});
    expect(callerHeaders(undefined)).toEqual({});
    expect(callerHeaders(null)).toEqual({});
    expect(callerHeaders(['X-Auracle-Confirmation'])).toEqual({});
  });
});

describe('the engine MCP server the IDE auto-wires', () => {
  it('shapes the enabled handoff into an http MCP server entry with the bearer', async () => {
    const req = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { enabled: true, url: 'http://localhost:7777/mcp', token: 'tok-abc' },
    }));
    const entry = await resolveEngineMcpServer(req as never);
    expect(req).toHaveBeenCalledWith('GET', '/ui/api/ide/mcp');
    expect(entry).toEqual({
      'auracle-engine': {
        type: 'http',
        url: 'http://localhost:7777/mcp',
        headers: { Authorization: 'Bearer tok-abc' },
      },
    });
  });

  it('is null when the handoff is disabled (no token set on the engine)', async () => {
    const req = async () => ({ ok: true, status: 200, body: { enabled: false, url: '', token: '' } });
    expect(await resolveEngineMcpServer(req as never)).toBeNull();
  });

  it('is null on a non-ok response (unauthorized / no engine)', async () => {
    const req = async () => ({ ok: false, status: 401, body: { detail: 'no key' } });
    expect(await resolveEngineMcpServer(req as never)).toBeNull();
  });

  it('is null when the body is missing a url or token', async () => {
    const noUrl = async () => ({ ok: true, status: 200, body: { enabled: true, token: 'x' } });
    const noTok = async () => ({ ok: true, status: 200, body: { enabled: true, url: 'http://localhost:7777/mcp' } });
    expect(await resolveEngineMcpServer(noUrl as never)).toBeNull();
    expect(await resolveEngineMcpServer(noTok as never)).toBeNull();
  });

  it('never throws — a failing request yields null so the session still launches', async () => {
    const req = async () => {
      throw new Error('engine unreachable');
    };
    expect(await resolveEngineMcpServer(req as never)).toBeNull();
  });
});

describe('the install-universe preamble the IDE grounds the agent with', () => {
  it('formats the backtestable universe into one directive paragraph', async () => {
    const req = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: {
        backtestable: [{ symbol: 'SPY' }, { symbol: 'QQQ' }, { symbol: 'IWM' }],
        n_backtestable: 3,
        span: { earliest: '2005-01-03', latest: '2026-07-29' },
        asset_classes: { ETF: 3 },
      },
    }));
    const preamble = await resolveInstallUniversePreamble(req as never);
    expect(req).toHaveBeenCalledWith('GET', '/ui/api/ide/universe');
    expect(preamble).toContain('can backtest 3 instrument(s)');
    expect(preamble).toContain('SPY, QQQ, IWM');
    expect(preamble).toContain('2005-01-03 to 2026-07-29');
    expect(preamble).toContain('3 ETF');
    // The load-bearing instructions: only these symbols, and check first.
    expect(preamble).toContain('ONLY from these symbols');
    expect(preamble).toContain('data_coverage');
  });

  it('caps a long symbol list and notes the remainder', async () => {
    const many = Array.from({ length: 75 }, (_v, i) => ({ symbol: `S${i}` }));
    const req = async () => ({
      ok: true,
      status: 200,
      body: { backtestable: many, n_backtestable: 75, span: {}, asset_classes: {} },
    });
    const preamble = await resolveInstallUniversePreamble(req as never);
    expect(preamble).toContain('+15 more'); // 75 - 60 cap
    expect(preamble).not.toContain('S74'); // beyond the cap, not listed inline
  });

  it('tells the agent to ingest first when nothing is backtestable', async () => {
    const req = async () => ({
      ok: true,
      status: 200,
      body: { backtestable: [], n_backtestable: 0, span: {}, asset_classes: {} },
    });
    const preamble = await resolveInstallUniversePreamble(req as never);
    expect(preamble).toContain('no ingested market data yet');
    expect(preamble).toContain('ingest_historical_bars');
    expect(preamble).not.toContain('Backtestable symbols:');
  });

  it('is null on a non-ok response, and never throws', async () => {
    const notOk = async () => ({ ok: false, status: 401, body: { detail: 'no key' } });
    expect(await resolveInstallUniversePreamble(notOk as never)).toBeNull();
    const boom = async () => {
      throw new Error('engine unreachable');
    };
    expect(await resolveInstallUniversePreamble(boom as never)).toBeNull();
  });
});
