/**
 * Extension panel toggle routing.
 *
 * A panel's declared placement decides which host state slot renders it:
 * `activeExtensionPanel` backs both `sidebar` and `fullscreen` placements, while
 * `activeExtensionBottomPanel` backs the bottom dock. The `nimbalyst:toggle-panel`
 * event must mutate the slot that actually renders the target panel — toggling
 * the bottom slot for a fullscreen panel is a silent no-op (the fullscreen render
 * slot reads a different state), which is how the editor Deploy button opened
 * nothing.
 */
import type { RegisteredPanel } from './PanelRegistry';
import type { ContentMode } from '../../types/WindowModeTypes';

/** The host state slot that renders a panel. */
export type ExtensionPanelSlot = 'panel' | 'bottomPanel';

/**
 * Which host state slot a toggle-panel request should mutate, decided by the
 * target panel's declared placement.
 *
 * - `fullscreen` / `sidebar` render from `activeExtensionPanel` → `'panel'`.
 * - `bottom` (and any unspecified placement) render from
 *   `activeExtensionBottomPanel` → `'bottomPanel'`, preserving the original dock
 *   default.
 * - An unresolved panel (id not in the registry) returns `null` so the caller
 *   no-ops instead of mutating a slot for a phantom panel.
 */
export function panelToggleSlot(
  panel: Pick<RegisteredPanel, 'placement'> | undefined
): ExtensionPanelSlot | null {
  if (!panel) return null;
  return panel.placement === 'fullscreen' || panel.placement === 'sidebar'
    ? 'panel'
    : 'bottomPanel';
}

/**
 * Build the alias → canonical-id index for a panel set. Canonical ids always
 * win a collision: a stale alias can never shadow a real registered panel.
 */
export function buildAliasIndex(
  panels: Array<Pick<RegisteredPanel, 'id' | 'aliases'>>
): Map<string, string> {
  const index = new Map<string, string>();
  for (const panel of panels) {
    for (const alias of panel.aliases) {
      index.set(alias, panel.id);
    }
  }
  for (const panel of panels) {
    index.delete(panel.id);
  }
  return index;
}

/**
 * Next value for a toggle slot.
 *
 * A request addressed to the panel's OWN id is a toggle: pressing the rail
 * button again closes it. A request addressed to an ABSORBED id (resolved
 * here through an alias) is a NAVIGATION — the caller asked for a specific
 * surface, not for a toggle — so it must never close the hub that now owns
 * that surface. Without this split, a hand-off to e.g. `…pack.blotter` while
 * the Live Desk is already open would shut the desk instead of showing the
 * blotter.
 */
export function panelToggleNext(
  prev: string | null,
  panel: Pick<RegisteredPanel, 'id'>,
  requestedId: string
): string | null {
  const viaAlias = panel.id !== requestedId;
  if (viaAlias) return panel.id;
  return prev === panel.id ? null : panel.id;
}

/**
 * Whether a window-mode change must also dismiss the open fullscreen panel.
 *
 * A fullscreen panel is drawn OVER every mode, so a mode switch made while one
 * is up lands behind it and reads as "nothing happened" — a panel that opens a
 * file, or hands a prompt to the agent, would otherwise leave the user staring
 * at the panel it came from. The gutter and keyboard paths already clear the
 * panel on the way through; this lets the host apply the same rule to the
 * programmatic switches that do not go through either.
 *
 * Only a real CHANGE dismisses: re-asserting the current mode (or opening the
 * panel itself, which does not move the mode) must leave the panel up.
 * Sidebar-placement panels are not fullscreen and so are never dismissed —
 * they are designed to sit alongside files mode.
 */
export function shouldDismissFullscreenPanel(
  previousMode: ContentMode,
  nextMode: ContentMode,
  isFullscreenPanelActive: boolean
): boolean {
  return isFullscreenPanelActive && previousMode !== nextMode;
}
