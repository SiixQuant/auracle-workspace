/**
 * What a person can ask this desk to do — read from the engine.
 *
 * The list is not held here and must not be. It lives in the engine
 * (`auracle/commands.py`) precisely so the desktop and the browser render the
 * same one; a copy in this package would be a second list that drifts, which
 * is the failure the move was made to end.
 *
 * ★ THREE OUTCOMES, NOT TWO. `getJsonDetailed` keeps the status so a 404 —
 * this engine build predates the route — stays distinguishable from status 0,
 * nothing answered. They call for different sentences: one is "update the
 * engine", the other is "the engine is down", and telling somebody the wrong
 * one sends them to fix the wrong thing.
 */
import { getJsonDetailed } from './client';

export interface DeskCommand {
  id: string;
  label: string;
  hint: string;
  utility: string;
  origin: string;
  available: boolean;
  /** Absent on unbuilt commands, by construction on the engine side. */
  prompt?: string;
}

export interface DeskUtility {
  id: string;
  name: string;
  blurb: string;
}

export type DeskCatalogue =
  | { status: 'unread' }
  | { status: 'ready'; utilities: DeskUtility[]; commands: DeskCommand[] }
  | { status: 'outdated' }
  | { status: 'unreachable' };

let CATALOGUE: DeskCatalogue = { status: 'unread' };
let lastLoadAt = 0;

/** Whatever was last read. Synchronous, because a command provider is. */
export function deskCatalogue(): DeskCatalogue {
  return CATALOGUE;
}

/**
 * What the palette may offer.
 *
 * ★ Only built commands, and only ones carrying a question. A menu can
 * honestly show a plan and mark a row "soon"; a palette RUNS what you pick, so
 * an unbuilt row there is a broken control. The engine omits `prompt` on those
 * anyway, so this holds even if `available` were ever wrong.
 */
export function runnableDeskCommands(): DeskCommand[] {
  if (CATALOGUE.status !== 'ready') return [];
  return CATALOGUE.commands.filter((c) => c.available && typeof c.prompt === 'string' && c.prompt);
}

function isCatalogue(body: unknown): body is { utilities: DeskUtility[]; commands: DeskCommand[] } {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return Array.isArray(b.utilities) && Array.isArray(b.commands);
}

/**
 * Repopulate the catalogue, at most once per 5 minutes. Fire-and-forget: the
 * palette calls this when it opens, so the list is as fresh as the last time
 * anyone looked, and a failed read leaves the previous one intact rather than
 * emptying the palette because a request happened to fail.
 */
export function refreshDeskCommands(): void {
  const now = Date.now();
  if (now - lastLoadAt < 5 * 60_000) return;
  lastLoadAt = now;
  void reload();
}

async function reload(): Promise<void> {
  const res = await getJsonDetailed<unknown>('/ui/api/commands');

  if (res.ok) {
    if (!isCatalogue(res.body)) {
      // Half a malformed catalogue would hide commands with nothing to say why.
      CATALOGUE = { status: 'unreachable' };
      return;
    }
    CATALOGUE = { status: 'ready', utilities: res.body.utilities, commands: res.body.commands };
    return;
  }

  // 404 is the one worth naming: the engine is running, it simply predates
  // this route. Anything else — 0 for no answer, 401 for no session — reads as
  // not reachable right now, which is true of both.
  CATALOGUE = res.status === 404 ? { status: 'outdated' } : { status: 'unreachable' };
}

/** Test seam: seed deterministically, no network. Stamps the load time so the
 *  palette's on-open refresh stays throttled and cannot clobber the seed. */
export function __setDeskCatalogueForTest(next: DeskCatalogue): void {
  CATALOGUE = next;
  lastLoadAt = Date.now();
}
