/**
 * gridEntityCommands — the entity half of the ⌘K grammar (Frontier #1, R1/R3).
 *
 * The rooms provider already answers a bare mnemonic (`bt` → Backtest). This
 * provider answers the two-word grammar the PRD asks for — `<entity> <verb>`,
 * e.g. `fundpair risk` → the Factors room focused on FundPair, `t25 bt` → its
 * backtest. It reuses the palette's own token-AND filter: it emits one command
 * per (known strategy × verb), and `filterCommands` keeps the ones whose words
 * contain every token typed. So the resolver stays tiny and the matching stays
 * the palette's single, tested code path.
 *
 * TWO-TOKEN GATE. A phrase is a grammar phrase only at two-plus tokens, so a
 * single token (`bt`, a room title, half a strategy name) is left entirely to
 * the rooms provider and the ordinary palette is unchanged — these rows surface
 * only once someone is clearly typing `<entity> <verb>`.
 *
 * The known-entity list is the engine's recent chartable backtests
 * ({@link tearsheetRuns}), deduped to one row per strategy (its latest run),
 * cached so the synchronous `list()` never blocks. {@link refreshEntityCommands}
 * repopulates it — the palette calls it on open, throttled — and a failed read
 * leaves the last good list in place (the room mnemonics still navigate).
 */
import { prettifyPath } from '../../engine/humanize';
import { tearsheetRuns } from '../../engine/client';
import { ENTITY_VERBS, entityFocus, type EntityRef } from '../../engine/entityLinks';
import { registerCommandProvider, type GridCommand, type GridCommandProvider } from './gridCommands';
import { openRoomFocused } from './gridNav';
import { ROOM_ICONS } from './districts';
import { ROOMS } from './rooms';

/** The heading these rows file under in the palette. */
export const ENTITY_SECTION = 'Jump to';

/** A DOM-id-safe token from a strategy path — no dots, so the command id is
 *  usable as a `#id` selector (the palette scrolls the active row that way). */
function slug(path: string): string {
  return path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The grammar's commands for a given typed query — PURE, so the matching rules
 * are unit-tested without a cache or a network. Empty until the query is a
 * two-token phrase; then one command per (entity × verb), which the palette's
 * `filterCommands` narrows to what was typed. The command's `run` opens the
 * verb's room focused on the entity (never a reload — `openRoomFocused`).
 */
export function buildEntityCommands(entities: EntityRef[], query: string | undefined): GridCommand[] {
  const tokens = (query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || entities.length === 0) return [];
  const commands: GridCommand[] = [];
  for (const entity of entities) {
    for (const verb of ENTITY_VERBS) {
      commands.push({
        id: `entity-${slug(entity.strategyPath)}-${verb.verb}`,
        label: `${ROOMS[verb.room].title} · ${entity.label}`,
        icon: ROOM_ICONS[verb.room],
        section: ENTITY_SECTION,
        keywords: [entity.label, entity.strategyPath, verb.verb, ...verb.aliases],
        run: () => openRoomFocused(verb.room, entityFocus(entity)),
      });
    }
  }
  return commands;
}

/* ── the known-entity cache (recent runs, one row per strategy) ─────────── */

let ENTITIES: EntityRef[] = [];
let lastLoadAt = 0;

async function reloadEntities(): Promise<void> {
  try {
    const runs = await tearsheetRuns();
    const byStrategy = new Map<string, EntityRef>();
    for (const run of runs) {
      // Runs arrive newest-first; the first seen for a strategy is its latest.
      if (byStrategy.has(run.strategyPath)) continue;
      byStrategy.set(run.strategyPath, {
        kind: 'run',
        id: String(run.jobId),
        label: prettifyPath(run.strategyPath) ?? run.strategyPath,
        strategyPath: run.strategyPath,
        runId: String(run.jobId),
      });
    }
    ENTITIES = [...byStrategy.values()];
  } catch {
    // Keep the last good cache — the room mnemonics still cover navigation.
  }
}

/**
 * Repopulate the entity cache, at most once per 30s. Fire-and-forget: the
 * palette calls this when it opens, so the grammar is as fresh as the last time
 * anyone looked, and a failed read leaves the previous list intact.
 */
export function refreshEntityCommands(): void {
  const now = Date.now();
  if (now - lastLoadAt < 30_000) return;
  lastLoadAt = now;
  void reloadEntities();
}

/** Test seam: seed the cache deterministically, no network. Stamps the load
 *  time to "now" so the palette's on-open refresh stays throttled and cannot
 *  clobber the seed mid-test. */
export function __setEntitiesForTest(entities: EntityRef[]): void {
  ENTITIES = entities;
  lastLoadAt = Date.now();
}

const entityProvider: GridCommandProvider = {
  id: 'entity-grammar',
  list: (context) => buildEntityCommands(ENTITIES, context.query),
};

registerCommandProvider(entityProvider);
