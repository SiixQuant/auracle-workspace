/**
 * One request, one research lane — and an audit of everything it produced.
 *
 * The acceptance this whole surface is built against is two sentences: a single
 * chat request stands up a working research lane end to end, and an audit of
 * every agent-visible payload finds no credential value. This file is both.
 *
 * The flow is driven through the REAL tool definitions — the same objects the
 * host registers, schemas and handlers together — rather than through the
 * functions behind them, because the schema is half of the write-only promise:
 * a tool that accepted a `secret` property would be wrong even if its handler
 * threw the value away.
 *
 * Every payload that crosses the agent's field of view is collected as it goes
 * (the parameters in, the results out, the prompt dispatched, the document
 * saved to the settings lane, and the ambient envelope for each card) and put
 * through one audit at the end. The person's key is planted in the conversation
 * the whole time, so a leak has something to leak.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getJson: vi.fn(async () => null),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  postJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  putJson: vi.fn(async () => ({ ok: false, status: 0, body: null })),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import type { AIToolContext, ExtensionAITool } from '@nimbalyst/extension-sdk';
import { boardAiTools, boardScanPrompt } from '../../aiTools';
import { registerAgentHost, unregisterAgentHost } from '../../components/grid/gridAiExecutors';
import type { PanelHostLike } from '../../components/aiPanel';
import { boardNodeContext } from '../boardEnvelope';
import { boardGraphStore } from '../boardGraphStore';
import type { BoardGraphTransport } from '../boardPersistence';
import { SECRET_PROBE, secretFindings } from './boardSecretProbe';

/* ── the harness ─────────────────────────────────────────────────────────── */

/** Everything the agent could see, in the order it saw it. */
const seen: Array<{ label: string; payload: unknown }> = [];

function watch(label: string, payload: unknown): void {
  seen.push({ label, payload });
}

const saved: string[] = [];

const lane: BoardGraphTransport = {
  async load() {
    return null;
  },
  async save(_workspaceId: string, json: string) {
    saved.push(json);
    return true;
  },
};

const CONTEXT = { workspacePath: '/work/desk' } as unknown as AIToolContext;

