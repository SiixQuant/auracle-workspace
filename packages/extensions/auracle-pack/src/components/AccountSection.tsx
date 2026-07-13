/**
 * Auracle account section (pack settings page): keyless email device flow,
 * hosted-identity-first with local-engine fallback. Reads and writes the ONE
 * shared session store in the main process — the same identity the native
 * Settings → Account page shows. Sign-in is optional; everything local works
 * signed out. Tokens live only in the OS-encrypted store, never in the
 * renderer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authPersist, authRequest, authSignout, authStart, authState } from '../engine/client';
import { Button, ensurePanelKitStyles, tone } from './panelkit';

const POLL_INTERVAL_MS = 3_000;
const POLL_LIMIT = 100;

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
  | { kind: 'signed-in'; email: string; tier: string; offline: boolean };

const styles = {
  note: { fontSize: 12, color: tone.text3 },
  input: {
    width: '100%',
    maxWidth: 320,
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 13,
    border: `1px solid ${tone.borderStrong}`,
    background: tone.sunken,
    color: tone.text,
  },
  chip: {
    fontSize: 11,
    padding: '1px 8px',
    borderRadius: 999,
    border: `1px solid ${tone.borderStrong}`,
    color: tone.text2,
  },
};

export function AccountSection(): JSX.Element {
  ensurePanelKitStyles();
  const [state, setState] = useState<AccountState>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const pollCount = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const auth = await authState();
      if (cancelled) return;
      if (auth.signedIn) {
        setState({
          kind: 'signed-in',
          email: auth.email ?? '',
          tier: auth.tier ?? '',
          offline: auth.offline ?? false,
        });
      } else {
        setState({
          kind: 'signed-out',
          error: auth.expired ? 'Your session expired. Sign in again.' : undefined,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = useCallback(async (base: string, payload: ReadyPayload) => {
    await authPersist({
      base,
      signed_jwt: payload.signed_jwt,
      refresh_token: payload.refresh_token,
      email: payload.email,
      tier: payload.tier,
    });
    setState({
      kind: 'signed-in',
      email: payload.email ?? '',
      tier: payload.tier ?? '',
      offline: false,
    });
  }, []);

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
          await finish(state.base, body);
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [state, finish]);

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
      await finish(state.base, body);
    } else {
      setState({ ...state, error: 'That code was not accepted. Check it and try again.' });
    }
  }, [state, code, finish]);

  const signOut = useCallback(async () => {
    await authSignout();
    setEmail('');
    setCode('');
    setState({ kind: 'signed-out' });
  }, []);

  if (state.kind === 'loading') {
    return <div style={styles.note}>Loading account…</div>;
  }

  if (state.kind === 'signed-in') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 500 }}>{state.email || 'Signed in'}</span>
        {state.tier ? <span style={styles.chip}>{state.tier}</span> : null}
        {state.offline ? <span style={styles.note}>identity service unreachable — cached</span> : null}
        <Button variant="danger" onClick={() => void signOut()}>
          Sign out
        </Button>
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
          <Button variant="primary" disabled={busy} onClick={() => void verify()}>
            {busy ? 'Verifying…' : 'Verify'}
          </Button>
          <Button variant="ghost" onClick={() => setState({ kind: 'signed-out' })}>
            Cancel
          </Button>
        </div>
        {state.error ? <div style={{ ...styles.note, color: tone.danger }}>{state.error}</div> : null}
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
        <Button
          variant="primary"
          disabled={busy || !email.includes('@')}
          onClick={() => void start()}
        >
          {busy ? 'Sending…' : 'Send sign-in link'}
        </Button>
      </div>
      {state.error ? <div style={{ ...styles.note, color: tone.danger }}>{state.error}</div> : null}
    </div>
  );
}
