/**
 * Auracle provider: Auracle's built-in OpenAI-compatible chat models
 * (Sextant / Atlas). Cloned from LMStudioProvider — the streaming and tool-call
 * handling are kept verbatim. The differences are:
 *   (a) getModels() returns a STATIC two-model list instead of /v1/models discovery;
 *   (b) baseUrl is the OpenAI-compatible base already ending in `/v1`, so the fetch
 *       targets `${baseUrl}/chat/completions` (no extra `/v1`);
 *   (c) an `Authorization: Bearer <apiKey>` header is attached IFF a non-empty
 *       apiKey is configured (cloud run target); local/remote send no auth.
 * The run target (baseUrl / upstream model id / apiKey) is resolved per-model by
 * the host and injected via initialize(config).
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
  ModelIdentifier
} from '../types';
import { AURACLE_MODELS, AURACLE_DEFAULT_RUN_TARGETS } from '../../modelConstants';
import { buildUserMessageAddition } from './documentContextUtils';

interface AuracleConfig extends ProviderConfig {
  baseUrl?: string;  // OpenAI-compatible base, ends in /v1 (e.g. http://127.0.0.1:11434/v1)
  apiKey?: string;   // Bearer key; attached only when non-empty (cloud run target)
}

export class AuracleProvider extends BaseAIProvider {
  private baseUrl: string = 'http://127.0.0.1:11434/v1';
  private apiKey: string | undefined;
  private abortController: AbortController | null = null;
  private resolvedModel: string | null = null;

  static readonly DEFAULT_MODEL = 'auracle:sextant';

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

    // Create abort controller for this request
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

    // Use the centralized tool system (OpenAI-compatible format)
    const tools = this.getToolsInOpenAIFormat();

    // Log the request for debugging
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

    // Apply response format if specified (extension chat completions)
    // LM Studio uses OpenAI-compatible format
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
    
    console.log('[Auracle] Sending request with tools:', {
      model: requestBody.model,
      messagesCount: requestBody.messages.length,
      toolsCount: requestBody.tools.length,
      firstMessage: apiMessages[0],
      lastMessage: apiMessages[apiMessages.length - 1]
    });

    try {
      // Make streaming request to the OpenAI-compatible endpoint with tools.
      // baseUrl already ends in /v1, so append /chat/completions directly.
      // buildHeaders() attaches the Bearer key only in cloud mode.
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal
      });
      
      console.log('[Auracle] Response status:', response.status, response.statusText);

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
      let chunkCount = 0;
      let usageData: { input_tokens?: number; output_tokens?: number } | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[Auracle] Stream done, total chunks:', chunkCount);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.trim() === 'data: [DONE]') {
            console.log('[Auracle] Received [DONE] marker');
            // Log the output message - await to ensure it's saved before signaling completion
            if (sessionId && fullContent) {
              await this.logAgentMessage(sessionId, 'auracle', 'output', fullContent);
            }
            yield {
              type: 'complete',
              content: fullContent,
              isComplete: true,
              ...(usageData && {
                usage: {
                  input_tokens: usageData.input_tokens || 0,
                  output_tokens: usageData.output_tokens || 0,
                  total_tokens: (usageData.input_tokens || 0) + (usageData.output_tokens || 0)
                }
              })
            };
            return;
          }

          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              chunkCount++;

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
                return;
              }

              const delta = json.choices?.[0]?.delta;

              // Capture usage data if provided (OpenAI stream_options.include_usage)
              if (json.usage) {
                usageData = {
                  input_tokens: json.usage.prompt_tokens,
                  output_tokens: json.usage.completion_tokens
                };
              }

              // Log if this is the first chunk or if it's empty
              if (chunkCount === 1) {
                console.log('[Auracle] First chunk from API:', JSON.stringify(json, null, 2));
              }

              // Log if we get an empty response
              if (!delta?.content && !delta?.tool_calls && json.choices?.[0]?.finish_reason) {
                console.log('[Auracle] Empty response with finish_reason:', json.choices[0].finish_reason);
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
                console.log('[Auracle] Tool calls detected:', delta.tool_calls);
                for (const toolCall of delta.tool_calls) {
                  if (toolCall.id) {
                    // New tool call starting
                    console.log('[Auracle] Starting new tool call:', toolCall.function?.name);
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
                    console.log('[Auracle] Tool call chunk received:', {
                      toolName: currentToolCall?.function?.name,
                      chunkLength: chunk.length,
                      chunkPreview: chunk.substring(0, 50),
                      totalBufferLength: toolCallBuffer.length,
                      isStreamingContent: isStreamingContent
                    });
                    
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
                          
                          console.log('[Auracle] Starting streaming with config:', streamConfig);
                          
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
                              console.log('[Auracle] 📝 Emitting stream_edit_content (complete):', {
                                length: unescaped.length,
                                preview: unescaped.substring(0, 30) + (unescaped.length > 30 ? '...' : '')
                              });
                              
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
                          if (sessionId) {
                            // Parse full args for logging
                            let fullArgs: any = {};
                            try {
                              fullArgs = JSON.parse(toolCallBuffer);
                            } catch (e) {
                              fullArgs = { content: rawContent, position: streamConfig?.position || 'cursor' };
                            }

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
                                console.log('[Auracle] 📝 Emitting stream_edit_content (partial):', {
                                  length: unescaped.length,
                                  preview: unescaped.substring(0, 30) + (unescaped.length > 30 ? '...' : ''),
                                  totalBuffered: streamContentBuffer.length + safeEndIndex
                                });
                                
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
                      // Not streaming, try to parse complete arguments for other tools
                      try {
                        const args = JSON.parse(toolCallBuffer);
                        
                        // Emit as regular tool call
                        const toolName = currentToolCall.function.name;
                        let executionResult: any | undefined;
                        let executionError: string | undefined;

                        if (this.toolHandler) {
                          const toolStartTime = Date.now();
                          try {
                            executionResult = await this.executeToolCall(toolName, args);
                            console.log(`[Auracle] ${toolName} execution completed in ${Date.now() - toolStartTime}ms`);
                            if (executionResult !== undefined) {
                              try {
                                console.log(`[Auracle] ${toolName} result:`, JSON.stringify(executionResult, null, 2));
                              } catch (stringifyError) {
                                console.log(`[Auracle] ${toolName} result could not be stringified`, stringifyError);
                              }
                            }
                          } catch (error) {
                            executionError = error instanceof Error ? error.message : 'Tool execution failed';
                            const errorResult = (error as any)?.toolResult ?? { success: false, error: executionError };
                            executionResult = errorResult;
                            console.error(`[Auracle] ${toolName} execution failed:`, error);
                            yield {
                              type: 'tool_error',
                              toolError: {
                                name: toolName,
                                arguments: args,
                                error: executionError,
                                result: errorResult
                              }
                            };
                          }
                        } else {
                          console.warn(`[Auracle] No tool handler registered - skipping execution for ${toolName}`);
                        }

                        const toolId = currentToolCall.id || `tool-${Date.now()}`;

                        // Log tool call to database in format that UI can reconstruct
                        if (sessionId) {
                          // Log the tool_use block
                          this.logAgentMessage(sessionId, 'auracle', 'output', JSON.stringify({
                            type: 'assistant',
                            message: {
                              content: [{
                                type: 'tool_use',
                                id: toolId,
                                name: toolName,
                                input: args
                              }]
                            }
                          }));

                          // Log the tool_result block
                          const resultContent = executionResult !== undefined
                            ? (typeof executionResult === 'string' ? executionResult : JSON.stringify(executionResult))
                            : 'Tool executed';
                          this.logAgentMessage(sessionId, 'auracle', 'output', JSON.stringify({
                            type: 'assistant',
                            message: {
                              content: [{
                                type: 'tool_result',
                                tool_use_id: toolId,
                                content: resultContent,
                                is_error: executionError !== undefined
                              }]
                            }
                          }));
                        }

                        yield {
                          type: 'tool_call',
                          toolCall: {
                            id: toolId,
                            name: toolName,
                            arguments: args,
                            ...(executionResult !== undefined ? { result: executionResult } : {})
                          }
                        };

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
              
              // Note: Don't yield 'complete' here on finish_reason='stop'
              // The [DONE] marker will handle the final completion to avoid duplicates
            } catch (error) {
              console.error('Error parsing SSE data from Auracle endpoint:', error, 'Line:', line);
            }
          }
        }
      }

      // Handle any remaining buffer
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

      // Log the output message - await to ensure it's saved before signaling completion
      if (sessionId && fullContent) {
        await this.logAgentMessage(sessionId, 'auracle', 'output', fullContent);
      }

      // Ensure we send a complete event
      yield {
        type: 'complete',
        content: fullContent,
        isComplete: true,
        ...(usageData && {
          usage: {
            input_tokens: usageData.input_tokens || 0,
            output_tokens: usageData.output_tokens || 0,
            total_tokens: (usageData.input_tokens || 0) + (usageData.output_tokens || 0)
          }
        })
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

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
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
