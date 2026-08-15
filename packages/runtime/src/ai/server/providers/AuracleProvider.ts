/**
 * Auracle provider: Auracle's built-in OpenAI-compatible chat models
 * (Sextant / Atlas). Cloned from LMStudioProvider — the streaming and tool-call
 * PARSING are kept verbatim. The differences are:
 *   (a) getModels() returns a STATIC two-model list instead of /v1/models discovery;
 *   (b) baseUrl is the OpenAI-compatible base already ending in `/v1`, so the fetch
 *       targets `${baseUrl}/chat/completions` (no extra `/v1`);
 *   (c) an `Authorization: Bearer <apiKey>` header is attached IFF a non-empty
 *       apiKey is configured (cloud run target); local/remote send no auth.
 * The run target (baseUrl / upstream model id / apiKey) is resolved per-model by
 * the host and injected via initialize(config).
 *
 * Phase 2, Slice 1 — AGENTIC TOOL LOOP + INLINE PERMISSION GATING:
 * Instead of the old single-shot tool handling (execute one tool, then finish),
 * sendMessage now runs a BOUNDED agentic loop:
 *   1. call the model (streaming);
 *   2. if it returns tool_calls, append the assistant message, gate EACH call
 *      through ToolPermissionService BEFORE executing, append a `role:'tool'`
 *      result (or a denial notice), and re-invoke the model;
 *   3. terminate when the model returns no more tool calls;
 *   4. a hard iteration cap (MAX_TOOL_ITERATIONS) prevents runaway loops.
 * The shared read-only toolset and the streamContent incremental-streaming path
 * are unchanged; only the control flow around tool execution is new.
 */

import { BaseAIProvider } from '../AIProvider';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  DocumentContext,
  ProviderConfig,
  ProviderCapabilities,
  StreamChunk,
  AIModel,
  ModelIdentifier,
  ToolDefinition,
  getPatternDisplayName
} from '../types';
import { AURACLE_MODELS, AURACLE_DEFAULT_RUN_TARGETS } from '../../modelConstants';
import { buildUserMessageAddition } from './documentContextUtils';
import { BaseAgentProvider } from './BaseAgentProvider';
import { ToolPermissionService } from '../permissions/ToolPermissionService';
import { generateToolPattern, buildToolDescription } from '../permissions/toolPermissionHelpers';
import { hasShellChainingOperators, splitOnShellOperators } from '../permissions/BashCommandAnalyzer';
import { AURACLE_DESTRUCTIVE_TOOLS } from './auracleTools';
import type { PermissionDecision } from './ProviderPermissionMixin';
import { INTERNAL_MCP_TOOLS } from './claudeCode/toolPolicy';
import { AuracleMcpClientHub } from './auracleMcpClient';
import type { McpServerDict, McpClientFactory, McpToolAnnotations } from './auracleMcpClient';

interface AuracleConfig extends ProviderConfig {
  baseUrl?: string;  // OpenAI-compatible base, ends in /v1 (e.g. http://127.0.0.1:11434/v1)
  apiKey?: string;   // Bearer key; attached only when non-empty (cloud run target)
  // Phase 2b: the assembled MCP server dict (internal nimbalyst servers +
  // per-extension board_* + the local engine) the host injects so the in-process
  // MCP hub can connect. Absent → no MCP tools (degrade, don't break).
  mcpServers?: McpServerDict;
}

/** Optional constructor dependencies (used to inject a mock in tests). */
export interface AuracleProviderDeps {
  permissionService?: ToolPermissionService;
  /** Test injection of the MCP server dict (production injects via initialize()). */
  mcpServers?: McpServerDict;
  /** Test seam: build a fake MCP client per server instead of importing the SDK. */
  mcpClientFactory?: McpClientFactory;
}

/**
 * A tool call the model requested that must go through permission + execution
 * in the agent loop (everything except streamContent, which self-executes).
 */
interface PendingToolCall {
  id: string;
  name: string;
  arguments: string; // raw JSON string as streamed by the model
}

/**
 * A tool call already fully handled inline while streaming (streamContent). Its
 * result still has to be fed back to the model if the turn continues.
 */
interface HandledToolCall {
  id: string;
  name: string;
  args: any;
  result: any;
}

/** The distilled outcome of a single model turn (one streamed completion). */
interface AuracleTurnResult {
  content: string;
  pendingToolCalls: PendingToolCall[];
  handledToolCalls: HandledToolCall[];
  usage?: { input_tokens?: number; output_tokens?: number };
  /** True when an in-stream error chunk was already yielded; caller should stop. */
  errored: boolean;
}

export class AuracleProvider extends BaseAIProvider {
  private baseUrl: string = 'http://127.0.0.1:11434/v1';
  private apiKey: string | undefined;
  private abortController: AbortController | null = null;
  private resolvedModel: string | null = null;

  private injectedPermissionService?: ToolPermissionService;
  private permissionServiceCache: ToolPermissionService | null = null;
  private permissionServiceResolved = false;

  // Phase 2b: in-process MCP client hub (see auracleMcpClient). The server dict is
  // injected by the host (initialize) or a test (deps); the hub connects lazily on
  // the first sendMessage and is reused across loop iterations + turns until abort/
  // destroy tears it down.
  private mcpServersDict: McpServerDict | undefined;
  private readonly injectedMcpClientFactory?: McpClientFactory;
  private mcpHub: AuracleMcpClientHub | null = null;
  private mcpHubPromise: Promise<AuracleMcpClientHub | null> | null = null;

  static readonly DEFAULT_MODEL = 'auracle:sextant';

  /**
   * Hard safety cap on model round-trips within a single sendMessage turn.
   * Prevents a tool-calling model from looping forever (and blowing up cost).
   */
  static readonly MAX_TOOL_ITERATIONS = 25;

  /**
   * Tool names treated as DESTRUCTIVE for permission gating. Covers the
   * auracle-scoped tool names (writeFile/editFile/bash) AND the canonical agent
   * names (Write/Edit/MultiEdit/Bash) so the set is correct whether the caller
   * passes the raw or canonicalized name. Destructive tools FAIL CLOSED when no
   * trust infrastructure is available to gate them.
   */
  private static readonly DESTRUCTIVE_TOOL_NAMES = new Set<string>([
    'writeFile', 'editFile', 'bash',
    'Write', 'Edit', 'MultiEdit', 'Bash',
  ]);

