import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseWorkspacePathFromConfig, readProvisionedWorkspacePath } from '../provisionedWorkspace';

describe('parseWorkspacePathFromConfig', () => {
  it('returns the workspace_path when present', () => {
    expect(
      parseWorkspacePathFromConfig(
        JSON.stringify({ engine_url: 'http://127.0.0.1:1969', api_key: 'k', workspace_path: '/ws/Auracle Strategies' })
      )
    ).toBe('/ws/Auracle Strategies');
  });

  it('trims surrounding whitespace from workspace_path', () => {
    expect(parseWorkspacePathFromConfig(JSON.stringify({ workspace_path: '  /ws/trim  ' }))).toBe('/ws/trim');
  });

  it('returns null when the key is absent (older launcher config)', () => {
    expect(parseWorkspacePathFromConfig(JSON.stringify({ engine_url: 'http://x', api_key: 'k' }))).toBeNull();
  });

  it('returns null for an empty or whitespace-only value', () => {
    expect(parseWorkspacePathFromConfig(JSON.stringify({ workspace_path: '' }))).toBeNull();
    expect(parseWorkspacePathFromConfig(JSON.stringify({ workspace_path: '   ' }))).toBeNull();
  });

  it('returns null when workspace_path is not a string', () => {
    expect(parseWorkspacePathFromConfig(JSON.stringify({ workspace_path: 42 }))).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    expect(parseWorkspacePathFromConfig('{ this is not valid json')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseWorkspacePathFromConfig('')).toBeNull();
  });
});

describe('readProvisionedWorkspacePath', () => {
  let tempDir: string;
  const savedEnv = process.env.AURACLE_WORKSPACE_PATH;

  beforeEach(() => {
    delete process.env.AURACLE_WORKSPACE_PATH;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auracle-config-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (savedEnv === undefined) {
      delete process.env.AURACLE_WORKSPACE_PATH;
    } else {
      process.env.AURACLE_WORKSPACE_PATH = savedEnv;
    }
  });

  it('reads workspace_path from the provisioning config file', () => {
    const configPath = path.join(tempDir, 'auracle.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ engine_url: 'http://x', api_key: 'k', workspace_path: '/ws/canonical' })
    );

    expect(readProvisionedWorkspacePath(configPath)).toBe('/ws/canonical');
  });

  it('returns null when the config file is missing', () => {
    expect(readProvisionedWorkspacePath(path.join(tempDir, 'does-not-exist.json'))).toBeNull();
  });

  it('returns null when the config file is corrupt', () => {
    const configPath = path.join(tempDir, 'auracle.json');
    fs.writeFileSync(configPath, '{ not json at all');

    expect(readProvisionedWorkspacePath(configPath)).toBeNull();
  });

  it('returns null when the config omits workspace_path', () => {
    const configPath = path.join(tempDir, 'auracle.json');
    fs.writeFileSync(configPath, JSON.stringify({ engine_url: 'http://x', api_key: 'k' }));

    expect(readProvisionedWorkspacePath(configPath)).toBeNull();
  });

  it('lets AURACLE_WORKSPACE_PATH override the config file', () => {
    const configPath = path.join(tempDir, 'auracle.json');
    fs.writeFileSync(configPath, JSON.stringify({ workspace_path: '/ws/from-file' }));
    process.env.AURACLE_WORKSPACE_PATH = '/ws/from-env';

    expect(readProvisionedWorkspacePath(configPath)).toBe('/ws/from-env');
  });
});
