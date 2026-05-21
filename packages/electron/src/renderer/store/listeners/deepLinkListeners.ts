/**
 * Centralized IPC listeners for deep-link navigation events.
 *
 * Follows the pattern from IPC_LISTENERS.md:
 * - Components NEVER subscribe to IPC events directly
 * - Central listeners update atoms / dispatch
 * - Components react to the atoms
 *
 * Two delivery paths for shared-document links:
 * - Live: main sends `deep-link:open-shared-document` to an already-mounted
 *   window when a link arrives.
 * - Pending queue: when main creates a new window to host the link's
 *   workspace, the renderer drains the queued payload via
 *   `deep-link:consume-pending-shared-doc` on listener init and again any
 *   time the active workspace changes (covers rail-switch flows too).
 */

import { store } from '../index';
import { setWindowModeAtom } from '../atoms/windowMode';
import { pendingCollabDocumentAtom } from '../atoms/collabDocuments';
import { activeWorkspacePathAtom } from '../atoms/openProjects';
import { errorNotificationService } from '../../services/ErrorNotificationService';

interface SharedDocPayload {
  documentId: string;
  orgId: string;
  workspacePath: string;
}

function applySharedDocPayload(data: SharedDocPayload): void {
  if (!data?.documentId || !data?.workspacePath) return;

  const activePath = store.get(activeWorkspacePathAtom);
  if (activePath !== data.workspacePath) {
    // The matching workspace is warm in the project rail but not the
    // visible one. Switch to it before opening the document.
    store.set(activeWorkspacePathAtom, data.workspacePath);
  }

  store.set(setWindowModeAtom, 'collab');
  store.set(pendingCollabDocumentAtom, { documentId: data.documentId });
}

async function drainPendingFor(workspacePath: string | null): Promise<void> {
  if (!workspacePath) return;
  try {
    const pending = await window.electronAPI.invoke(
      'deep-link:consume-pending-shared-doc',
      workspacePath
    ) as SharedDocPayload | null;
    if (pending) applySharedDocPayload(pending);
  } catch (err) {
    console.error('[DeepLink] Failed to consume pending shared doc:', err);
  }
}

/**
 * Initialize deep-link IPC listeners. Should be called once at startup.
 */
export function initDeepLinkListeners(): () => void {
  const cleanups: Array<() => void> = [];

  // Live: main sends this when an already-running window matches the link.
  cleanups.push(
    window.electronAPI.on('deep-link:open-shared-document', (data: SharedDocPayload) => {
      applySharedDocPayload(data);
    })
  );

  // Live: no known workspace matches the link's orgId, or the user isn't signed in.
  cleanups.push(
    window.electronAPI.on('deep-link:shared-document-not-available', (data: {
      documentId: string;
      orgId: string;
      reason?: 'not-authenticated' | 'no-workspace';
    }) => {
      if (data?.reason === 'not-authenticated') {
        errorNotificationService.showWarning(
          'Sign in required',
          'Sign in to your Nimbalyst team account to open this shared document.',
          { duration: 6000 }
        );
      } else {
        errorNotificationService.showWarning(
          'No matching workspace',
          'You do not have a workspace open for the team that owns this document.',
          { duration: 6000 }
        );
      }
      console.warn('[DeepLink] No workspace available for shared doc:', data);
    })
  );

  // Drain any pending payload queued before this listener mounted (newly
  // created window case).
  void drainPendingFor(store.get(activeWorkspacePathAtom));

  // Also drain when the active workspace changes — covers users switching
  // projects in the rail to one that has a queued link.
  const unsubscribe = store.sub(activeWorkspacePathAtom, () => {
    void drainPendingFor(store.get(activeWorkspacePathAtom));
  });
  cleanups.push(unsubscribe);

  return () => {
    cleanups.forEach((fn) => fn?.());
  };
}
