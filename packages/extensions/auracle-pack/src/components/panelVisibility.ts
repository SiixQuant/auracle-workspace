/**
 * Tracks whether the Backtest bottom panel is currently mounted (i.e. it is the
 * active extension bottom panel). The host only exposes a TOGGLE event for
 * opening panels, so the Run header consults this to avoid toggling an
 * already-open panel shut on a re-run. The panel unmounts whenever it stops
 * being the active bottom panel, so this flag stays accurate however it was
 * closed (Run header, gutter, or switching to another panel).
 */
let mounted = false;

export function markBacktestPanelMounted(): void {
  mounted = true;
}

export function markBacktestPanelUnmounted(): void {
  mounted = false;
}

export function isBacktestPanelOpen(): boolean {
  return mounted;
}
