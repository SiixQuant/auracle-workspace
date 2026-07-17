/**
 * Overwrite-safe write for the "create-file" IPC handler.
 *
 * The handler used to call plain writeFile, which silently overwrote any
 * existing file at the target path. New-file creation must never clobber an
 * existing strategy, so we write with the exclusive `wx` flag and translate the
 * resulting EEXIST into a structured result the renderer can distinguish from a
 * generic failure.
 */

export interface CreateFileResult {
  success: boolean;
  filePath?: string;
  error?: string;
  /** Set to 'FILE_EXISTS' when the write was refused because the target exists. */
  errorCode?: string;
}

/** Injected file writer. Matches fs.promises.writeFile's (path, data, options) shape. */
export type ExclusiveWriter = (
  filePath: string,
  content: string,
  options: { encoding: 'utf-8'; flag: 'wx' },
) => Promise<void>;

/**
 * Write `content` to `filePath`, refusing to overwrite an existing file.
 * Returns a structured result rather than throwing so the IPC handler can
 * report it to the renderer.
 */
export async function writeNewFile(
  filePath: string,
  content: string,
  writer: ExclusiveWriter,
): Promise<CreateFileResult> {
  try {
    await writer(filePath, content, { encoding: 'utf-8', flag: 'wx' });
    return { success: true, filePath };
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      return {
        success: false,
        filePath,
        errorCode: 'FILE_EXISTS',
        error: 'A file with that name already exists',
      };
    }
    return { success: false, filePath, error: error?.message ?? String(error) };
  }
}
