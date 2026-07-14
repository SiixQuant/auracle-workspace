/**
 * Deploy-from-file view model — pure helpers for the editor "Deploy" action.
 *
 * The editor knows only the open FILE; the deploy wizard needs a discovered
 * Strategy CLASS (function-based backtests can't run live). These helpers
 * bridge the two: resolve an open .py file to the deployable strategy the
 * engine expects, name the reason when it can't, and shape the picker's
 * exclusions list. Reuses the same file→discovery resolution the backtest
 * header uses (`resolveStrategyFromFile`) — no new resolution machinery.
 *
 * No network here — deployStore owns the engine call. Pure so it unit-tests
 * without a renderer or a running engine.
 */
import {
  resolveStrategyFromFile,
  strategyOptionsFromDiscovery,
  type StrategyOption,
} from './backtest';

export type { StrategyOption } from './backtest';

/**
 * Why a file resolved to no deployable strategy.
 *  - `function-only`: the file matched a discovered `backtest_*` function but
 *    no Strategy class — it backtests, but live deploy needs a class.
 *  - `no-match`: the engine discovered nothing for this file at all (it isn't
 *    a strategy, or it failed to import / didn't subclass Strategy — the
 *    picker's exclusions list carries the specific reason).
 */
export type DeployBlockReason = 'function-only' | 'no-match';

/** Resolving an open file to the strategy the deploy wizard should bind to. */
export type DeployResolution =
  | { kind: 'one'; option: StrategyOption }
  | { kind: 'many'; options: StrategyOption[] }
  | { kind: 'blocked'; reason: DeployBlockReason };

/**
 * Split raw discovery rows by `kind`. The `?deployable=1` response carries
 * BOTH class and function entries (the engine filters by bundled/workspace,
 * not by kind); only classes are deployable. A row is a class unless it is
 * explicitly `kind: "function"`, so an older engine that omits `kind`
 * defaults to class — matching the wizard picker's own filter.
 */
export function splitDiscoveryByKind(rows: Array<Record<string, unknown>>): {
  classes: StrategyOption[];
  functions: StrategyOption[];
} {
  return {
    classes: strategyOptionsFromDiscovery(rows.filter((r) => r.kind !== 'function')),
    functions: strategyOptionsFromDiscovery(rows.filter((r) => r.kind === 'function')),
  };
}

/**
 * Resolve the open file to a deployable strategy, or explain why it can't be.
 *
 * Match against deployable CLASSES first (`one`/`many` bind the wizard). Only
 * when no class matches do we ask whether a `backtest_*` FUNCTION in the file
 * matched — that's an honest "backtests but can't deploy live" rather than a
 * generic "not a strategy". Everything else is `no-match`, which the picker's
 * exclusions list explains file-by-file.
 */
export function resolveDeployableFromFile(
  filePath: string,
  rows: Array<Record<string, unknown>>
): DeployResolution {
  const { classes, functions } = splitDiscoveryByKind(rows);
  const asClass = resolveStrategyFromFile(filePath, classes);
  if (asClass.kind === 'one') return { kind: 'one', option: asClass.option };
  if (asClass.kind === 'many') return { kind: 'many', options: asClass.options };
  const asFunction = resolveStrategyFromFile(filePath, functions);
  if (asFunction.kind !== 'none') return { kind: 'blocked', reason: 'function-only' };
  return { kind: 'blocked', reason: 'no-match' };
}

/** One file discovery saw but dropped, with the engine's human reason. */
export interface DeployExclusion {
  file: string;
  reason: string;
}

/**
 * Parse the additive `excluded` field on the deployable-discovery response.
 * Absent, empty, or malformed → [] (older engines don't send it, and the
 * picker then simply renders no expander — dual-read tolerant).
 */
export function exclusionsFromDiscovery(
  body: { excluded?: unknown } | null | undefined
): DeployExclusion[] {
  const raw = body?.excluded;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const rec = (entry ?? {}) as Record<string, unknown>;
      const file = typeof rec.file === 'string' ? rec.file : '';
      const reason = typeof rec.reason === 'string' ? rec.reason : '';
      return { file, reason };
    })
    .filter((e) => e.file.length > 0);
}

/** The honest title + detail the wizard shows for a non-deployable file. */
export function blockedReasonText(reason: DeployBlockReason): { title: string; detail: string } {
  if (reason === 'function-only') {
    return {
      title: 'This file backtests, but can’t deploy live',
      detail:
        'It defines only backtest functions. A live deploy needs a Strategy class — port the backtest_* function to a Strategy subclass to deploy it.',
    };
  }
  return {
    title: 'Not a deployable strategy',
    detail:
      'This file isn’t a Strategy the engine can deploy. Files that fail to import or don’t define a Strategy class are listed with their reason in the deploy picker’s exclusions.',
  };
}

/* ── store snapshot + wizard-view selector ──────────────────────────── */

export type DeployPhase = 'idle' | 'resolving' | 'engine-down' | 'one' | 'many' | 'blocked';

/** What deployStore holds — the file→strategy binding the wizard consumes. */
export interface DeploySnapshot {
  /** Absolute path of the .py the deploy was launched from. */
  file: string | null;
  phase: DeployPhase;
  /** The resolved strategy, phase 'one' (the pre-bound identity). */
  option: StrategyOption | null;
  /** Candidate classes when the file defines several, phase 'many'. */
  options: StrategyOption[];
  /** Why the file can't deploy, phase 'blocked'. */
  reason: DeployBlockReason | null;
  /** engine-down was a 404/405 — the build predates the route, not unreachable. */
  outdated: boolean;
}

/**
 * The wizard sub-view for a deploy snapshot. `null` (no launch from a file) and
 * `idle` both mean the normal Live-page wizard: the global picker. Pure so the
 * component stays a thin renderer and the state machine is unit-tested here.
 */
export type DeployWizardMode =
  | { view: 'resolving' }
  | { view: 'engine-down'; outdated: boolean }
  | { view: 'blocked'; reason: DeployBlockReason }
  | { view: 'chooser'; options: StrategyOption[] }
  | { view: 'form'; locked: StrategyOption | null };

export function deployWizardMode(snap: DeploySnapshot | null): DeployWizardMode {
  if (!snap || snap.phase === 'idle') return { view: 'form', locked: null };
  switch (snap.phase) {
    case 'resolving':
      return { view: 'resolving' };
    case 'engine-down':
      return { view: 'engine-down', outdated: snap.outdated };
    case 'blocked':
      return { view: 'blocked', reason: snap.reason ?? 'no-match' };
    case 'many':
      return { view: 'chooser', options: snap.options };
    case 'one':
      return { view: 'form', locked: snap.option };
  }
}
