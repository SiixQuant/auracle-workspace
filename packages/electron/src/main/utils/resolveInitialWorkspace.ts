/**
 * Decides which workspace the IDE should open on launch. Pure by design: the
 * caller injects the directory-existence check so this module stays free of
 * `fs`/`electron` and is fully unit-testable.
 *
 * Precedence, in order:
 *   1. A saved/restored workspace always wins. Existing users are untouched,
 *      and we deliberately do not re-validate it here -- that is the restore
 *      path's concern.
 *   2. Otherwise a launcher-provisioned canonical Workspace, but only when its
 *      directory actually exists on disk (the fresh-install first-launch case).
 *   3. Otherwise null -- the caller keeps today's welcome-screen behavior.
 */
export interface ResolveInitialWorkspaceInput {
  /** Workspace restored from persisted window state, or null when none. */
  savedWorkspacePath: string | null;
  /** Canonical Workspace path from the launcher provisioning config, or null. */
  provisionedWorkspacePath: string | null;
  /** Real existence check (e.g. fs.existsSync + isDirectory) injected by the caller. */
  workspaceDirExists: (candidatePath: string) => boolean;
}

export function resolveInitialWorkspace(input: ResolveInitialWorkspaceInput): string | null {
  const { savedWorkspacePath, provisionedWorkspacePath, workspaceDirExists } = input;

  if (typeof savedWorkspacePath === 'string' && savedWorkspacePath.length > 0) {
    return savedWorkspacePath;
  }

  if (
    typeof provisionedWorkspacePath === 'string' &&
    provisionedWorkspacePath.length > 0 &&
    workspaceDirExists(provisionedWorkspacePath)
  ) {
    return provisionedWorkspacePath;
  }

  return null;
}
