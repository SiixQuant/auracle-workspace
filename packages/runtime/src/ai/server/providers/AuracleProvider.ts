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
  getPatternDisplayName
} from '../types';
import { AURACLE_MODELS, AURACLE_DEFAULT_RUN_TARGETS } from '../../modelConstants';
import { buildUserMessageAddition } from './documentContextUtils';
import { BaseAgentProvider } from './BaseAgentProvider';
import { ToolPermissionService } from '../permissions/ToolPermissionService';
import { generateToolPattern, buildToolDescription } from '../permissions/toolPermissionHelpers';
import type { PermissionDecision } from './ProviderPermissionMixin';

interface AuracleConfig extends ProviderConfig {
  baseUrl?: string;  // OpenAI-compatible base, ends in /v1 (e.g. http://127.0.0.1:11434/v1)
  apiKey?: string;   // Bearer key; attached only when non-empty (cloud run target)
}

/** Optional constructor dependencies (used to inject a mock in tests). */
export interface AuracleProviderDeps {
  permissionService?: ToolPermissionService;
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

  static readonly DEFAULT_MODEL = 'auracle:sextant';

  /**
   * Hard safety cap on model round-trips within a single sendMessage turn.
   * Prevents a tool-calling model from looping forever (and blowing up cost).
   */
  static readonly MAX_TOOL_ITERATIONS = 25;

  constructor(deps?: AuracleProviderDeps) {
    super();
    this.injectedPermissionService = deps?.permissionService;
  }

  async initialize(config: AuracleConfig): Promise<void> {
    this.config = config;
    // baseUrl already ends in /v1 (the host injects the per-model run target).
    this.baseUrl = (config.baseUrl || 'http://127.0.0.1:11434/v1').replace(/\/$/, '');
    // Attach Bearer only when a non-empty key is present (cloud run target).
    this.apiKey = config.apiKey && config.apiKey.trim() !== '' ? config.apiKey : undefined;
    // The upstream model id is injected by the host (distinct from auracle:<key>).
    this.resolvedModel = config.model || null;

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
            executionResult = await this.executeToolCall(pending.name, args);
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
   * Falls back to allow ONLY when no permission infrastructure is available
   * (no service AND no session/workspace to key a request on) — e.g. a minimal
   * non-Electron embedding running the safe read-only toolset. In the desktop
   * app the trust infra is always wired, so every call is really gated.
   * A thrown request (timeout/abort) fails CLOSED (deny).
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
    if (!service || !sessionId || !workspacePath) {
      return { decision: 'allow', scope: 'once' };
    }

    const requestId = `tool-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pattern = generateToolPattern(toolName, toolInput);
    const toolDescription = buildToolDescription(toolName, toolInput);
    const isDestructive = ['Write', 'Edit', 'MultiEdit', 'Bash'].includes(toolName);
    const patternDisplayName = getPatternDisplayName(pattern);

    try {
      return await service.requestToolPermission({
        requestId,
        sessionId,
        workspacePath,
        permissionsPath: permissionsPath || workspacePath,
        toolName,
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
        emit: this.emit.bind(this),
      });
    } else {
      this.permissionServiceCache = null;
    }
    return this.permissionServiceCache;
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
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      tools: true,  // LMStudio supports native OpenAI-style function calling
      mcpSupport: false,
      edits: true,  // Enable edits through native tool support
      resumeSession: false,
      supportsFileTools: false  // Files should be attached to messages, not accessed via tools
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
