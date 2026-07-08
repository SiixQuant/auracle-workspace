/**
 * Auracle Account panel — replaces the upstream Account & Sync panel's
 * sign-in surface. Same structure (card → email → sent state → signed-in
 * identity row), but the identity provider is the Auracle keyless device
 * flow (hosted identity first, local engine fallback) through the main
 * process bridge; the session lives in ONE store shared with the Auracle
 * pack's settings section.
 *
 * The upstream panel's sync/device/share machinery is deliberately absent:
 * those features rode the previous vendor's hosted sync service. Rather than
 * render controls that silently talk to third-party infrastructure, this
 * panel says exactly what is and isn't connected.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => {
  const api = (window as unknown as {
    electronAPI?: { invoke?: (c: string, ...a: unknown[]) => Promise<unknown> };
  }).electronAPI;
  if (!api?.invoke) return Promise.reject(new Error('bridge unavailable'));
  return api.invoke(channel, ...args);
};

interface EngineSession {
  signed_in?: boolean;
  email?: string;
  tier?: string;
  plan?: string;
  offline?: boolean;
  picture?: string;
}

// The engine holds the one hosted-sign-in session that BOTH the IDE and the
// launcher read. Reading it here is what makes a launcher sign-in show up in
// the IDE (and vice-versa).
async function readEngineSession(): Promise<EngineSession | null> {
  try {
    const r = (await invoke('auracle:engine-request', 'GET', '/auth/session')) as {
      ok: boolean;
      body: unknown;
    };
    if (!r.ok) return null;
    return (r.body ?? {}) as EngineSession;
  } catch {
    return null;
  }
}

interface AuthState {
  signedIn: boolean;
  email?: string;
  tier?: string;
  offline?: boolean;
  expired?: boolean;
}

interface ReadyPayload {
  status?: string;
  signed_jwt?: string;
  refresh_token?: string;
  tier?: string;
  email?: string;
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'signed-out'; error?: string }
  | { kind: 'pending'; email: string; base: string; deviceCode: string; error?: string }
  | { kind: 'signed-in'; email: string; tier: string; offline: boolean; picture?: string };

const POLL_INTERVAL_MS = 3_000;
const POLL_LIMIT = 100;

export function AuracleAccountPanel() {
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [clerkPolling, setClerkPolling] = useState(false);
  const pollCount = useRef(0);

  const loadState = useCallback(async () => {
    // Prefer the engine-held session (the hosted sign-in shared by both apps).
    const engine = await readEngineSession();
    if (engine?.signed_in) {
      setState({
        kind: 'signed-in',
        email: engine.email ?? '',
        tier: engine.tier ?? engine.plan ?? '',
        offline: !!engine.offline,
        picture: engine.picture,
      });
      return;
    }
    try {
      const auth = (await invoke('auracle:auth-state')) as AuthState;
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
    } catch {
      setState({ kind: 'signed-out' });
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const persistAndFinish = useCallback(
    async (base: string, payload: ReadyPayload) => {
      await invoke('auracle:auth-persist', {
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
    },
    []
  );

  const start = async () => {
    setBusy(true);
    try {
      const response = (await invoke('auracle:auth-start', email.trim())) as {
        ok: boolean;
        base: string | null;
        body: unknown;
      };
      if (response.ok && response.base) {
        pollCount.current = 0;
        const body = (response.body ?? {}) as { device_code?: string };
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
            'Could not start sign-in. The Auracle identity service (or the local engine mailer) is not reachable.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  // Continue with Google: the engine opens its hosted sign-in in the browser,
  // runs the OAuth+PKCE dance, and persists the shared session. We poll it.
  const clerkSignIn = async () => {
    setBusy(true);
    try {
      await invoke('auracle:auth-clerk-start');
      pollCount.current = 0;
      setClerkPolling(true);
    } catch {
      setState({
        kind: 'signed-out',
        error: 'Could not open the sign-in page. Is the Auracle engine running?',
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!clerkPolling) return;
    const timer = setInterval(() => {
      void (async () => {
        pollCount.current += 1;
        if (pollCount.current > POLL_LIMIT) {
          clearInterval(timer);
          setClerkPolling(false);
          return;
        }
        const engine = await readEngineSession();
        if (engine?.signed_in) {
          clearInterval(timer);
          setClerkPolling(false);
          setState({
            kind: 'signed-in',
            email: engine.email ?? '',
            tier: engine.tier ?? engine.plan ?? '',
            offline: !!engine.offline,
          });
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [clerkPolling]);

  // Poll for the magic-link completion while pending.
  useEffect(() => {
    if (state.kind !== 'pending' || !state.deviceCode) return;
    const timer = setInterval(() => {
      void (async () => {
        pollCount.current += 1;
        if (pollCount.current > POLL_LIMIT) {
          clearInterval(timer);
          return;
        }
        const response = (await invoke(
          'auracle:auth-request',
          state.base,
          '/auth/device/poll',
          { device_code: state.deviceCode }
        )) as { ok: boolean; body: unknown };
        const body = (response.body ?? {}) as ReadyPayload;
        if (response.ok && body.status === 'ready') {
          clearInterval(timer);
          await persistAndFinish(state.base, body);
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [state, persistAndFinish]);

  const verify = async () => {
    if (state.kind !== 'pending') return;
    setBusy(true);
    try {
      const response = (await invoke('auracle:auth-request', state.base, '/auth/device/verify', {
        email: state.email,
        code: code.trim(),
      })) as { ok: boolean; body: unknown };
      const body = (response.body ?? {}) as ReadyPayload;
      if (response.ok && body.status === 'ready') {
        await persistAndFinish(state.base, body);
      } else {
        setState({ ...state, error: 'That code was not accepted. Check it and try again.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await invoke('auracle:auth-signout');
    try {
      await invoke('auracle:engine-request', 'POST', '/auth/session/signout');
    } catch {
      // Engine may be down; the local session is cleared regardless.
    }
    setEmail('');
    setCode('');
    setClerkPolling(false);
    setState({ kind: 'signed-out' });
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-semibold text-nim mb-1">Account</h2>
      <p className="text-[13px] text-nim-muted mb-6">
        Your Auracle account links this install to your license tier and live-trading
        entitlement. Everything local — editing, backtests, paper trading — works without an
        account.
      </p>

      <div className="p-4 bg-nim-secondary rounded-lg mb-8">
        {state.kind === 'loading' ? (
          <div className="text-[13px] text-nim-faint">Loading account…</div>
        ) : null}

        {state.kind === 'signed-in' ? (
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 shrink-0 rounded-full bg-nim-primary flex items-center justify-center text-nim-on-primary font-semibold text-sm overflow-hidden">
              {(state.email || 'A').charAt(0).toUpperCase()}
              {state.picture ? (
                <img
                  src={state.picture}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(event) => {
                    (event.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : null}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-nim text-[13px] truncate">{state.email}</div>
              <div className="text-[11px] text-nim-faint">
                {state.tier ? `${state.tier} plan` : 'Signed in'}
                {state.offline ? ' · identity service unreachable — using cached session' : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="px-3 py-1.5 text-xs bg-transparent border border-nim rounded text-nim-muted cursor-pointer hover:bg-nim-hover"
            >
              Sign out
            </button>
          </div>
        ) : null}

        {state.kind === 'signed-out' ? (
          <div>
            <div className="text-[13px] text-nim mb-3">
              Sign in to link this install to your plan and live-trading entitlement.
            </div>
            <button
              type="button"
              disabled={busy || clerkPolling}
              onClick={() => void clerkSignIn()}
              className="w-full px-4 py-2.5 flex items-center justify-center gap-2.5 bg-white border border-nim rounded-md text-[#333] font-medium text-[13px] cursor-pointer disabled:opacity-70 disabled:cursor-wait"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="4" r="2.1" fill="currentColor" />
                <circle cx="12" cy="20" r="2.1" fill="currentColor" />
                <circle cx="4" cy="12" r="2.1" fill="currentColor" />
                <circle cx="20" cy="12" r="2.1" fill="currentColor" />
              </svg>
              {clerkPolling ? 'Waiting for browser sign-in…' : 'Continue with Auracle'}
            </button>
            {clerkPolling ? (
              <div className="text-[12px] text-nim-faint mt-2">
                Finish signing in in your browser, then return here — this page updates
                automatically.
              </div>
            ) : null}
            <div className="text-[12px] text-nim-faint mt-3">
              Opens a secure Auracle sign-in in your browser — continue with Google, GitHub, or X.
            </div>
            {state.error ? (
              <div className="text-[12px] text-nim-danger mt-2">{state.error}</div>
            ) : null}
          </div>
        ) : null}

        {state.kind === 'pending' ? (
          <div>
            <div className="text-[13px] text-nim mb-3">
              We emailed a sign-in link and a 6-digit code to {state.email}. Click the link, or
              enter the code here — this page updates automatically.
            </div>
            <div className="flex gap-2">
              <input
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="6-digit code"
                className="w-36 px-3 py-2 bg-nim-primary-bg border border-nim rounded text-nim text-[13px]"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void verify()}
                className="px-3 py-2 bg-nim-primary text-nim-on-primary rounded text-[13px] cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Verifying…' : 'Verify'}
              </button>
              <button
                type="button"
                onClick={() => setState({ kind: 'signed-out' })}
                className="px-3 py-2 bg-transparent border border-nim rounded text-nim-muted text-[13px] cursor-pointer hover:bg-nim-hover"
              >
                Cancel
              </button>
            </div>
            {state.error ? (
              <div className="text-[12px] text-nim-danger mt-2">{state.error}</div>
            ) : null}
          </div>
        ) : null}
      </div>

      <h3 className="text-[15px] font-semibold text-nim mb-1">Mobile &amp; device sync</h3>
      <p className="text-[13px] text-nim-muted">
        Auracle's own sync service isn't live yet, so mobile access, shared links, and device
        pairing are unavailable for now. Nothing on this page talks to third-party servers —
        your sessions and documents stay on this machine.
      </p>
    </div>
  );
}

/** Honest stand-in for the upstream Shared Links panel (vendor-hosted service). */
export function AuracleSharedLinksPanel() {
  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-semibold text-nim mb-1">Shared Links</h2>
      <p className="text-[13px] text-nim-muted">
        Encrypted share links depend on a hosted sync service. Auracle's isn't live yet, so
        nothing can be shared from here — and nothing is sent anywhere. This page will light up
        when the Auracle sync service ships.
      </p>
    </div>
  );
}
