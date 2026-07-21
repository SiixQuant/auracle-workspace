import { describe, expect, it, vi } from 'vitest';

import { agentKeyPresence, type PanelHostLike } from '../aiPanel';

describe('agentKeyPresence', () => {
  it('treats a host without the key-state lane as unknown (older IDE, never blocks)', async () => {
    await expect(agentKeyPresence(undefined)).resolves.toBe('unknown');
    await expect(agentKeyPresence({} as PanelHostLike)).resolves.toBe('unknown');
  });

  it('maps a configured agent to present', async () => {
    const host: PanelHostLike = {
      agentKeyState: vi.fn().mockResolvedValue({ configured: true }),
    };
    await expect(agentKeyPresence(host)).resolves.toBe('present');
  });

  it('maps an unconfigured agent to absent — the only state that gates', async () => {
    const host: PanelHostLike = {
      agentKeyState: vi.fn().mockResolvedValue({ configured: false }),
    };
    await expect(agentKeyPresence(host)).resolves.toBe('absent');
  });

  it('folds a failed lane call into unknown rather than blocking', async () => {
    const host: PanelHostLike = {
      agentKeyState: vi.fn().mockRejectedValue(new Error('bridge down')),
    };
    await expect(agentKeyPresence(host)).resolves.toBe('unknown');
  });
});
