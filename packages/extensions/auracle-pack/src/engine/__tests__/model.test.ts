import { describe, expect, it } from 'vitest';
import {
  Connector,
  defaultExpanded,
  isConnected,
  normalizeConnector,
  sectionSummary,
} from '../model';

function conn(state: string): Connector {
  return normalizeConnector({ id: 'x', status: { state, detail: null } });
}

describe('engine model helpers (ported native tests)', () => {
  it('is connected only on the connected state', () => {
    expect(isConnected({ state: 'connected', detail: null })).toBe(true);
    for (const state of ['not_configured', 'error', 'disconnected', 'degraded', '']) {
      expect(isConnected({ state, detail: null })).toBe(false);
    }
    expect(isConnected(undefined)).toBe(false);
  });

  it('section summary is honest about counts', () => {
    expect(sectionSummary([])).toBe('None available');
    expect(sectionSummary([conn('not_configured'), conn('error')])).toBe('None connected');
    expect(sectionSummary([conn('connected')])).toBe('Connected');
    expect(sectionSummary([conn('connected'), conn('connected')])).toBe('All 2 connected');
    expect(sectionSummary([conn('connected'), conn('not_configured')])).toBe('1 of 2 connected');
  });

  it('default expanded opens only when nothing connected', () => {
    expect(defaultExpanded([])).toBe(false);
    expect(defaultExpanded([conn('not_configured')])).toBe(true);
    expect(defaultExpanded([conn('connected')])).toBe(false);
    expect(defaultExpanded([conn('connected'), conn('not_configured')])).toBe(false);
  });

  it('normalizes a connector with a nested status object', () => {
    const connector = normalizeConnector({
      id: 'ibkr',
      display_label: 'Interactive Brokers',
      kind: 'broker',
      status: { state: 'connected' },
      test_supported: true,
    });
    expect(connector.id).toBe('ibkr');
    expect(connector.kind).toBe('broker');
    expect(isConnected(connector.status)).toBe(true);
    expect(connector.test_supported).toBe(true);
    expect(connector.gated).toBe(false);
  });
});
