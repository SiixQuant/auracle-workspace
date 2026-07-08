import { atom } from 'jotai';

// The ONE Auracle identity the whole IDE should read. It reflects the
// engine-held hosted sign-in session (GET /auth/session) shared by the
// launcher, the IDE, and the web — NOT nimbalyst's dormant Stytch/sync auth.
// The gutter user button, the user-menu popover, and the Account panel all
// read this so they never disagree. A single poller (mounted in the always-on
// NavigationGutter) keeps it fresh.
export interface AuracleSessionState {
  /** null = not yet loaded (avoid flashing a logged-out look on startup). */
  signedIn: boolean | null;
  email?: string;
  tier?: string;
  /** Google (or other IdP) avatar URL, when the session carries one. */
  picture?: string;
}

export const auracleSessionAtom = atom<AuracleSessionState>({ signedIn: null });
