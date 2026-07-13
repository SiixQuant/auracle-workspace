/**
 * Renderer-side engine client for the Auracle pack. All HTTP goes through the
 * main-process bridge (`auracle:engine-request`), which owns the cookie +
 * double-submit CSRF contract the engine's /ui surface requires — headers a
 * renderer fetch cannot set.
 */
import type { ConnectCheck } from './model';

interface BridgeResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

interface ElectronBridge {
  electronAPI?: {
    invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
}

function bridge(): ((channel: string, ...args: unknown[]) => Promise<unknown>) | null {
  const api = (window as unknown as ElectronBridge).electronAPI;
  return api?.invoke ? api.invoke.bind(api) : null;
}

export async function engineConfig(): Promise<{ engineUrl: string; hasKey: boolean }> {
  const invoke = bridge();
  if (!invoke) return { engineUrl: '', hasKey: false };
  try {
    return (await invoke('auracle:engine-config')) as { engineUrl: string; hasKey: boolean };
  } catch {
    return { engineUrl: '', hasKey: false };
  }
}

async function request(method: string, path: string, body?: unknown): Promise<BridgeResponse> {
  const invoke = bridge();
  if (!invoke) return { ok: false, status: 0, body: null };
  try {
    return (await invoke('auracle:engine-request', method, path, body)) as BridgeResponse;
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/** GET returning parsed JSON, or null on any transport/HTTP failure. */
export async function getJson<T>(path: string): Promise<T | null> {
  const response = await request('GET', path);
  return response.ok && response.body !== null ? (response.body as T) : null;
}

/**
 * GET that keeps the HTTP status on failure, so callers can distinguish
 * "this engine build doesn't serve the route" (404 — engine outdated)
 * from "nothing answered" (status 0 — unreachable). getJson erases that
 * difference, which is how the Research panel once reported a stale
 * engine as network trouble.
 */
export async function getJsonDetailed<T>(
  path: string
): Promise<{ ok: true; body: T } | { ok: false; status: number; body: unknown }> {
  const response = await request('GET', path);
  if (response.ok && response.body !== null) return { ok: true, body: response.body as T };
  // Keep the parsed body on failure too: an HTTP 4xx (e.g. a 422 with {detail})
  // still carries a reason the caller may want to surface. getJson drops it.
  return { ok: false, status: response.status, body: response.body };
}

/** Mutation returning the full bridge response so callers can render errors honestly. */
export async function postJson(path: string, body?: unknown): Promise<BridgeResponse> {
  return request('POST', path, body);
}

export async function putJson(path: string, body?: unknown): Promise<BridgeResponse> {
  return request('PUT', path, body);
}

/**
 * Queue a backtest of `strategyPath` (a dotted `module.Symbol` discovery id).
 * The engine runs it as a background job, so this returns the job id; poll
 * {@link backtestJobStatus} until the status is terminal. Blank dates let the
 * engine default the window (last ~5 years).
 */
export async function runBacktest(
  strategyPath: string,
  start = '',
  end = ''
): Promise<{ ok: true; jobId: number } | { ok: false; status: number; error?: string }> {
  const res = await postJson('/ui/api/backtest/run', {
    strategy_path: strategyPath,
    start,
    end,
  });
  const body = (res.body ?? {}) as { ok?: boolean; job_id?: number; error?: string };
  if (res.ok && body.ok && typeof body.job_id === 'number') {
    return { ok: true, jobId: body.job_id };
  }
  return { ok: false, status: res.status, error: body.error };
}

/** Poll a backtest job's status. `status` is 'pending'|'running'|'succeeded'|'failed'. */
export async function backtestJobStatus(
  jobId: number
): Promise<{ ok: true; status: string } | { ok: false; status: number }> {
  const res = await getJsonDetailed<{ status?: string }>(
    `/ui/api/backtest/job/${jobId}/status`
  );
  if (res.ok) {
    return { ok: true, status: typeof res.body.status === 'string' ? res.body.status : 'unknown' };
  }
  return { ok: false, status: res.status };
}

/** Engine reachability + identity probe (`/ui/api/ide/connect-check`). */
export async function connectCheck(): Promise<ConnectCheck | null> {
  return getJson<ConnectCheck>('/ui/api/ide/connect-check');
}

/**
 * Keyless sign-in transport. `/auth/*` is unauthenticated JSON served by both
 * the hosted identity deployment (HQ) and the local engine; the bridge tries
 * HQ first and reports which base opened the session, and every later call is
 * pinned to that base.
 */
export async function authBases(): Promise<{ hq: string; engine: string }> {
  const invoke = bridge();
  if (!invoke) return { hq: '', engine: '' };
  try {
    return (await invoke('auracle:auth-bases')) as { hq: string; engine: string };
  } catch {
    return { hq: '', engine: '' };
  }
}

export async function authStart(
  email: string
): Promise<BridgeResponse & { base: string | null }> {
  const invoke = bridge();
  if (!invoke) return { ok: false, status: 0, body: null, base: null };
  try {
    return (await invoke('auracle:auth-start', email)) as BridgeResponse & {
      base: string | null;
    };
  } catch {
    return { ok: false, status: 0, body: null, base: null };
  }
}

export async function authRequest(
  base: string,
  path: string,
  body?: unknown
): Promise<BridgeResponse> {
  const invoke = bridge();
  if (!invoke) return { ok: false, status: 0, body: null };
  try {
    return (await invoke('auracle:auth-request', base, path, body)) as BridgeResponse;
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/**
 * Shared session store (main-process, OS-encrypted). One identity for every
 * surface: the native Account panel and this pack read and write the same
 * state; tokens never reach the renderer.
 */
export interface AuthState {
  signedIn: boolean;
  email?: string;
  tier?: string;
  offline?: boolean;
  expired?: boolean;
}

export async function authState(): Promise<AuthState> {
  const invoke = bridge();
  if (!invoke) return { signedIn: false };
  try {
    return (await invoke('auracle:auth-state')) as AuthState;
  } catch {
    return { signedIn: false };
  }
}

export async function authPersist(payload: {
  base: string;
  signed_jwt?: string;
  refresh_token?: string;
  email?: string;
  tier?: string;
}): Promise<void> {
  const invoke = bridge();
  if (!invoke) return;
  try {
    await invoke('auracle:auth-persist', payload);
  } catch {
    // surfaced by the next authState() read
  }
}

export async function authSignout(): Promise<void> {
  const invoke = bridge();
  if (!invoke) return;
  try {
    await invoke('auracle:auth-signout');
  } catch {
    // surfaced by the next authState() read
  }
}

/**
 * Connect generation: bumped after every saved/disconnected connection so all
 * pack surfaces re-poll immediately instead of waiting out their intervals.
 * In-process because the whole pack is one extension.
 */
type GenerationListener = () => void;
const generationListeners = new Set<GenerationListener>();
let generation = 0;

export function bumpConnectGeneration(): void {
  generation += 1;
  for (const listener of generationListeners) listener();
}

export function connectGenerationValue(): number {
  return generation;
}

export function onConnectGeneration(listener: GenerationListener): () => void {
  generationListeners.add(listener);
  return () => generationListeners.delete(listener);
}
