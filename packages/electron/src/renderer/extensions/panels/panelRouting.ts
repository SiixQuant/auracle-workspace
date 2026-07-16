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
