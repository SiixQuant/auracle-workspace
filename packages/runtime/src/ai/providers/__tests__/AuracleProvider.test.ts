/**
 * Unit tests for the Auracle provider's static contract:
 * - the STATIC two-model list (Sextant / Atlas) with combined ids,
 * - the default model,
 * - the LM-Studio-equivalent capability profile.
 * These are pure (no network) and always run.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { AuracleProvider } from '../../server/providers/AuracleProvider';
import { ProviderFactory } from '../../server/ProviderFactory';

describe('AuracleProvider (static contract)', () => {
  afterEach(() => {
    ProviderFactory.destroyAll();
  });

  it('exposes exactly Sextant and Atlas with combined auracle: ids', async () => {
    const models = await AuracleProvider.getModels();
    expect(models.map(m => m.id)).toEqual(['auracle:sextant', 'auracle:atlas']);
    expect(models.map(m => m.name)).toEqual(['Sextant', 'Atlas']);
    for (const m of models) {
      expect(m.provider).toBe('auracle');
      expect(m.maxTokens).toBeGreaterThan(0);
      expect(m.contextWindow).toBeGreaterThan(0);
    }
  });

  it('getModels() mirrors the static default list (no discovery)', async () => {
    expect(await AuracleProvider.getModels()).toEqual(AuracleProvider.getDefaultModels());
  });

  it('defaults to auracle:sextant', () => {
    expect(AuracleProvider.getDefaultModel()).toBe('auracle:sextant');
    expect(AuracleProvider.DEFAULT_MODEL).toBe('auracle:sextant');
  });

  it('reports the LM-Studio-equivalent chat capability profile', () => {
    const provider = ProviderFactory.createProvider('auracle', 'test-caps');
    const caps = provider.getCapabilities();
    expect(caps.tools).toBe(true);
    expect(caps.mcpSupport).toBe(false);
    // Phase 2, Slice 3: auracle reads AND writes files via its own gated tools.
    expect(caps.supportsFileTools).toBe(true);
    expect(caps.streaming).toBe(true);
  });
});
