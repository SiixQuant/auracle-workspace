import { describe, expect, it } from 'vitest';
import { isAgentProvider, usesCanonicalToolPipeline } from '../types';

/**
 * `usesCanonicalToolPipeline` is the UNION of the subprocess/SDK agent providers
 * and the in-process `auracle` chat provider. It gates "renders via the canonical
 * transcript pipeline + gets the hookless diff watcher" — NOT "is a subprocess
 * agent" (that stays `isAgentProvider`). These tests pin the membership so the two
 * predicates cannot silently drift.
 */
describe('usesCanonicalToolPipeline', () => {
  const AGENT_PROVIDERS = [
    'claude-code',
    'claude-code-cli',
    'openai-codex',
    'openai-codex-acp',
    'opencode',
    'copilot-cli',
  ];

  // Chat providers that do NOT have their own canonical tool loop.
  const CHAT_ONLY_PROVIDERS = ['claude', 'openai', 'lmstudio'];

  it('is true for auracle (the in-process agentic chat provider)', () => {
    expect(usesCanonicalToolPipeline('auracle')).toBe(true);
  });

  it('is true for every subprocess/SDK agent provider', () => {
    for (const provider of AGENT_PROVIDERS) {
      expect(usesCanonicalToolPipeline(provider)).toBe(true);
    }
  });

  it('is false for chat-only providers (openai, lmstudio, claude)', () => {
    for (const provider of CHAT_ONLY_PROVIDERS) {
      expect(usesCanonicalToolPipeline(provider)).toBe(false);
    }
  });

  it('is false for null / undefined / unknown providers', () => {
    expect(usesCanonicalToolPipeline(null)).toBe(false);
    expect(usesCanonicalToolPipeline(undefined)).toBe(false);
    expect(usesCanonicalToolPipeline('not-a-provider')).toBe(false);
  });

  it('adds ONLY auracle on top of isAgentProvider (does not widen agent membership)', () => {
    // auracle joins the canonical pipeline WITHOUT becoming a subprocess agent.
    expect(isAgentProvider('auracle')).toBe(false);
    expect(usesCanonicalToolPipeline('auracle')).toBe(true);

    // For every other provider the two predicates agree.
    for (const provider of [...AGENT_PROVIDERS, ...CHAT_ONLY_PROVIDERS, 'not-a-provider']) {
      expect(usesCanonicalToolPipeline(provider)).toBe(isAgentProvider(provider));
    }
  });
});