  constructor(deps?: AuracleProviderDeps) {
    super();
    this.injectedPermissionService = deps?.permissionService;
    this.mcpServersDict = deps?.mcpServers;
    this.injectedMcpClientFactory = deps?.mcpClientFactory;
  }

  async initialize(config: AuracleConfig): Promise<void> {
    this.config = config;
    // baseUrl already ends in /v1 (the host injects the per-model run target).
    this.baseUrl = (config.baseUrl || 'http://127.0.0.1:11434/v1').replace(/\/$/, '');
    // Attach Bearer only when a non-empty key is present (cloud run target).
    this.apiKey = config.apiKey && config.apiKey.trim() !== '' ? config.apiKey : undefined;
    // The upstream model id is injected by the host (distinct from auracle:<key>).
    this.resolvedModel = config.model || null;

    // Phase 2b: the host assembles the MCP server dict per session and injects it
    // here so the in-process hub can connect on the first sendMessage. A ctor-
    // injected dict (tests) stays as the fallback when config omits it.
    if (config.mcpServers) {
      this.mcpServersDict = config.mcpServers;
    }

    // No network discovery here: the models are a static list and reachability is
    // surfaced by the explicit per-model Test button and by sendMessage's own
    // OpenAI-compatible error streaming. Failing session creation on a cold local
    // server would be worse UX than letting the first message report the error.
  }

  /** Build request headers, attaching Bearer auth only in cloud mode. */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * The toolset auracle OFFERS to the model: the shared read-only tools PLUS the
   * auracle-scoped DESTRUCTIVE tools (writeFile / editFile / bash).
   *
   * CONTAINMENT (Phase 2, Slice 3): the destructive tools are NOT in the shared
   * `toolRegistry`, so `openai` / `lmstudio` — which inherit the base
   * `getRegisteredTools()` (shared registry only) and execute tool calls
   * single-shot with NO permission gate — never see them. Only auracle appends
   * them here, and auracle gates every call through `ToolPermissionService`
   * before executing. This override is the single place where the destructive
   * tools enter the offered set; the OpenAI/Anthropic format getters build on
   * top of it.
   */
  protected getRegisteredTools(): ToolDefinition[] {
    return [...super.getRegisteredTools(), ...AURACLE_DESTRUCTIVE_TOOLS];
  }

  async *sendMessage(
    message: string,
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: any[],
    workspacePath?: string,
    attachments?: any[]
  ): AsyncIterableIterator<StreamChunk> {
    // Build system prompt (no longer includes document context - that's in user message now)
    const systemPrompt = this.buildSystemPrompt(documentContext);

    // Append document context to message using pre-built prompts from DocumentContextService
    const { userMessageAddition, messageWithContext } = buildUserMessageAddition(message, documentContext);
    message = messageWithContext;

    // Emit prompt additions for debugging UI
    const hasAttachments = attachments && attachments.length > 0;
    if (sessionId && (systemPrompt || userMessageAddition || hasAttachments)) {
      // Build attachment summaries (don't include full base64 data, just metadata)
      const attachmentSummaries = attachments?.map(att => ({
        type: att.type,
        filename: att.filename || (att.filepath ? path.basename(att.filepath) : 'unknown'),
        mimeType: att.mimeType,
        filepath: att.filepath
      })) || [];

      this.emit('promptAdditions', {
        sessionId,
        systemPromptAddition: systemPrompt || null,
        userMessageAddition: userMessageAddition,
        attachments: attachmentSummaries,
        timestamp: Date.now()
      });
    }

    // Create abort controller for this request (spans the whole agent loop).
    this.abortController = new AbortController();

    // Build messages array for OpenAI-compatible API
    const apiMessages: any[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Add existing messages if provided
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        // Skip messages with empty content
        if (!msg.content || msg.content.trim() === '') {
          continue;
        }

        // Handle tool/function messages
        if (msg.role === 'tool') {
          // LMStudio expects tool results in a specific format
          apiMessages.push({
            role: 'tool',
            tool_call_id: msg.toolCall?.id || 'tool_' + Date.now(),
            content: msg.content || JSON.stringify(msg.toolCall?.result || {})
          });
        } else {
          // Check if message has attachments (images)
          if (msg.attachments && msg.attachments.length > 0) {
            // Build content array with images and text
            const content: any[] = [];

            // Add images first
            for (const attachment of msg.attachments) {
              if (attachment.type === 'image') {
                try {
                  const fileBuffer = await fs.readFile(attachment.filepath);
                  const base64Data = fileBuffer.toString('base64');

                  content.push({
                    type: 'image_url',
                    image_url: {
                      url: `data:${attachment.mimeType};base64,${base64Data}`
                    }
                  });
                } catch (error) {
                  console.error('[AuracleProvider] Failed to read attachment:', error);
                }
              }
            }

            // Add text content
            content.push({
              type: 'text',
              text: msg.content
            });

            apiMessages.push({
              role: msg.role === 'user' ? 'user' : 'assistant',
              content
            });
          } else {
            // No attachments, use simple text content
            apiMessages.push({
              role: msg.role === 'user' ? 'user' : 'assistant',
              content: msg.content
            });
          }
        }
      }
    }

    // Add the new user message (check for attachments)
    if (!message || message.trim() === '') {
      throw new Error('Cannot send empty message to Auracle');
    }

    // Check if current message has attachments (images)
    if (attachments && attachments.length > 0) {
      const content: any[] = [];

      // Add images first
      for (const attachment of attachments) {
        if (attachment.type === 'image') {
          try {
            const fileBuffer = await fs.readFile(attachment.filepath);
            const base64Data = fileBuffer.toString('base64');

            content.push({
              type: 'image_url',
              image_url: {
                url: `data:${attachment.mimeType};base64,${base64Data}`
              }
            });
          } catch (error) {
            console.error('[AuracleProvider] Failed to read attachment:', error);
          }
        }
      }

      // Add text content
      content.push({
        type: 'text',
        text: message
      });

      apiMessages.push({ role: 'user', content });
    } else {
      // No attachments, use simple text content
      apiMessages.push({ role: 'user', content: message });
    }

