/**
 * The Board's own engine lane: the provider a person describes on a card, and
 * the key it needs — declared here as a CONTRACT before the engine serves it.
 *
 * The Board lets somebody describe a source entirely on the canvas. Two things
 * have to leave the canvas for that to be worth anything: the DESCRIPTION, so
 * the engine can go and read the thing, and the SECRET, so it is allowed to.
 * Neither route exists on the engine yet — they land in a parallel change — so
 * this module is written as the request shapes that change has to serve, and
 * the harness serves them as mocks in the meantime. Every function here is
 * honest about a route that is not there: an unreachable or 404 engine is
 * reported as a refusal with its status, never as a quiet success.
 *
 * ## The write-only rule, enforced on this side too
 * A secret goes out and nothing comes back but SET or UNSET. The engine is
 * expected to honour that, and this module does not trust it to: every reply is
 * reduced field by field to {@link CredentialSlot} — a name, a boolean and a
 * timestamp — so an engine that echoed the value back could not put it on a
 * screen, into a re-render, or into an agent context envelope. The graph is
 * protected by its schema (it has no field for a value at all); this is the
 * same guarantee for the transport.
 *
 * ## Why the board node id is the source id
 * The card on the canvas and the record on the engine are the same thing seen
 * from two sides, so they share an identifier rather than keeping a mapping
 * table that could drift. Saving is an UPSERT on that id: editing a card and
 * pressing connect again re-describes one source instead of growing a second.
 *
 * Conventions follow {@link ./client}: everything goes through the
 * main-process bridge (which owns the cookie + CSRF contract), a read returns
 * null when nothing answered, and a write returns the engine's own status and
 * message so a surface can say what actually happened.
 */
import { getJsonDetailed, postJson } from './client';
import { readRejection } from './confirm';

/** Where the Board's sources live on the engine. */
export const BOARD_SOURCES_PATH = '/ui/api/board/sources';

/** Where their keys live. Values go in; only state comes out. */
export const BOARD_CREDENTIALS_PATH = '/ui/api/board/credentials';

/**
 * The connector kinds a Board source may declare — how the data ARRIVES, not
 * which vendor sends it. Deliberately small and closed: the card is a
 * description a person writes in a hurry, and four answers cover every shape
 * the ingest side knows how to open.
 */
export const CONNECTOR_KINDS = ['feed', 'http_api', 'file_drop', 'database'] as const;

export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

/** How each kind is written on screen. */
export const CONNECTOR_KIND_LABEL: Record<ConnectorKind, string> = {
  feed: 'Feed',
  http_api: 'HTTP API',
  file_drop: 'File drop',
  database: 'Database',
};

export function isConnectorKind(value: string): value is ConnectorKind {
  return (CONNECTOR_KINDS as readonly string[]).includes(value);
}

/** What the engine stores for one described source. Snake case: it is a wire shape. */
export interface BoardSourceRecord {
  /** The board node's id — see the header. */
  id: string;
  name: string;
  connector_kind: string;
  endpoint: string;
  payload_type: string;
  /** The vault SLOT this source reads its key from. Never a value. */
  credential_slot?: string | null;
  /** The engine's own word for how the ingest is doing (`idle`, `ingesting`,
   *  `error`, ...). Absent on a record the engine has not tried yet. */
  state?: string | null;
  /** The engine's sentence about that state, when it gave one. */
  detail?: string | null;
  /** When data last arrived, ISO. Null until it has. */
  last_ingest_at?: string | null;
}

/** What a card sends when it is connected. */
export interface BoardSourceInput {
  id: string;
  name: string;
  connectorKind: string;
  endpoint: string;
  payloadType: string;
  /** Slot NAME only. Omitted when the source needs no key. */
  credentialSlot?: string;
}

/** A vault slot as this module is willing to describe it: state, never value. */
export interface CredentialSlot {
  name: string;
  /** True when a secret is stored under this name. */
  set: boolean;
  /** When it was last written, ISO, when the engine says. */
  updatedAt: string | null;
}

