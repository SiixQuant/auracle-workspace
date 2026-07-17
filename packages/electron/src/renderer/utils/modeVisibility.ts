/**
 * Simple / Developer mode tree visibility.
 *
 * This is the pure decision that Simple mode composes on TOP of the
 * user-selectable file-tree filter (an independent axis -- never a
 * FileTreeFilter enum value, because reveal actions force-reset that filter).
 *
 * Developer mode renders the raw filesystem exactly as today (identity).
 * Simple mode shows a positive allowlist of strategy-authoring file classes,
 * the Canonical folders as containers (even when empty), and any file whose
 * path is in `openPaths` (open editor tabs + temporarily-revealed files).
 *
 * Visibility here is strictly a view concern: it only changes what the tree
 * renders, never what the engine discovers or runs.
 */

/**
 * Minimal structural shape of a file-tree node. Matches
 * `RendererFileTreeItem` so the host can pass its tree straight through,
 * while keeping this module free of store/electron imports for testability.
 */
export interface ModeTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: ModeTreeNode[];
}

/**
 * File extensions shown in Simple mode (the positive allowlist).
 *
 * Note: `.flow.json` is a compound extension and is intentionally distinct
 * from a plain `.json` (which stays hidden). `.py` MUST be here -- the host's
 * existing `knownExtensions` list does not include it.
 */
export const SIMPLE_MODE_ALLOWED_EXTENSIONS: readonly string[] = [
  '.py',
  '.flow.json',
  '.md',
  '.pdf',
  '.ipynb',
];

/**
 * Top-level workspace folders always shown as containers in Simple mode,
 * even when empty. Organizational only -- no folder-name semantics are
 * enforced (a strategy anywhere still deploys).
 */
export const CANONICAL_FOLDERS: ReadonlySet<string> = new Set([
  'Potential',
  'Live',
  'Tearsheets',
  'Testing',
  'Trashed',
  'Analysis',
]);

export interface ModeVisibilityOptions {
  /** When true, the tree is returned untouched (raw filesystem view). */
  developerMode: boolean;
  /**
   * Paths that must stay visible regardless of the allowlist -- open editor
   * tabs and temporarily-revealed files. Callers MUST normalize entries with
   * {@link normalizeVisibilityPath} so membership checks line up.
   */
  openPaths: Set<string>;
}

/**
 * Normalize a path for open-tab / reveal membership checks: forward slashes,
 * no trailing slash. Callers building `openPaths` and this module both run
 * paths through here so comparisons never diverge on slash direction.
 */
export function normalizeVisibilityPath(path: string): string {
  if (!path) return '';
  let normalized = path.replace(/\\/g, '/');
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.replace(/\/+$/, '');
  }
  return normalized;
}

/**
 * Whether a file name is on the Simple-mode allowlist. Exported so the reveal
 * escape hatch can tell whether a revealed file would otherwise be hidden.
 */
export function isSimpleAllowlistedFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SIMPLE_MODE_ALLOWED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function filterLevel<T extends ModeTreeNode>(
  items: T[],
  isTopLevel: boolean,
  openPaths: Set<string>
): T[] {
  const result: T[] = [];

  for (const item of items) {
    if (item.type === 'directory') {
      const survivingChildren = item.children
        ? filterLevel(item.children as T[], false, openPaths)
        : [];
      const isCanonical = isTopLevel && CANONICAL_FOLDERS.has(item.name);
      // A directly-revealed folder (its own path in openPaths) is kept as a
      // container so a reveal is never a no-op, even when empty/all-hidden.
      const isRevealed = openPaths.has(normalizeVisibilityPath(item.path));
      if (isCanonical || isRevealed || survivingChildren.length > 0) {
        result.push({ ...item, children: survivingChildren });
      }
    } else if (
      isSimpleAllowlistedFile(item.name) ||
      openPaths.has(normalizeVisibilityPath(item.path))
    ) {
      result.push(item);
    }
  }

  return result;
}

/**
 * Apply the Simple / Developer mode visibility decision to a (already
 * user-filtered) file tree.
 *
 * - Developer mode: identity (returns the same array reference).
 * - Simple mode: keep a FILE iff its extension is allowlisted OR its path is
 *   in `openPaths`; keep a DIRECTORY iff it is a top-level Canonical folder OR
 *   still has surviving children. Recurses depth-first.
 */
export function applyModeVisibility<T extends ModeTreeNode>(
  tree: T[],
  opts: ModeVisibilityOptions
): T[] {
  if (opts.developerMode) {
    return tree;
  }
  return filterLevel(tree, true, opts.openPaths);
}

/**
 * Count the files (not directories) in a tree. Used to derive the
 * hidden-file count: `countTreeFiles(beforeMode) - countTreeFiles(afterMode)`.
 */
export function countTreeFiles(tree: ModeTreeNode[]): number {
  let count = 0;
  for (const item of tree) {
    if (item.type === 'directory') {
      count += item.children ? countTreeFiles(item.children) : 0;
    } else {
      count += 1;
    }
  }
  return count;
}
