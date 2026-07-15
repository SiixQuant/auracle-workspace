/**
 * The hub tab layer is the pack half of the id-compat contract (PRD #59
 * addendum): the host resolves aliases to the owning hub panel; this store
 * fronts the matching tab. Old ids must keep landing on the exact surface
 * they used to open.
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getActiveHubTab, HUB_ALIASES, openHubTab, resolveHubAlias } from '../hub';

describe('resolveHubAlias', () => {
  it.each([
    ['research', 'strategy-lab', 'research'],
    ['qc-import', 'strategy-lab', 'qc-import'],
    ['validation', 'strategy-lab', 'validation'],
    ['live-algorithms', 'live-desk', 'deployments'],
    ['blotter', 'live-desk', 'blotter'],
    ['incidents', 'live-desk', 'incidents'],
    ['schedules', 'live-desk', 'schedules'],
    ['runway', 'live-desk', 'runway'],
  ])('%s lands on %s → %s, in short and full form', (short, hub, tab) => {
    expect(resolveHubAlias(short)).toEqual({ hub, tab });
    expect(resolveHubAlias(`com.auracle.pack.${short}`)).toEqual({ hub, tab });
  });

  it('ignores canonical hub ids and unknown ids', () => {
    expect(resolveHubAlias('com.auracle.pack.strategy-lab')).toBeNull();
    expect(resolveHubAlias('com.auracle.pack.live-desk')).toBeNull();
    expect(resolveHubAlias('com.auracle.pack.backtest')).toBeNull();
    expect(resolveHubAlias('com.other.ext.research-tools')).toBeNull();
  });

  it('covers every absorbed panel exactly once', () => {
    expect(Object.keys(HUB_ALIASES).sort()).toEqual([
      'blotter',
      'incidents',
      'live-algorithms',
      'qc-import',
      'research',
      'runway',
      'schedules',
      'validation',
    ]);
  });
});

describe('hub tab store', () => {
  it('falls back per hub until a tab is opened', () => {
    expect(getActiveHubTab('strategy-lab', 'research')).toBe('research');
    openHubTab('strategy-lab', 'validation');
    expect(getActiveHubTab('strategy-lab', 'research')).toBe('validation');
    // the other hub is untouched
    expect(getActiveHubTab('live-desk', 'deployments')).toBe('deployments');
  });

  it('an aliased toggle-panel event fronts the matching tab', () => {
    window.dispatchEvent(
      new CustomEvent('nimbalyst:toggle-panel', {
        detail: { panelId: 'com.auracle.pack.blotter' },
      })
    );
    expect(getActiveHubTab('live-desk', 'deployments')).toBe('blotter');
  });

  it('a canonical hub toggle leaves the current tab alone', () => {
    openHubTab('live-desk', 'incidents');
    window.dispatchEvent(
      new CustomEvent('nimbalyst:toggle-panel', {
        detail: { panelId: 'com.auracle.pack.live-desk' },
      })
    );
    expect(getActiveHubTab('live-desk', 'deployments')).toBe('incidents');
  });
});