/** A write that either landed or did not, in the engine's own words. */
export interface BoardWriteResult {
  ok: boolean;
  status: number;
  /** The engine's message, when it gave one. Null when nothing answered. */
  message: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * A slot, reduced to the three fields a slot may have. This is the write-only
 * rule's client-side half: whatever else the reply carried — a `value`, a
 * `secret`, a masked `preview` of one — does not survive this function, so no
 * caller can render it and no context envelope can pick it up.
 */
export function readCredentialSlot(value: unknown, fallbackName = ''): CredentialSlot | null {
  const row = record(value);
  if (!row) return null;
  const inner = record(row.slot) ?? row;
  const name = str(inner.name) || fallbackName;
  if (!name) return null;
  const updated = str(inner.updated_at);
  return {
    name,
    // `set` is only ever true when the engine says so: a reply that omits it is
    // read as unset rather than as "probably fine".
    set: inner.set === true,
    updatedAt: updated === '' ? null : updated,
  };
}

function refusal(status: number, body: unknown): BoardWriteResult {
  const { message } = readRejection(body);
  return { ok: false, status, message };
}

/** Every source the engine holds for this install, or null when nothing answered. */
export async function listBoardSources(): Promise<BoardSourceRecord[] | null> {
  const res = await getJsonDetailed<{ sources?: BoardSourceRecord[] }>(BOARD_SOURCES_PATH);
  if (!res.ok) return null;
  return Array.isArray(res.body.sources) ? res.body.sources : [];
}

/**
 * Describe a source to the engine — an upsert on the card's id, so pressing
 * connect twice re-describes one source rather than making two.
 *
 * The credential SLOT travels; the secret does not. It was posted separately by
 * {@link putCredentialSecret} and the engine reads it from its own vault.
 */
export async function saveBoardSource(
  input: BoardSourceInput
): Promise<BoardWriteResult & { source: BoardSourceRecord | null }> {
  const res = await postJson(BOARD_SOURCES_PATH, {
    id: input.id,
    name: input.name,
    connector_kind: input.connectorKind,
    endpoint: input.endpoint,
    payload_type: input.payloadType,
    credential_slot: input.credentialSlot ?? null,
  });
  if (!res.ok) return { ...refusal(res.status, res.body), source: null };
  const body = record(res.body);
  const source = record(body?.source) as BoardSourceRecord | null;
  return { ok: true, status: res.status, message: null, source };
}

/**
 * Forget a source. The engine drops its ingest; the card's own removal is the
 * store's business, and neither one destroys anything the source produced.
 */
export async function deleteBoardSource(id: string): Promise<BoardWriteResult> {
  const res = await postJson(`${BOARD_SOURCES_PATH}/${encodeURIComponent(id)}/delete`);
  return res.ok ? { ok: true, status: res.status, message: null } : refusal(res.status, res.body);
}

/**
 * Whether a slot holds a secret. Never what it holds. A 404 is an ANSWER —
 * that slot is empty — while nothing answering at all is null, because "no
 * secret stored" and "the engine is not there" must not read the same on a card
 * that is about to be told it is safe to connect.
 */
export async function credentialSlotState(slot: string): Promise<CredentialSlot | null> {
  if (slot === '') return null;
  const res = await getJsonDetailed<unknown>(
    `${BOARD_CREDENTIALS_PATH}/${encodeURIComponent(slot)}`
  );
  if (!res.ok) {
    return res.status === 404 ? { name: slot, set: false, updatedAt: null } : null;
  }
  return readCredentialSlot(res.body, slot);
}

/**
 * Write a secret into a vault slot. This is the only place in the pack a
 * credential VALUE is ever sent, and nothing about it is kept: the caller is
 * expected to clear its input on the way out, the graph has no field for it,
 * and the reply is reduced to state before it is returned.
 */
export async function putCredentialSecret(
  slot: string,
  secret: string
): Promise<BoardWriteResult & { slot: CredentialSlot | null }> {
  if (slot === '') {
    return { ok: false, status: 0, message: 'Name the slot before storing a secret.', slot: null };
  }
  const res = await postJson(`${BOARD_CREDENTIALS_PATH}/${encodeURIComponent(slot)}`, { secret });
  if (!res.ok) return { ...refusal(res.status, res.body), slot: null };
  // Reduced even on success — see readCredentialSlot.
  const state = readCredentialSlot(res.body, slot) ?? { name: slot, set: true, updatedAt: null };
  return { ok: true, status: res.status, message: null, slot: state };
}

/** Empty a slot. The card keeps the name; the vault stops holding anything. */
export async function clearCredentialSecret(slot: string): Promise<BoardWriteResult> {
  if (slot === '') return { ok: false, status: 0, message: 'There is no slot to clear.' };
  const res = await postJson(`${BOARD_CREDENTIALS_PATH}/${encodeURIComponent(slot)}/clear`);
  return res.ok ? { ok: true, status: res.status, message: null } : refusal(res.status, res.body);
}
