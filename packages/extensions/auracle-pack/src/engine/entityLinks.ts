/**
 * entityLinks — the shared entity→view resolver (Frontier S3).
 *
 * One small, pure registry that maps any Auracle entity (a strategy, a specific
 * backtest run) to WHERE it is looked at and WHAT focus lands you there. It is
 * the single target list two features share, so they can never disagree about
 * where "the factor view for Target-25" is:
 *
 *   - #1 mnemonic command grammar — `<entity> <verb>` typed in the ⌘K palette
 *     (`target risk` → the Factors room, focused on that strategy).
 *   - #2 cross-linked entities — a value rendered in a panel becomes a click
 *     that opens the same room with the same focus.
 *
 * Render-free and side-effect-free on purpose: the mapping rules are the part
 * worth unit-testing, and both callers (a palette provider, a click handler)
 * drive the actual navigation through `gridNav.openRoomFocused`, never here.
 * Symbols are deliberately NOT modelled yet — the Grid has no canonical
 * per-symbol room to land on, so a symbol pivot would have nowhere honest to go.
 */
import type { RoomId } from '../components/grid/rooms';
import type { Focus } from './focusStore';

/** The entity kinds this registry resolves. A `strategy` is a file identity; a
 *  `run` is one backtest of it. (Symbol/factor are intentionally absent until a
 *  room exists to receive them — see the module note.) */
export type EntityKind = 'strategy' | 'run';

/** A resolvable entity: enough to name it in the palette and to focus a room on
 *  it. `strategyPath` is the dotted/relative path used as both file and dotted
 *  identity (the Grid treats them the same, as the run picker already does);
 *  `runId` is the backtest job id, present only when `kind === 'run'`. */
export interface EntityRef {
  kind: EntityKind;
  /** Stable id — the strategy path for a strategy, the job id for a run. */
  id: string;
  /** Human label for the palette row / link ("FundPair"). */
  label: string;
  /** The strategy this entity belongs to; drives the focused strategy. */
  strategyPath: string;
  /** The backtest job id (stringified), when `kind === 'run'`. */
  runId?: string;
}

/** A navigation verb the grammar understands: a canonical short code plus the
 *  synonyms a person might actually type, all mapping to one room. */
export interface EntityVerb {
  /** The canonical short code shown/typed ("risk"). */
  verb: string;
  /** Other words that resolve to the same room ("fac", "factor", "alpha"). */
  aliases: readonly string[];
  /** Where the verb takes you. */
  room: RoomId;
}

/**
 * The verb table — the `<verb> → room` half of the grammar (PRD #1 R2). Ordered
 * so the most-reached views come first when a bare entity offers all of them.
 * Every alias is a plain word, never a secret code (the palette's honesty rule).
 */
export const ENTITY_VERBS: readonly EntityVerb[] = [
  { verb: 'ts', aliases: ['tear', 'sheet', 'tearsheet', 'overview'], room: 'strategy' },
  { verb: 'bt', aliases: ['backtest', 'back', 'run'], room: 'backtest' },
  { verb: 'risk', aliases: ['fac', 'factor', 'factors', 'attribution', 'alpha'], room: 'factors' },
  { verb: 'val', aliases: ['gate', 'gates', 'overfit', 'validate', 'validation'], room: 'validation' },
  { verb: 'dep', aliases: ['deploy', 'deploys', 'live'], room: 'deploys' },
];

/** The room an entity opens by default when no verb is given — its tearsheet
 *  (the strategy room). Used by #2 links that pivot without a verb. */
export const PRIMARY_ROOM: RoomId = 'strategy';

/**
 * The focus a room should land on for this entity: always the strategy, plus
 * the backtest run when the entity is a specific run. Pure — the caller passes
 * this straight to `openRoomFocused` / `focusStore.publish`.
 */
export function entityFocus(entity: EntityRef): Focus {
  const focus: Focus = {
    strategy: { filePath: entity.strategyPath, dottedPath: entity.strategyPath },
  };
  if (entity.kind === 'run' && entity.runId) {
    focus.run = { kind: 'backtest', id: entity.runId };
  }
  return focus;
}

/**
 * Resolve a typed verb token to its room, matching the canonical code or any
 * alias, case-insensitively. Returns null for an unknown token — the grammar
 * then degrades to the palette's ordinary fuzzy search (PRD #1 R4).
 */
export function resolveVerb(token: string): EntityVerb | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  return (
    ENTITY_VERBS.find((v) => v.verb === t || v.aliases.includes(t)) ?? null
  );
}
