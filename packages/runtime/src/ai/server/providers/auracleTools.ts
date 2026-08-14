/**
 * Auracle-scoped DESTRUCTIVE tools (Phase 2, Slice 3).
 *
 * These three tools give the in-process `auracle` chat provider (Sextant /
 * Atlas) real coding ability: write files, edit files, and run shell commands.
 *
 * SAFETY — why they live here and NOT in the shared `BUILT_IN_TOOLS`/
 * `toolRegistry`:
 *   The shared registry is what `BaseAIProvider.getRegisteredTools()` offers to
 *   EVERY chat provider — including `openai` and `lmstudio`, which have NO
 *   permission gate and execute tool calls single-shot. Putting write/edit/bash
 *   there would hand those providers ungated filesystem + shell access. Instead
 *   `AuracleProvider` overrides `getRegisteredTools()` to append THIS list, so
 *   only auracle ever OFFERS these tools to a model. Auracle gates each call
 *   through `ToolPermissionService` (Slice 1) before it runs, and the electron
 *   `ToolExecutor` refuses to execute them for any provider other than auracle
 *   (defense-in-depth, Slice 3).
 *
 * These definitions carry NO `handler` — execution happens in the electron main
 * process (`ToolExecutor.executeTool`), which owns the workspace-boundary check,
 * the provider guard, and the real fs/exec calls. Here we only describe the
 * schema offered to the model.
 */

import type { ToolDefinition } from '../../tools';

/**
 * Canonical names of the auracle destructive tools. The single source of truth
 * for what auracle OFFERS. The electron `ToolExecutor` keeps its own small copy
 * for its defense-in-depth guard (deliberate duplication to avoid a
 * cross-package import in that hot path / its tests).
 */
export const AURACLE_DESTRUCTIVE_TOOL_NAMES = ['writeFile', 'editFile', 'bash'] as const;

/**
 * `writeFile` — create or overwrite a file with the given content. Confined to
 * the session workspace/worktree by the executor's boundary check.
 */
export const AURACLE_WRITE_FILE_TOOL: ToolDefinition = {
  name: 'writeFile',
  description:
    'Create a new file or completely overwrite an existing file within the workspace. ' +
    'Provide the full desired file contents. The path must be inside the workspace; ' +
    'paths outside the workspace are rejected. Parent directories are created as needed. ' +
    'For a small change to an existing file prefer editFile so only the changed lines are touched.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Path to the file to write. Absolute (inside the workspace) or relative to the workspace root.',
      },
      content: {
        type: 'string',
        description: 'The complete contents to write to the file.',
      },
    },
    required: ['path', 'content'],
  },
  source: 'main',
};

/**
 * `editFile` — apply exact text replacements to an existing file. Mirrors the
 * `applyDiff` `replacements: [{oldText,newText}]` convention already used in the
 * codebase, but works on ARBITRARY workspace files (not only `.md`).
 */
export const AURACLE_EDIT_FILE_TOOL: ToolDefinition = {
  name: 'editFile',
  description:
    'Apply one or more exact text replacements to an existing file within the workspace. ' +
    'Each replacement finds oldText and replaces it with newText. oldText must match the ' +
    'file contents exactly (including whitespace and indentation) and must be unique enough ' +
    'to identify a single location. Use this for targeted edits; use writeFile to create a ' +
    'file or replace it wholesale.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Path to the file to edit. Absolute (inside the workspace) or relative to the workspace root.',
      },
      replacements: {
        type: 'array',
        description: 'The list of exact text replacements to apply, in order.',
        items: {
          type: 'object',
          properties: {
            oldText: {
              type: 'string',
              description: 'The exact existing text to replace. Must match the file exactly.',
            },
            newText: {
              type: 'string',
              description: 'The replacement text.',
            },
          },
          required: ['oldText', 'newText'],
        },
      },
    },
    required: ['path', 'replacements'],
  },
  source: 'main',
};

/**
 * `bash` — run a shell command in the session working directory. Gated per
 * sub-command (compound commands are split and each part is approved) and run
 * with only the app environment, no privilege escalation.
 */
export const AURACLE_BASH_TOOL: ToolDefinition = {
  name: 'bash',
  description:
    'Run a shell command in the workspace working directory and return its stdout, stderr, ' +
    'and exit code. Use this for builds, tests, git, and other command-line work. Compound ' +
    'commands (using &&, ||, or ;) are checked one part at a time before running.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to run.',
      },
      cwd: {
        type: 'string',
        description:
          'Optional working directory for the command. Must be inside the workspace; ' +
          'defaults to the workspace root.',
      },
    },
    required: ['command'],
  },
  source: 'main',
};

/**
 * The full auracle-scoped destructive toolset, offered ONLY by AuracleProvider
 * on top of the shared read-only tools.
 */
export const AURACLE_DESTRUCTIVE_TOOLS: ToolDefinition[] = [
  AURACLE_WRITE_FILE_TOOL,
  AURACLE_EDIT_FILE_TOOL,
  AURACLE_BASH_TOOL,
];
