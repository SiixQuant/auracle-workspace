/**
 * Spine navigation — the one shape-aware transform the cross-panel "open the
 * source" edges share. Panels report a strategy by its dotted engine id, but
 * the editor opens WORKSPACE-relative files; this maps the former to the
 * latter without ever handing the editor an engine-container absolute path.
 *
 * The two report shapes differ and a naive `rsplit('.', 1)` corrupts one of
 * them, so the caller states which it holds:
 *   - Validation reports `module.Class` (the trailing segment is the class,
 *     NOT part of the file path) — `hasClassSuffix: true`.
 *   - A deployment reports the module ALONE (its class rides a separate field)
 *     — `hasClassSuffix: false`. Stripping a segment here would drop a real
 *     module and open the wrong file.
 *
 * The derived path mirrors the engine's own module→file convention: user
 * strategies live under the workspace `strategies` package, so
 * `strategies.foo.Bar` → `strategies/foo.py`.
 */

/** Where a panel's strategy identity points in the editable workspace. */
export interface StrategySource {
  /** Workspace-relative `.py` path derived from the dotted module. Always set
   *  for a well-formed strategy id, so it can serve as a focus identity even
   *  when the file itself cannot be opened here. Never an absolute path. */
  path: string;
  /** True when {@link path} is a real, openable file in the editable
   *  workspace — i.e. safe to hand to `host.openFile`. */
  openable: boolean;
  /** Present only when {@link openable} is false: a plain reason, for a
   *  disabled affordance rather than a silent no-op. */
  reason?: string;
}

const OUTSIDE_WORKSPACE =
  "This strategy lives outside your workspace, so it can't be opened in the editor.";
const DESK_MOUNTED =
  "This strategy is mounted from a folder outside your workspace, so it can't be opened in the editor.";

/**
 * Resolve a dotted engine strategy id to its workspace source file.
 *
 * Returns null only when there is no module to derive a path from (an empty or
 * class-only id). Otherwise always returns a `path`; `openable` is false (with
 * a reason) when the module is not an editable workspace strategy:
 *   - it is not under the `strategies` package (a bundled example, say), or
 *   - it is desk-grafted (`strategies.desk.*`), which is mounted into the
 *     engine, not the editable workspace tree, so the editor cannot open it.
 */
export function strategySourceFromDotted(
  strategyPath: string,
  opts: { hasClassSuffix: boolean }
): StrategySource | null {
  const segments = (strategyPath ?? '')
    .split('.')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const moduleSegs = opts.hasClassSuffix ? segments.slice(0, -1) : segments;
  if (moduleSegs.length === 0) return null;

  const path = moduleSegs.join('/') + '.py';
  if (moduleSegs[0] !== 'strategies' || moduleSegs.length < 2) {
    return { path, openable: false, reason: OUTSIDE_WORKSPACE };
  }
  if (moduleSegs[1] === 'desk') {
    return { path, openable: false, reason: DESK_MOUNTED };
  }
  return { path, openable: true };
}
