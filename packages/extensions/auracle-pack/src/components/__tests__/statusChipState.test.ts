import { describe, expect, it } from 'vitest';
import { classifyChipState } from '../statusChipState';

describe('classifyChipState maps an engine probe to a chip state', () => {
  it('reports connected on a successful round-trip', () => {
    expect(classifyChipState({ hasKey: true, status: 200, ok: true })).toBe('connected');
    // ok wins even without a key on file (the engine vouched for itself).
    expect(classifyChipState({ hasKey: false, status: 200, ok: true })).toBe('connected');
  });

  it('reports key-rejected on a 401 or 403 while a key exists (the fix)', () => {
    expect(classifyChipState({ hasKey: true, status: 401, ok: false })).toBe('key-rejected');
    expect(classifyChipState({ hasKey: true, status: 403, ok: false })).toBe('key-rejected');
  });

  it('reports not-configured when there is no key to reject', () => {
    expect(classifyChipState({ hasKey: false, status: 0, ok: false })).toBe('not-configured');
    // No key beats a 401 — a rejected credential needs a credential.
    expect(classifyChipState({ hasKey: false, status: 401, ok: false })).toBe('not-configured');
  });

  it('reports unreachable for a dead engine or any other failure', () => {
    expect(classifyChipState({ hasKey: true, status: 0, ok: false })).toBe('unreachable');
    expect(classifyChipState({ hasKey: true, status: 500, ok: false })).toBe('unreachable');
    expect(classifyChipState({ hasKey: true, status: 404, ok: false })).toBe('unreachable');
  });
});
