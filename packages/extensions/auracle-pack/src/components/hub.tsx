/**
 * hub — the shared shell for the two consolidated rail surfaces
 * (PRD #59 addendum: Strategy Lab and Live Desk).
 *
 * Each hub is ONE registered fullscreen panel whose internal navigation is a
 * tab strip in the token system. The absorbed panels keep their stores,
 * honest states, and endpoints untouched — this file is IA + chrome only.
 *
 * Old panel ids keep working two ways:
 *  - the HOST resolves manifest `aliases` so a toggle of an absorbed id
 *    opens the owning hub panel;
 *  - this module listens to the same `nimbalyst:toggle-panel` event and maps
 *    the alias to the hub tab, so the right surface is frontmost when the
 *    hub opens. Pack-internal launchers (the editor header) can also call
 *    `openHubTab` directly, which works even when no toggle event fires
 *    because the hub is already open.
 */
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { ensurePanelKitStyles, tone } from './panelkit';

const PACK_PREFIX = 'com.auracle.pack.';

export type HubId = 'strategy-lab' | 'live-desk';

/** Absorbed panel id (short form) → owning hub + tab. */
export const HUB_ALIASES: Record<string, { hub: HubId; tab: string }> = {
  research: { hub: 'strategy-lab', tab: 'research' },
  'qc-import': { hub: 'strategy-lab', tab: 'qc-import' },
  validation: { hub: 'strategy-lab', tab: 'validation' },
  'live-algorithms': { hub: 'live-desk', tab: 'deployments' },
  blotter: { hub: 'live-desk', tab: 'blotter' },
  incidents: { hub: 'live-desk', tab: 'incidents' },
  schedules: { hub: 'live-desk', tab: 'schedules' },
  runway: { hub: 'live-desk', tab: 'runway' },
};

/** Map an old panel id (short or full) to its hub tab; null when it isn't one. */
export function resolveHubAlias(panelId: string): { hub: HubId; tab: string } | null {
  const short = panelId.startsWith(PACK_PREFIX) ? panelId.slice(PACK_PREFIX.length) : panelId;
  return HUB_ALIASES[short] ?? null;
}

/* ── per-hub active-tab store (session-lived) ───────────────────────── */

const activeTabs: Partial<Record<HubId, string>> = {};
const listeners = new Set<() => void>();

export function getActiveHubTab(hub: HubId, fallback: string): string {
  return activeTabs[hub] ?? fallback;
}

export function openHubTab(hub: HubId, tab: string): void {
  activeTabs[hub] = tab;
  for (const l of listeners) l();
}

function subscribeHubTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Window listener: an aliased toggle also fronts the matching hub tab. */
function onTogglePanelEvent(e: Event): void {
  const panelId = (e as CustomEvent).detail?.panelId;
  if (typeof panelId !== 'string') return;
  const hit = resolveHubAlias(panelId);
  if (hit) openHubTab(hit.hub, hit.tab);
}

if (typeof window !== 'undefined') {
  window.addEventListener('nimbalyst:toggle-panel', onTogglePanelEvent);
}

/* ── shell ──────────────────────────────────────────────────────────── */

export interface HubTab {
  id: string;
  label: string;
  component: ComponentType<PanelHostProps>;
}

export function HubShell({
  hubId,
  tabs,
  defaultTab,
  hostProps,
  banner,
}: {
  hubId: HubId;
  tabs: HubTab[];
  defaultTab: string;
  /** The host's PanelHostProps, passed through to the active tab's panel. */
  hostProps: PanelHostProps;
  /** Optional strip above the tab rail (e.g. a desk-wide status line). */
  banner?: ReactNode;
}): JSX.Element {
  ensurePanelKitStyles();
  const [tabId, setTabId] = useState<string>(() => getActiveHubTab(hubId, defaultTab));

  useEffect(
    () => subscribeHubTabs(() => setTabId(getActiveHubTab(hubId, defaultTab))),
    [hubId, defaultTab]
  );

  const active = tabs.find(t => t.id === tabId) ?? tabs[0];
  const Active = active.component;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: tone.bg }}>
      {banner}
      <div
        role="tablist"
        aria-label={hubId === 'strategy-lab' ? 'Strategy Lab sections' : 'Live Desk sections'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '8px 14px',
          borderBottom: `1px solid ${tone.border}`,
          flex: 'none',
          overflowX: 'auto',
        }}
      >
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="apk-hubtab"
            aria-selected={t.id === active.id}
            data-active={t.id === active.id || undefined}
            onClick={() => openHubTab(hubId, t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" style={{ flex: 1, minHeight: 0 }}>
        <Active {...hostProps} key={active.id} />
      </div>
    </div>
  );
}
