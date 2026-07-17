import { nextAvailableName } from '../../shared/strategyModuleName';

/** Shape returned by the create-file IPC (window.electronAPI.createFile). */
interface CreateFileIpcResult {
  success: boolean;
  filePath?: string;
  error?: string;
  errorCode?: string;
}

type CreateFileFn = (
  filePath: string,
  content: string,
) => Promise<CreateFileIpcResult | undefined>;

export interface StrategyCreateResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

/**
 * Create a strategy (.py) file without overwriting an existing one.
 *
 * The main-process wx guard is the authority on collisions: when it reports
 * FILE_EXISTS we treat the name as taken and let nextAvailableName pick the next
 * sanitized candidate (`base`, `base_2`, ..., `base_9`). Any other failure is
 * surfaced immediately. If every candidate is taken we return a clear
 * already-exists message rather than clobbering anything.
 */
export async function createStrategyFileNoOverwrite(
  directory: string,
  baseName: string,
  ext: string,
  content: string,
  createFile: CreateFileFn,
): Promise<StrategyCreateResult> {
  const taken = new Set<string>();

  for (;;) {
    const candidate = nextAvailableName(baseName, (name) => taken.has(name));
    if (candidate === null) {
      return { success: false, error: 'A file with that name already exists' };
    }

    const filePath = `${directory}/${candidate}${ext}`;
    const result = await createFile(filePath, content);

    if (result?.success) {
      return { success: true, filePath };
    }
    if (result?.errorCode === 'FILE_EXISTS') {
      taken.add(candidate);
      continue;
    }
    return { success: false, error: result?.error || 'Unknown error' };
  }
}
