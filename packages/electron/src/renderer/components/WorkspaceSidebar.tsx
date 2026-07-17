import React, { useState, useMemo, useRef, useEffect, useCallback, useSyncExternalStore } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { FlatFileTree } from './FlatFileTree';
import type { RendererFileTreeItem } from '../store';
import { InputModal } from './InputModal';
import { NewFileDialog } from './NewFileDialog';
import { PlansPanel } from './PlansPanel/PlansPanel';
import { FileTreeFilterMenu, FileTreeFilter } from './FileTreeFilterMenu';
import { NewFileMenu, NewFileType, ExtensionFileType, contributionToExtensionFileType } from './NewFileMenu';
import { createInitialFileContent, createMockupContent } from '../utils/fileUtils';
import { createStrategyFileNoOverwrite } from '../utils/createStrategyFile';
import { getFileName } from '../utils/pathUtils';
import { getExtensionLoader } from '@nimbalyst/runtime';
import { KeyboardShortcuts } from '../../shared/KeyboardShortcuts';
import { sanitizeStrategyModuleName } from '../../shared/strategyModuleName';
import { HelpTooltip } from '../help';
import { store, gitStatusMapAtom, revealRequestAtom, rawFileTreeAtom, fileTreeLoadedAtom, type FileGitStatus as AtomFileGitStatus } from '../store';
import { developerModeAtom, setDeveloperFeatureSettingsAtom } from '../store/atoms/appSettings';
import { applyModeVisibility, countTreeFiles, isSimpleAllowlistedFile, normalizeVisibilityPath } from '../utils/modeVisibility';
import { sessionFileEditsAtom } from '../store/atoms/sessionFiles';
import { refreshFileTree } from '../store/listeners/fileTreeListeners';
import { useTabsActions } from '../contexts/TabsContext';
import { WorkspaceSummaryHeader } from './WorkspaceSummaryHeader';

type FileTreeItem = RendererFileTreeItem;

/** Legacy git status type used for prop-based filtering. */
type FileGitStatus = 'modified' | 'staged' | 'untracked' | 'deleted';

interface WorkspaceSidebarProps {
  workspaceName: string;
  workspacePath: string;
  currentFilePath: string | null;
  currentView: 'files';
  onFileSelect: (filePath: string) => void;
  onCloseWorkspace: () => void;
  onOpenQuickSearch?: () => void;
  onViewWorkspaceHistory?: (folderPath: string) => void;
  onNewPlan?: () => void;
  onOpenPlansTable?: () => void;
  onSelectedFolderChange?: (folderPath: string | null) => void;
  currentAISessionId?: string | null;
}

const FILE_TREE_FILTER_OPTIONS: ReadonlyArray<FileTreeFilter> = ['all', 'markdown', 'known', 'git-uncommitted', 'git-worktree', 'ai-read', 'ai-written'];
const CLAUDE_SESSION_FILTERS = new Set<FileTreeFilter>(['ai-read', 'ai-written']);
const GIT_FILTERS = new Set<FileTreeFilter>(['git-uncommitted', 'git-worktree']);
const SPECIAL_DIRECTORIES = ['nimbalyst-local'];

function isSpecialDirectory(name: string): boolean {
  return SPECIAL_DIRECTORIES.includes(name);
}

interface SessionFileFilterState {
  read: string[];
  written: string[];
}

function isValidFileTreeFilter(value: unknown): value is FileTreeFilter {
  return typeof value === 'string' && FILE_TREE_FILTER_OPTIONS.includes(value as FileTreeFilter);
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

function normalizeFilePath(path: string): string {
  if (!path) return '';
  let normalized = normalizeSlashes(path);
  if (/^[a-zA-Z]:\/$/i.test(normalized)) {
    return normalized;
  }
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.replace(/\/+$/, '');
  }
  return normalized;
}

