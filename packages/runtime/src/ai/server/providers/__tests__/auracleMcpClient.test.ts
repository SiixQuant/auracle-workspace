import { describe, it, expect } from 'vitest';
import { AuracleMcpClientHub } from '../auracleMcpClient';
import type { McpServerDict, McpClientFactory } from '../auracleMcpClient';

/**
 * Phase 2b — the in-process MCP client hub.
 *
 * Fully hermetic: the SDK is never imported. Every test injects a `clientFactory`
 * that returns a fake `Client`, so the connect / list / dispatch / close lifecycle
 * runs with no network and no real MCP servers.
 */

interface FakeTool {
  name?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

interface FakeClient {
  connect: (t: unknown) => Promise<void>;
  listTools: () => Promise<{ tools?: FakeTool[] }>;
  callTool: (p: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
  close: () => Promise<void>;
  closed: boolean;
  calls: Array<{ name: string; arguments?: Record<string, unknown> }>;
}

function makeFakeClient(
  tools: FakeTool[],
  behavior?: { connectThrows?: boolean; listThrows?: boolean },
): FakeClient {
  const client: FakeClient = {
    closed: false,
    calls: [],
    async connect() {
      if (behavior?.connectThrows) throw new Error('connect failed');
    },
    async listTools() {
      if (behavior?.listThrows) throw new Error('list failed');
      return { tools };
    },
    async callTool(params) {
      client.calls.push(params);
      return { ok: true, tool: params.name, args: params.arguments };
    },
    async close() {
      client.closed = true;
    },
  };
  return client;
}

const OBJ_SCHEMA = { type: 'object', properties: {} };

describe('AuracleMcpClientHub', () => {
  it('lists tools ONLY from healthy servers — a failing server degrades, never throws', async () => {
    const healthy = makeFakeClient([
      { name: 'search', description: 'd', inputSchema: OBJ_SCHEMA },
    ]);
    // `nimbalyst-host` connects but its listTools throws → its tools are skipped.
    const brokenList = makeFakeClient([{ name: 'x', inputSchema: OBJ_SCHEMA }], { listThrows: true });

    const factory: McpClientFactory = (name) => {
      if (name === 'auracle-engine') return healthy;
      if (name === 'nimbalyst-host') return brokenList;
      throw new Error('cannot build client'); // a server that can't even be opened
    };

    const servers: McpServerDict = {
      'auracle-engine': { type: 'http', url: 'http://engine', headers: { Authorization: 'Bearer secret' } },
      'nimbalyst-host': { type: 'sse', url: 'http://host' },
      'nimbalyst-broken': { type: 'sse', url: 'http://broken' },
    };

    const hub = new AuracleMcpClientHub(servers, { clientFactory: factory });
    // Never throws despite two failing servers.
    await expect(hub.connectAll()).resolves.toBeUndefined();

    const names = hub.listNamespacedToolDefs().map((d) => d.name);
    expect(names).toEqual(['mcp__auracle-engine__search']);
  });

  it('namespaces tool "foo" on server "auracle-engine" as mcp__auracle-engine__foo (hyphen preserved)', async () => {
    const client = makeFakeClient([
      { name: 'foo', description: 'the foo', inputSchema: OBJ_SCHEMA, annotations: { readOnlyHint: true } },
    ]);
    const hub = new AuracleMcpClientHub(
      { 'auracle-engine': { type: 'sse', url: 'http://x' } },
      { clientFactory: () => client },
    );
    await hub.connectAll();

    expect(hub.hasTool('mcp__auracle-engine__foo')).toBe(true);
    const def = hub.listNamespacedToolDefs()[0];
    expect(def.name).toBe('mcp__auracle-engine__foo');
    expect(def.description).toBe('the foo');
    expect(def.parameters).toEqual(OBJ_SCHEMA);
    expect(hub.getToolAnnotations('mcp__auracle-engine__foo')).toEqual({ readOnlyHint: true });
  });

  it('callTool routes a namespaced call back to {server, tool} (server name has a hyphen)', async () => {
    const engine = makeFakeClient([{ name: 'run_backtest_now', inputSchema: OBJ_SCHEMA }]);
    const hub = new AuracleMcpClientHub(
      { 'auracle-engine': { type: 'http', url: 'http://x' } },
      { clientFactory: () => engine },
    );
    await hub.connectAll();

    const res = await hub.callTool('mcp__auracle-engine__run_backtest_now', { symbol: 'SPY' });
    // The BARE tool name reached the owning client (not the namespaced form).
    expect(engine.calls).toEqual([{ name: 'run_backtest_now', arguments: { symbol: 'SPY' } }]);
    expect(res).toMatchObject({ ok: true, tool: 'run_backtest_now' });
  });

  it('callTool throws for an unknown / unconnected namespaced tool', async () => {
    const hub = new AuracleMcpClientHub({}, { clientFactory: () => null });
    await hub.connectAll();
    await expect(hub.callTool('mcp__nope__x', {})).rejects.toThrow(/Unknown MCP tool/);
  });

  it('closeAll closes every connected client and clears the tool set', async () => {
    const a = makeFakeClient([{ name: 't1', inputSchema: OBJ_SCHEMA }]);
    const b = makeFakeClient([{ name: 't2', inputSchema: OBJ_SCHEMA }]);
    const hub = new AuracleMcpClientHub(
      { 'srv-a': { type: 'sse', url: 'http://a' }, 'srv-b': { type: 'sse', url: 'http://b' } },
      { clientFactory: (name) => (name === 'srv-a' ? a : b) },
    );
    await hub.connectAll();
    expect(hub.listNamespacedToolDefs()).toHaveLength(2);

    await hub.closeAll();
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
    expect(hub.listNamespacedToolDefs()).toHaveLength(0);
  });

  it('connectAll is idempotent (a second call does not double-register tools)', async () => {
    const client = makeFakeClient([{ name: 'foo', inputSchema: OBJ_SCHEMA }]);
    const hub = new AuracleMcpClientHub(
      { 'srv-a': { type: 'sse', url: 'http://a' } },
      { clientFactory: () => client },
    );
    await hub.connectAll();
    await hub.connectAll();
    expect(hub.listNamespacedToolDefs()).toHaveLength(1);
  });
});
