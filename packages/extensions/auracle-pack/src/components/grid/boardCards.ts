/**
 * What a card SAYS — its title, its one line, and how it is doing — as pure
 * functions over the graph and the connections feed.
 *
 * Kept out of the components for the reason the rest of the Grid keeps its
 * arithmetic out of them: the readings are the part that has to be right, and
 * they are cheaper to pin here than through a render. A card component's whole
 * job is to draw what these return.
 *
 * ## A source card's health is the CONNECTIONS feed, not a second opinion
 * The pack already polls the connector registry for the Plan's Connections
 * room. A source card reads that same table, so a provider cannot be up on one
 * face of the panel and down on the other. Nothing here fetches anything.
 *
 * ## Four states, and the fourth is honest ignorance
 * `unknown` is not a failure — it is a card whose described source has no live
 * counterpart in the registry (somebody typed a provider the engine has never
 * been told about), or a registry that has not answered yet. It is drawn as a
 * HOLLOW dot rather than a coloured one, because the Grid's rule is that only
 * trouble takes a hue, and "I do not know" is not trouble. That rule is also
 * why a healthy source is grey and not green: the visible change a person is
 * promised — the card goes healthy when its source ingests — is the dot
 * FILLING IN and the word beside it changing, not a colour arriving.
 */
import { isConnected, KEYLESS_IDS, type Connector } from '../../engine/model';
import type { Health } from '../../engine/gridVitals';
import type { BoardDeletePlan, BoardNode, BoardSourceConfig } from '../../engine/boardGraph';

/** The Plan's three readings, plus the one a Board needs that a room never does. */
export type CardHealth = Health | 'unknown';

/** One card's reading: how it is drawn, and the words for it. */
export interface CardReading {
  health: CardHealth;
  /** Said on the card's label and in its peek. Never a code. */
  word: string;
}

/** Ids and labels are compared loosely: a person types "Yahoo Finance" where
 *  the registry says `yfinance`, and neither is wrong. */
function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The registry row a described source is talking about, or null.
 *
 * Matched on the card's NAME or its ENDPOINT against the connector's id or its
 * display label — the two things a person actually types when they mean a
 * provider the engine already knows. Nothing is inferred from the payload type
 * or the connector kind: those describe the shape of the data, not which
 * provider it is, and matching on them would link two unrelated feeds.
 */
export function matchConnector(
  source: BoardSourceConfig,
  rows: readonly Connector[] | null
): Connector | null {
  if (!rows || rows.length === 0) return null;
  const wanted = [key(source.name), key(source.endpoint)].filter((value) => value !== '');
  if (wanted.length === 0) return null;
  for (const row of rows) {
    const candidates = [key(row.id), key(row.display_label ?? '')].filter((v) => v !== '');
    if (candidates.some((candidate) => wanted.includes(candidate))) return row;
  }
  return null;
}

/**
 * How a source card is doing, from the registry alone.
 *
 * A row that is connected — or keyless, which is connected without ever having
 * been configured — reads nominal. An error faults. Anything else the engine is
 * in the middle of (connecting, reconnecting, degraded) reads degraded in the
 * engine's own words. `not_configured` is deliberately NOT a fault: on a
 * keyless-by-default platform an unconfigured connector is a choice, so it
 * reads as unknown, which is what it is.
 */
export function sourceReading(
  source: BoardSourceConfig,
  rows: readonly Connector[] | null
): CardReading {
  if (rows === null) return { health: 'unknown', word: 'no reading yet' };
  const row = matchConnector(source, rows);
  if (!row) return { health: 'unknown', word: 'not linked to a connector' };
  if (isConnected(row.status)) return { health: 'nominal', word: 'connected' };
  if (KEYLESS_IDS.has(row.id)) return { health: 'nominal', word: 'ready' };
  const state = row.status?.state ?? '';
  const detail = row.status?.detail ?? '';
  if (state === 'error') return { health: 'fault', word: detail || 'error' };
  if (state === '' || state === 'not_configured') return { health: 'unknown', word: 'not configured' };
  return { health: 'degraded', word: detail || state };
}

