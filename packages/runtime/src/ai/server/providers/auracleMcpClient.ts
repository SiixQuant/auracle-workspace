/**
 * In-process MCP client hub for the Auracle chat provider (Phase 2b).
 *
 * The `auracle` provider (Sextant / Atlas) runs its agentic loop IN-PROCESS, so —
 * unlike the subprocess/SDK agents whose MCP servers are wired by the Claude /
 * Codex SDK — it needs its OWN MCP client to reach the same tool surface: the
 * internal `nimbalyst-*` servers, the per-extension `board_*` servers, and the
 * local engine's backtest / data tools. This hub connects to each configured
 * server over the SAME transports the SDK uses (sse / streamable-http / stdio),
 * lists its tools, namespaces them `mcp__<server>__<tool>`, and dispatches calls
 * back to the owning server.
 *
 * Design constraints (hard requirements):
 *  - DEGRADE, NEVER BREAK: every server connects in its OWN try/catch. A down
 *    engine or an absent extension removes only THAT server's tools; the chat and
 *    the other servers keep working. `connectAll` never throws.
 *  - TOKEN HYGIENE: bearer auth lives ONLY inside the transport
 *    `requestInit.headers`. The descriptor, its headers, and the token are NEVER
 *    logged, returned in a tool result, or persisted. A connect failure logs ONLY
 *    the server NAME and a coarse status.
 *  - NO HARD DEP: the MCP SDK is loaded with dynamic `import()` (it is hoisted in
 *    the root node_modules but is NOT a declared runtime dependency), so a missing
 *    SDK degrades to "no MCP tools" instead of a load-time crash.
 *  - LOSSLESS DISPATCH: reverse-parsing `mcp__<server>__<tool>` is lossy when a
 *    tool name itself contains `__`, so the hub keeps its OWN
 *    `namespaced -> {server, tool}` map built at list time and never reverse-
 *    parses the name for dispatch.
 */

/** Tool-behavior hints from an MCP `tools/list` entry (all optional). */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  [key: string]: unknown;
}

/** A namespaced tool definition the provider appends to its OFFERED toolset. */
export interface NamespacedToolDef {
  /** `mcp__<server>__<tool>` */
  name: string;
  description: string;
  /** JSON-Schema object (the MCP tool's `inputSchema`). */
  parameters: Record<string, unknown>;
  annotations?: McpToolAnnotations;
}

/**
 * A raw MCP server descriptor as produced by `McpConfigService.getMcpServersConfig`
 * and `resolveEngineMcpServer` (internal sse, engine http, or stdio).
 */
export interface McpServerDescriptor {
  type?: string; // 'sse' | 'http' | 'stdio' (falls back to `transport`)
  transport?: string;
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  [key: string]: unknown;
}

export type McpServerDict = Record<string, McpServerDescriptor>;

/** Minimal structural shape of the MCP SDK `Client` the hub depends on. */
interface McpClientLike {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{
    tools?: Array<{
      name?: string;
      description?: string;
      inputSchema?: unknown;
      annotations?: McpToolAnnotations;
    }>;
  }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Test seam: build an already-usable client for a server instead of importing the
 * SDK. When provided, `connect(undefined)` is still called (a fake's connect is a
 * harmless no-op), so the connect / list / close lifecycle is exercised exactly as
 * in production.
 */
export type McpClientFactory = (
  serverName: string,
  descriptor: McpServerDescriptor,
) => Promise<McpClientLike | null> | McpClientLike | null;

interface ResolvedTool {
  server: string;
  tool: string;
  annotations?: McpToolAnnotations;
}

export interface AuracleMcpClientHubDeps {
  clientFactory?: McpClientFactory;
}

/**
 * Normalize an MCP `inputSchema` into a JSON-Schema object the OpenAI-compatible
 * endpoint accepts as a tool's `parameters`. MCP input schemas are object schemas,
 * but we default defensively so a server that omits `type`/`properties` still
 * yields a valid parameters object.
 */
function normalizeSchema(inputSchema: unknown): Record<string, unknown> {
  if (inputSchema && typeof inputSchema === 'object') {
    const schema = inputSchema as Record<string, unknown>;
    if (schema.type === 'object') return schema;
    return {
      type: 'object',
      properties:
        schema.properties && typeof schema.properties === 'object'
          ? (schema.properties as Record<string, unknown>)
          : {},
      ...(Array.isArray(schema.required) ? { required: schema.required } : {}),
    };
  }
  return { type: 'object', properties: {} };
}

/**
 * A COARSE, token-safe status string for a connect failure. We deliberately do
 * NOT surface `err.message` (which could echo request details) — only a numeric
 * status / code or the error name. Never the descriptor, headers, or token.
 */
function connectStatus(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; status?: unknown; name?: unknown };
    if (typeof e.code === 'number' || typeof e.code === 'string') return String(e.code);
    if (typeof e.status === 'number' || typeof e.status === 'string') return String(e.status);
    if (typeof e.name === 'string' && e.name) return e.name;
  }
  return 'connect failed';
}

export class AuracleMcpClientHub {
  private readonly servers: McpServerDict;
  private readonly clientFactory?: McpClientFactory;

