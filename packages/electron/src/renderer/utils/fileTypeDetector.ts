/**
 * File Type Detection Utility
 *
 * Determines whether a file should be edited as markdown (Lexical),
 * code (Monaco), image viewer, or a custom editor.
 */

export type EditorType = 'markdown' | 'code' | 'image' | 'custom' | 'pdf' | 'binary';

/**
 * Browser-compatible path utilities
 */
function getExtname(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastDot > lastSlash && lastDot > 0) {
    return filePath.substring(lastDot);
  }
  return '';
}

function getBasename(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
}

/**
 * Check if a file is an image
 */
export function isImageFile(filePath: string): boolean {
  const ext = getExtname(filePath).toLowerCase();
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp'];
  return imageExtensions.includes(ext);
}

/**
 * Check if a file is a PDF (gets a real inline viewer, not the text editor).
 */
export function isPdfFile(filePath: string): boolean {
  return getExtname(filePath).toLowerCase() === '.pdf';
}

/**
 * Determine which editor should be used for a given file
 *
 * Note: This function can optionally check for custom editors if a registry
 * check function is provided. To avoid circular dependencies, the custom editor
 * check is done by the caller (TabEditor).
 */
export function getFileType(
  filePath: string,
  customEditorCheck?: (ext: string) => boolean
): EditorType {
  const ext = getExtname(filePath).toLowerCase();

  // Check custom editors FIRST so extensions can override built-in types
  // (e.g., .slides.md handled by an extension instead of Lexical)
  if (customEditorCheck && customEditorCheck(ext)) {
    return 'custom';
  }

  if (ext === '.md' || ext === '.markdown' || ext === '.mdc') {
    return 'markdown';
  }

  if (isImageFile(filePath)) {
    return 'image';
  }

  // PDFs get a real inline viewer.
  if (isPdfFile(filePath)) {
    return 'pdf';
  }

  // Any other binary file (archives, executables, databases, office docs, …)
  // must NOT be handed to the text editor — that would paint its raw bytes as
  // mojibake. Route it to the binary panel instead.
  if (isBinaryFile(filePath)) {
    return 'binary';
  }

  return 'code';
}

/**
 * Map file extension to Monaco editor language ID
 *
 * Monaco supports many languages out of the box. This function
 * provides the language ID for syntax highlighting.
 *
 * See: https://microsoft.github.io/monaco-editor/monarch.html
 */
export function getMonacoLanguage(filePath: string): string {
  const ext = getExtname(filePath).toLowerCase();

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.d.ts': 'typescript',

    // Web
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',

    // Data formats
    '.json': 'json',
    '.jsonc': 'json',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'ini', // Monaco doesn't have TOML, INI is closest

    // Python
    '.py': 'python',
    '.pyw': 'python',
    '.pyi': 'python',

    // Shell
    '.sh': 'shell',
    '.bash': 'shell',
    '.zsh': 'shell',
    '.fish': 'shell',

    // C/C++
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.hxx': 'cpp',

    // Other compiled languages
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.kt': 'kotlin',
    '.swift': 'swift',
    '.cs': 'csharp',
    '.dart': 'dart',

    // Scripting
    '.rb': 'ruby',
    '.php': 'php',
    '.pl': 'perl',
    '.lua': 'lua',

    // Functional
    '.hs': 'haskell',
    '.scala': 'scala',
    '.clj': 'clojure',
    '.fs': 'fsharp',
    '.fsx': 'fsharp',

    // Markup/Config
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.mdc': 'markdown',
    '.sql': 'sql',
    '.graphql': 'graphql',
    '.dockerfile': 'dockerfile',
    '.dockerignore': 'plaintext',
    '.gitignore': 'plaintext',
    '.env': 'plaintext',

    // Text
    '.txt': 'plaintext',
    '.log': 'plaintext',
  };

  // Special case: files without extensions
  if (!ext) {
    const basename = getBasename(filePath);
    if (basename === 'Dockerfile') return 'dockerfile';
    if (basename === 'Makefile') return 'makefile';
    if (basename === 'Gemfile') return 'ruby';
    return 'plaintext';
  }

  return languageMap[ext] || 'plaintext';
}

/**
 * Check if a file is likely binary (not suitable for text editing)
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = getExtname(filePath).toLowerCase();

  const binaryExtensions = [
    // Images
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    // Video/Audio
    '.mp4', '.avi', '.mov', '.wmv', '.mp3', '.wav', '.ogg', '.flac',
    // Archives
    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.jar', '.war',
    // Executables / compiled objects (a quant workspace grows __pycache__
    // the moment the engine imports a strategy through the shared mount)
    '.exe', '.dll', '.so', '.dylib', '.app', '.dmg',
    '.pyc', '.pyo', '.pyd', '.class', '.o', '.obj', '.a', '.lib', '.node',
    // Data-science artifacts
    '.pkl', '.pickle', '.parquet', '.feather', '.npy', '.npz', '.h5', '.hdf5',
    // Fonts
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    // Documents
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    // Other binary (.ds_store is how getExtname sees macOS .DS_Store files)
    '.bin', '.dat', '.db', '.sqlite', '.sqlite3', '.wasm', '.ds_store',
  ];

  return binaryExtensions.includes(ext);
}

/**
 * Content-level safety net for binaries the extension list doesn't know.
 *
 * Every text decode the read path can produce keeps a source file's NUL
 * bytes: utf-8 and latin1 map 0x00 straight to U+0000, and a genuine UTF-16
 * file consumes its NULs into code units during decode. So a decoded string
 * that still contains U+0000 came from a binary file (git uses the same
 * heuristic on raw bytes). Real source code never contains NUL.
 */
export function textLooksBinary(content: string): boolean {
  return content.includes('\u0000');
}
