/**
 * ToolExecutor - Handles execution of tools with proper IPC communication
 */

import { WebContents, ipcMain, BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { DiffArgs, DiffResult, ToolDefinition } from '@nimbalyst/runtime/ai/server/types';
import { toolRegistry } from './ToolRegistry';
import { logger } from '../../../utils/logger';
import { sessionFileTracker } from '../../SessionFileTracker';
import { addGitignoreBypass } from '../../../file/WorkspaceEventBus';
import { extractFilePath } from './extractFilePath';
import {AnalyticsService} from "../../analytics/AnalyticsService.ts";

const LOG_PREVIEW_LENGTH = 400;
const analytics = AnalyticsService.getInstance();
const execFileAsync = promisify(execFile);

/**
 * Auracle-scoped DESTRUCTIVE tools (Phase 2, Slice 3). These are OFFERED to the
 * model ONLY by AuracleProvider (they are deliberately NOT in the shared tool
 * registry) and executed here. This local copy backs the defense-in-depth guard
 * below; the canonical offered list lives in
 * runtime `.../providers/auracleTools.ts`.
 */
const AURACLE_DESTRUCTIVE_TOOLS = ['writeFile', 'editFile', 'bash'];

/** Hard cap on how long a `bash` tool command may run (ms). */
const BASH_TIMEOUT_MS = 120000;

function previewForLog(value?: string, max: number = LOG_PREVIEW_LENGTH): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export class ToolExecutor extends EventEmitter {
  private webContents: WebContents;
  private pendingExecutions: Map<string, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private sessionId?: string;
  private workspaceId?: string;
  /**
   * Name of the AI provider this executor serves (e.g. 'auracle', 'openai',
   * 'lmstudio'). Used by the defense-in-depth guard so the auracle-scoped
   * destructive tools (writeFile/editFile/bash) can ONLY be executed for the
   * gated `auracle` provider — even a hallucinated call from a non-gated chat
   * provider cannot run them.
   */
  private providerName?: string;

  constructor(webContents: WebContents, sessionId?: string, workspaceId?: string, providerName?: string) {
    super();
    this.webContents = webContents;
    this.sessionId = sessionId;
    this.workspaceId = workspaceId;
    this.providerName = providerName;
    this.setupHandlers();
  }

  private bucketContentLength(length: number): string {
    if (length < 100) return '0-99';
    if (length < 500) return '100-499';
    if (length < 1000) return '500-999';
    return '1000+';
  }
  
  private setupHandlers(): void {
    // Clean up any existing handlers to avoid duplicates
    ipcMain.removeAllListeners('tool:execution:result');
  }
  
  /**
   * Execute applyDiff tool
  */
  async applyDiff(args: DiffArgs & { targetFilePath?: string }): Promise<DiffResult> {
    analytics.sendEvent('apply_diff_tool');
    const resultChannel = `applyDiff-result-${Date.now()}`;
    const replacementCount = Array.isArray(args?.replacements) ? args.replacements.length : undefined;
    logger.ai.info('[ToolExecutor] applyDiff invoked', {
      replacements: replacementCount,
      targetFilePath: args.targetFilePath,
      preview: previewForLog(JSON.stringify(args ?? {}))
    });
    if (replacementCount === undefined || replacementCount === 0) {
      logger.ai.warn('[ToolExecutor] applyDiff called without replacements');
    }

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(resultChannel);
        logger.ai.error('[ToolExecutor] applyDiff timed out');
        reject(new Error('applyDiff execution timed out'));
      }, 30000);

      // Set up one-time listener for result
      ipcMain.once(resultChannel, (event, result: DiffResult) => {
        clearTimeout(timeout);
        logger.ai.info('[ToolExecutor] applyDiff result received', result);
        resolve(result);
      });

      // Pre-register bypass for the target file
      if (this.workspaceId && args.targetFilePath) {
        addGitignoreBypass(this.workspaceId, args.targetFilePath);
      }

      // Send to renderer with explicit targetFilePath
      console.log(`[ToolExecutor] Sending applyDiff to renderer with targetFilePath:`, args.targetFilePath);
      this.webContents.send('ai:applyDiff', {
        replacements: args.replacements,
        resultChannel,
        targetFilePath: args.targetFilePath
      });
    });
  }
  
  /**
   * Execute streamContent tool
   */
  async streamContent(args: {
    content: string;
    position?: string;
    insertAfter?: string;
    mode?: string;
    targetFilePath?: string;
  }): Promise<void> {
    const streamId = `stream-${Date.now()}`;

    // Determine position type for analytics
    let positionType: 'cursor' | 'end' | 'after-selection';
    if (args.insertAfter) {
      positionType = 'after-selection';
    } else if (args.position === 'cursor') {
      positionType = 'cursor';
    } else {
      positionType = 'end';
    }

    // Track ai_stream_content_used analytics event
    analytics.sendEvent('ai_stream_content_used', {
      position: positionType,
      contentLength: this.bucketContentLength(args.content.length)
    });

    // Pre-register bypass for the target file
    if (this.workspaceId && args.targetFilePath) {
      addGitignoreBypass(this.workspaceId, args.targetFilePath);
    }

    // Start streaming - include targetFilePath so renderer knows which document to target
    // This prevents race conditions if user switches tabs while waiting for AI response
    if (!args.targetFilePath) {
      logger.ai.warn('[ToolExecutor] streamContent called without targetFilePath - edit may go to wrong document');
    }
    this.webContents.send('ai:streamEditStart', {
      id: streamId,
      position: args.position || (args.insertAfter ? undefined : 'cursor'),
      insertAfter: args.insertAfter,
      mode: args.mode || 'append',
      insertAtEnd: false,
      targetFilePath: args.targetFilePath
    });

    // Stream content in chunks
    const chunkSize = 50;
    const content = args.content;

    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, Math.min(i + chunkSize, content.length));
      this.webContents.send('ai:streamEditContent', chunk);

      // Small delay between chunks for smooth streaming
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // End streaming
    this.webContents.send('ai:streamEditEnd', { id: streamId });

    // Track file interaction after streaming completes
    // Also attach file watcher for the edited file
    if (this.sessionId && this.workspaceId && args.targetFilePath) {
      try {
        // Get the BrowserWindow from webContents to attach file watchers
        const window = BrowserWindow.fromWebContents(this.webContents);

        console.log('[ToolExecutor] Tracking streamContent file interaction');
        await sessionFileTracker.trackToolExecution(
          this.sessionId,
          this.workspaceId,
          'streamContent',
          { file_path: args.targetFilePath, content: args.content },
          { success: true, linesAdded: args.content.split('\n').length },
          undefined,
          window  // Pass window to enable file watcher attachment
        );
        console.log('[ToolExecutor] streamContent tracking completed');
      } catch (error) {
        logger.main.warn('[ToolExecutor] Failed to track streamContent:', error);
        console.error('[ToolExecutor] streamContent tracking error:', error);
      }
    }
  }

  /**
   * Execute getDocumentContent tool
   */
  async getDocumentContent(args: { filePath?: string }): Promise<{ content: string }> {
    const resultChannel = `getDocumentContent-result-${Date.now()}`;
    logger.ai.info('[ToolExecutor] getDocumentContent invoked', {
      filePath: args?.filePath
    });

    // SAFETY: Require explicit filePath
    if (!args?.filePath) {
      throw new Error('getDocumentContent requires filePath parameter - no target file specified');
    }

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(resultChannel);
        logger.ai.error('[ToolExecutor] getDocumentContent timed out');
        reject(new Error('getDocumentContent execution timed out'));
      }, 5000);

      // Set up one-time listener for result
      ipcMain.once(resultChannel, (event, result: { content: string }) => {
        clearTimeout(timeout);
        logger.ai.info('[ToolExecutor] getDocumentContent result received', {
          contentLength: result?.content?.length || 0
        });
        resolve(result);
      });

      // Send to renderer with filePath
      this.webContents.send('ai:getDocumentContent', {
        filePath: args.filePath,
        resultChannel
      });
    });
  }

  /**
   * Execute updateFrontmatter tool
   */
  async updateFrontmatter(args: { filePath?: string; updates: Record<string, any> }): Promise<DiffResult> {
    const resultChannel = `updateFrontmatter-result-${Date.now()}`;
    logger.ai.info('[ToolExecutor] updateFrontmatter invoked', {
      filePath: args?.filePath,
      updates: args?.updates
    });

    // SAFETY: Require explicit filePath
    if (!args?.filePath) {
      throw new Error('updateFrontmatter requires filePath parameter - no target file specified');
    }

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(resultChannel);
        logger.ai.error('[ToolExecutor] updateFrontmatter timed out');
        reject(new Error('updateFrontmatter execution timed out'));
      }, 30000);

      // Set up one-time listener for result
      ipcMain.once(resultChannel, (event, result: DiffResult) => {
        clearTimeout(timeout);
        logger.ai.info('[ToolExecutor] updateFrontmatter result received', result);
        resolve(result);
      });

      // Send to renderer with filePath
      this.webContents.send('ai:updateFrontmatter', {
        filePath: args.filePath,
        updates: args.updates,
        resultChannel
      });
    });
  }

  /**
   * Execute createDocument tool
   */
  async createDocument(args: { filePath: string; initialContent?: string; switchToFile?: boolean }): Promise<any> {
    analytics.sendEvent('create_document_tool');
    const resultChannel = `createDocument-result-${Date.now()}`;
    logger.ai.info('[ToolExecutor] createDocument invoked', {
      filePath: args?.filePath,
      hasContent: !!args?.initialContent,
      switchToFile: args?.switchToFile !== false
    });

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(resultChannel);
        logger.ai.error('[ToolExecutor] createDocument timed out');
        reject(new Error('Tool createDocument execution timed out'));
      }, 10000);

      // Set up one-time listener for result
      ipcMain.once(resultChannel, (event, result: any) => {
        clearTimeout(timeout);
        logger.ai.info('[ToolExecutor] createDocument result received', result);
        resolve(result);
      });

      // Send to renderer
      this.webContents.send('ai:createDocument', {
        filePath: args.filePath,
        initialContent: args.initialContent,
        switchToFile: args.switchToFile !== false,
        resultChannel
      });
    });
  }

  /**
   * Execute any registered tool
   */
  async executeTool(name: string, args: any): Promise<any> {
    const isAuracleDestructiveTool = AURACLE_DESTRUCTIVE_TOOLS.includes(name);

    // DEFENSE-IN-DEPTH (Phase 2, Slice 3): the auracle-scoped destructive tools
    // are OFFERED only by AuracleProvider, but a hallucinated call from a
    // non-gated chat provider (openai/lmstudio) must NEVER execute here. They
    // run ONLY for the `auracle` provider, whose loop gates every call through
    // ToolPermissionService before dispatch. Fail closed on any other caller.
    if (isAuracleDestructiveTool && this.providerName !== 'auracle') {
      throw new Error(
        `Tool "${name}" is restricted to the auracle provider and cannot be executed for provider "${this.providerName ?? 'unknown'}".`
      );
    }

    // The destructive tools are intentionally NOT in the shared registry
    // (containment), so a missing registry entry is expected for them.
    const tool = toolRegistry.get(name);
    if (!tool && !isAuracleDestructiveTool) {
      throw new Error(`Tool ${name} not found`);
    }

    // Pre-register gitignore bypass BEFORE tool execution so the watcher
    // picks up file changes even if the bypass registration from
    // SessionFileTracker arrives after the fs event.
    // Only for tools that write files — read-only tools (getDocumentContent,
    // searchFiles, etc.) should not register bypasses.
    const WRITE_TOOLS = ['applyDiff', 'streamContent', 'writeFile', 'editFile', 'createDocument', 'updateFrontmatter'];
    if (this.workspaceId && WRITE_TOOLS.includes(name)) {
      const filePath = extractFilePath(args);
      if (filePath) {
        addGitignoreBypass(this.workspaceId, filePath);
      }
    }

    let result: any;

    // Handle built-in tools
    switch (name) {
      case 'applyDiff':
        result = await this.applyDiff(args);
        break;
      case 'streamContent':
        result = await this.streamContent(args);
        break;
      case 'getDocumentContent':
        result = await this.getDocumentContent(args);
        break;
      case 'updateFrontmatter':
        result = await this.updateFrontmatter(args);
        break;
      case 'createDocument':
        result = await this.createDocument(args);
        break;
      // Auracle-scoped destructive tools (guarded above). Execution happens
      // directly on disk within the workspace boundary; the session diff
      // watcher renders the resulting changes as reviewable diffs.
      case 'writeFile':
        result = await this.writeFileTool(args);
        break;
      case 'editFile':
        result = await this.editFileTool(args);
        break;
      case 'bash':
        result = await this.bashTool(args);
        break;
      default:
        if (!tool) {
          throw new Error(`Tool ${name} not found`);
        }
        // Check if tool has a handler (e.g., file tools)
        if (typeof tool.handler === 'function') {
          logger.ai.info(`[ToolExecutor] Executing tool with handler: ${name}`);
          try {
            // Pass the executor's workspaceId as context so handlers that
            // resolve workspace-scoped services (e.g. fileTools' search /
            // list / read) hit the per-path FileSystemService registry
            // instead of the runtime-global singleton — without this, an
            // inactive rail project's session would route through the
            // currently-visible project's service.
            result = await tool.handler(args, { workspacePath: this.workspaceId });
          } catch (error) {
            logger.ai.error(`[ToolExecutor] Tool ${name} execution failed:`, error);
            throw error;
          }
        } else {
          // Execute custom/renderer tool
          result = await this.executeCustomTool(tool, args);
        }
    }

    // Track file interactions after successful tool execution
    // Also attach file watchers for edited files to detect subsequent changes
    console.log('[ToolExecutor] Checking if should track file:', {
      hasSessionId: !!this.sessionId,
      hasWorkspaceId: !!this.workspaceId,
      toolName: name,
      sessionId: this.sessionId,
      workspaceId: this.workspaceId
    });

    if (this.sessionId && this.workspaceId) {
      try {
        // Get the BrowserWindow from webContents to attach file watchers
        const window = BrowserWindow.fromWebContents(this.webContents);

        console.log('[ToolExecutor] Calling sessionFileTracker.trackToolExecution');
        await sessionFileTracker.trackToolExecution(
          this.sessionId,
          this.workspaceId,
          name,
          args,
          result,
          undefined,
          window  // Pass window to enable file watcher attachment for edited files
        );
        console.log('[ToolExecutor] File tracking completed successfully');
      } catch (error) {
        // Log but don't fail - tracking is not critical
        logger.main.warn('[ToolExecutor] Failed to track file interaction:', error);
        console.error('[ToolExecutor] File tracking error:', error);
      }
    } else {
      console.warn('[ToolExecutor] Skipping file tracking - missing sessionId or workspaceId');
    }

    return result;
  }
  
  /**
   * Resolve a tool-supplied path against the session workspace/worktree root and
   * enforce the workspace boundary. Mirrors the existing @-mention boundary
   * check (aiServiceUtils.ts) — resolve then require the result to be the
   * workspace root itself or a descendant of it. Accepts absolute paths that
   * fall inside the workspace as well as workspace-relative paths; rejects
   * anything that escapes. Throws on violation (fail closed).
   */
  private resolveInsideWorkspace(inputPath: string | undefined): string {
    if (!this.workspaceId) {
      throw new Error('No workspace is configured for this session; refusing filesystem access.');
    }
    if (!inputPath || typeof inputPath !== 'string') {
      throw new Error('A file path is required.');
    }
    const resolvedWorkspace = path.resolve(this.workspaceId);
    const resolvedPath = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(resolvedWorkspace, inputPath);

    if (resolvedPath !== resolvedWorkspace && !resolvedPath.startsWith(resolvedWorkspace + path.sep)) {
      throw new Error(`Path "${inputPath}" is outside the workspace and was rejected.`);
    }
    return resolvedPath;
  }

  /**
   * writeFile — create or overwrite a file with the given content, confined to
   * the workspace boundary. Parent directories are created as needed. Writing to
   * disk lets the session diff watcher render the change as a reviewable diff.
   */
  private async writeFileTool(args: { path?: string; content?: string }): Promise<any> {
    const targetPath = this.resolveInsideWorkspace(args?.path);
    const content = typeof args?.content === 'string' ? args.content : '';
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, content, 'utf-8');
    const bytesWritten = Buffer.byteLength(content, 'utf-8');
    logger.ai.info('[ToolExecutor] writeFile', {
      path: targetPath,
      bytes: bytesWritten,
    });
    return { success: true, path: targetPath, bytesWritten };
  }

  /**
   * editFile — apply exact oldText→newText replacements to an existing file
   * within the workspace boundary. Matches the applyDiff replacement convention
   * but works on arbitrary files. Each oldText must be found (first occurrence
   * replaced); a miss fails the whole edit so partial edits never land silently.
   */
  private async editFileTool(args: { path?: string; replacements?: Array<{ oldText?: unknown; newText?: unknown }> }): Promise<any> {
    const targetPath = this.resolveInsideWorkspace(args?.path);
    const replacements = Array.isArray(args?.replacements) ? args!.replacements! : [];
    if (replacements.length === 0) {
      throw new Error('editFile requires at least one replacement.');
    }

    let content: string;
    try {
      content = await fsp.readFile(targetPath, 'utf-8');
    } catch {
      throw new Error(`editFile could not read "${args?.path}". Use writeFile to create a new file.`);
    }

    let applied = 0;
    for (let i = 0; i < replacements.length; i++) {
      const r = replacements[i];
      if (!r || typeof r.oldText !== 'string' || typeof r.newText !== 'string') {
        throw new Error(`editFile replacement ${i} must have string oldText and newText.`);
      }
      const idx = content.indexOf(r.oldText);
      if (idx === -1) {
        throw new Error(`editFile replacement ${i} oldText was not found in "${args?.path}".`);
      }
      // Replace only the first occurrence to keep edits precise.
      content = content.slice(0, idx) + r.newText + content.slice(idx + r.oldText.length);
      applied++;
    }

    await fsp.writeFile(targetPath, content, 'utf-8');
    logger.ai.info('[ToolExecutor] editFile', { path: targetPath, replacementsApplied: applied });
    return { success: true, path: targetPath, replacementsApplied: applied };
  }

  /**
   * bash — run a shell command in the session working directory (worktree or
   * workspace root). The AuracleProvider permission loop has already gated this
   * command (compound commands are split and each sub-command approved) before
   * dispatch. Runs with ONLY the app environment, no privilege escalation, and a
   * hard timeout. Non-zero exit returns structured output rather than throwing so
   * the model can react to failures.
   */
  private async bashTool(args: { command?: string; cwd?: string }): Promise<any> {
    const command = typeof args?.command === 'string' ? args.command.trim() : '';
    if (!command) {
      throw new Error('bash requires a non-empty command.');
    }
    // Default to the session workspace/worktree; a supplied cwd must be inside it.
    const cwd = args?.cwd
      ? this.resolveInsideWorkspace(args.cwd)
      : (this.workspaceId ? path.resolve(this.workspaceId) : undefined);
    if (!cwd) {
      throw new Error('No workspace is configured for this session; refusing to run bash.');
    }

    try {
      const { stdout, stderr } = await execFileAsync('bash', ['-c', command], {
        cwd,
        env: process.env,          // inherit ONLY the app environment
        timeout: BASH_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      });
      return { success: true, exitCode: 0, stdout, stderr };
    } catch (error: any) {
      // Non-zero exit / timeout: surface output instead of throwing.
      const exitCode = typeof error?.code === 'number' ? error.code : 1;
      return {
        success: false,
        exitCode,
        stdout: error?.stdout ?? '',
        stderr: error?.stderr ?? (error?.message ?? 'bash command failed'),
        ...(error?.killed ? { killed: true } : {}),
      };
    }
  }

  /**
   * Execute a custom/renderer tool
   */
  private async executeCustomTool(tool: ToolDefinition, args: any): Promise<any> {
    analytics.sendEvent('execute_custom_tool');
    const correlationId = `tool-${tool.name}-${Date.now()}`;
    
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingExecutions.delete(correlationId);
        reject(new Error(`Tool ${tool.name} execution timed out`));
      }, 30000);
      
      // Store pending execution
      this.pendingExecutions.set(correlationId, {
        resolve,
        reject,
        timeout
      });
      
      // Send execution request to renderer
      this.webContents.send('ai:executeTool', {
        toolName: tool.name,
        args,
        correlationId
      });
    });
  }
  
  /**
   * Handle tool execution result from renderer
   */
  handleToolResult(correlationId: string, result: any, error?: string): void {
    const pending = this.pendingExecutions.get(correlationId);
    if (!pending) return;
    
    clearTimeout(pending.timeout);
    this.pendingExecutions.delete(correlationId);
    
    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }
  }
  
  /**
   * Clean up resources
   */
  destroy(): void {
    // Clear all pending executions
    for (const [id, pending] of this.pendingExecutions) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('ToolExecutor destroyed'));
    }
    this.pendingExecutions.clear();
    this.removeAllListeners();
  }
}
