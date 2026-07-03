import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
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

interface EngineResponse {
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

async function engineRequest(
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

export function registerAuracleEngineHandlers(): void {
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
        return await engineRequest(method, requestPath, body);
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
