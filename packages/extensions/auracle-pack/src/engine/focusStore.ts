/**
 * Focus store — the Spine's routing layer.
 *
 * ## What it is
 * A tiny module-level store (the fifth instance of the pack's
 * `subscribe`/`getSnapshot`/`set` pattern, alongside `backtestStore`,
 * `deployStore`, the hub tab store and `statusChipState`) that names the ONE
 * strategy and the ONE run the user is currently looking at. Independent panels
 * and the AI chat align through it without knowing about each other: a panel
 * PUBLISHES the identity it just acted on and READS the current identity on
 * open.
 *
 * ## Replace vs. beside — it SITS BESIDE (decision)
 * The per-domain stores (`backtestStore`, `deployStore`) remain the single
 * source of truth for their run data: job lifecycle and result curves, the
 * deploy binding. This store holds identities ONLY, never run data. It sits
 * beside those stores as a routing layer, so a panel that already subscribes to
 * a domain store keeps driving its heavy state from there, while publishing the
 * lightweight identity here for everyone else to follow. "Beside" was chosen
 * over "replace" because it leaves the domain stores untouched (no migration,
 * no reconciling two sources of truth) and gives panels with no cross-panel
 * store today (Validation) a follow-on-open for free.
 *
 * ## Ambient-AI precedence
 * The AI ambient lane (`host.ai.setContext`) is one last-writer-wins document.
 * The rule: focus context NEVER clobbers an active panel's richer payload. A
 * panel publishes focus FIRST, then writes its own `setContext`; this store
 * writes only a MINIMAL {@link focusContext} as a debounced fallback, and only
 * when no panel wrote its own context after the focus changed. See
 * {@link createFocusAmbient}.
 */

/** The focused strategy — a file identity, optionally with its discovery id. */
export interface FocusedStrategy {
  /** Workspace-relative path of the strategy's `.py` (e.g. `strategies/desk/atlas.py`). */
  filePath: string;
  /** Dotted discovery id when known (e.g. `strategies.desk.atlas.AtlasMomentum`). */
  dottedPath?: string;
}

/**
 * The three run identities a focus can point at, kept distinct so "follow on
 * open" resolves to the right surface — a backtest job, a live deployment, or a
 * validation target — instead of silently collapsing to "backtest job".
 */
export type FocusedRunKind = 'backtest' | 'deployment' | 'validation';

export interface FocusedRun {
  kind: FocusedRunKind;
  /** Opaque identity within its kind: a backtest job id, a deployment id, or a
   *  validation target's strategy path — all stringified. */
  id: string;
}

/** What the user is focused on. Both fields optional: the unfocused default is
 *  the empty object, and a run can be focused without a resolvable file. */
export interface Focus {
  strategy?: FocusedStrategy;
  run?: FocusedRun;
}

const EMPTY: Focus = {};

let state: Focus = EMPTY;
const listeners = new Set<() => void>();

function sameFocus(a: Focus, b: Focus): boolean {
  return (
    a.strategy?.filePath === b.strategy?.filePath &&
    a.strategy?.dottedPath === b.strategy?.dottedPath &&
    a.run?.kind === b.run?.kind &&
    a.run?.id === b.run?.id
  );
}

export const focusStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot(): Focus {
    return state;
  },

  /**
   * Point focus at a strategy and/or run. Routing only — last selection wins,
   * so state is replaced, not merged. A no-op when the focus is unchanged, so a
   * panel re-publishing the same identity on re-render can neither thrash
   * subscribers nor re-arm the ambient fallback.
   */
  publish(next: Focus): void {
    if (sameFocus(state, next)) return;
    state = next;
    for (const listener of listeners) listener();
  },

  /** Drop focus back to the unfocused default. */
  clear(): void {
    if (state === EMPTY) return;
    state = EMPTY;
    for (const listener of listeners) listener();
  },
};

/**
 * The MINIMAL ambient payload the fallback publishes — enough for the agent to
 * know what the user is focused on, and deliberately thinner than any panel's
 * own context so a real panel write always reads as the richer document.
 */
export function focusContext(focus: Focus): Record<string, unknown> {
  const ctx: Record<string, unknown> = { panel: 'focus' };
  if (focus.strategy) {
    ctx.strategy = focus.strategy.dottedPath
      ? { file_path: focus.strategy.filePath, dotted_path: focus.strategy.dottedPath }
      : { file_path: focus.strategy.filePath };
  }
  if (focus.run) ctx.run = { kind: focus.run.kind, id: focus.run.id };
  return ctx;
}

/** Minimal sink the ambient bridge writes to — structurally `host.ai`. */
export interface FocusAmbientSink {
  setContext(context: Record<string, unknown>): void;
  clearContext(): void;
}

export interface FocusAmbient {
  /** Focus changed — arm the debounced fallback, or disarm it when unfocused. */
  onFocusChange(focus: Focus): void;
  /** A panel wrote its own richer context — the fallback is no longer needed. */
  onAmbientWrite(): void;
  /** Tear down any pending timer. */
  dispose(): void;
}

/**
 * Build the focus→ambient bridge that enforces the precedence rule. Pure and
 * timer-driven so the contract test can drive it with fake timers and a mock
 * sink.
 *
 * - `onFocusChange(focus)` with a non-empty focus arms a `debounceMs` timer;
 *   when it fires with no intervening `onAmbientWrite` it writes the minimal
 *   {@link focusContext}. An empty focus disarms and writes nothing — the
 *   unfocused default leaves the ambient document exactly as it was.
 * - `onAmbientWrite()` cancels the pending fallback: an active panel's own
 *   payload has taken the document, and focus must not overwrite it.
 */
export function createFocusAmbient(sink: FocusAmbientSink, debounceMs = 600): FocusAmbient {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return {
    onFocusChange(focus: Focus): void {
      cancel();
      if (!focus.strategy && !focus.run) return;
      timer = setTimeout(() => {
        timer = undefined;
        sink.setContext(focusContext(focus));
      }, debounceMs);
    },
    onAmbientWrite(): void {
      cancel();
    },
    dispose(): void {
      cancel();
    },
  };
}

/* ── module singleton: one bridge per host, driven by the AI panel hook ───── */

let boundSink: FocusAmbientSink | null = null;
let bridge: FocusAmbient | null = null;
let unsubscribeStore: (() => void) | null = null;

/**
 * Bind the focus→ambient bridge to a host's AI sink the first time one appears
 * (every `aiSupported` panel calls this from `useAiPanelContext`). Idempotent
 * for a given sink; rebinds if the host's sink identity changes. Once bound the
 * bridge follows the focus store on its own, so the fallback fires regardless of
 * which panel happens to be mounted.
 */
export function ensureFocusAmbient(sink: FocusAmbientSink, debounceMs = 600): void {
  if (boundSink === sink && bridge) return;
  unsubscribeStore?.();
  bridge?.dispose();
  boundSink = sink;
  bridge = createFocusAmbient(sink, debounceMs);
  bridge.onFocusChange(focusStore.getSnapshot());
  unsubscribeStore = focusStore.subscribe(() => bridge?.onFocusChange(focusStore.getSnapshot()));
}

/** A panel just wrote its own ambient context — cancel any pending focus fallback. */
export function noteFocusAmbientWrite(): void {
  bridge?.onAmbientWrite();
}