function resolveSessionFilePath(filePath: string, workspacePath?: string): string | null {
  if (!filePath) return null;
  const sanitized = normalizeSlashes(filePath);
  if (sanitized.startsWith('/') || /^[a-zA-Z]:\//.test(sanitized)) {
    return normalizeFilePath(sanitized);
  }
  if (!workspacePath) {
    return normalizeFilePath(sanitized);
  }
  const base = normalizeFilePath(workspacePath);
  const relative = sanitized.replace(/^\.?\//, '');
  return normalizeFilePath(`${base}/${relative}`);
}

function replaceFolderChildren(
  items: FileTreeItem[],
  normalizedFolderPath: string,
  newChildren: FileTreeItem[]
): [FileTreeItem[], boolean] {
  let mutated = false;

  const updatedItems = items.map(item => {
    if (item.type !== 'directory') {
      return item;
    }

    const normalizedItemPath = normalizeFilePath(item.path);
    if (normalizedItemPath === normalizedFolderPath) {
      mutated = true;
      return { ...item, children: newChildren };
    }

    if (item.children && item.children.length > 0) {
      const [nextChildren, childMutated] = replaceFolderChildren(item.children, normalizedFolderPath, newChildren);
      if (childMutated) {
        mutated = true;
        return { ...item, children: nextChildren };
      }
    }

    return item;
  });

  return [mutated ? updatedItems : items, mutated];
}

export function WorkspaceSidebar({
  workspaceName,
  workspacePath,
  currentFilePath: currentFilePathProp,
  currentView,
  onFileSelect,
  onCloseWorkspace,
  onOpenQuickSearch,
  onViewWorkspaceHistory,
  onNewPlan,
  onOpenPlansTable,
  onSelectedFolderChange,
  currentAISessionId
}: WorkspaceSidebarProps) {
  // Subscribe to TabsContext to get reactive updates when active tab changes
  // This enables auto-scroll functionality after the Jotai refactor that
  // made EditorMode stop re-rendering on tab switches
  const tabsActions = useTabsActions();
  const tabsStore = useSyncExternalStore(
    tabsActions.subscribe,
    tabsActions.getSnapshot
  );
  // Get active file path from tabs store (reactive) or fall back to prop (legacy)
  const activeTab = tabsStore.activeTabId ? tabsStore.tabs.get(tabsStore.activeTabId) : null;
  const currentFilePath = activeTab?.filePath ?? currentFilePathProp;

  // File tree state - read from centralized atom (populated by fileTreeListeners.ts)
  const fileTree = useAtomValue(rawFileTreeAtom);
  const fileTreeLoaded = useAtomValue(fileTreeLoadedAtom);
  // Global Simple/Developer mode (the existing developer-mode system). Simple
  // mode (developerMode === false) applies the file-tree allowlist as an
  // independent axis on top of the user-selectable filter.
  const developerMode = useAtomValue(developerModeAtom);
  const setDeveloperFeatureSettings = useSetAtom(setDeveloperFeatureSettingsAtom);
  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);
  const [draggedItem, setDraggedItem] = useState<any | null>(null);
  // Selected folder state - internal to sidebar, FileTree now uses Jotai atom for external selection
  const [selectedFolder, setSelectedFolderInternal] = useState<string | null>(null);
  const setSelectedFolder = useCallback((value: string | null) => {
    setSelectedFolderInternal(value);
    onSelectedFolderChange?.(value);
  }, [onSelectedFolderChange]);
  const [fileTreeFilter, setFileTreeFilter] = useState<FileTreeFilter>('all');
  // Session-only allow set: paths temporarily revealed past the Simple-mode
  // allowlist by a reveal-in-tree action. Component state only -- never
  // persisted, cleared on unmount. `revealNotice` names the last such file.
  const [revealedPaths, setRevealedPaths] = useState<Set<string>>(() => new Set());
  const [revealNotice, setRevealNotice] = useState<string | null>(null);
  const [showFileIcons, setShowFileIcons] = useState(true);
  const [showGitStatus, setShowGitStatus] = useState(true);
  const [enableAutoScroll, setEnableAutoScroll] = useState(true);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [filterMenuPosition, setFilterMenuPosition] = useState({ x: 0, y: 0 });
  const [sessionFileFilters, setSessionFileFilters] = useState<SessionFileFilterState>({ read: [], written: [] });
  const [gitUncommittedFiles, setGitUncommittedFiles] = useState<string[]>([]);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [gitWorktreeModifiedFiles, setGitWorktreeModifiedFiles] = useState<string[]>([]);
  const [isGitWorktree, setIsGitWorktree] = useState(false);
  const [gitFileStatuses, setGitFileStatuses] = useState<Map<string, FileGitStatus>>(new Map());
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const newFileButtonRef = useRef<HTMLButtonElement>(null);
  const hasLoadedSettingsRef = useRef(false);
  const [showNewFileMenu, setShowNewFileMenu] = useState(false);
  const [newFileMenuPosition, setNewFileMenuPosition] = useState({ x: 0, y: 0 });
  const [pendingFileType, setPendingFileType] = useState<NewFileType | null>(null);
  const [extensionFileTypes, setExtensionFileTypes] = useState<ExtensionFileType[]>([]);
  const [isNewFileDialogOpen, setIsNewFileDialogOpen] = useState(false);
  const [newFileDialogDirectory, setNewFileDialogDirectory] = useState<string | null>(null);

  // Load extension file type contributions
  useEffect(() => {
    const loader = getExtensionLoader();

    const updateExtensionFileTypes = () => {
      const contributions = loader.getNewFileMenuContributions();
      const fileTypes = contributions.map(c => contributionToExtensionFileType(c.contribution));
      setExtensionFileTypes(fileTypes);
    };

    // Initial load
    updateExtensionFileTypes();

    // Subscribe to changes
    const unsubscribe = loader.subscribe(updateExtensionFileTypes);
    return unsubscribe;
  }, []);

  // Refresh file tree handler -- delegates to centralized listener
  const handleRefreshFileTree = useCallback(async () => {
    await refreshFileTree(workspacePath);
  }, [workspacePath]);

  const handleFolderContentsLoaded = useCallback((folderPath: string, contents: FileTreeItem[]) => {
    if (!folderPath) return;

    const normalizedFolderPath = normalizeFilePath(folderPath);
    const normalizedWorkspacePath = workspacePath ? normalizeFilePath(workspacePath) : '';

    const prevTree = store.get(rawFileTreeAtom);
    if (normalizedWorkspacePath && normalizedFolderPath === normalizedWorkspacePath) {
      store.set(rawFileTreeAtom, contents);
      return;
    }

    const [updatedTree, changed] = replaceFolderChildren(prevTree, normalizedFolderPath, contents);
    if (changed) {
      store.set(rawFileTreeAtom, updatedTree);
    }
  }, [workspacePath]);

  // Load file tree settings from workspace state
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.invoke) return;

    // Reset loaded flag when workspace changes
    hasLoadedSettingsRef.current = false;

    window.electronAPI.invoke('workspace:get-state', workspacePath)
      .then(state => {
        // Set filter if it exists, otherwise keep default
        if (state?.fileTreeFilter && isValidFileTreeFilter(state.fileTreeFilter)) {
          setFileTreeFilter(state.fileTreeFilter);
        }

        // Set showFileIcons - handle both explicit false and undefined
        if (state?.showFileIcons !== undefined) {
          setShowFileIcons(state.showFileIcons);
        }

        // Set showGitStatus - handle both explicit false and undefined
        if (state?.showGitStatus !== undefined) {
          setShowGitStatus(state.showGitStatus);
        }

        // Set enableAutoScroll - handle both explicit false and undefined
        if (state?.enableAutoScroll !== undefined) {
          setEnableAutoScroll(state.enableAutoScroll);
        }

        hasLoadedSettingsRef.current = true;
      })
      .catch(error => {
        console.error('Failed to load file tree settings:', error);
        hasLoadedSettingsRef.current = true;
      });
  }, [workspacePath]);

  // Save file tree settings to workspace state
  useEffect(() => {
    // Don't save until we've loaded the initial settings
    if (!hasLoadedSettingsRef.current) return;
    if (!workspacePath || !window.electronAPI?.invoke) return;

    window.electronAPI.invoke('workspace:update-state', workspacePath, {
      fileTreeFilter,
      showFileIcons,
      showGitStatus,
      enableAutoScroll
    }).catch(error => {
      console.error('Failed to save file tree settings:', error);
    });
  }, [workspacePath, fileTreeFilter, showFileIcons, showGitStatus, enableAutoScroll]);

  // Notify parent when selected folder changes
  const handleSelectedFolderChange = (folderPath: string | null) => {
    setSelectedFolder(folderPath);
    onSelectedFolderChange?.(folderPath);
  };

  const handleNewFileButtonClick = () => {
    if (newFileButtonRef.current) {
      const rect = newFileButtonRef.current.getBoundingClientRect();
      setNewFileMenuPosition({
        x: rect.left,
        y: rect.bottom + 4
      });
      setShowNewFileMenu(true);
    }
  };

  const handleNewFileTypeSelect = (fileType: NewFileType) => {
    // Action items (e.g. "New Browser Tab") open a fileless virtual tab
    // directly -- no name prompt, no file written.
    if (typeof fileType === 'string' && fileType.startsWith('ext:')) {
      const extType = extensionFileTypes.find(e => e.extension === fileType.slice(4));
      if (extType?.action === 'openVirtualTab' && extType.virtualScheme) {
        const id = `tab-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
        const title = encodeURIComponent(extType.displayName);
        onFileSelect(`${extType.virtualScheme}${id}?title=${title}`);
        return;
      }
    }

    // Priority: selected folder > parent of current file > workspace root
    if (selectedFolder) {
      setTargetFolder(selectedFolder);
    } else if (currentFilePath) {
      const parentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
      setTargetFolder(parentDir);
    }

    setPendingFileType(fileType);
    setIsFileModalOpen(true);
  };

  const createMockupContent = () => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mockup</title>
    <style>
        body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            color: #333;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>New Mockup</h1>
        <p>Start designing your mockup here.</p>
    </div>
</body>
</html>`;

  const handleNewFolder = () => {
    // Priority: selected folder > parent of current file > workspace root
    if (selectedFolder) {
      setTargetFolder(selectedFolder);
    } else if (currentFilePath) {
      const parentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
      setTargetFolder(parentDir);
    }
    setIsFolderModalOpen(true);
  };

  const [targetFolder, setTargetFolder] = useState<string | null>(null);

  const handleCreateFile = async (fileName: string) => {
    setIsFileModalOpen(false);
    const fileType = pendingFileType;
    setPendingFileType(null);

    // Determine full filename and content based on type. Strategy (.py) files
    // are routed through createStrategyFileNoOverwrite below because their name
    // has to be a valid, unique Python module name.
    let fullFileName: string;
    let content: string;
    let strategyBase: string | null = null;

    if (fileType === 'markdown') {
      // Add .md extension if not present
      fullFileName = fileName.endsWith('.md') || fileName.endsWith('.markdown') ? fileName : `${fileName}.md`;
      content = createInitialFileContent(fullFileName);
    } else if (fileType === 'mockup') {
      // Add .mockup.html extension if not present
      fullFileName = fileName.endsWith('.mockup.html') ? fileName : `${fileName}.mockup.html`;
      content = createMockupContent();
    } else if (fileType?.startsWith('ext:')) {
      // Extension-provided file type
      const extName = fileType.slice(4); // Remove 'ext:' prefix
      const extType = extensionFileTypes.find(e => e.extension === extName);
      if (extType) {
        content = extType.defaultContent ?? '';
        if (extName === '.py') {
          // Sanitize the typed base (minus any .py the user already typed) into
          // a valid module name before appending the extension.
          const typedBase = fileName.endsWith(extName) ? fileName.slice(0, -extName.length) : fileName;
          strategyBase = sanitizeStrategyModuleName(typedBase);
          fullFileName = `${strategyBase}${extName}`;
        } else {
          fullFileName = fileName.endsWith(extName) ? fileName : `${fileName}${extName}`;
        }
      } else {
        // Fallback
        fullFileName = fileName;
        content = '';
      }
    } else {
      // Any type - keep filename as-is
      fullFileName = fileName;
      content = createInitialFileContent(fullFileName);
    }

    try {
      const basePath = targetFolder || workspacePath;
      const createFile = (window as any).electronAPI?.createFile;

      if (strategyBase !== null) {
        // Auto-suffix on collision rather than overwriting an existing edge.
        const result = await createStrategyFileNoOverwrite(basePath, strategyBase, '.py', content, createFile);
        if (result.success && result.filePath) {
          handleRefreshFileTree();
          onFileSelect(result.filePath);
        } else {
          alert('Failed to create file: ' + (result.error || 'Unknown error'));
        }
      } else {
        const filePath = `${basePath}/${fullFileName}`;
        const result = await createFile?.(filePath, content);
        if (result?.success) {
          // Refresh file tree and open the new file
          handleRefreshFileTree();
          onFileSelect(filePath);
        } else if (result?.errorCode === 'FILE_EXISTS') {
          alert('A file with that name already exists');
        } else {
          alert('Failed to create file: ' + (result?.error || 'Unknown error'));
        }
      }
    } catch (error) {
      console.error('Failed to create file:', error);
      alert('Failed to create file: ' + error);
    } finally {
      setTargetFolder(null);
    }
  };

  const handleCreateFolder = async (folderName: string) => {
    setIsFolderModalOpen(false);

    try {
      const basePath = targetFolder || workspacePath;
      const folderPath = `${basePath}/${folderName}`;

      const result = await (window as any).electronAPI?.createFolder?.(folderPath);
      if (result?.success) {
        // Refresh file tree
        handleRefreshFileTree();
      } else {
        alert('Failed to create folder: ' + (result?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to create folder:', error);
      alert('Failed to create folder: ' + error);
    } finally {
      setTargetFolder(null);
    }
  };

  const handleNewFileInFolder = (folderPath: string, fileType: NewFileType) => {
    if (fileType === 'any') {
      // For "New File..." open the full NewFileDialog with type selector
      setNewFileDialogDirectory(folderPath);
      setIsNewFileDialogOpen(true);
    } else {
      // For specific file types, use the simple InputModal
      setTargetFolder(folderPath);
      setPendingFileType(fileType);
      setIsFileModalOpen(true);
    }
  };

  // Handler for NewFileDialog file creation
  const handleNewFileDialogCreate = async (fileName: string, fileType: NewFileType) => {
    try {
      const directory = newFileDialogDirectory || workspacePath;

      // Determine full filename and content based on type. Strategy (.py) files
      // are routed through createStrategyFileNoOverwrite below because their
      // name has to be a valid, unique Python module name.
      let fullFileName: string;
      let content: string;
      let strategyBase: string | null = null;

      if (fileType === 'markdown') {
        fullFileName = fileName.endsWith('.md') || fileName.endsWith('.markdown') ? fileName : `${fileName}.md`;
        content = createInitialFileContent(fullFileName);
      } else if (fileType === 'mockup') {
        fullFileName = fileName.endsWith('.mockup.html') ? fileName : `${fileName}.mockup.html`;
        content = createMockupContent();
      } else if (fileType?.startsWith('ext:')) {
        const extName = fileType.slice(4);
        const extType = extensionFileTypes.find(e => e.extension === extName);
        if (extType) {
          content = extType.defaultContent ?? '';
          if (extName === '.py') {
            const typedBase = fileName.endsWith(extName) ? fileName.slice(0, -extName.length) : fileName;
            strategyBase = sanitizeStrategyModuleName(typedBase);
            fullFileName = `${strategyBase}${extName}`;
          } else {
            fullFileName = fileName.endsWith(extName) ? fileName : `${fileName}${extName}`;
          }
        } else {
          fullFileName = fileName;
          content = '';
        }
      } else {
        fullFileName = fileName;
        content = createInitialFileContent(fullFileName);
      }

      const createFile = (window as any).electronAPI?.createFile;

      if (strategyBase !== null) {
        const result = await createStrategyFileNoOverwrite(directory, strategyBase, '.py', content, createFile);
        if (result.success && result.filePath) {
          handleRefreshFileTree();
          onFileSelect(result.filePath);
        } else {
          alert('Failed to create file: ' + (result.error || 'Unknown error'));
        }
      } else {
        const filePath = `${directory}/${fullFileName}`;
        const result = await createFile?.(filePath, content);
        if (result?.success) {
          handleRefreshFileTree();
          onFileSelect(filePath);
        } else if (result?.errorCode === 'FILE_EXISTS') {
          alert('A file with that name already exists');
        } else {
          alert('Failed to create file: ' + (result?.error || 'Unknown error'));
        }
      }
    } catch (error) {
      console.error('Failed to create file:', error);
      alert('Failed to create file: ' + error);
    } finally {
      setIsNewFileDialogOpen(false);
      setNewFileDialogDirectory(null);
    }
  };

  const handleNewFolderInFolder = (folderPath: string) => {
    setTargetFolder(folderPath);
    setIsFolderModalOpen(true);
  };

  const handleFileSelect = (filePath: string) => {
    handleSelectedFolderChange(null); // Clear folder selection when a file is selected
    onFileSelect(filePath);
  };

  // Filter menu handlers
  const handleFilterButtonClick = () => {
    if (filterButtonRef.current) {
      const rect = filterButtonRef.current.getBoundingClientRect();
      setFilterMenuPosition({
        x: rect.right + 4,
        y: rect.top
      });
      setShowFilterMenu(true);
    }
  };

  const handleFilterChange = (filter: FileTreeFilter) => {
    setFileTreeFilter(filter);
  };

  // Flip to Developer mode via the same setter Settings/onboarding use, so the
  // change persists (developer-mode:set) and the tree re-filters live.
  const handleSwitchToDeveloperMode = useCallback(() => {
    setDeveloperFeatureSettings({ developerMode: true });
  }, [setDeveloperFeatureSettings]);

  const loadClaudeSessionFiles = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setSessionFileFilters({ read: [], written: [] });
      return;
    }

    if (!window.electronAPI?.invoke) {
      return;
    }

    const normalizeResponse = (response: any): string[] => {
      if (!response?.success || !Array.isArray(response.files)) {
        return [];
      }
      const normalizedPaths = response.files
        .map((file: any) => resolveSessionFilePath(file.filePath, workspacePath))
        .filter((value: string | undefined): value is string => Boolean(value));

      return Array.from(new Set(normalizedPaths));
    };

    try {
      const [readResult, writtenResult] = await Promise.all([
        window.electronAPI.invoke('session-files:get-by-session', sessionId, 'read'),
        window.electronAPI.invoke('session-files:get-by-session', sessionId, 'edited')
      ]);

      setSessionFileFilters({
        read: normalizeResponse(readResult),
        written: normalizeResponse(writtenResult)
      });
    } catch (error) {
      console.error('Failed to load Claude session files:', error);
      setSessionFileFilters({ read: [], written: [] });
    }
  }, [workspacePath]);

  // Watch the centrally-maintained file edits atom. When the central listener
  // (fileStateListeners.ts) processes session-files:updated, this atom changes
  // and we refetch read+written file filters via IPC.
  const sessionFileEdits = useAtomValue(
    sessionFileEditsAtom(currentAISessionId ?? '')
  );
  useEffect(() => {
    if (!currentAISessionId) {
      setSessionFileFilters({ read: [], written: [] });
      return;
    }
    loadClaudeSessionFiles(currentAISessionId);
  }, [currentAISessionId, sessionFileEdits, loadClaudeSessionFiles]);

  // Clear file tree filter when a reveal request comes in (so the target file is visible)
  const fileTreeFilterRef = useRef(fileTreeFilter);
  fileTreeFilterRef.current = fileTreeFilter;
  // Mirror developerMode into a ref so the once-subscribed reveal handler reads
  // the current value without re-subscribing.
  const developerModeRef = useRef(developerMode);
  developerModeRef.current = developerMode;
  useEffect(() => {
    const unsub = store.sub(revealRequestAtom, () => {
      const req = store.get(revealRequestAtom);
      if (!req) return;
      if (fileTreeFilterRef.current !== 'all') {
        setFileTreeFilter('all');
      }
      // Simple-mode escape hatch: a reveal may target a path the allowlist
      // hides. Add it to the session allow set and surface a brief notice so a
      // reveal is never a silent no-op. Open/allowlisted targets need neither.
      if (!developerModeRef.current) {
        const fileName = req.path.slice(req.path.lastIndexOf('/') + 1);
        const wouldBeHidden = req.type === 'folder' || !isSimpleAllowlistedFile(fileName);
        if (wouldBeHidden) {
          const normalized = normalizeVisibilityPath(req.path);
          setRevealedPaths(prev => {
            if (prev.has(normalized)) return prev;
            const next = new Set(prev);
            next.add(normalized);
            return next;
          });
          setRevealNotice(fileName);
        }
      }
    });
    return unsub;
  }, []);

  // Auto-dismiss the reveal notice after a short window.
  useEffect(() => {
    if (!revealNotice) return;
    const timeoutId = setTimeout(() => setRevealNotice(null), 6000);
    return () => clearTimeout(timeoutId);
  }, [revealNotice]);

  // Check if workspace is a git repository
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.invoke) {
      setIsGitRepo(false);
      return;
    }

    window.electronAPI.invoke('git:is-repo', workspacePath)
      .then(result => {
        if (result?.success) {
          setIsGitRepo(result.isRepo);
        } else {
          setIsGitRepo(false);
        }
      })
      .catch(error => {
        console.error('Failed to check if git repo:', error);
        setIsGitRepo(false);
      });
  }, [workspacePath]);

  // Check if workspace is a git worktree
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.invoke) {
      setIsGitWorktree(false);
      return;
    }

    window.electronAPI.invoke('git:is-worktree', workspacePath)
      .then(result => {
        if (result?.success) {
          setIsGitWorktree(result.isWorktree);
        } else {
          setIsGitWorktree(false);
        }
      })
      .catch(error => {
        console.error('Failed to check if git worktree:', error);
        setIsGitWorktree(false);
      });
  }, [workspacePath]);

  // Load git uncommitted files when filter is active
  const loadGitUncommittedFiles = useCallback(async () => {
    if (!workspacePath || !window.electronAPI?.invoke) {
      setGitUncommittedFiles([]);
      return;
    }

    try {
      const result = await window.electronAPI.invoke('git:get-uncommitted-files', workspacePath);

      if (result?.success && Array.isArray(result.files)) {
        // Files are already absolute paths from the service, just normalize them
        const normalizedFiles = result.files
          .map((file: string) => normalizeFilePath(file))
          .filter((value: string | undefined): value is string => Boolean(value));
        setGitUncommittedFiles(Array.from(new Set(normalizedFiles)));
      } else {
        setGitUncommittedFiles([]);
      }
    } catch (error) {
      console.error('Failed to load git uncommitted files:', error);
      setGitUncommittedFiles([]);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (fileTreeFilter === 'git-uncommitted' && isGitRepo) {
      loadGitUncommittedFiles();
    } else if (fileTreeFilter !== 'git-worktree' && !GIT_FILTERS.has(fileTreeFilter)) {
      setGitUncommittedFiles([]);
    }
  }, [fileTreeFilter, isGitRepo, loadGitUncommittedFiles]);

  // Refresh git status when file tree changes (files added/modified/deleted)
  // Debounced to avoid excessive git status calls during rapid file changes
  useEffect(() => {
    if (fileTreeFilter !== 'git-uncommitted' || !isGitRepo) {
      return;
    }

    const timeoutId = setTimeout(() => {
      loadGitUncommittedFiles();
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [fileTree, fileTreeFilter, isGitRepo, loadGitUncommittedFiles]);

  // Load git worktree modified files when filter is active
  const loadGitWorktreeModifiedFiles = useCallback(async () => {
    if (!workspacePath || !window.electronAPI?.invoke) {
      setGitWorktreeModifiedFiles([]);
      return;
    }

    try {
      const result = await window.electronAPI.invoke('git:get-worktree-modified-files', workspacePath);

      if (result?.success && Array.isArray(result.files)) {
        // Files are already absolute paths from the service, just normalize them
        const normalizedFiles = result.files
          .map((file: string) => normalizeFilePath(file))
          .filter((value: string | undefined): value is string => Boolean(value));
        setGitWorktreeModifiedFiles(Array.from(new Set(normalizedFiles)));
      } else {
        setGitWorktreeModifiedFiles([]);
      }
    } catch (error) {
      console.error('Failed to load git worktree modified files:', error);
      setGitWorktreeModifiedFiles([]);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (fileTreeFilter === 'git-worktree' && isGitWorktree) {
      loadGitWorktreeModifiedFiles();
    } else if (!GIT_FILTERS.has(fileTreeFilter)) {
      setGitWorktreeModifiedFiles([]);
    }
  }, [fileTreeFilter, isGitWorktree, loadGitWorktreeModifiedFiles]);

  // Refresh worktree status when file tree changes (files added/modified/deleted)
  // Debounced to avoid excessive git diff calls during rapid file changes
  useEffect(() => {
    if (fileTreeFilter !== 'git-worktree' || !isGitWorktree) {
      return;
    }

    const timeoutId = setTimeout(() => {
      loadGitWorktreeModifiedFiles();
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [fileTree, fileTreeFilter, isGitWorktree, loadGitWorktreeModifiedFiles]);

  // Load git file statuses for file tree icons
  // Writes to Jotai atom - FileGitStatusIndicator components subscribe per-node
  const loadGitFileStatuses = useCallback(async () => {
    if (!workspacePath || !window.electronAPI?.invoke) {
      setGitFileStatuses(new Map());
      store.set(gitStatusMapAtom, new Map());
      return;
    }

    try {
      const result = await window.electronAPI.invoke('git:get-all-file-statuses', workspacePath);

      if (result?.success && result.statuses) {
        // Convert object to Map for legacy prop-based system
        const legacyStatusMap = new Map<string, FileGitStatus>();
        // Convert to atom format {index, workingTree}
        const atomStatusMap = new Map<string, AtomFileGitStatus>();

        for (const [filePath, fileStatus] of Object.entries(result.statuses)) {
          const status = (fileStatus as { status: string }).status;
          // Only include modified, staged, and untracked (not unchanged or deleted)
          if (status === 'modified' || status === 'staged' || status === 'untracked') {
            legacyStatusMap.set(filePath, status as FileGitStatus);
            // Map to atom format
            atomStatusMap.set(filePath, {
              index: status === 'staged' ? 'A' : ' ',
              workingTree: status === 'modified' ? 'M' : status === 'untracked' ? '?' : ' ',
            });
          }
        }
        setGitFileStatuses(legacyStatusMap);
        store.set(gitStatusMapAtom, atomStatusMap);
      } else {
        setGitFileStatuses(new Map());
        store.set(gitStatusMapAtom, new Map());
      }
    } catch (error) {
      console.error('Failed to load git file statuses:', error);
      setGitFileStatuses(new Map());
      store.set(gitStatusMapAtom, new Map());
    }
  }, [workspacePath]);

  // Load git file statuses when workspace is a git repo
  useEffect(() => {
    if (isGitRepo) {
      loadGitFileStatuses();
    } else {
      setGitFileStatuses(new Map());
      store.set(gitStatusMapAtom, new Map());
    }
  }, [isGitRepo, loadGitFileStatuses]);

  // Refresh git file statuses when file tree changes (files added/modified/deleted)
  // The file watcher triggers file tree updates when files change on disk.
  // We debounce to avoid excessive git status calls during rapid changes.
  // The service has its own cache (TTL-based), so this is just a cache refresh trigger.
  useEffect(() => {
    if (!isGitRepo) {
      return;
    }

    const timeoutId = setTimeout(() => {
      loadGitFileStatuses();
    }, 500); // 500ms debounce - git status is cached, this just invalidates/refreshes

    return () => clearTimeout(timeoutId);
  }, [fileTree, isGitRepo, loadGitFileStatuses]);

  // Listen for git status changes from GitRefWatcher (staging, commits, etc.)
  // This provides immediate updates when git operations occur from any source
  useEffect(() => {
    if (!isGitRepo || !workspacePath) {
      return;
    }

    const unsubscribe = window.electronAPI?.git?.onStatusChanged?.(
      (data: { workspacePath: string }) => {
        if (data.workspacePath === workspacePath) {
          loadGitFileStatuses();
        }
      }
    );

    return () => {
      unsubscribe?.();
    };
  }, [isGitRepo, workspacePath, loadGitFileStatuses]);

  const aiReadPathSet = useMemo(() => new Set(sessionFileFilters.read), [sessionFileFilters.read]);
  const aiWrittenPathSet = useMemo(() => new Set(sessionFileFilters.written), [sessionFileFilters.written]);
  const gitUncommittedPathSet = useMemo(() => new Set(gitUncommittedFiles), [gitUncommittedFiles]);
  const gitWorktreeModifiedPathSet = useMemo(() => new Set(gitWorktreeModifiedFiles), [gitWorktreeModifiedFiles]);

  // Filter file tree based on current filter
  const filterFileTree = useCallback((items: FileTreeItem[], filter: FileTreeFilter): FileTreeItem[] => {
    if (filter === 'all') {
      return items;
    }

    if (CLAUDE_SESSION_FILTERS.has(filter)) {
      const trackedSet = filter === 'ai-read' ? aiReadPathSet : aiWrittenPathSet;
      if (trackedSet.size === 0) {
        return [];
      }

      const filterTrackedItems = (entries: FileTreeItem[]): FileTreeItem[] => {
        return entries.reduce((acc: FileTreeItem[], item) => {
          if (item.type === 'directory') {
            // Always include special directories with all their children
            if (isSpecialDirectory(item.name)) {
              acc.push(item);
            } else {
              const filteredChildren = item.children ? filterTrackedItems(item.children) : [];
              if (filteredChildren.length > 0) {
                acc.push({
                  ...item,
                  children: filteredChildren
                });
              }
            }
          } else {
            const normalizedPath = normalizeFilePath(item.path);
            if (trackedSet.has(normalizedPath)) {
              acc.push(item);
            }
          }
          return acc;
        }, []);
      };

      return filterTrackedItems(items);
    }

    if (GIT_FILTERS.has(filter)) {
      const pathSet = filter === 'git-worktree' ? gitWorktreeModifiedPathSet : gitUncommittedPathSet;
      if (pathSet.size === 0) {
        return [];
      }

      const filterGitItems = (entries: FileTreeItem[]): FileTreeItem[] => {
        return entries.reduce((acc: FileTreeItem[], item) => {
          if (item.type === 'directory') {
            // Always include special directories with all their children
            if (isSpecialDirectory(item.name)) {
              acc.push(item);
            } else {
              const filteredChildren = item.children ? filterGitItems(item.children) : [];
              if (filteredChildren.length > 0) {
                acc.push({
                  ...item,
                  children: filteredChildren
                });
              }
            }
          } else {
            const normalizedPath = normalizeFilePath(item.path);
            if (pathSet.has(normalizedPath)) {
              acc.push(item);
            }
          }
          return acc;
        }, []);
      };

      return filterGitItems(items);
    }

    const knownExtensions = ['.md', '.markdown', '.txt', '.json', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.xml', '.yaml', '.yml'];

    const shouldIncludeFile = (fileName: string): boolean => {
      const lowerName = fileName.toLowerCase();

      if (filter === 'markdown') {
        return lowerName.endsWith('.md') || lowerName.endsWith('.markdown');
      }

      if (filter === 'known') {
        return knownExtensions.some(ext => lowerName.endsWith(ext));
      }

      return true;
    };

    const filterItems = (entries: FileTreeItem[]): FileTreeItem[] => {
      return entries.reduce((acc: FileTreeItem[], item) => {
        if (item.type === 'directory') {
          // Always include special directories with all their children
          if (isSpecialDirectory(item.name)) {
            acc.push(item);
          } else {
            const filteredChildren = item.children ? filterItems(item.children) : [];
            // Include directory if it has any matching children
            if (filteredChildren.length > 0) {
              acc.push({
                ...item,
                children: filteredChildren
              });
            }
          }
        } else if (shouldIncludeFile(item.name)) {
          acc.push(item);
        }
        return acc;
      }, []);
    };

    return filterItems(items);
  }, [aiReadPathSet, aiWrittenPathSet, gitUncommittedPathSet, gitWorktreeModifiedPathSet]);

  const filteredFileTree = useMemo(
    () => filterFileTree(fileTree, fileTreeFilter),
    [fileTree, fileTreeFilter, filterFileTree]
  );

  // Files always visible in Simple mode regardless of the allowlist: every open
  // editor tab, the current file, and any session-revealed path.
  const openPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const tab of tabsStore.tabs.values()) {
      if (tab.filePath) paths.add(normalizeVisibilityPath(tab.filePath));
    }
    if (currentFilePath) paths.add(normalizeVisibilityPath(currentFilePath));
    for (const revealed of revealedPaths) paths.add(revealed);
    return paths;
  }, [tabsStore.tabs, currentFilePath, revealedPaths]);

  // Simple/Developer mode composed as an INDEPENDENT axis on top of the
  // user-selectable filter (never a FileTreeFilter value). Developer mode is
  // identity; Simple mode applies the allowlist. View-only: this changes only
  // what the tree renders, never what the engine discovers or runs.
  const modeFilteredTree = useMemo(
    () => applyModeVisibility(filteredFileTree, { developerMode, openPaths }),
    [filteredFileTree, developerMode, openPaths]
  );

  // Count of files the mode hid = files surviving the user filter minus files
  // surviving the mode axis. Drives the footer so hiding is never silent.
  const hiddenFileCount = useMemo(
    () => (developerMode ? 0 : countTreeFiles(filteredFileTree) - countTreeFiles(modeFilteredTree)),
    [developerMode, filteredFileTree, modeFilteredTree]
  );

  const isAISessionFilter = CLAUDE_SESSION_FILTERS.has(fileTreeFilter);
  const hasActiveClaudeSession = Boolean(currentAISessionId);
  const activeClaudeFilterCount = fileTreeFilter === 'ai-read'
    ? aiReadPathSet.size
    : fileTreeFilter === 'ai-written'
      ? aiWrittenPathSet.size
      : 0;
  const shouldShowFilterHint = isAISessionFilter && (!hasActiveClaudeSession || activeClaudeFilterCount === 0);
  const aiFilterHintText = !hasActiveClaudeSession
    ? 'Open a Claude Agent session to see which files the agent reads or writes.'
    : fileTreeFilter === 'ai-read'
      ? 'No files have been read by this Claude Agent session yet.'
      : 'No files have been written by this Claude Agent session yet.';

  // Check if filtered tree is empty
  const isFilteredTreeEmpty = filteredFileTree.length === 0;

  // Generate empty state message based on filter type
  const getEmptyStateMessage = (): { title: string; description: string } => {
    switch (fileTreeFilter) {
      case 'markdown':
        return {
          title: 'No Markdown Files',
          description: 'No .md or .markdown files found in this workspace.'
        };
      case 'known':
        return {
          title: 'No Known File Types',
          description: 'No files with recognized extensions found. Showing files with extensions like .md, .txt, .json, .js, .ts, etc.'
        };
      case 'git-uncommitted':
        return {
          title: 'No Uncommitted Changes',
          description: isGitRepo
            ? 'No uncommitted files found in this git repository.'
            : 'This workspace is not a git repository.'
        };
      case 'git-worktree':
        return {
          title: 'No Worktree Changes',
          description: isGitWorktree
            ? 'No files modified in this git worktree.'
            : 'This workspace is not a git worktree.'
        };
      case 'ai-read':
        return {
          title: 'No Files Read',
          description: hasActiveClaudeSession
            ? 'No files have been read by this Claude Agent session yet.'
            : 'Open a Claude Agent session to see which files the agent reads.'
        };
      case 'ai-written':
        return {
          title: 'No Files Written',
          description: hasActiveClaudeSession
            ? 'No files have been written by this Claude Agent session yet.'
            : 'Open a Claude Agent session to see which files the agent writes.'
        };
      default:
        return {
          title: 'No Files',
          description: 'No files match the current filter.'
        };
    }
  };

  // Root folder drag and drop handlers
  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    // Check if we're over a folder or file item - if so, don't handle at root level
    const target = e.target as HTMLElement;
    const overFolderOrFile = target.closest('.file-tree-directory, .file-tree-file');

    if (overFolderOrFile) {
      // We're over a specific folder/file, let FileTree handle it
      setIsDragOverRoot(false);
      return;
    }

    // Get the drag data to check if it's a valid file/folder
    const isInternalDrag = e.dataTransfer.types.includes('text/plain');
    const isExternalFileDrag = e.dataTransfer.types.includes('Files');
    if (isInternalDrag) {
      setIsDragOverRoot(true);
      e.dataTransfer.dropEffect = e.altKey || e.metaKey ? 'copy' : 'move';
    } else if (isExternalFileDrag) {
      setIsDragOverRoot(true);
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleRootDragLeave = (e: React.DragEvent) => {
    // Only clear if we're leaving the root drop zone entirely
    const relatedTarget = e.relatedTarget as HTMLElement;
    const dropZone = e.currentTarget as HTMLElement;
    if (!dropZone.contains(relatedTarget)) {
      setIsDragOverRoot(false);
    }
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverRoot(false);

    // External files from Finder/Dock: resolve their paths via the preload
    // bridge (Electron 32 removed File.path) and copy into the workspace root.
    const externalFiles = Array.from(e.dataTransfer.files);
    if (externalFiles.length > 0) {
      let successCount = 0;
      for (const file of externalFiles) {
        const sourcePath = window.electronAPI.getPathForFile(file);
        if (!sourcePath) {
          console.error('Failed to resolve path for dropped file:', file.name);
          continue;
        }
        try {
          const result = await window.electronAPI.copyFile(sourcePath, workspacePath);
          if (result.success) {
            successCount++;
          } else {
            console.error('Failed to copy external file to root:', sourcePath, result.error);
          }
        } catch (error) {
          console.error('Error copying external file to root:', sourcePath, error);
        }
      }
      if (successCount > 0) {
        handleRefreshFileTree();
      }
      return;
    }

    const sourcePath = e.dataTransfer.getData('text/plain');
    if (!sourcePath) return;

    const isCopy = e.altKey || e.metaKey;

    try {
      if (isCopy) {
        const result = await (window as any).electronAPI.copyFile(sourcePath, workspacePath);
        if (!result.success) {
          console.error('Failed to copy to root:', result.error);
        } else {
          handleRefreshFileTree();
        }
      } else {
        const result = await (window as any).electronAPI.moveFile(sourcePath, workspacePath);
        if (!result.success) {
          console.error('Failed to move to root:', result.error);
        } else {
          handleRefreshFileTree();
        }
      }
    } catch (error) {
      console.error('Error during drop to root:', error);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    // Store the dragged item info for visual feedback
    const dragPath = e.dataTransfer.getData('text/plain');
    setDraggedItem({ path: dragPath });
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setIsDragOverRoot(false);
  };

  return (
    <div className="workspace-sidebar w-full bg-[var(--nim-bg-secondary)] border-r border-[var(--nim-border)] flex flex-col h-full overflow-hidden relative"
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <WorkspaceSummaryHeader
        workspacePath={workspacePath}
        workspaceName={workspaceName}
        actionsClassName="gap-1"
        actions={
          <>
            {currentView === 'files' && (
              <>
                <button
                  ref={newFileButtonRef}
                  className="workspace-action-button bg-transparent border-none p-1.5 cursor-pointer rounded text-[var(--nim-text-faint)] flex items-center justify-center transition-all duration-200 relative hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
                  onClick={handleNewFileButtonClick}
                  title="New file"
                  aria-label="New file"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    edit_square
                  </span>
                </button>
                <HelpTooltip testId="file-tree-refresh-button">
                  <button
                    data-testid="file-tree-refresh-button"
                    className="workspace-action-button bg-transparent border-none p-1.5 cursor-pointer rounded text-[var(--nim-text-faint)] flex items-center justify-center transition-all duration-200 relative hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
                    onClick={handleRefreshFileTree}
                    title="Refresh file tree"
                    aria-label="Refresh file tree"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                      refresh
                    </span>
                  </button>
                </HelpTooltip>
                <button
                  className="workspace-action-button bg-transparent border-none p-1.5 cursor-pointer rounded text-[var(--nim-text-faint)] flex items-center justify-center transition-all duration-200 relative hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
                  onClick={handleNewFolder}
                  title="New folder"
                  aria-label="New folder"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    create_new_folder
                  </span>
                </button>
                {onOpenQuickSearch && (
                  <HelpTooltip testId="file-tree-quick-open-button">
                    <button
                      data-testid="file-tree-quick-open-button"
                      className="workspace-action-button bg-transparent border-none p-1.5 cursor-pointer rounded text-[var(--nim-text-faint)] flex items-center justify-center transition-all duration-200 relative hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
                      onClick={onOpenQuickSearch}
                      aria-label="Search files"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                        search
                      </span>
                    </button>
                  </HelpTooltip>
                )}
                <HelpTooltip testId="file-tree-filter-button">
                  <button
                    ref={filterButtonRef}
                    data-testid="file-tree-filter-button"
                    className="workspace-action-button bg-transparent border-none p-1.5 cursor-pointer rounded text-[var(--nim-text-faint)] flex items-center justify-center transition-all duration-200 relative hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
                    onClick={handleFilterButtonClick}
                    aria-label="Filter files"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                      filter_alt
                    </span>
                    {fileTreeFilter !== 'all' && (
                      <span className="filter-active-indicator text-[var(--nim-primary)] font-bold text-base leading-none absolute top-0.5 right-0.5" title="Filter active">•</span>
                    )}
                  </button>
                </HelpTooltip>
              </>
            )}
          </>
        }
      />

      {currentView === 'files' ? (
        <>
          <div className="workspace-section-label nim-section-label py-1.5 px-3 border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shrink-0">Files</div>
          <div className={`workspace-file-tree nim-scrollbar flex-1 overflow-y-auto overflow-x-hidden py-2 relative transition-colors duration-200 ${isDragOverRoot ? 'drag-over-root bg-[var(--nim-accent-subtle)] border-2 border-dashed border-[var(--nim-primary)] !py-1.5' : ''}`}>
            {shouldShowFilterHint && (
              <div className="file-tree-filter-hint py-2 px-3 text-xs text-[var(--nim-text-faint)] leading-relaxed border-b border-[var(--nim-border)] mb-1">
                {aiFilterHintText}
              </div>
            )}
            {!developerMode && revealNotice && (
              <div
                data-testid="reveal-notice"
                className="reveal-notice flex items-start gap-1.5 py-2 px-3 mb-1 text-xs text-[var(--nim-text-muted)] leading-relaxed border-b border-[var(--nim-border)]"
              >
                <span className="material-symbols-outlined text-[14px] leading-none mt-px text-[var(--nim-text-faint)]">info</span>
                <span>
                  Showing <span className="reveal-notice-file font-medium text-[var(--nim-text)]">{revealNotice}</span> temporarily. It is a developer file hidden in Simple mode.
                </span>
              </div>
            )}
            {isFilteredTreeEmpty && fileTreeFilter === 'all' && !fileTreeLoaded ? (
              <div className="flex items-center gap-2 px-4 py-3 text-[13px] text-[var(--nim-text-muted)]">
                <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
                Loading files...
              </div>
            ) : isFilteredTreeEmpty && fileTreeFilter !== 'all' ? (
              <div className="file-tree-empty-state flex flex-col items-center justify-center py-12 px-6 text-center min-h-[300px]">
                <span className="material-symbols-outlined file-tree-empty-icon text-5xl text-[var(--nim-text-faint)] opacity-50 mb-4">
                  filter_list_off
                </span>
                <h3 className="file-tree-empty-title m-0 mb-2 text-base font-semibold text-[var(--nim-text)]">{getEmptyStateMessage().title}</h3>
                <p className="file-tree-empty-description m-0 mb-6 text-[13px] text-[var(--nim-text-muted)] leading-normal max-w-[280px]">{getEmptyStateMessage().description}</p>
                <button
                  className="file-tree-clear-filter-btn nim-btn-primary px-4 py-2 rounded-md text-[13px] font-medium hover:opacity-90 hover:-translate-y-px active:translate-y-0 transition-all duration-200"
                  onClick={() => handleFilterChange('all')}
                >
                  Clear Filter
                </button>
              </div>
            ) : (
              <FlatFileTree
                items={modeFilteredTree}
                currentFilePath={currentFilePath}
                onFileSelect={handleFileSelect}
                showIcons={showFileIcons}
                enableAutoScroll={enableAutoScroll}
                onNewFile={handleNewFileInFolder}
                onNewFolder={handleNewFolderInFolder}
                onRefreshFileTree={handleRefreshFileTree}
                onFolderContentsLoaded={handleFolderContentsLoaded}
                onViewWorkspaceHistory={onViewWorkspaceHistory}
                onFolderSelect={handleSelectedFolderChange}
                extensionFileTypes={extensionFileTypes}
              />
            )}
            {isDragOverRoot && (
              <div className="root-drop-indicator sticky top-0 bg-gradient-to-b from-[var(--nim-accent-subtle)] to-transparent text-center text-[13px] font-medium text-[var(--nim-primary)] z-10 mb-2 rounded">
                Drop here to move to workspace root
              </div>
            )}
          </div>
          {!developerMode && hiddenFileCount > 0 && (
            <div
              data-testid="hidden-files-footer"
              className="hidden-files-footer shrink-0 flex items-center flex-wrap gap-x-1 gap-y-0.5 py-1.5 px-3 border-t border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] text-xs text-[var(--nim-text-muted)]"
            >
              <span className="material-symbols-outlined text-[14px] leading-none text-[var(--nim-text-faint)]">visibility_off</span>
              <span className="hidden-files-footer-count">
                {hiddenFileCount} {hiddenFileCount === 1 ? 'file' : 'files'} hidden -
              </span>
              <button
                type="button"
                data-testid="hidden-files-footer-action"
                className="hidden-files-footer-action bg-transparent border-none p-0 cursor-pointer text-[var(--nim-primary)] hover:underline"
                onClick={handleSwitchToDeveloperMode}
              >
                switch to Developer mode to show
              </button>
            </div>
          )}
          {showFilterMenu && (
            <FileTreeFilterMenu
              x={filterMenuPosition.x}
              y={filterMenuPosition.y}
              currentFilter={fileTreeFilter}
              showIcons={showFileIcons}
              showGitStatus={showGitStatus}
              enableAutoScroll={enableAutoScroll}
              onFilterChange={handleFilterChange}
              onShowIconsChange={setShowFileIcons}
              onShowGitStatusChange={setShowGitStatus}
              onEnableAutoScrollChange={setEnableAutoScroll}
              hasActiveClaudeSession={hasActiveClaudeSession}
              claudeSessionFileCounts={{
                read: sessionFileFilters.read.length,
                written: sessionFileFilters.written.length
              }}
              isGitRepo={isGitRepo}
              gitUncommittedCount={gitUncommittedFiles.length}
              isGitWorktree={isGitWorktree}
              gitWorktreeCount={gitWorktreeModifiedFiles.length}
              onClose={() => setShowFilterMenu(false)}
            />
          )}
          {showNewFileMenu && (
            <NewFileMenu
              x={newFileMenuPosition.x}
              y={newFileMenuPosition.y}
              onSelect={handleNewFileTypeSelect}
              onClose={() => setShowNewFileMenu(false)}
              extensionFileTypes={extensionFileTypes}
            />
          )}
        </>
      ) : (
        <PlansPanel
          currentFilePath={currentFilePath}
          onPlanSelect={onFileSelect}
        />
      )}

      <InputModal
        isOpen={isFileModalOpen}
        title={(() => {
          if (pendingFileType === 'markdown') {
            return targetFolder ? `New Markdown File in ${getFileName(targetFolder)}` : "New Markdown File";
          }
          if (pendingFileType === 'mockup') {
            return targetFolder ? `New Mockup in ${getFileName(targetFolder)}` : "New Mockup";
          }
          if (pendingFileType?.startsWith('ext:')) {
            const extName = pendingFileType.slice(4);
            const extType = extensionFileTypes.find(e => e.extension === extName);
            const displayName = extType?.displayName || 'File';
            return targetFolder ? `New ${displayName} in ${getFileName(targetFolder)}` : `New ${displayName}`;
          }
          return targetFolder ? `New File in ${getFileName(targetFolder)}` : "New File";
        })()}
        placeholder={
          pendingFileType === 'markdown' || pendingFileType === 'mockup' || pendingFileType?.startsWith('ext:')
            ? "Enter name"
            : "Enter file name with extension"
        }
        suffix={(() => {
          if (pendingFileType === 'markdown') return ".md";
          if (pendingFileType === 'mockup') return ".mockup.html";
          if (pendingFileType?.startsWith('ext:')) {
            const extName = pendingFileType.slice(4);
            return extName;
          }
          return undefined;
        })()}
        defaultValue=""
        onConfirm={handleCreateFile}
        onCancel={() => {
          setIsFileModalOpen(false);
          setTargetFolder(null);
          setPendingFileType(null);
        }}
      />

      <InputModal
        isOpen={isFolderModalOpen}
        title={targetFolder ? `New Folder in ${getFileName(targetFolder)}` : "New Folder"}
        placeholder="Enter folder name"
        defaultValue=""
        onConfirm={handleCreateFolder}
        onCancel={() => {
          setIsFolderModalOpen(false);
          setTargetFolder(null);
        }}
      />

      <NewFileDialog
        isOpen={isNewFileDialogOpen}
        onClose={() => {
          setIsNewFileDialogOpen(false);
          setNewFileDialogDirectory(null);
        }}
        currentDirectory={newFileDialogDirectory || workspacePath}
        workspacePath={workspacePath}
        onCreateFile={handleNewFileDialogCreate}
        extensionFileTypes={extensionFileTypes}
        onDirectoryChange={setNewFileDialogDirectory}
      />
    </div>
  );
}