function tool(name: string): ExtensionAITool {
  const found = boardAiTools.find((row) => row.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return found;
}

/**
 * Call a tool the way the host does, recording both sides of the call.
 *
 * `smuggle` marks a call whose PARAMETERS deliberately carry the key — the
 * attack, not the leak. Its parameters are left out of the audit (auditing the
 * poison would only prove the test planted it) while its result is audited like
 * any other: a refusal that quoted the value back would be a leak with a polite
 * sentence around it.
 */
async function call(
  name: string,
  params: Record<string, unknown>,
  options: { smuggle?: boolean } = {}
) {
  if (!options.smuggle) watch(`${name} params`, params);
  const outcome = await tool(name).handler(params, CONTEXT);
  watch(`${name} result`, outcome);
  return outcome;
}

function agentHost(): { host: PanelHostLike; launch: ReturnType<typeof vi.fn> } {
  const launch = vi.fn(async (prompt: string) => {
    watch('agent session prompt', prompt);
    return { ok: true, sessionId: 'sess-1' };
  });
  return { host: { launchAgentSession: launch }, launch };
}

let host: PanelHostLike | undefined;

beforeEach(async () => {
  seen.length = 0;
  saved.length = 0;
  await boardGraphStore.open('/work/desk', { transport: lane, saveDelayMs: 10_000 });
});

afterEach(() => {
  unregisterAgentHost(host);
  host = undefined;
  boardGraphStore.reset();
});

/* ── the flow ────────────────────────────────────────────────────────────── */

describe('one request stands a research lane up', () => {
  it('places the source, places the question, wires them and starts the scan', async () => {
    const { host: agent, launch } = agentHost();
    host = agent;
    registerAgentHost(agent);

    // 1. Something to read.
    const source = await call('board_create_card', {
      kind: 'source',
      config: {
        name: 'Filings stream',
        connector_kind: 'http_api',
        endpoint: 'https://example.invalid/filings',
        payload_type: 'news',
        // The NAME of the slot. The key itself is the person's to paste.
        credential_slot: 'filings_key',
      },
    });
    expect(source.success).toBe(true);
    const sourceId = (source.data as { node_id: string }).node_id;

    // 2. Something to ask of it.
    const research = await call('board_create_card', {
      kind: 'research',
      config: { hypothesis: 'Do late filings predict drift?' },
    });
    expect(research.success).toBe(true);
    const researchId = (research.data as { node_id: string }).node_id;

    // 3. The wire between them.
    const wired = await call('board_wire', { from: sourceId, to: researchId });
    expect(wired.success).toBe(true);

    // 4. The scan.
    const scan = await call('board_scan_card', { node_id: researchId });
    expect(scan.success).toBe(true);
    expect(scan.message).toContain('nothing has been scanned yet');
    expect(launch).toHaveBeenCalledTimes(1);

    // The lane a person will open tomorrow.
    const graph = boardGraphStore.getSnapshot().graph;
    expect(graph.nodes.map((node) => node.kind)).toEqual(['source', 'research']);
    expect(graph.edges).toEqual([
      { id: expect.any(String), from: sourceId, to: researchId, origin: 'user' },
    ]);
    expect(graph.nodes[0].source).toMatchObject({
      name: 'Filings stream',
      credentialSlot: 'filings_key',
    });

    // Every mutation was carried out to the settings lane before it answered,
    // so a lane built in a session that ends is still there in the next one.
    expect(saved.length).toBeGreaterThanOrEqual(3);
    expect(saved[saved.length - 1]).toContain(researchId);

    // The session opened on the same lane the Board is showing.
    const prompt = launch.mock.calls[0][0] as string;
    expect(prompt).toContain('Do late filings predict drift?');
    expect(prompt).toContain('Filings stream');
    expect(prompt).toContain(researchId);
  });

  it('reads the lane back, listing the cards and the wire', async () => {
    host = undefined;
    const source = await call('board_create_card', {
      kind: 'source',
      config: { name: 'Filings stream', credential_slot: 'filings_key' },
    });
    const research = await call('board_create_card', {
      kind: 'research',
      config: { hypothesis: 'Do late filings predict drift?' },
    });
    const sourceId = (source.data as { node_id: string }).node_id;
    const researchId = (research.data as { node_id: string }).node_id;
    await call('board_wire', { from: sourceId, to: researchId });

    const listed = await call('board_list', {});
    expect((listed.data as { nodes: { id: string }[] }).nodes.map((node) => node.id)).toEqual([
      sourceId,
      researchId,
    ]);
    const outputs = await call('board_read_outputs', { node_id: researchId });
    expect((outputs.data as { artifacts: unknown[] }).artifacts).toEqual([]);
    expect((outputs.data as { upstream: { id: string }[] }).upstream.map((c) => c.id)).toEqual([
      sourceId,
    ]);
  });

  it('refuses the key at every door it could be pushed through', async () => {
    host = undefined;
    const created = await call(
      'board_create_card',
      { kind: 'source', config: { name: 'Filings stream', secret: SECRET_PROBE } },
      { smuggle: true }
    );
    expect(created.success).toBe(false);

    const ok = await call('board_create_card', {
      kind: 'source',
      config: { name: 'Filings stream', credential_slot: 'filings_key' },
    });
    const nodeId = (ok.data as { node_id: string }).node_id;

    for (const field of ['secret', 'api_key', 'token', 'credential_value']) {
      const refused = await call(
        'board_update_card',
        { node_id: nodeId, config: { [field]: SECRET_PROBE } },
        { smuggle: true }
      );
      expect(refused.success).toBe(false);
      expect(refused.error).toContain('never travels through a board tool');
    }

    // Nothing the refusals carried reached the document that gets saved.
    expect(JSON.stringify(boardGraphStore.getSnapshot().graph)).not.toContain(SECRET_PROBE);
    expect(saved.join('')).not.toContain(SECRET_PROBE);
  });

  it('says plainly when there is no lane to start a scan on', async () => {
    host = undefined;
    const research = await call('board_create_card', {
      kind: 'research',
      config: { hypothesis: 'Do late filings predict drift?' },
    });
    const scan = await call('board_scan_card', {
      node_id: (research.data as { node_id: string }).node_id,
    });
    expect(scan.success).toBe(false);
    expect(scan.error).toContain('Nothing was started');
  });

  it('refuses to scan a card that is not a question', async () => {
    host = undefined;
    const source = await call('board_create_card', { kind: 'source', config: { name: 'Filings' } });
    const scan = await call('board_scan_card', {
      node_id: (source.data as { node_id: string }).node_id,
    });
    expect(scan.success).toBe(false);
    expect(boardScanPrompt('nope')).toBeNull();
  });
});

/* ── the audit ───────────────────────────────────────────────────────────── */

describe('the audit', () => {
  it('finds no credential value in anything the agent could see', async () => {
    const { host: agent } = agentHost();
    host = agent;
    registerAgentHost(agent);

    const source = await call('board_create_card', {
      kind: 'source',
      config: {
        name: 'Filings stream',
        connector_kind: 'http_api',
        endpoint: 'https://example.invalid/filings',
        payload_type: 'news',
        credential_slot: 'filings_key',
      },
    });
    const sourceId = (source.data as { node_id: string }).node_id;
    const research = await call('board_create_card', {
      kind: 'research',
      config: { hypothesis: 'Do late filings predict drift?' },
    });
    const researchId = (research.data as { node_id: string }).node_id;
    await call('board_wire', { from: sourceId, to: researchId });
    await call('board_scan_card', { node_id: researchId });
    await call('board_list', {});
    await call('board_read_outputs', { node_id: researchId });
    await call('board_delete_card', { node_id: sourceId, preview: true });

    // The person tries to hand the key over mid-conversation. It is refused,
    // and the refusal is audited too — a message that quoted the value back
    // would be a leak with a polite sentence around it.
    await call(
      'board_update_card',
      { node_id: sourceId, config: { secret: SECRET_PROBE } },
      { smuggle: true }
    );

    // The ambient envelope for every card, which is the other payload the agent
    // reads without asking for it.
    const graph = boardGraphStore.getSnapshot().graph;
    for (const node of graph.nodes) watch(`envelope ${node.id}`, boardNodeContext(graph, node.id));
    watch('saved document', saved);

    const findings = seen.flatMap((entry) => secretFindings(entry.label, entry.payload));
    expect(findings).toEqual([]);
    expect(JSON.stringify(seen)).not.toContain(SECRET_PROBE);
  });
});

/* ── what the host registers ─────────────────────────────────────────────── */

describe('the tool surface', () => {
  // Read from the workspace root, which is where the suite runs from. A tool
  // the module exports but the manifest does not list is not registered by the
  // host, and the two lists drifting apart is exactly the kind of failure that
  // shows up as "the agent cannot see the Board" months later.
  const manifest = JSON.parse(
    readFileSync('packages/extensions/auracle-pack/manifest.json', 'utf8')
  ) as { contributions: { aiTools: string[] } };

  it('declares exactly the tools the manifest lists', () => {
    expect(boardAiTools.map((row) => row.name).sort()).toEqual(
      [...manifest.contributions.aiTools].sort()
    );
  });

  it('is global and touches no editor, because the Board is not a file', () => {
    for (const row of boardAiTools) {
      expect(row.scope).toBe('global');
      expect(row.access).toEqual({ kind: 'filesystem' });
      expect(row.inputSchema?.type).toBe('object');
    }
  });

  it('offers no field a secret could be passed in, and says so where a key would be typed', () => {
    for (const row of boardAiTools) {
      const properties = row.inputSchema?.properties ?? {};
      const config = properties.config?.properties ?? {};
      expect(secretFindings(`${row.name} schema`, { ...properties, config })).toEqual([]);
      if (config.credential_slot) {
        expect(config.credential_slot.description).toContain('NAME');
      }
    }
  });
});
