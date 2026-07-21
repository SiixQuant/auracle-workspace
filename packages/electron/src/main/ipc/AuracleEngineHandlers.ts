import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { app, safeStorage, shell } from 'electron';
import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';

/**
 * Loopback bridge between the renderer (Auracle pack extension) and the local
 * Auracle engine. Lives in the main process because the engine's /ui surface
 * authenticates with an `auracle_session` cookie plus a double-submit CSRF
 * token — headers a renderer `fetch` is forbidden from setting.
 *
 * Contract per request:
 *   - every request sends `X-API-Key` and `Cookie: auracle_session=<key>`
 *   - mutations (non-GET) first obtain the `auracle_csrf` cookie from
 *     `GET /ui/api/status`, then echo it as both cookie and `X-CSRF-Token`
 *   - a 403 on a mutation refreshes the CSRF token once and retries
 *
 * Credentials come from the launcher-provisioned config file
 * `~/.config/auracle/auracle.json` `{engine_url, api_key}`, overridable for
 * development via AURACLE_ENGINE_URL / AURACLE_API_KEY.
 */

interface EngineConfig {
  engineUrl: string;
  apiKey: string;
}

export interface EngineResponse {
  ok: boolean;
  status: number;
  /** Parsed JSON body when the response was JSON, otherwise raw text. */
  body: unknown;
}

const DEFAULT_ENGINE_URL = 'http://127.0.0.1:1969';
const CONFIG_PATH = path.join(os.homedir(), '.config', 'auracle', 'auracle.json');

let csrfToken: string | null = null;

async function readConfig(): Promise<EngineConfig> {
  let fileUrl = '';
  let fileKey = '';
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as { engine_url?: string; api_key?: string };
    fileUrl = (parsed.engine_url ?? '').trim();
    fileKey = (parsed.api_key ?? '').trim();
  } catch {
    // Missing or unreadable config is a normal state (engine not provisioned).
  }
  const engineUrl = (process.env.AURACLE_ENGINE_URL?.trim() || fileUrl || DEFAULT_ENGINE_URL)
    .replace(/\/+$/, '');
  const apiKey = process.env.AURACLE_API_KEY?.trim() || fileKey;
  return { engineUrl, apiKey };
}

function parseSetCookie(headers: Headers, name: string): string | null {
  const cookies: string[] =
    typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie') as string]
        : [];
  for (const line of cookies) {
    const match = line.match(new RegExp(`(?:^|[ ,])${name}=([^;]+)`));
    if (match) return match[1];
  }
  return null;
}

async function fetchCsrf(config: EngineConfig): Promise<string | null> {
  const response = await fetch(`${config.engineUrl}/ui/api/status`, {
    method: 'GET',
    headers: baseHeaders(config),
  });
  const token = parseSetCookie(response.headers, 'auracle_csrf');
  if (token) csrfToken = token;
  return csrfToken;
}

function baseHeaders(config: EngineConfig, csrf?: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
    let cookie = `auracle_session=${config.apiKey}`;
    if (csrf) cookie += `; auracle_csrf=${csrf}`;
    headers['Cookie'] = cookie;
  }
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return headers;
}

async function toEngineResponse(response: Response): Promise<EngineResponse> {
  const text = await response.text();
  let body: unknown = text;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      body = JSON.parse(text);
    } catch {
      // fall through with raw text
    }
  }
  return { ok: response.ok, status: response.status, body };
}

/**
 * Make an authenticated request to the local Auracle engine's /ui surface,
 * reusing the same cookie + CSRF handling as the renderer bridge. Exported so
 * other main-process services (e.g. the proactive-notification paid gate) can
 * read engine state with the identical auth instead of re-implementing it.
 */