    // Log the input message
    // CRITICAL: Must await to ensure user message is persisted before proceeding
    if (sessionId) {
      await this.logAgentMessage(sessionId, 'auracle', 'input', message);
    }

    // Use the centralized tool system (OpenAI-compatible format). Offered once
    // and reused across every loop iteration.
    const tools = this.getToolsInOpenAIFormat();

    // Phase 2b: connect the in-process MCP hub ONCE per session (lazily, here,
    // where sessionId + workspacePath exist) and OFFER its namespaced tools
    // (mcp__<server>__<tool>) alongside the built-ins. These are appended to
    // auracle's OWN offered set only — never the shared registry — so
    // openai/lmstudio are unaffected. Best-effort: a hub that can't connect any
    // server contributes no tools and the chat proceeds normally.
    const mcpHub = await this.ensureMcpHub();
    if (mcpHub) {
      for (const def of mcpHub.listNamespacedToolDefs()) {
        tools.push({
          type: 'function',
          function: {
            name: def.name,
            description: def.description,
            parameters: def.parameters,
          },
        });
      }
    }

    // Path used for trust checks / pattern persistence (worktrees resolve to parent).
    const permissionsPath = documentContext?.permissionsPath || workspacePath;

    // Cumulative usage across every model round-trip in this turn (reported once
    // on the final `complete` chunk to avoid double-counting).
    let cumulativeInput = 0;
    let cumulativeOutput = 0;
    let sawUsage = false;

    const buildUsage = () => (sawUsage
      ? {
          usage: {
            input_tokens: cumulativeInput,
            output_tokens: cumulativeOutput,
            total_tokens: cumulativeInput + cumulativeOutput
          }
        }
      : {});

