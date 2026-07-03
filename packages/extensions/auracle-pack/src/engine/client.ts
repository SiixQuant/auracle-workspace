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

/** Mutation returning the full bridge response so callers can render errors honestly. */
export async function postJson(path: string, body?: unknown): Promise<BridgeResponse> {
  return request('POST', path, body);
}

export async function putJson(path: string, body?: unknown): Promise<BridgeResponse> {
  return request('PUT', path, body);
}

/** Engine reachability + identity probe (`/ui/api/ide/connect-check`). */
export async function connectCheck(): Promise<ConnectCheck | null> {
  return getJson<ConnectCheck>('/ui/api/ide/connect-check');
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
