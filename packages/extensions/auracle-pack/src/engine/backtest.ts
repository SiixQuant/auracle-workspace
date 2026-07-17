/**
 * Backtest view model — pure helpers for the "Run this file" editor action.
 *
 * The engine discovers strategies as dotted `module.Symbol` ids
 * (/ui/api/backtest/strategies), but the editor knows only the open FILE.
 * These helpers bridge the two: resolve an open .py file to the strategy id
 * the engine expects, shape the discovery rows, and build the AI hand-off.
 *
 * No network here — the store owns the engine calls (POST /run + poll). Pure
 * so it can be unit-tested without a renderer or a running engine.
 */

/** One deployable strategy from the discovery endpoint. */
export interface StrategyOption {
  /** Dotted `module.Symbol` — passed verbatim to the engine as strategy_path. */
  path: string;
  /** The trailing symbol (class or backtest_* fn name), for display. */
  cls: string;
  /** `cls — first docstring line`, or just `cls`. */
  label: string;
}

/** Resolving an open file against the discovery list. */
export type Resolution =
  | { kind: 'one'; option: StrategyOption }
  | { kind: 'many'; options: StrategyOption[] }
  | { kind: 'none' };

/**
 * Shape the raw discovery rows into StrategyOptions, dropping empty paths.
 * Mirrors ValidationPanel's dropdown mapping but keeps `cls` separately so
 * file resolution can compare against the module, not the label.
 */
export function strategyOptionsFromDiscovery(
  rows: Array<Record<string, unknown>>
): StrategyOption[] {
  return rows
    .map((s) => {
      const path = typeof s.path === 'string' ? s.path : '';
      const doc = typeof s.doc === 'string' ? s.doc : '';
      const cls = path.split('.').pop() ?? path;
      return { path, cls, label: doc ? `${cls} — ${doc}` : cls };
    })
    .filter((s) => s.path.length > 0);
}

/** The file's basename without directory or the `.py` suffix. */
export function fileStem(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  return base.replace(/\.py$/i, '');
}

/** The module portion of a discovery id — the dotted path minus its symbol. */
export function moduleOf(strategyPath: string): string {
  const dot = strategyPath.lastIndexOf('.');
  return dot > 0 ? strategyPath.slice(0, dot) : strategyPath;
}

/** Path split into segments, `.py` dropped: "/a/Potential/t25.py" -> ["a","Potential","t25"]. */
function pathSegments(filePath: string): string[] {
  return filePath
    .replace(/\.py$/i, '')
    .split(/[\\/]/)
    .filter((s) => s.length > 0);
}

/** How many trailing segments two paths agree on, compared from the end. */
function commonSuffixLength(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}

/**
 * Resolve the open file to the strategy the engine should run.
 *
 * A discovery id is `module.Symbol`; the module's LAST segment is the source
 * file's stem (e.g. `strategies.desk.Potential.a3_target25.T25Composite` came
 * from `a3_target25.py`). Matching on the stem ALONE is directory-blind: two
 * files with the same basename in different packages — realistic under the desk
 * mount's subdirs — both match, so the wrong one can run. So we rank every stem
 * match by how many TRAILING path segments it shares with the open file
 * (`Potential/breakout.py` prefers `...Potential.breakout` over
 * `...Sandbox.breakout`) and take the closest. Ties (e.g. several strategy
 * classes in one file) fall through to the caller's picker.
 *
 * ponytail: a lone stem match in a *different* directory still resolves to it
 * (nothing competes to outrank it). Running a non-strategy file whose basename
 * collides with a real strategy elsewhere is the residual case; the common
 * multi-candidate collisions are handled.
 */
export function resolveStrategyFromFile(
  filePath: string,
  options: StrategyOption[]
): Resolution {
  const segs = pathSegments(filePath);
  const stem = segs[segs.length - 1] ?? '';
  if (!stem) return { kind: 'none' };
  const scored = options
    .map((o) => ({ option: o, score: commonSuffixLength(segs, moduleOf(o.path).split('.')) }))
    .filter((s) => s.score >= 1); // the stem itself must match
  if (scored.length === 0) return { kind: 'none' };
  const best = Math.max(...scored.map((s) => s.score));
  const winners = scored.filter((s) => s.score === best).map((s) => s.option);
  if (winners.length === 1) return { kind: 'one', option: winners[0] };
  return { kind: 'many', options: winners };
}