    try {
      for (let iteration = 1; iteration <= AuracleProvider.MAX_TOOL_ITERATIONS; iteration++) {
        // --- Call the model (streaming). Text + streamContent editor-streaming
        //     are yielded live; the parsed turn summary is the return value. ---
        const turn = yield* this.streamModelTurn(apiMessages, tools, sessionId);

        if (turn.usage) {
          sawUsage = true;
          cumulativeInput += turn.usage.input_tokens || 0;
          cumulativeOutput += turn.usage.output_tokens || 0;
        }

        // Log this turn's assistant narration (tool blocks are logged separately).
        if (sessionId && turn.content) {
          await this.logAgentMessage(sessionId, 'auracle', 'output', turn.content);
        }

        // An in-stream error already surfaced to the UI — stop.
        if (turn.errored) {
          return;
        }

        // Terminal: the model produced no tool calls that require execution.
        // (streamContent, if any, self-executed during streaming.)
        if (turn.pendingToolCalls.length === 0) {
          yield {
            type: 'complete',
            content: turn.content,
            isComplete: true,
            ...buildUsage()
          };
          return;
        }

        // The model wants to run tools. Append the assistant message carrying ALL
        // tool_calls from this turn so the follow-up tool results are valid
        // OpenAI-format (each tool_call id must be answered by a tool message).
        const assistantToolCalls = [
          ...turn.handledToolCalls.map(h => ({
            id: h.id,
            type: 'function',
            function: { name: h.name, arguments: JSON.stringify(h.args ?? {}) }
          })),
          ...turn.pendingToolCalls.map(p => ({
            id: p.id,
            type: 'function',
            function: { name: p.name, arguments: p.arguments }
          }))
        ];
        apiMessages.push({
          role: 'assistant',
          content: turn.content || null,
          tool_calls: assistantToolCalls
        });

        // Feed back results for tool calls already handled inline (streamContent).
        for (const handled of turn.handledToolCalls) {
          apiMessages.push({
            role: 'tool',
            tool_call_id: handled.id,
            content: this.stringifyToolResult(handled.result)
          });
        }

        // Gate + execute each pending tool call, then feed the result back.
        for (const pending of turn.pendingToolCalls) {
          let args: any = {};
          try {
            args = JSON.parse(pending.arguments);
          } catch {
            args = {};
          }

          // --- PERMISSION BEFORE EXECUTION. ---
          const decision = await this.requestToolPermissionForCall(
            pending.name,
            args,
            sessionId,
            workspacePath,
            permissionsPath,
            this.abortController.signal
          );

          if (decision.decision !== 'allow') {
            // DENIED: do not execute. Feed a denial notice back so the model can
            // react (apologize, try another approach, or finish).
            const denialNotice = `Tool call "${pending.name}" was denied by the user and was not executed.`;
            apiMessages.push({
              role: 'tool',
              tool_call_id: pending.id,
              content: denialNotice
            });
            const deniedResult = { success: false, denied: true, error: denialNotice };
            this.logToolBlocks(sessionId, pending.id, pending.name, args, deniedResult, true);
            yield {
              type: 'tool_call',
              toolCall: {
                id: pending.id,
                name: pending.name,
                arguments: args,
                result: deniedResult
              }
            };
            continue;
          }

          // ALLOWED: execute via the shared, provider-agnostic dispatcher.
          let executionResult: any | undefined;
          let executionError: string | undefined;
          try {
            const toolStartTime = Date.now();
            if (pending.name.startsWith('mcp__')) {
              // Phase 2b: MCP tool calls dispatch to the in-process hub (which
              // resolves the namespaced name to {server, tool}), NOT the built-in
              // executor. A missing hub here means the model asked for a tool that
              // wasn't offered — surface it as a normal tool error.
              if (!mcpHub) {
                throw new Error(`MCP tool "${pending.name}" requested but no MCP hub is connected`);
              }
              executionResult = await mcpHub.callTool(pending.name, args);
            } else {
              executionResult = await this.executeToolCall(pending.name, args);
            }
            console.log(`[Auracle] ${pending.name} execution completed in ${Date.now() - toolStartTime}ms`);
          } catch (error) {
            executionError = error instanceof Error ? error.message : 'Tool execution failed';
            const errorResult = (error as any)?.toolResult ?? { success: false, error: executionError };
            executionResult = errorResult;
            console.error(`[Auracle] ${pending.name} execution failed:`, error);
            yield {
              type: 'tool_error',
              toolError: {
                name: pending.name,
                arguments: args,
                error: executionError,
                result: errorResult
              }
            };
          }

          apiMessages.push({
            role: 'tool',
            tool_call_id: pending.id,
            content: this.stringifyToolResult(executionResult ?? 'Tool executed')
          });
          this.logToolBlocks(sessionId, pending.id, pending.name, args, executionResult, executionError !== undefined);
          yield {
            type: 'tool_call',
            toolCall: {
              id: pending.id,
              name: pending.name,
              arguments: args,
              ...(executionResult !== undefined ? { result: executionResult } : {})
            }
          };
        }

        // Loop: re-invoke the model with the appended tool results.
      }

      // --- HARD SAFETY CAP reached: stop gracefully. ---
      const capNotice = `Auracle stopped after reaching the maximum of ${AuracleProvider.MAX_TOOL_ITERATIONS} tool iterations.`;
      yield { type: 'text', content: `\n\n[${capNotice}]` };
      if (sessionId) {
        await this.logAgentMessage(sessionId, 'auracle', 'output', capNotice);
      }
      yield {
        type: 'complete',
        content: capNotice,
        isComplete: true,
        ...buildUsage()
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Request was aborted');
        yield {
          type: 'complete',
          isComplete: true
        };
      } else {
        console.error('[Auracle] error:', error);

        // Log error to database
        this.logError(sessionId, 'auracle', error, 'catch_block');

        yield {
          type: 'error',
          error: error.message
        };
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Stream ONE model completion. Yields `text` chunks and the streamContent
   * editor-streaming chunks live (exactly as the pre-loop provider did), and
   * RETURNS the distilled turn summary (assistant text, tool calls to run,
   * streamContent calls already handled, usage). It never yields `complete`;
   * the caller (sendMessage) owns loop control and completion.
   *
   * Network/HTTP failures throw (caught by sendMessage's try/catch). In-stream
   * OpenAI-format errors are yielded as an `error` chunk and returned as
   * `errored: true`.
   */
  private async *streamModelTurn(
    apiMessages: any[],
    tools: any[],
    sessionId?: string
  ): AsyncGenerator<StreamChunk, AuracleTurnResult, void> {
    const requestBody: any = {
      model: this.resolvedModel || this.config.model || AURACLE_DEFAULT_RUN_TARGETS.sextant.model,
      messages: apiMessages,
      max_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature || 0.7,
      tools: tools,
      tool_choice: 'auto',  // Let the model decide when to use tools
      stream: true,
      // Request usage data in streaming response (OpenAI-compatible extension)
      stream_options: { include_usage: true }
    };

    // Apply response format if specified (extension chat completions).
    if (this.config.responseFormat && this.config.responseFormat.type !== 'text') {
      if (this.config.responseFormat.type === 'json_object') {
        requestBody.response_format = { type: 'json_object' };
      } else if (this.config.responseFormat.type === 'json_schema' && this.config.responseFormat.schema) {
        requestBody.response_format = {
          type: 'json_schema',
          json_schema: {
            name: this.config.responseFormat.name || 'response',
            schema: this.config.responseFormat.schema,
            strict: this.config.responseFormat.strict ?? true,
          },
        };
      }
    }

    // Make streaming request to the OpenAI-compatible endpoint with tools.
    // baseUrl already ends in /v1, so append /chat/completions directly.
    // buildHeaders() attaches the Bearer key only in cloud mode.
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(requestBody),
      signal: this.abortController?.signal
    });

    if (!response.ok) {
      throw new Error(`Auracle endpoint returned ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body from Auracle endpoint');
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    let currentToolCall: any = null;
    let toolCallBuffer = '';
    let isStreamingContent = false;
    let streamContentBuffer = '';
    let streamConfig: any = null;
    let usageData: { input_tokens?: number; output_tokens?: number } | undefined;
    const pendingToolCalls: PendingToolCall[] = [];
    const handledToolCalls: HandledToolCall[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === '') continue;
        if (line.trim() === 'data: [DONE]') {
          // The turn is complete; hand control back to the loop.
          return { content: fullContent, pendingToolCalls, handledToolCalls, usage: usageData, errored: false };
        }

        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.slice(6));

            // Check for error in the response (LMStudio/OpenAI format)
            if (json.error) {
              const errorMessage = json.error.message || json.error.type || JSON.stringify(json.error);
              console.error('[Auracle] Error in streaming response:', errorMessage);

              // Log error to database
              this.logError(sessionId, 'auracle', new Error(errorMessage), 'streaming_response');

              yield {
                type: 'error',
                error: errorMessage
              };
              return { content: fullContent, pendingToolCalls, handledToolCalls, usage: usageData, errored: true };
            }

            const delta = json.choices?.[0]?.delta;

            // Capture usage data if provided (OpenAI stream_options.include_usage)
            if (json.usage) {
              usageData = {
                input_tokens: json.usage.prompt_tokens,
                output_tokens: json.usage.completion_tokens
              };
            }

            // Handle text content
            if (delta?.content) {
              fullContent += delta.content;
              yield {
                type: 'text',
                content: delta.content
              };
            }

            // Handle tool calls (OpenAI format)
            if (delta?.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                if (toolCall.id) {
                  // New tool call starting
                  currentToolCall = {
                    id: toolCall.id,
                    type: toolCall.type,
                    function: {
                      name: toolCall.function?.name || '',
                      arguments: ''
                    }
                  };
                  toolCallBuffer = '';
                }

                if (toolCall.function?.arguments) {
                  // Accumulate function arguments
                  const chunk = toolCall.function.arguments;
                  toolCallBuffer += chunk;

                  // Special handling for streamContent to enable true streaming
                  if (currentToolCall?.function?.name === 'streamContent') {
                    if (!isStreamingContent) {
                      // Check if we have enough info to start streaming
                      const positionMatch = toolCallBuffer.match(/"position"\s*:\s*"([^"]+)"/);
                      const insertAfterMatch = toolCallBuffer.match(/"insertAfter"\s*:\s*"([^"]+)"/);

                      // Start streaming as soon as we see the content field starting
                      if (toolCallBuffer.includes('"content"')) {
                        // Default to cursor if position not found yet
                        const position = positionMatch ? positionMatch[1] : 'cursor';

                        isStreamingContent = true;
                        streamConfig = {
                          position: position,
                          insertAfter: insertAfterMatch ? insertAfterMatch[1] : undefined,
                          insertAtEnd: position === 'end',
                          mode: 'after'
                        };

                        yield {
                          type: 'stream_edit_start',
                          config: streamConfig
                        };

                        // Initialize stream content buffer to track what we've sent
                        streamContentBuffer = '';
                      }
                    }
                  }

                  // If we're streaming content, extract and stream it incrementally
                  if (isStreamingContent && currentToolCall?.function?.name === 'streamContent') {
                    // Extract content from the accumulated buffer
                    // Look for the content field in the JSON
                    const contentMatch = toolCallBuffer.match(/"content"\s*:\s*"/);

                    if (contentMatch && contentMatch.index !== undefined) {
                      // Find where content value starts (after the matched pattern)
                      const contentStartIndex = contentMatch.index + contentMatch[0].length;

                      // Find potential end of content (look for ", but handle escaped quotes)
                      let contentEndIndex = -1;
                      let escaped = false;
                      for (let i = contentStartIndex; i < toolCallBuffer.length; i++) {
                        if (toolCallBuffer[i] === '\\' && !escaped) {
                          escaped = true;
                          continue;
                        }
                        if (toolCallBuffer[i] === '"' && !escaped) {
                          contentEndIndex = i;
                          break;
                        }
                        escaped = false;
                      }

                      if (contentEndIndex > 0) {
                        // We have complete content
                        const rawContent = toolCallBuffer.substring(contentStartIndex, contentEndIndex);

                        // Only send new content that hasn't been streamed yet
                        if (rawContent.length > streamContentBuffer.length) {
                          const newContent = rawContent.substring(streamContentBuffer.length);

                          // Unescape the JSON string content
                          const unescaped = newContent
                            .replace(/\\n/g, '\n')
                            .replace(/\\r/g, '\r')
                            .replace(/\\t/g, '\t')
                            .replace(/\\"/g, '"')
                            .replace(/\\\\/g, '\\');

                          if (unescaped.length > 0) {
                            yield {
                              type: 'stream_edit_content',
                              content: unescaped
                            };
                          }

                          streamContentBuffer = rawContent;
                        }

                        // End streaming since content is complete
                        yield {
                          type: 'stream_edit_end'
                        };

                        // Log streamContent tool call to database
                        const toolId = currentToolCall?.id || `tool-${Date.now()}`;

                        // Parse full args for logging / feedback
                        let fullArgs: any = {};
                        try {
                          fullArgs = JSON.parse(toolCallBuffer);
                        } catch (e) {
                          fullArgs = { content: rawContent, position: streamConfig?.position || 'cursor' };
                        }

                        if (sessionId) {
                          // Log the tool_use block
                          this.logAgentMessage(sessionId, 'auracle', 'output', JSON.stringify({
                            type: 'assistant',
                            message: {
                              content: [{
                                type: 'tool_use',
                                id: toolId,
                                name: 'streamContent',
                                input: fullArgs
                              }]
                            }
                          }));

                          // Log the tool_result block
                          this.logAgentMessage(sessionId, 'auracle', 'output', JSON.stringify({
                            type: 'assistant',
                            message: {
                              content: [{
                                type: 'tool_result',
                                tool_use_id: toolId,
                                content: JSON.stringify({ success: true, message: 'Content streamed to editor' }),
                                is_error: false
                              }]
                            }
                          }));
                        }

                        // Yield tool_call event so AIService can track it
                        yield {
                          type: 'tool_call',
                          toolCall: {
                            id: toolId,
                            name: 'streamContent',
                            arguments: { content: rawContent, position: streamConfig?.position || 'cursor' },
                            result: { success: true, output: 'Content streamed to editor' }
                          }
                        };

                        // Record it so the agent loop can feed the result back to
                        // the model if the turn continues with other tool calls.
                        handledToolCalls.push({
                          id: toolId,
                          name: 'streamContent',
                          args: fullArgs,
                          result: { success: true, output: 'Content streamed to editor' }
                        });

                        isStreamingContent = false;
                        streamContentBuffer = '';
                        streamConfig = null;
                        currentToolCall = null;
                        toolCallBuffer = '';
                      } else {
                        // Content not complete yet, but we can stream what we have so far
                        const partialContent = toolCallBuffer.substring(contentStartIndex);

                        // Only send new content
                        if (partialContent.length > streamContentBuffer.length) {
                          const newContent = partialContent.substring(streamContentBuffer.length);

                          // Don't send incomplete escape sequences
                          let safeEndIndex = newContent.length;

                          // Check for incomplete escape sequence at the end
                          if (newContent.endsWith('\\')) {
                            // Don't include the trailing backslash as it might be part of an escape
                            safeEndIndex = newContent.length - 1;
                          }

                          if (safeEndIndex > 0) {
                            const safeContent = newContent.substring(0, safeEndIndex);

                            // Unescape the JSON string content
                            const unescaped = safeContent
                              .replace(/\\n/g, '\n')
                              .replace(/\\r/g, '\r')
                              .replace(/\\t/g, '\t')
                              .replace(/\\"/g, '"')
                              .replace(/\\\\/g, '\\');

                            if (unescaped.length > 0) {
                              yield {
                                type: 'stream_edit_content',
                                content: unescaped
                              };
                            }

                            streamContentBuffer = partialContent.substring(0, streamContentBuffer.length + safeEndIndex);
                          }
                        }
                      }
                    }
                  } else if (!isStreamingContent) {
                    // Not streaming — probe whether the accumulated arguments now
                    // form valid JSON. When they do, the tool call is fully
                    // assembled: RECORD it for the agent loop instead of executing
                    // inline. Permission + execution + result feedback happen in
                    // sendMessage AFTER this turn's stream completes.
                    try {
                      JSON.parse(toolCallBuffer); // validity probe only
                      const toolId = currentToolCall.id || `tool-${Date.now()}-${pendingToolCalls.length}`;
                      pendingToolCalls.push({
                        id: toolId,
                        name: currentToolCall.function.name,
                        arguments: toolCallBuffer
                      });

                      // Reset for next tool call
                      currentToolCall = null;
                      toolCallBuffer = '';
                    } catch (e) {
                      // Arguments not complete yet, continue accumulating
                    }
                  }
                }
              }
            }

            // Note: completion is decided by the caller once this turn returns.
          } catch (error) {
            console.error('Error parsing SSE data from Auracle endpoint:', error, 'Line:', line);
          }
        }
      }
    }

    // Handle any remaining buffer (stream ended without an explicit [DONE]).
    if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
      if (buffer.startsWith('data: ')) {
        try {
          const json = JSON.parse(buffer.slice(6));
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            yield {
              type: 'text',
              content: delta.content
            };
          }
        } catch (error) {
          console.error('Error parsing final SSE data:', error);
        }
      }
    }

    return { content: fullContent, pendingToolCalls, handledToolCalls, usage: usageData, errored: false };
  }

  /**
   * Gate a single tool call through the shared ToolPermissionService, mirroring
   * the ClaudeCode/Codex integration (see claudeCode/toolAuthorization.ts).
   *
   * FAIL-CLOSED (Phase 2, Slice 3): when no permission infrastructure is
   * available (no service AND/OR no session/workspace to key a request on),
   * DESTRUCTIVE tools (writeFile/editFile/bash) are DENIED — they must never run
   * ungated. Only READ-ONLY tools keep the permissive fallback, for minimal
   * non-Electron embeddings that ship just the safe read-only toolset. In the
   * desktop app the trust infra is always wired, so every call is really gated.
   * A thrown request (timeout/abort/infra failure) also fails CLOSED (deny).
   *
   * BASH COMPOUND SAFETY: a chained command (`a && b; c`) is split via
   * BashCommandAnalyzer and EACH sub-command is gated separately — approving
   * `git add` must not smuggle a chained `rm -rf`. This mirrors
   * AgentToolHooks.handleCompoundBashCommand for the SDK agents.
   */
  private async requestToolPermissionForCall(
    toolName: string,
    toolInput: any,
    sessionId: string | undefined,
    workspacePath: string | undefined,
    permissionsPath: string | undefined,
    signal: AbortSignal
  ): Promise<PermissionDecision> {
    const service = this.getPermissionService();

    // --- MCP tools (Phase 2b): classify via list-time annotations + policy. This
    //     is SAFER than the CLI default (which auto-approves every mcp__* in auto
    //     mode): auracle auto-allows ONLY provably read-only / internal tools, and
    //     fails CLOSED for mutating tools when no gate infra is present. ---
    if (toolName.startsWith('mcp__')) {
      const annotations = this.mcpHub?.getToolAnnotations(toolName);
      const classification = this.classifyMcpTool(toolName, annotations);

      // Auto-allow: internal read-only + readOnlyHint. No prompt, even w/o infra.
      if (classification === 'auto-allow') {
        return { decision: 'allow', scope: 'once' };
      }

      const mcpDestructive = classification === 'destructive';

      if (!service || !sessionId || !workspacePath) {
        // No trust infra: ONLY the auto-allow set may run (handled above). Every
        // other MCP tool — unknown OR mutating — is DENIED. Never silent-allow.
        return { decision: 'deny', scope: 'once' };
      }

      // The namespaced `mcp__server__tool` name IS the canonical form the
      // permission helpers (generateToolPattern/buildToolDescription) key on.
      return this.gateSingleToolCall(
        service, toolName, toolInput, sessionId, workspacePath, permissionsPath, mcpDestructive, signal
      );
    }

    const isDestructive = AuracleProvider.DESTRUCTIVE_TOOL_NAMES.has(toolName);

    if (!service || !sessionId || !workspacePath) {
      // No trust infra to gate on: deny destructive tools, allow read-only.
      return isDestructive
        ? { decision: 'deny', scope: 'once' }
        : { decision: 'allow', scope: 'once' };
    }

    const canonicalName = this.canonicalizeToolName(toolName);

    // Compound bash: gate each sub-command; deny the whole call if any is denied.
    if (canonicalName === 'Bash') {
      const command = typeof toolInput?.command === 'string' ? toolInput.command : '';
      if (command && hasShellChainingOperators(command)) {
        const subCommands = splitOnShellOperators(command);
        for (const sub of subCommands) {
          const decision = await this.gateSingleToolCall(
            service, 'Bash', { command: sub }, sessionId, workspacePath, permissionsPath, true, signal
          );
          if (decision.decision !== 'allow') {
            return decision;
          }
        }
        return { decision: 'allow', scope: 'once' };
      }
    }

    return this.gateSingleToolCall(
      service, canonicalName, toolInput, sessionId, workspacePath, permissionsPath, isDestructive, signal
    );
  }

  /**
   * Map an auracle tool name to the canonical name the permission helpers key on
   * (pattern generation, compound-bash detection, widget display). Execution
   * still uses the ORIGINAL name — only permission metadata is canonicalized.
   */
  private canonicalizeToolName(name: string): string {
    switch (name) {
      case 'writeFile': return 'Write';
      case 'editFile': return 'Edit';
      case 'bash': return 'Bash';
      default: return name;
    }
  }

  /**
   * Classify an `mcp__server__tool` call for gating (Phase 2b). SAFER than the
   * CLI's blanket auto-approve:
   *  - `auto-allow` (no prompt): tools in the internal read-only allow set
   *    (INTERNAL_MCP_TOOLS) OR any tool the server marks `readOnlyHint === true`.
   *  - `destructive` (isDestructive:true → fails CLOSED with no gate infra): tools
   *    the server marks `destructiveHint === true`, OR known state-mutating
   *    engine/board names (run_backtest / ingest / delete / save / write, and
   *    board_* writes).
   *  - `prompt` (gate, isDestructive:false): everything else — we can't establish
   *    it's read-only, but it isn't provably mutating either.
   */
  private classifyMcpTool(
    namespaced: string,
    annotations?: McpToolAnnotations
  ): 'auto-allow' | 'destructive' | 'prompt' {
    if (INTERNAL_MCP_TOOLS.includes(namespaced)) return 'auto-allow';
    if (annotations?.readOnlyHint === true) return 'auto-allow';
    if (annotations?.destructiveHint === true) return 'destructive';
    if (this.isKnownMutatingMcpTool(namespaced)) return 'destructive';
    return 'prompt';
  }

  /**
   * Name-based fallback for tools with no `destructiveHint`: treat known
   * state-mutating engine/board tools as destructive so they FAIL CLOSED. Operates
   * on the bare tool segment (internal/engine server names carry no `__`).
   */
  private isKnownMutatingMcpTool(namespaced: string): boolean {
    const bare = namespaced.toLowerCase().split('__').slice(2).join('__');
    const MUTATING = ['run_backtest', 'ingest', 'delete', 'save', 'write'];
    if (MUTATING.some((verb) => bare.includes(verb))) return true;
    // board_* writes (create / update / move / add / remove / set / rename / archive).
    if (bare.startsWith('board_') && /(create|update|delete|move|add|remove|set|rename|archive|save|write)/.test(bare)) {
      return true;
    }
    return false;
  }

  /**
   * Lazily build + connect the in-process MCP hub, ONCE per provider (session).
   * Reused across loop iterations and turns. Returns null when no server dict was
   * injected or the SDK/servers can't connect. NEVER throws — a hub failure must
   * not break the chat (the built-in tools keep working).
   */
  private async ensureMcpHub(): Promise<AuracleMcpClientHub | null> {
    const servers = this.mcpServersDict;
    if (!servers || Object.keys(servers).length === 0) {
      return null;
    }
    if (this.mcpHub) return this.mcpHub;
    if (this.mcpHubPromise) return this.mcpHubPromise;

    this.mcpHubPromise = (async () => {
      const hub = new AuracleMcpClientHub(servers, {
        clientFactory: this.injectedMcpClientFactory,
      });
      // connectAll swallows per-server failures; this guards the unexpected so a
      // hub build never rejects into sendMessage.
      await hub.connectAll().catch(() => undefined);
      this.mcpHub = hub;
      return hub;
    })();

    try {
      return await this.mcpHubPromise;
    } catch {
      this.mcpHubPromise = null;
      return null;
    }
  }

  /**
   * Close the MCP hub and clear its cache. Best-effort and safe to call
   * repeatedly. Called from abort()/destroy() so no client connections leak; the
   * next sendMessage rebuilds + reconnects the hub.
   */
  private teardownMcpHub(): void {
    const hub = this.mcpHub;
    this.mcpHub = null;
    this.mcpHubPromise = null;
    if (hub) {
      void hub.closeAll().catch(() => undefined);
    }
  }

  /**
   * Gate ONE (already-canonical) tool call through the shared service. A thrown
   * request (timeout/abort/infra failure) fails CLOSED (deny).
   */
  private async gateSingleToolCall(
    service: ToolPermissionService,
    canonicalName: string,
    toolInput: any,
    sessionId: string,
    workspacePath: string,
    permissionsPath: string | undefined,
    isDestructive: boolean,
    signal: AbortSignal
  ): Promise<PermissionDecision> {
    const requestId = `tool-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pattern = generateToolPattern(canonicalName, toolInput);
    // buildToolDescription keys file tools on `file_path`; auracle's tools use
    // `path`, so surface it under both for a readable widget description.
    const descInput = (canonicalName === 'Write' || canonicalName === 'Edit')
      ? { ...toolInput, file_path: toolInput?.file_path ?? toolInput?.path }
      : toolInput;
    const toolDescription = buildToolDescription(canonicalName, descInput);
    const patternDisplayName = getPatternDisplayName(pattern);

    try {
      return await service.requestToolPermission({
        requestId,
        sessionId,
        workspacePath,
        permissionsPath: permissionsPath || workspacePath,
        toolName: canonicalName,
        toolInput,
        pattern,
        patternDisplayName,
        toolDescription,
        isDestructive,
        warnings: [],
        signal,
      });
    } catch (error) {
      // Timeout / abort / infra failure → fail closed.
      return { decision: 'deny', scope: 'once' };
    }
  }

  /**
   * Resolve (or build) the ToolPermissionService for this provider.
   * - An injected service (tests) always wins.
   * - Otherwise build one lazily from the SAME dependencies the agent providers
   *   wire at app startup (BaseAgentProvider.getSharedPermissionDeps), so the
   *   Auracle chat provider gets identical trust semantics with no extra wiring.
   * - When no infra is wired, returns null (caller treats that as "no gating").
   */
  private getPermissionService(): ToolPermissionService | null {
    if (this.injectedPermissionService) {
      return this.injectedPermissionService;
    }
    if (this.permissionServiceResolved) {
      return this.permissionServiceCache;
    }
    this.permissionServiceResolved = true;

    const deps = BaseAgentProvider.getSharedPermissionDeps();
    if (deps.trustChecker && deps.permissionPatternSaver && deps.permissionPatternChecker) {
      this.permissionServiceCache = new ToolPermissionService({
        trustChecker: deps.trustChecker,
        patternSaver: deps.permissionPatternSaver,
        patternChecker: deps.permissionPatternChecker,
        securityLogger: deps.securityLogger ?? undefined,
        // Wrap the provider's own emitter: when the service decides a prompt is
        // needed it fires `toolPermission:pending`. The ToolPermissionWidget does
        // NOT render from that event (it only drives the "waiting for input"
        // indicator) — it renders from a `nimbalyst_tool_use`/`ToolPermission`
        // agent message projected into the canonical transcript. The service
        // never logs that message, so we log it here, hooking the pending event
        // (which fires only AFTER the trust / session-cache / persisted-pattern
        // pre-checks decide a prompt is genuinely required). Logging on every
        // request instead would strand a never-resolving widget for
        // auto-approved tools. Mirrors claudeCode/toolAuthorization.ts +
        // AgentToolHooks, the claude-code / codex widget path.
        emit: (event: string, data: unknown) => {
          if (event === 'toolPermission:pending') {
            this.logToolPermissionWidget(data);
          }
          this.emit(event, data as any);
        },
      });
    } else {
      this.permissionServiceCache = null;
    }
    return this.permissionServiceCache;
  }

  /**
   * Log the synthetic `nimbalyst_tool_use`/`ToolPermission` agent message that the
   * canonical transcript projects into a ToolPermissionWidget (via
   * SessionManager.transformAgentMessagesToUI + the ClaudeCodeRawParser fallback,
   * then the `ToolPermission` CustomToolWidget). Built from the
   * `toolPermission:pending` payload emitted by ToolPermissionService so it fires
   * exactly once per genuine prompt. Fire-and-forget, mirroring logToolBlocks.
   */
  private logToolPermissionWidget(data: unknown): void {
    const payload = data as {
      requestId?: string;
      sessionId?: string;
      workspacePath?: string;
      request?: {
        toolName?: string;
        rawCommand?: string;
        hasDestructiveActions?: boolean;
        actionsNeedingApproval?: Array<{ action?: { pattern?: string }; warnings?: string[] }>;
      };
    };
    const sessionId = payload?.sessionId;
    const request = payload?.request;
    if (!sessionId || !request || !payload.requestId) {
      return;
    }
    const firstAction = request.actionsNeedingApproval?.[0];
    const pattern = firstAction?.action?.pattern || request.toolName || '';
    this.logAgentMessage(
      sessionId,
      'auracle',
      'output',
      JSON.stringify({
        type: 'nimbalyst_tool_use',
        id: payload.requestId,
        name: 'ToolPermission',
        input: {
          requestId: payload.requestId,
          toolName: request.toolName,
          rawCommand: request.rawCommand ?? '',
          pattern,
          patternDisplayName: getPatternDisplayName(pattern),
          isDestructive: !!request.hasDestructiveActions,
          warnings: firstAction?.warnings ?? [],
          workspacePath: payload.workspacePath ?? '',
        },
      })
    );
  }

  /**
   * Resolve a pending tool permission with the user's decision. Called by
   * AIService over IPC (duck-typed) when the desktop/mobile UI responds.
   */
  resolveToolPermission(
    requestId: string,
    response: PermissionDecision,
    _sessionId?: string,
    _respondedBy: 'desktop' | 'mobile' = 'desktop'
  ): void {
    this.getPermissionService()?.resolvePermission(requestId, response);
  }

  /** Serialize a tool result for a `role:'tool'` message / DB block. */
  private stringifyToolResult(result: any): string {
    if (result === undefined || result === null) {
      return 'Tool executed';
    }
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  /**
   * Log the tool_use + tool_result blocks for a single tool call in the format
   * the transcript UI can reconstruct (mirrors the pre-loop provider and
   * OpenAIProvider). Fire-and-forget, guarded on sessionId.
   */
  private logToolBlocks(
    sessionId: string | undefined,
    toolId: string,
    toolName: string,
    input: any,
    result: any,
    isError: boolean
  ): void {
    if (!sessionId) return;

    // tool_use block
    this.logAgentMessage(sessionId, 'auracle', 'output', JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: toolId,
          name: toolName,
          input
        }]
      }
    }));

