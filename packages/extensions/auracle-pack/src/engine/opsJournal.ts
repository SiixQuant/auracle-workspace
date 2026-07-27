/**
 * The engine's ops action journal — what was done to the running system, by
 * whom, what it looked like before, and the one action that would put it back.
 *
 * The journal is the paper trail behind the incident feed: the same events
 * arrive there as `ops.applied` / `ops.undone`, so a reader who saw an incident
 * can find the action that caused it and reverse exactly that action rather
 * than reconstructing the previous state by hand.
 *
 * HONESTY, three rules:
 *  - only the ENGINE decides what is reversible. An entry is offered an Undo
 *    when its own `status` says `applied`; every other status (already undone,
 *    failed, expired) is stated and left alone. The client never infers
 *    reversibility from the action name.
 *  - an engine build that does not serve the route reads as `unsupported`, not
 *    as an empty journal. "Nothing was done" and "this build cannot tell you
 *    what was done" are different answers and must not collapse into one.
 *  - every field is rendered as the engine reported it. Nothing here invents a
 *    label, a target, or a previous state; an absent field stays absent.
 *
 * Wire shapes are read tolerantly because the journal serves mixed-age
 * engines: `target` and `inverse` may arrive as a plain string or as a small
 * object, and the applied stamp has carried more than one name.
 */
import { getJsonDetailed, postJson } from './client';

/** One journaled action, flattened to the strings the section renders. */
export interface OpsEntry {
  /** The engine's own id — what the undo route addresses. */
  id: string;
  /** Who did it, as the engine recorded it. */
  actor: string | null;
  /** What was done. */
  action: string | null;
  /** What it was done to. */
  target: string | null;
  /** What the target looked like beforehand. */
  preState: string | null;
  /** The action that reverses this one, as the engine names it. */
  inverse: string | null;
  /** The engine's status word. `applied` is the only undoable one. */
  status: string;
  /** When it was applied. */
  at: string | null;
  /** When it was undone, for an entry that has been. */
  undoneAt: string | null;
}

/** How a journal read ended. `unsupported` is an older engine, not an empty log. */
export type JournalLoad =
  | { phase: 'loading' }
  | { phase: 'unsupported' }
  | { phase: 'unreachable' }
  | { phase: 'ready'; entries: OpsEntry[] };

/** The engine status that means "this is still in effect, and reversible". */
export const APPLIED = 'applied';

const JOURNAL_PATH = '/ui/api/ops/journal';

/** Fields an object-shaped `target` / `inverse` may name itself with, in the
 *  order a reader would prefer to see. */
const LABEL_KEYS = ['label', 'name', 'display_label', 'summary', 'plain', 'description'] as const;

function str(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * A one-line reading of a field that may arrive as a string or a small object.
 * An object is named by whichever label field it carries, else by its
 * `kind`/`id` pair, else by its action — and null when it names nothing, so a
 * row omits the line rather than printing `[object Object]`.
 */
export function label(value: unknown): string | null {
  const direct = str(value);
  if (direct !== null) return direct;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  for (const key of LABEL_KEYS) {
    const named = str(row[key]);
    if (named !== null) return named;
  }
  const kind = str(row.kind) ?? str(row.type);
  const id = str(row.id);
  if (kind !== null && id !== null) return `${kind} ${id}`;
  return kind ?? id ?? str(row.action);
}

/**
 * A previous state as a reader can check it: a flat object becomes
 * `mode=paper · aum=100000`, a string stays itself, and anything with no
 * readable scalar becomes null so the row simply does not claim one.
 */
export function describeState(value: unknown): string | null {
  const direct = str(value);
  if (direct !== null) return direct;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const scalar =
      typeof raw === 'boolean' ? String(raw) : raw === null ? null : str(raw);
    if (scalar !== null) parts.push(`${key}=${scalar}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** One wire row, flattened. Null when the row carries no id — an entry the
 *  undo route could not address is not one this section can offer. */
export function normalizeEntry(raw: unknown): OpsEntry | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = str(row.id) ?? str(row.entry_id);
  if (id === null) return null;
  return {
    id,
    actor: label(row.actor),
    action: label(row.action),
    target: label(row.target),
    preState: describeState(row.pre_state ?? row.preState),
    inverse: label(row.inverse),
    // A row that does not state a status is not claimed to be reversible.
    status: str(row.status) ?? 'unknown',
    at: str(row.created_at) ?? str(row.applied_at) ?? str(row.at) ?? str(row.ts),
    undoneAt: str(row.undone_at) ?? str(row.undoneAt),
  };
}

/** The journal's rows from a response body, newest first as the engine ordered
 *  them. A body that answered without the key listed nothing. */
export function journalEntries(body: unknown): OpsEntry[] {
  if (body === null || typeof body !== 'object') return [];
  const rows = (body as Record<string, unknown>).entries ?? (body as Record<string, unknown>).journal;
  if (!Array.isArray(rows)) return [];
  return rows
    .map(normalizeEntry)
    .filter((entry): entry is OpsEntry => entry !== null);
}

/** Whether the engine says this entry is still in effect, and reversible. */
export function isUndoable(entry: OpsEntry): boolean {
  return entry.status === APPLIED;
}

/** The undo route for one entry. */
export function undoPath(id: string): string {
  return `${JOURNAL_PATH}/${encodeURIComponent(id)}/undo`;
}

/**
 * Read the journal, keeping the difference between an engine that cannot serve
 * it (404/405) and one that did not answer at all.
 */
export async function readJournal(limit = 20): Promise<JournalLoad> {
  const result = await getJsonDetailed<unknown>(`${JOURNAL_PATH}?limit=${limit}`);
  if (result.ok) return { phase: 'ready', entries: journalEntries(result.body) };
  return result.status === 404 || result.status === 405
    ? { phase: 'unsupported' }
    : { phase: 'unreachable' };
}

/**
 * Undo one entry. The engine's own message is carried back on failure so the
 * surface states the reason it was given rather than a bare status code.
 */
export async function undoEntry(id: string): Promise<{ ok: boolean; message: string | null }> {
  const response = await postJson(undoPath(id));
  if (response.ok) return { ok: true, message: null };
  const body = (response.body ?? {}) as Record<string, unknown>;
  const reason = str(body.detail) ?? str(body.error) ?? str(body.message);
  return {
    ok: false,
    message: reason ?? `Undo was rejected (${response.status || 'engine unreachable'}).`,
  };
}