/** A strategy the engine found but declined to run, with its reason. */
export interface ExcludedStrategy {
  /** The file or dotted-module path the engine excluded. */
  path: string;
  /** Why it was left out — shown to the user verbatim. */
  reason: string;
}

/** First of the candidates that is a non-empty string, else null. */
function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) if (typeof c === 'string' && c.length > 0) return c;
  return null;
}

/**
 * Shape a discovery response's `excluded` array into {path, reason} rows,
 * tolerating field-name variants (path/rel_path/file, reason/detail/why) and
 * an absent or non-array value (older engines never send the key). A row needs
 * both a path and a reason to be useful, so partial rows are dropped.
 */
export function excludedFromDiscovery(raw: unknown): ExcludedStrategy[] {
  if (!Array.isArray(raw)) return [];
  const out: ExcludedStrategy[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const path = firstString(r.path, r.rel_path, r.file);
    const reason = firstString(r.reason, r.detail, r.why);
    if (path && reason) out.push({ path, reason });
  }
  return out;
}

/**
 * The exclusion reason for the open file, or null if it wasn't excluded.
 *
 * Same directory-aware match as {@link resolveStrategyFromFile}: rank each
 * excluded entry by how many TRAILING path segments it shares with the open
 * file and take the closest, so a `Potential/breakout.py` exclusion isn't
 * confused with a `Sandbox/breakout.py` one. The excluded path may be a file
 * path or a dotted module, so its segments split on either separator.
 */
export function excludedReasonForFile(
  filePath: string,
  excluded: ExcludedStrategy[]
): string | null {
  const segs = pathSegments(filePath);
  const stem = segs[segs.length - 1] ?? '';
  if (!stem || excluded.length === 0) return null;
  let best: { reason: string; score: number } | null = null;
  for (const ex of excluded) {
    const exSegs = ex.path
      .replace(/\.py$/i, '')
      .split(/[./\\]/)
      .filter((s) => s.length > 0);
    const score = commonSuffixLength(segs, exSegs);
    if (score >= 1 && (!best || score > best.score)) best = { reason: ex.reason, score };
  }
  return best ? best.reason : null;
}

/**
 * The basenames (last path segment, `.py` stripped) the engine already knows —
 * every discovered strategy plus every excluded file. The rescue card uses this
 * to pick a scaffold slot whose file does not yet exist, so a "Start from the
 * scaffold" can never overwrite a user's file even though the engine's
 * strategy-source save is itself an overwrite.
 */
export function knownStrategyBasenames(
  options: StrategyOption[],
  excluded: ExcludedStrategy[]
): Set<string> {
  const out = new Set<string>();
  const add = (raw: string) => {
    const segs = raw
      .replace(/\.py$/i, '')
      .split(/[./\\]/)
      .filter((s) => s.length > 0);
    const last = segs[segs.length - 1];
    if (last) out.add(last);
  };
  for (const o of options) add(moduleOf(o.path));
  for (const e of excluded) add(e.path);
  return out;
}

/** Identity of a backtest run, for the results link + AI hand-off. */
export interface BacktestRunInfo {
  strategyPath: string;
  cls: string;
  jobId: number;
}

/**
 * Ambient context a completed run publishes to the AI chat via
 * `host.ai.setContext` (the panel is `aiSupported`). Compact + stable so the
 * agent can answer "how did my backtest do?" from any session.
 */
export function backtestContext(run: BacktestRunInfo): Record<string, unknown> {
  return {
    panel: 'backtest',
    strategy_path: run.strategyPath,
    job_id: run.jobId,
  };
}

/**
 * Explicit hand-off prompt for the "Ask the agent" button. The engine doesn't
 * return the stats as JSON, so the prompt points the agent at the run to read
 * and interpret rather than embedding numbers we don't have.
 */
export function backtestPrompt(run: BacktestRunInfo): string {
  return [
    `I just ran a backtest on the strategy \`${run.strategyPath}\` through the Auracle engine (job ${run.jobId}).`,
    '',
    'Read this strategy in my workspace and open its backtest results. Interpret the headline numbers (Sharpe, CAGR, max drawdown) honestly, call out anything that looks like overfitting or a data artifact, and propose concrete, minimal improvements. You can re-run the backtest and the overfit validation through the engine to check your changes.',
  ].join('\n');
}
