/**
 * Stytch B2B Configuration
 *
 * These are PUBLIC tokens - safe to commit to git.
 * They are designed to be embedded in client-side code.
 *
 * DO NOT put the secret key here - it should only exist on the server (collabv3).
 */

export const STYTCH_CONFIG = {
  // Auracle: the upstream vendor's live tenant tokens are removed — identity
  // is handled by the Auracle device flow, not Stytch. The env override below
  // remains for anyone standing up their own tenant.
  live: {
    projectId: '',
    publicToken: '',
    apiBase: 'https://api.stytch.com/v1/b2b',
  },
};

/**
 * Get the Stytch config.
 */
export function getStytchConfig() {
  // Allow override via environment variable
  if (process.env.STYTCH_PROJECT_ID && process.env.STYTCH_PUBLIC_TOKEN) {
    return {
      projectId: process.env.STYTCH_PROJECT_ID,
      publicToken: process.env.STYTCH_PUBLIC_TOKEN,
      apiBase: 'https://api.stytch.com/v1/b2b',
    };
  }

  return STYTCH_CONFIG.live;
}