    // tool_result block
    const resultContent = result !== undefined
      ? (typeof result === 'string' ? result : JSON.stringify(result))
      : 'Tool executed';
    this.logAgentMessage(sessionId, 'auracle', 'output', JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: toolId,
          content: resultContent,
          is_error: isError
        }]
      }
    }));
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    // Release any tool-permission request blocked awaiting a user response.
    const service = this.getPermissionService();
    if (service && typeof service.rejectAllPending === 'function') {
      service.rejectAllPending();
    }
    // Phase 2b: tear down the in-process MCP hub so no client connections leak.
    // The next sendMessage rebuilds + reconnects it.
    this.teardownMcpHub();
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      tools: true,  // LMStudio supports native OpenAI-style function calling
      mcpSupport: true,  // Phase 2b: in-process MCP client hub (auracleMcpClient)
      edits: true,  // Enable edits through native tool support
      resumeSession: false,
      // Phase 2, Slice 3: auracle now READS and WRITES files via its own gated
      // tools (readFile/searchFiles/listFiles + writeFile/editFile/bash), so it
      // is file-tool-capable. This also stops the host from auto-inlining
      // @-mentioned file contents (attachMentionedFiles) — the model fetches
      // them with tools instead.
      supportsFileTools: true
    };
  }

  destroy(): void {
    this.abort();
  }

  protected buildSystemPrompt(documentContext?: DocumentContext): string {
    // The base prompt now includes all tool usage instructions
    return super.buildSystemPrompt(documentContext);
  }

  /**
   * Auracle exposes a STATIC list of its two built-in models (Sextant, Atlas).
   * Unlike LM Studio there is no /v1/models discovery — the models always appear
   * in the picker regardless of whether any run target is currently reachable.
   * The `baseUrl` param is accepted for signature parity with the registry but
   * is unused.
   */
  static async getModels(_baseUrl?: string): Promise<AIModel[]> {
    return this.getDefaultModels();
  }

  /**
   * Get default models — the static Sextant/Atlas list.
   */
  static getDefaultModels(): AIModel[] {
    return AURACLE_MODELS.map((model) => ({
      id: ModelIdentifier.create('auracle', model.id).combined,
      name: model.displayName,
      provider: 'auracle' as const,
      maxTokens: model.maxTokens,
      contextWindow: model.contextWindow
    }));
  }

  /**
   * Get default model
   */
  static getDefaultModel(): string {
    return this.DEFAULT_MODEL;
  }
}
