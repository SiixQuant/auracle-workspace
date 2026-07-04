/**
 * BinaryFileView — renders non-text files without ever dumping their raw
 * bytes into a text editor.
 *
 * - `pdf`: a real inline viewer. The file is served same-origin through the
 *   `nim-asset://` protocol and rendered by Chromium's sandboxed built-in PDF
 *   viewer inside an <iframe>.
 * - `binary`: a clean "no preview" panel with Reveal in Finder / Open with
 *   default app, for archives, executables, databases, office docs, etc.
 *
 * This is the guard that replaces the old behavior where any unrecognized
 * file (a tearsheet PDF, a .sqlite, a .dmg, …) fell through to the Monaco
 * text editor and painted its bytes as mojibake.
 */
import React from 'react';
import { nimAssetUrl } from '../../utils/assetUrl';

interface ElectronBridge {
  electronAPI?: {
    openExternal?: (url: string) => Promise<unknown>;
    invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
}

function absolutePath(filePath: string): string {
  return filePath.startsWith('file://') ? filePath.replace(/^file:\/\//, '') : filePath;
}

/** Build a properly-encoded file:// URL (handles spaces / non-ASCII in the path). */
function fileUrl(path: string): string {
  return 'file://' + path.split('/').map(encodeURIComponent).join('/');
}

function revealInFinder(filePath: string): void {
  const api = (window as unknown as ElectronBridge).electronAPI;
  void api?.invoke?.('show-in-finder', absolutePath(filePath));
}

function openExternally(filePath: string): void {
  const api = (window as unknown as ElectronBridge).electronAPI;
  void api?.openExternal?.(fileUrl(absolutePath(filePath)));
}

interface BinaryFileViewProps {
  filePath: string;
  fileName: string;
  kind: 'pdf' | 'binary';
}

export const BinaryFileView: React.FC<BinaryFileViewProps> = ({ filePath, fileName, kind }) => {
  if (kind === 'pdf') {
    return (
      <div className="flex flex-col h-full bg-nim">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-nim bg-nim-secondary">
          <span className="text-[13px] text-nim-muted truncate mr-auto">{fileName}</span>
          <button
            type="button"
            onClick={() => openExternally(filePath)}
            className="px-3 py-1 text-xs rounded border border-nim text-nim hover:bg-nim-hover"
          >
            Open with default app
          </button>
          <button
            type="button"
            onClick={() => revealInFinder(filePath)}
            className="px-3 py-1 text-xs rounded border border-nim text-nim hover:bg-nim-hover"
          >
            Reveal in Finder
          </button>
        </div>
        <iframe
          key={filePath}
          title={fileName}
          src={nimAssetUrl(absolutePath(filePath))}
          className="flex-1 w-full border-0 bg-white"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full bg-nim text-nim-muted">
      <div className="text-center max-w-sm px-6">
        <div className="text-5xl mb-4">🗎</div>
        <div className="text-[15px] text-nim font-medium mb-1 break-all">{fileName}</div>
        <div className="text-[13px] mb-5">
          This is a binary file, so there's no text preview for it here.
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => openExternally(filePath)}
            className="px-3 py-1.5 text-xs rounded border border-nim text-nim hover:bg-nim-hover"
          >
            Open with default app
          </button>
          <button
            type="button"
            onClick={() => revealInFinder(filePath)}
            className="px-3 py-1.5 text-xs rounded border border-nim text-nim hover:bg-nim-hover"
          >
            Reveal in Finder
          </button>
        </div>
      </div>
    </div>
  );
};
