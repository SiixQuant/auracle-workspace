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
