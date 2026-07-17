import { describe, it, expect, vi } from 'vitest';
import { resolveInitialWorkspace } from '../resolveInitialWorkspace';

const SAVED = '/Users/me/Documents/Saved Workspace';
const PROVISIONED = '/Users/me/Documents/Auracle Strategies';

describe('resolveInitialWorkspace', () => {
  const existsAlways = (): boolean => true;
  const existsNever = (): boolean => false;

  it('returns the saved workspace, which wins over a provisioned one', () => {
    expect(
      resolveInitialWorkspace({
        savedWorkspacePath: SAVED,
        provisionedWorkspacePath: PROVISIONED,
        workspaceDirExists: existsAlways,
      })
    ).toBe(SAVED);
  });

  it('never consults the existence check for a saved workspace', () => {
    const workspaceDirExists = vi.fn(() => false);

    const result = resolveInitialWorkspace({
      savedWorkspacePath: SAVED,
      provisionedWorkspacePath: PROVISIONED,
      workspaceDirExists,
    });

    expect(result).toBe(SAVED);
    expect(workspaceDirExists).not.toHaveBeenCalled();
  });

  it('returns the provisioned workspace when there is no saved one and its directory exists', () => {
    expect(
      resolveInitialWorkspace({
        savedWorkspacePath: null,
        provisionedWorkspacePath: PROVISIONED,
        workspaceDirExists: existsAlways,
      })
    ).toBe(PROVISIONED);
  });

  it('returns null when the provisioned directory does not exist', () => {
    expect(
      resolveInitialWorkspace({
        savedWorkspacePath: null,
        provisionedWorkspacePath: PROVISIONED,
        workspaceDirExists: existsNever,
      })
    ).toBeNull();
  });

  it('returns null when neither a saved nor a provisioned workspace is set', () => {
    expect(
      resolveInitialWorkspace({
        savedWorkspacePath: null,
        provisionedWorkspacePath: null,
        workspaceDirExists: existsAlways,
      })
    ).toBeNull();
  });

  it('treats an empty-string saved workspace as absent and falls through to the provisioned one', () => {
    expect(
      resolveInitialWorkspace({
        savedWorkspacePath: '',
        provisionedWorkspacePath: PROVISIONED,
        workspaceDirExists: existsAlways,
      })
    ).toBe(PROVISIONED);
  });

  it('treats an empty-string provisioned path as absent', () => {
    expect(
      resolveInitialWorkspace({
        savedWorkspacePath: null,
        provisionedWorkspacePath: '',
        workspaceDirExists: existsAlways,
      })
    ).toBeNull();
  });
});
