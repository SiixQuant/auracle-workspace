/**
 * Tracks whether a pack panel is currently mounted (i.e. it is the active
 * extension panel of its slot). The host only exposes a TOGGLE event for
 * opening panels, so an editor header consults this to avoid toggling an
 * already-open panel shut on a repeat press. A panel unmounts whenever it
 * stops being active, so these flags stay accurate however it was closed.
 */
let backtestMounted = false;
let liveMounted = false;

export function markBacktestPanelMounted(): void {
  backtestMounted = true;
}

export function markBacktestPanelUnmounted(): void {
  backtestMounted = false;
}

export function isBacktestPanelOpen(): boolean {
  return backtestMounted;
}

export function markLivePanelMounted(): void {
  liveMounted = true;
}

export function markLivePanelUnmounted(): void {
  liveMounted = false;
}

export function isLivePanelOpen(): boolean {
  return liveMounted;
}