export async function auracleEngineRequest(
  method: string,
  requestPath: string,
  body?: unknown
): Promise<EngineResponse> {
  const config = await readConfig();
  const isMutation = method.toUpperCase() !== 'GET';
  let csrf: string | null = null;
  if (isMutation) {
    csrf = csrfToken ?? (await fetchCsrf(config));
  }

  const doFetch = async (token: string | null): Promise<Response> => {
    const headers = baseHeaders(config, isMutation ? token : null);
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(`${config.engineUrl}${requestPath}`, {
      method: method.toUpperCase(),
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let response = await doFetch(csrf);
  if (isMutation && response.status === 403) {
    // Stale or missing CSRF token: refresh once and retry.
    csrf = await fetchCsrf(config);
    response = await doFetch(csrf);
  }
  return toEngineResponse(response);
}

/**
 * Keyless sign-in transport. The device flow (`/auth/device/*`, `/auth/refresh`)
 * is unauthenticated and CSRF-exempt JSON served by both the hosted identity
 * deployment ("HQ") and the local engine. Start prefers HQ and falls back to
 * the local engine; every later call must be pinned to whichever base opened
 * the session, so callers pass the base back and we validate it against the
 * two known origins (never arbitrary URLs).
 */
const HQ_CANONICAL = 'https://amused-commitment-production-fb48.up.railway.app';

function hqBase(): string {
  const override = process.env.AURACLE_HQ_URL?.trim();
  return (override && override.length > 0 ? override : HQ_CANONICAL).replace(/\/+$/, '');
}

async function authPost(base: string, path: string, body: unknown): Promise<EngineResponse> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return toEngineResponse(response);
}

/**
 * Auracle session store — the ONE home for the signed-in identity, shared by
 * every surface (native Account panel, pack Account section, future gates).
 * Tokens are encrypted at rest with the OS keychain-backed safeStorage; the
 * decrypted values never cross the IPC boundary — renderers only ever see
 * `{signedIn, email, tier, offline}`.
 */
interface StoredSession {
  base: string;
  signed_jwt: string;
  refresh_token: string;
  email: string;
  tier: string;
}

function sessionPath(): string {
  return path.join(app.getPath('userData'), 'auracle-session.enc');
}

async function readSession(): Promise<StoredSession | null> {
  try {
    const raw = await fs.readFile(sessionPath());
    const text = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf-8');
    const parsed = JSON.parse(text) as StoredSession;
    return parsed && parsed.refresh_token ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSession(session: StoredSession): Promise<void> {
  const text = JSON.stringify(session);
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(text)
    : Buffer.from(text, 'utf-8');
  await fs.writeFile(sessionPath(), payload, { mode: 0o600 });
}

async function clearSession(): Promise<void> {
  await fs.rm(sessionPath(), { force: true });
}

export function registerAuracleEngineHandlers(): void {
  safeHandle('auracle:auth-state', async () => {
    const session = await readSession();
    if (!session) return { signedIn: false };
    try {
      const response = await authPost(session.base, '/auth/refresh', {
        refresh_token: session.refresh_token,
      });
      if (response.ok) {
        const body = (response.body ?? {}) as Partial<StoredSession> & {
          signed_jwt?: string;
          refresh_token?: string;
        };
        const updated: StoredSession = {
          ...session,
          signed_jwt: body.signed_jwt ?? session.signed_jwt,
          refresh_token: body.refresh_token ?? session.refresh_token,
          email: body.email ?? session.email,
          tier: body.tier ?? session.tier,
        };
        await writeSession(updated);
        return { signedIn: true, email: updated.email, tier: updated.tier, offline: false };
      }
      if (response.status === 401) {
        await clearSession();
        return { signedIn: false, expired: true };
      }
    } catch {
      // fall through to the offline-cached answer
    }
    // Identity host unreachable: keep the cached identity — local work never
    // breaks; live entitlement is re-verified engine-side anyway.
    return { signedIn: true, email: session.email, tier: session.tier, offline: true };
  });

  safeHandle(
    'auracle:auth-persist',
    async (
      _event,
      payload: { base: string; signed_jwt?: string; refresh_token?: string; email?: string; tier?: string }
    ) => {
      if (!payload || typeof payload.base !== 'string' || !payload.refresh_token) {
        return { ok: false };
      }
      await writeSession({
        base: payload.base,
        signed_jwt: payload.signed_jwt ?? '',
        refresh_token: payload.refresh_token,
        email: payload.email ?? '',
        tier: payload.tier ?? '',
      });
      return { ok: true };
    }
  );

  safeHandle('auracle:auth-signout', async () => {
    await clearSession();
    return { ok: true };
  });

  // Open the engine's hosted sign-in in the system browser. The engine runs
  // the whole OAuth+PKCE dance and persists the shared session; the renderer
  // then polls GET /auth/session to reflect it.
  safeHandle('auracle:auth-clerk-start', async () => {
    const config = await readConfig();
    await shell.openExternal(`${config.engineUrl}/auth/clerk/start`);
    return { ok: true };
  });

  safeHandle('auracle:auth-bases', async () => {
    const config = await readConfig();
    return { hq: hqBase(), engine: config.engineUrl };
  });

  safeHandle('auracle:auth-start', async (_event, email: string) => {
    if (typeof email !== 'string' || !email.includes('@')) {
      return { ok: false, status: 0, body: 'invalid email', base: null };
    }
    const config = await readConfig();
    const bases = [hqBase(), config.engineUrl];
    for (const base of bases) {
      try {
        const response = await authPost(base, '/auth/device/start', { email });
        if (response.ok) {
          return { ...response, base };
        }
      } catch {
        // fall through to the next base
      }
    }
    return { ok: false, status: 0, body: null, base: null };
  });

  safeHandle(
    'auracle:auth-request',
    async (_event, base: string, path: string, body: unknown) => {
      const config = await readConfig();
      const allowed = new Set([hqBase(), config.engineUrl]);
      if (!allowed.has(base) || typeof path !== 'string' || !path.startsWith('/auth/')) {
        return { ok: false, status: 0, body: 'invalid auth request' };
      }
      try {
        return await authPost(base, path, body);
      } catch {
        return { ok: false, status: 0, body: null };
      }
    }
  );

  safeHandle('auracle:engine-config', async () => {
    const config = await readConfig();
    return { engineUrl: config.engineUrl, hasKey: config.apiKey.length > 0 };
  });

  safeHandle(
    'auracle:engine-request',
    async (_event, method: string, requestPath: string, body?: unknown) => {
      if (typeof requestPath !== 'string' || !requestPath.startsWith('/')) {
        return { ok: false, status: 0, body: 'invalid path' };
      }
      try {
        return await auracleEngineRequest(method, requestPath, body);
      } catch (error) {
        // Engine down/unreachable is a normal state the UI renders honestly.
        logger.main?.debug?.(
          `[AuracleEngine] ${method} ${requestPath} failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return { ok: false, status: 0, body: null };
      }
    }
  );
}
