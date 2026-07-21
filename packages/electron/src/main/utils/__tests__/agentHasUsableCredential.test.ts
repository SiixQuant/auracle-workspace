import { beforeEach, describe, expect, it, vi } from 'vitest';

// Drive the ai-settings store and the extension-agent lookup so the readiness
// matrix can be exercised branch by branch. workspacePath is left undefined
// throughout, so the per-project override path (which reads the app-settings
// workspace state) is never taken — this isolates the provider matrix.
const { aiSettings, isExtensionAgentProvider } = vi.hoisted(() => ({
  aiSettings: { current: {} as Record<string, unknown> },
  isExtensionAgentProvider: vi.fn(),
}));

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string, fallback?: unknown) {
      return key in aiSettings.current ? aiSettings.current[key] : fallback;
    }
  },
}));

vi.mock('../../services/ai/providerResolution', () => ({
  isExtensionAgentProvider,
}));

import { agentHasUsableCredential } from '../store';

describe('agentHasUsableCredential', () => {
  beforeEach(() => {
    aiSettings.current = {};
    isExtensionAgentProvider.mockReturnValue(false);
  });

  it('the default (claude-code on login) needs no stored key — configured', () => {
    aiSettings.current = { defaultProvider: 'claude-code' };
    expect(agentHasUsableCredential()).toBe(true);
  });

  it('falls back to claude-code (configured) when no default provider is set', () => {
    expect(agentHasUsableCredential()).toBe(true);
  });

  it('claude-code on api-key auth needs the stored key', () => {
    aiSettings.current = {
      defaultProvider: 'claude-code',
      providerSettings: { 'claude-code': { authMethod: 'api-key' } },
    };
    expect(agentHasUsableCredential()).toBe(false);

    aiSettings.current = { ...aiSettings.current, apiKeys: { 'claude-code': 'sk-cc' } };
    expect(agentHasUsableCredential()).toBe(true);
  });

  it('a key-based provider gates until its key is present (claude reads the anthropic key)', () => {
    aiSettings.current = { defaultProvider: 'claude' };
    expect(agentHasUsableCredential()).toBe(false);

    aiSettings.current = { defaultProvider: 'claude', apiKeys: { anthropic: 'sk-ant' } };
    expect(agentHasUsableCredential()).toBe(true);
  });

  it('openai gates until its own key is present', () => {
    aiSettings.current = { defaultProvider: 'openai' };
    expect(agentHasUsableCredential()).toBe(false);

    aiSettings.current = { defaultProvider: 'openai', apiKeys: { openai: 'sk-oa' } };
    expect(agentHasUsableCredential()).toBe(true);
  });

  it('extension-agent and lmstudio providers defer auth — configured without a stored key', () => {
    isExtensionAgentProvider.mockImplementation((p: string) => p === 'antigravity');
    aiSettings.current = { defaultProvider: 'antigravity' };
    expect(agentHasUsableCredential()).toBe(true);

    aiSettings.current = { defaultProvider: 'lmstudio' };
    expect(agentHasUsableCredential()).toBe(true);
  });

  it('an empty-string key does not count as configured', () => {
    aiSettings.current = { defaultProvider: 'openai', apiKeys: { openai: '' } };
    expect(agentHasUsableCredential()).toBe(false);
  });
});