/**
 * A research card has no feed to read, and says so. It is drawn with the same
 * hollow dot a sourceless source gets, which is the truthful mark for a card
 * whose state nothing has measured yet — and the state the scan verb will
 * eventually move.
 */
export const RESEARCH_READING: CardReading = { health: 'unknown', word: 'not scanned yet' };

/** A neutral reading for a card this build has no opinion about. */
export const NEUTRAL_READING: CardReading = { health: 'unknown', word: 'on the board' };

/** One line: newlines and runs of space collapsed, and cut with an ellipsis. */
export function oneLine(text: string, limit = 68): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

/** The card's heading. Never blank: an unnamed card still has to be findable. */
export function cardTitle(node: BoardNode): string {
  if (node.kind === 'source') return oneLine(node.source?.name ?? '', 34) || 'Unnamed source';
  if (node.kind === 'research') {
    const first = (node.research?.hypothesis ?? '').split('\n')[0] ?? '';
    return oneLine(first, 34) || 'A question, unwritten';
  }
  return oneLine(node.label ?? '', 34) || node.ref?.kind || node.kind;
}

/**
 * The one line under the title. Null when the card genuinely has nothing to
 * add — the sheet's honesty rule: a blank line is worse than no line.
 */
export function cardNote(node: BoardNode): string | null {
  if (node.kind === 'source') {
    const parts = [node.source?.payloadType ?? '', node.source?.endpoint ?? ''].filter(
      (part) => part.trim() !== ''
    );
    return parts.length === 0 ? 'nothing described yet' : oneLine(parts.join(' · '));
  }
  if (node.kind === 'research') {
    const text = node.research?.hypothesis ?? '';
    const rest = text.split('\n').slice(1).join(' ').trim();
    if (rest !== '') return oneLine(rest);
    // A one-line hypothesis is already the title; repeating it would say the
    // same thing twice on one card.
    return oneLine(text, 34).length < oneLine(text).length ? oneLine(text) : null;
  }
  return node.ref ? `${node.ref.kind} ${node.ref.id}` : null;
}

/** Whether a card carries a credential slot the vault is expected to hold. */
export function credentialSlotOf(node: BoardNode): string {
  return node.kind === 'source' ? (node.source?.credentialSlot ?? '') : '';
}

/* ── removing a card, in words ───────────────────────────────────────────── */

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What removing this card would actually do — built from the store's own plan,
 * so the confirm can neither overstate nor understate it.
 *
 * The second clause is the load-bearing one: removing a question removes the
 * question, never the findings and strategies that came out of it, and somebody
 * about to press a red button deserves that in numbers rather than in
 * reassurance.
 */
export function deleteSentence(plan: BoardDeletePlan, word: string): string {
  const wires =
    plan.removedEdgeIds.length === 0 ? '' : ` and ${plural(plan.removedEdgeIds.length, 'wire')}`;
  const head = `Removing this ${word.toLowerCase()} takes the card${wires} off the Board.`;
  if (plan.retainedNodeIds.length === 0) return `${head} Nothing else on the Board depends on it.`;
  const kept = plural(plan.retainedNodeIds.length, 'card');
  if (plan.retainedRefs.length === 0) return `${head} ${kept} downstream stay where they are.`;
  return `${head} ${kept} downstream stay where they are, still pointing at ${plural(
    plan.retainedRefs.length,
    'saved result'
  )}.`;
}

/** The receipt, after the fact — the same accounting, in the past tense. */
export function keptSentence(plan: BoardDeletePlan): string {
  if (plan.removedNodeIds.length === 0) return 'That card was already gone.';
  if (plan.retainedNodeIds.length === 0) return 'Card removed.';
  const kept = plural(plan.retainedNodeIds.length, 'card');
  if (plan.retainedRefs.length === 0) return `Card removed. ${kept} downstream stayed.`;
  return `Card removed. ${kept} downstream stayed, still pointing at ${plural(
    plan.retainedRefs.length,
    'saved result'
  )}.`;
}
