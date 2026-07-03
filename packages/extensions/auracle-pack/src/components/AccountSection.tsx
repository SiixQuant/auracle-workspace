/**
 * Auracle account section: keyless sign-in via the email device flow
 * (magic link + 6-digit code), mirroring the launcher's HQ-first topology.
 * Sign-in is optional — everything local works signed out. Tokens live only
 * in the OS keychain (extension secret storage); identity display data
 * (email/tier) is not secret and lives in plain extension storage.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtensionStorage } from '@nimbalyst/extension-sdk';
import { authRequest, authStart } from '../engine/client';

const JWT_KEY = 'auracle_signed_jwt';
const REFRESH_KEY = 'auracle_refresh_token';
const IDENTITY_KEY = 'auracle_identity';
const POLL_INTERVAL_MS = 3_000;
const POLL_LIMIT = 100;

interface Identity {
  email: string;
  tier: string;
  base: string;
}

interface ReadyPayload {
  status?: string;
  signed_jwt?: string;
  refresh_token?: string;
  tier?: string;
  email?: string;
}

type AccountState =
  | { kind: 'loading' }
  | { kind: 'signed-out'; error?: string }
  | { kind: 'pending'; email: string; base: string; deviceCode: string; error?: string }
  | { kind: 'signed-in'; identity: Identity };

const styles = {
  note: { fontSize: 12, color: 'var(--text-tertiary, #8a8f98)' },
  input: {
    width: '100%',
    maxWidth: 320,
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 13,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    background: 'var(--bg-primary, rgba(0,0,0,0.2))',
    color: 'var(--text-primary, #d7dae0)',
  },
  button: (primary?: boolean) => ({
    padding: '5px 12px',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    background: primary ? 'var(--accent-primary, #0053fd)' : 'transparent',
    color: primary ? '#fff' : 'var(--text-primary, #d7dae0)',
  }),
  chip: {
    fontSize: 11,
    padding: '1px 8px',
    borderRadius: 999,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    color: 'var(--text-secondary, #b9bec7)',
  },
};

async function persistReady(
  storage: ExtensionStorage,
  base: string,
  payload: ReadyPayload
): Promise<Identity> {
  if (payload.signed_jwt) await storage.setSecret(JWT_KEY, payload.signed_jwt);
  if (payload.refresh_token) await storage.setSecret(REFRESH_KEY, payload.refresh_token);
  const identity: Identity = {
    email: payload.email ?? '',
    tier: payload.tier ?? '',
    base,
  };
  await storage.setGlobal(IDENTITY_KEY, identity);
  return identity;
}

async function clearSession(storage: ExtensionStorage): Promise<void> {
  await storage.deleteSecret(JWT_KEY);
  await storage.deleteSecret(REFRESH_KEY);
  await storage.setGlobal(IDENTITY_KEY, null);
}

export function AccountSection({ storage }: { storage: ExtensionStorage }): JSX.Element {
  const [state, setState] = useState<AccountState>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const pollCount = useRef(0);

  // On mount: restore identity; silently refresh the entitlement when a
  // refresh token exists; degrade honestly to signed-out when it is rejected.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const identity = (await storage.getGlobal(IDENTITY_KEY)) as Identity | null;
      const refreshToken = await storage.getSecret(REFRESH_KEY);
      if (!identity || !refreshToken) {
        if (!cancelled) setState({ kind: 'signed-out' });
        return;
      }
      const response = await authRequest(identity.base, '/auth/refresh', {
        refresh_token: refreshToken,
      });
      if (cancelled) return;
      if (response.ok) {
        const payload = (response.body ?? {}) as ReadyPayload;
        const updated = await persistReady(storage, identity.base, {
          ...payload,
          email: payload.email ?? identity.email,
          tier: payload.tier ?? identity.tier,
        });
        setState({ kind: 'signed-in', identity: updated });
      } else if (response.status === 401) {
        await clearSession(storage);
        setState({ kind: 'signed-out', error: 'Your session expired. Sign in again.' });
      } else {
        // Offline or identity host unreachable: keep the cached identity —
        // local work never breaks; live entitlement is re-verified engine-side.
        setState({ kind: 'signed-in', identity });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const start = useCallback(async () => {
    setBusy(true);
    const response = await authStart(email.trim());
    setBusy(false);
    if (response.ok && response.base) {
      const body = (response.body ?? {}) as { device_code?: string };
      pollCount.current = 0;
      setState({
        kind: 'pending',
        email: email.trim(),
        base: response.base,
        deviceCode: body.device_code ?? '',
      });
    } else {
      setState({
        kind: 'signed-out',
        error:
          'Could not start sign-in. The identity service (or local engine email delivery) is not reachable.',
      });
    }
  }, [email]);

  // Poll for magic-link completion while pending.
  useEffect(() => {
    if (state.kind !== 'pending' || !state.deviceCode) return;
    const timer = setInterval(() => {
      void (async () => {
        pollCount.current += 1;
        if (pollCount.current > POLL_LIMIT) {
          clearInterval(timer);
          return;
        }
        const response = await authRequest(state.base, '/auth/device/poll', {
          device_code: state.deviceCode,
        });
        const body = (response.body ?? {}) as ReadyPayload;
        if (response.ok && body.status === 'ready') {
          clearInterval(timer);
          const identity = await persistReady(storage, state.base, body);
          setState({ kind: 'signed-in', identity });
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [state, storage]);

  const verify = useCallback(async () => {
    if (state.kind !== 'pending') return;
    setBusy(true);
    const response = await authRequest(state.base, '/auth/device/verify', {
      email: state.email,
      code: code.trim(),
    });
    setBusy(false);
    const body = (response.body ?? {}) as ReadyPayload;
    if (response.ok && body.status === 'ready') {
      const identity = await persistReady(storage, state.base, body);
      setState({ kind: 'signed-in', identity });
    } else {
      setState({ ...state, error: 'That code was not accepted. Check it and try again.' });
    }
  }, [state, code, storage]);

  const signOut = useCallback(async () => {
    await clearSession(storage);
    setEmail('');
    setCode('');
    setState({ kind: 'signed-out' });
  }, [storage]);

  if (state.kind === 'loading') {
    return <div style={styles.note}>Loading account…</div>;
  }

  if (state.kind === 'signed-in') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 500 }}>{state.identity.email || 'Signed in'}</span>
        {state.identity.tier ? <span style={styles.chip}>{state.identity.tier}</span> : null}
        <button type="button" style={styles.button()} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  if (state.kind === 'pending') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={styles.note}>
          We emailed a sign-in link and a 6-digit code to {state.email}. Click the link, or enter
          the code here.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...styles.input, maxWidth: 140 }}
            inputMode="numeric"
            placeholder="6-digit code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button type="button" style={styles.button(true)} disabled={busy} onClick={() => void verify()}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          <button type="button" style={styles.button()} onClick={() => setState({ kind: 'signed-out' })}>
            Cancel
          </button>
        </div>
        {state.error ? <div style={{ ...styles.note, color: '#c4554d' }}>{state.error}</div> : null}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={styles.note}>
        Sign in to link your Auracle account (license tier, live-trading entitlement). Everything
        local works without an account.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={styles.input}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button
          type="button"
          style={styles.button(true)}
          disabled={busy || !email.includes('@')}
          onClick={() => void start()}
        >
          {busy ? 'Sending…' : 'Send sign-in link'}
        </button>
      </div>
      {state.error ? <div style={{ ...styles.note, color: '#c4554d' }}>{state.error}</div> : null}
    </div>
  );
}
