/**
 * The pack's single rail button.
 *
 * One pack, one button (the SDK's `gutterButton` contribution, so the pack
 * owns what it draws). It carries the open-alert count, because with every
 * surface now inside the Grid the rail is the only place an unopened problem
 * can announce itself: a number here is the difference between "something is
 * wrong" and finding out tomorrow.
 *
 * The count comes from {@link alertStore}, which reads the engine's incident
 * feed and reports ZERO when the engine did not answer — the badge never
 * shows a number it cannot stand behind. Absent alerts, no badge renders at
 * all: a "0" is decoration, not information.
 */
import { useSyncExternalStore } from 'react';
import type { PanelGutterButtonProps } from '@nimbalyst/extension-sdk';
import { alertStore } from '../../engine/alertStore';
import { ensurePanelKitStyles, tone } from '../panelkit';

/** Above this the exact number stops mattering and the glyph would not fit. */
const BADGE_CAP = 99;

export function GridGutterButton({ isActive, onActivate }: PanelGutterButtonProps): JSX.Element {
  // The rail renders before any panel does, so the kit's sheet (which carries
  // the focus ring below) may not be on the page yet.
  ensurePanelKitStyles();
  const alerts = useSyncExternalStore(
    alertStore.subscribe,
    alertStore.getSnapshot,
    () => 0
  );

  const label =
    alerts > 0 ? `Auracle (${alerts} open ${alerts === 1 ? 'alert' : 'alerts'})` : 'Auracle';

  return (
    <button
      type="button"
      className="apk-btn"
      data-testid="auracle-grid-gutter-button"
      data-alert-count={alerts}
      aria-label={label}
      aria-pressed={isActive}
      title={label}
      onClick={onActivate}
      style={{
        position: 'relative',
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        background: isActive ? tone.accentSoft : 'transparent',
        color: isActive ? tone.accentText : tone.text2,
      }}
    >
      <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20 }}>
        grid_view
      </span>
      {alerts > 0 && (
        <span
          data-testid="auracle-grid-gutter-badge"
          aria-hidden
          style={{
            position: 'absolute',
            top: 1,
            right: 1,
            minWidth: 15,
            height: 15,
            padding: '0 3px',
            boxSizing: 'border-box',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            background: tone.danger,
            color: tone.text,
            fontSize: 9.5,
            fontWeight: 700,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            pointerEvents: 'none',
          }}
        >
          {alerts > BADGE_CAP ? `${BADGE_CAP}+` : alerts}
        </span>
      )}
    </button>
  );
}