  private readonly clients = new Map<string, McpClientLike>();
  /** `mcp__<server>__<tool>` -> {server, tool, annotations}. Built at list time. */
  private readonly toolMap = new Map<string, ResolvedTool>();
  private toolDefs: NamespacedToolDef[] = [];
  private connectStarted = false;

  constructor(servers: McpServerDict | undefined, deps?: AuracleMcpClientHubDeps) {
    this.servers = servers ?? {};
    this.clientFactory = deps?.clientFactory;
  }

  /**
   * Connect EVERY configured server, each in its own try/catch, and record its
   * namespaced tools. Idempotent and NEVER throws: a per-server failure logs the
   * server NAME + a coarse status and skips only that server's tools.
   */
  async connectAll(): Promise<void> {
    if (this.connectStarted) return;
    this.connectStarted = true;

    for (const [name, descriptor] of Object.entries(this.servers)) {
      try {
        const client = await this.openClient(name, descriptor);
        if (!client) continue;
        const listed = await client.listTools();
        this.clients.set(name, client);
        for (const tool of listed?.tools ?? []) {
          const bare = typeof tool?.name === 'string' ? tool.name : '';
          if (!bare) continue;
          const namespaced = `mcp__${name}__${bare}`;
          this.toolMap.set(namespaced, {
            server: name,
            tool: bare,
            annotations: tool.annotations,
          });
          this.toolDefs.push({
            name: namespaced,
            description: typeof tool.description === 'string' ? tool.description : '',
            parameters: normalizeSchema(tool.inputSchema),
            annotations: tool.annotations,
          });
        }
      } catch (err) {
        // DEGRADE: skip only this server's tools. Log ONLY the name + status —
        // never the descriptor, headers, or token.
        console.warn(
          `[AuracleMcpClientHub] MCP server "${name}" unavailable; skipping its tools (status: ${connectStatus(err)})`,
        );
      }
    }
  }

  /**
   * Build + connect a client for ONE server. Returns null when the transport type
   * is unsupported or the SDK is unavailable (dynamic import fails / degrades).
   * Bearer auth is passed ONLY via `requestInit.headers`.
   */
  private async openClient(
    name: string,
    descriptor: McpServerDescriptor,
  ): Promise<McpClientLike | null> {
    // Test seam: an injected factory returns a ready client (connect is a no-op).
    if (this.clientFactory) {
      const client = await this.clientFactory(name, descriptor);
      if (!client) return null;
      await client.connect(undefined);
      return client;
    }

    const kind = String(descriptor.type ?? descriptor.transport ?? 'sse').toLowerCase();
    const requestInit = descriptor.headers
      ? { requestInit: { headers: { ...descriptor.headers } } }
      : undefined;

    let transport: unknown;
    if (kind === 'http' || kind === 'streamable-http' || kind === 'streamablehttp') {
      const { StreamableHTTPClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/streamableHttp.js'
      );
      transport = new StreamableHTTPClientTransport(new URL(String(descriptor.url)), requestInit);
    } else if (kind === 'sse') {
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
      transport = new SSEClientTransport(new URL(String(descriptor.url)), requestInit);
    } else if (kind === 'stdio') {
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      transport = new StdioClientTransport({
        command: String(descriptor.command ?? ''),
        args: Array.isArray(descriptor.args) ? descriptor.args : [],
        ...(descriptor.env ? { env: descriptor.env } : {}),
      });
    } else {
      return null;
    }

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const client = new Client(
      { name: 'auracle-inprocess', version: '1.0.0' },
      { capabilities: {} },
    ) as unknown as McpClientLike;
    await client.connect(transport);
    return client;
  }

  /** The namespaced tool definitions to append to the provider's offered toolset. */
  listNamespacedToolDefs(): NamespacedToolDef[] {
    return this.toolDefs.slice();
  }

  /** Annotations for a namespaced tool (drives the provider's gating classifier). */
  getToolAnnotations(namespaced: string): McpToolAnnotations | undefined {
    return this.toolMap.get(namespaced)?.annotations;
  }

  /** True if the hub owns a tool by its namespaced name. */
  hasTool(namespaced: string): boolean {
    return this.toolMap.has(namespaced);
  }

  /**
   * Dispatch a namespaced tool call to its owning server's client. Resolves via
   * the list-time map (NEVER reverse-parses the name). Throws for an unknown /
   * unconnected tool so the provider surfaces a normal tool error.
   */
  async callTool(namespaced: string, args: Record<string, unknown>): Promise<unknown> {
    const resolved = this.toolMap.get(namespaced);
    if (!resolved) throw new Error(`Unknown MCP tool: ${namespaced}`);
    const client = this.clients.get(resolved.server);
    if (!client) throw new Error(`MCP server not connected: ${resolved.server}`);
    return client.callTool({ name: resolved.tool, arguments: args ?? {} });
  }

  /** Close every connected client. Best-effort; individual close failures are swallowed. */
  async closeAll(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    this.toolMap.clear();
    this.toolDefs = [];
    await Promise.all(
      clients.map((client) => Promise.resolve(client.close()).catch(() => undefined)),
    );
  }
}
