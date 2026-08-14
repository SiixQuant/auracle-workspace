/**
 * Phase 2, Slice 3 — the auracle-scoped DESTRUCTIVE tools executed in the
 * electron main process: writeFile, editFile, bash.
 *
 * These tests are hermetic:
 *   - a real OS temp directory stands in for the session workspace,
 *   - real `bash`/fs are exercised (node environment),
 *   - all electron / registry / tracker / analytics deps are mocked so the
 *     module graph loads without the full main process.
 *
 * They pin the three safety behaviours this slice owns:
 *   1. the handlers write/edit/run correctly inside the workspace,
 *   2. the workspace boundary is enforced (paths outside are rejected),
 *   3. DEFENSE-IN-DEPTH: a destructive call attributed to a non-auracle
 *      provider is rejected before anything executes.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ToolExecutor's constructor calls ipcMain.removeAllListeners, which the global
// setup mock does not provide — supply a complete-enough electron surface here.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/path'), on: vi.fn() },
  ipcMain: { removeAllListeners: vi.fn(), handle: vi.fn(), on: vi.fn(), once: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
}));

// The real registry pulls in the ipc/runtime graph; a stub `get()` is enough.
// The destructive tools are intentionally NOT in the registry, so returning
// undefined here mirrors production and exercises the dedicated switch cases.
vi.mock('../ToolRegistry', () => ({
  toolRegistry: { get: vi.fn(() => undefined) },
}));

vi.mock('../../../SessionFileTracker', () => ({
  sessionFileTracker: { trackToolExecution: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../../file/WorkspaceEventBus', () => ({
  addGitignoreBypass: vi.fn(),
}));

vi.mock('../../../../utils/logger', () => ({
  logger: {
    ai: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    main: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

vi.mock('../../../analytics/AnalyticsService.ts', () => ({
  AnalyticsService: { getInstance: () => ({ sendEvent: vi.fn() }) },
}));

import { ToolExecutor } from '../ToolExecutor';

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'auracle-exec-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** ToolExecutor scoped to the temp workspace, attributed to the given provider. */
function makeExecutor(providerName?: string): ToolExecutor {
  // webContents is only used for renderer round-trips (not these tools); {} is fine.
  // sessionId omitted so the post-exec file-tracking branch is skipped.
  return new ToolExecutor({} as never, undefined, workspace, providerName);
}

describe('ToolExecutor auracle tools — writeFile', () => {
  it('creates a file (and parent dirs) inside the workspace', async () => {
    const exec = makeExecutor('auracle');
    const result = await exec.executeTool('writeFile', { path: 'nested/dir/a.txt', content: 'hello world' });
    expect(result.success).toBe(true);
    expect(result.bytesWritten).toBe(11);
    expect(readFileSync(join(workspace, 'nested/dir/a.txt'), 'utf-8')).toBe('hello world');
  });

  it('overwrites an existing file wholesale', async () => {
    const exec = makeExecutor('auracle');
    writeFileSync(join(workspace, 'over.txt'), 'old');
    await exec.executeTool('writeFile', { path: 'over.txt', content: 'new' });
    expect(readFileSync(join(workspace, 'over.txt'), 'utf-8')).toBe('new');
  });

  it('rejects a path that escapes the workspace (boundary check)', async () => {
    const exec = makeExecutor('auracle');
    await expect(
      exec.executeTool('writeFile', { path: '../escape.txt', content: 'x' })
    ).rejects.toThrow(/outside the workspace/);
    expect(existsSync(join(workspace, '../escape.txt'))).toBe(false);
  });
});

describe('ToolExecutor auracle tools — editFile', () => {
  it('applies exact oldText→newText replacements', async () => {
    const exec = makeExecutor('auracle');
    writeFileSync(join(workspace, 'edit.txt'), 'foo bar baz');
    const result = await exec.executeTool('editFile', {
      path: 'edit.txt',
      replacements: [{ oldText: 'bar', newText: 'QUX' }],
    });
    expect(result.success).toBe(true);
    expect(result.replacementsApplied).toBe(1);
    expect(readFileSync(join(workspace, 'edit.txt'), 'utf-8')).toBe('foo QUX baz');
  });

  it('fails the whole edit (no partial write) when oldText is not found', async () => {
    const exec = makeExecutor('auracle');
    writeFileSync(join(workspace, 'edit2.txt'), 'abc');
    await expect(
      exec.executeTool('editFile', { path: 'edit2.txt', replacements: [{ oldText: 'zzz', newText: 'y' }] })
    ).rejects.toThrow(/not found/);
    expect(readFileSync(join(workspace, 'edit2.txt'), 'utf-8')).toBe('abc');
  });

  it('rejects editing a non-existent file (directing the model to writeFile)', async () => {
    const exec = makeExecutor('auracle');
    await expect(
      exec.executeTool('editFile', { path: 'nope.txt', replacements: [{ oldText: 'a', newText: 'b' }] })
    ).rejects.toThrow(/could not read/);
  });
});

describe('ToolExecutor auracle tools — bash', () => {
  it('runs a command and captures stdout', async () => {
    const exec = makeExecutor('auracle');
    const result = await exec.executeTool('bash', { command: 'printf hello' });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
  });

  it('runs in the workspace working directory by default', async () => {
    const exec = makeExecutor('auracle');
    const result = await exec.executeTool('bash', { command: 'echo written > bash-out.txt' });
    expect(result.success).toBe(true);
    // The file landed in the workspace → cwd was the workspace root.
    expect(readFileSync(join(workspace, 'bash-out.txt'), 'utf-8').trim()).toBe('written');
  });

  it('returns a structured failure (not a throw) on non-zero exit', async () => {
    const exec = makeExecutor('auracle');
    const result = await exec.executeTool('bash', { command: 'exit 3' });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it('rejects a cwd outside the workspace', async () => {
    const exec = makeExecutor('auracle');
    await expect(
      exec.executeTool('bash', { command: 'echo x', cwd: '../..' })
    ).rejects.toThrow(/outside the workspace/);
  });
});

describe('ToolExecutor auracle tools — defense-in-depth provider guard', () => {
  it('rejects a destructive call attributed to openai (non-gated chat provider)', async () => {
    const exec = makeExecutor('openai');
    await expect(
      exec.executeTool('writeFile', { path: 'evil.txt', content: 'x' })
    ).rejects.toThrow(/restricted to the auracle provider/);
    // Nothing was written.
    expect(existsSync(join(workspace, 'evil.txt'))).toBe(false);
  });

  it('rejects a destructive call attributed to lmstudio', async () => {
    const exec = makeExecutor('lmstudio');
    await expect(
      exec.executeTool('bash', { command: 'echo x' })
    ).rejects.toThrow(/restricted to the auracle provider/);
  });

  it('rejects a destructive call when the provider is unknown (fail closed)', async () => {
    const exec = makeExecutor(undefined);
    await expect(
      exec.executeTool('editFile', { path: 'x', replacements: [{ oldText: 'a', newText: 'b' }] })
    ).rejects.toThrow(/restricted to the auracle provider/);
  });

  it('still lets auracle run the destructive tools', async () => {
    const exec = makeExecutor('auracle');
    mkdirSync(join(workspace, 'ok'), { recursive: true });
    const result = await exec.executeTool('writeFile', { path: 'ok/fine.txt', content: 'ok' });
    expect(result.success).toBe(true);
  });
});
