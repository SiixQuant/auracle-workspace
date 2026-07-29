/**
 * The two verbs a question card carries — scan, and synthesize — and the
 * standing loop that may press one of them on its own.
 *
 * SCAN and SYNTHESIZE are the same dispatch. The difference is only what there
 * is to look at: a first pass over whatever the engine has gathered, or a pass
 * over the material that has piled up since the last one. The card says which
 * by counting, so a person never has to remember where they left off.
 *
 * ## One lane, one authority, no new ceremony
 * Both go through the Grid's established dispatch lane — an {@link ActionIntent}
 * run by {@link requestAiAction} — and both are DRAFT class, which is the same
 * promise the findings verb makes: a prefilled agent session opens, and the
 * person sends it. Nothing runs, nothing deploys, and no approval dialog stands
 * in the way of reading your own evidence. The lane's one-run-at-a-time rule
 * comes along for free, which is what stops a board of eight questions from
 * opening eight sessions at once.
 *
 * ## What the payload may contain, and what it may not
 * A dispatch names the CARD, quotes the QUESTION, and lists the NAMES of the
 * sources wired into it. It carries no credential value, no slot name, and not
 * even whether a slot is set — a payload that is going to be handed to an agent
 * session has no business mentioning a key at all, and the omission is pinned
 * by a snapshot test rather than left to care.
 *
 * ## Deliberate spend
 * The counters accumulate for nothing: watching a question costs no dispatch,
 * and the badge is a READ. A dispatch is the only thing that spends, so it
 * happens on a press — or, for a card whose owner armed it, through
 * {@link autoSynthesisPlan}, which returns an empty list for every card whose
 * toggle is off and for every budget that has not affirmatively said there is
 * room. With auto off, the loop below sends nothing, ever.
 *
 * WHO ASKED travels with the dispatch, because the engine spends the two
 * differently: the loop is refused outright once the month is gone, while a
 * person's press runs and is recorded as over budget. Both go through the one
 * executor, so the answer rides in the intent alongside the rest of the payload
 * and {@link settleBoardDispatch} — the same three steps the agent's own scan
 * tool settles with — hands it to the engine's ledger.
 */
import { useEffect } from 'react';
import type { BoardGraph, BoardNode } from '../../engine/boardGraph';
import { boardGraph } from '../../engine/boardGraphStore';
import {
  recordSynthesis,
  resetMaterialCounter,
  type MaterialCounter,
  type SynthesisBudget,
  type SynthesisKind,
  type SynthesisTrigger,
} from '../../engine/boardResearch';
import type { BoardWriteResult } from '../../engine/boardSources';
import { startStandingQueries } from '../../engine/boardStandingQueries';
import { engineFeeds, gridVitals } from '../../engine/gridVitals';
import {
  registerAiExecutor,
  requestAiAction,
  type ActionIntent,
  type AiAction,
  type AiActionResult,
} from './gridAiActions';
import { agentSessionHost } from './gridAiExecutors';

/** The operation the executor below registers against. */
export const BOARD_SCAN_OPERATION = 'board.scan-card';

/** The field labels the intent carries. The executor reads the payload back
 *  out of them, so they are a contract rather than decoration. */
const FIELD = {
  card: 'Card',
  question: 'Question',
  source: 'Source',
  material: 'New material',
  /** Who asked — a press, or the standing loop. The engine treats the two
   *  differently, so the executor has to be able to say which this was. */
  trigger: 'Trigger',
} as const;

/* ── the card's scope (pure) ─────────────────────────────────────────── */

/** Everything a dispatch is allowed to know about one question card. */
export interface ScanScope {
  nodeId: string;
  hypothesis: string;
  /** Display names of the wired sources, in board order. Never their keys. */
  sources: string[];
}

/**
 * What a card would send.
 *
 * The sources are the cards WIRED INTO this question, read off the graph rather
 * than off the engine, because the wire on the canvas is the thing the person
 * drew and is therefore the thing they expect to be searched. A source with no
 * name contributes nothing rather than an empty string: an unnamed source is
 * not a source anybody can be told about.
 */
export function scanScope(graph: BoardGraph, nodeId: string): ScanScope | null {
  const node = graph.nodes.find((row) => row.id === nodeId);
  if (!node || node.kind !== 'research') return null;
  const wiredIn = new Set(
    graph.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from)
  );
  const sources: string[] = [];
  for (const row of graph.nodes) {
    if (!wiredIn.has(row.id) || row.kind !== 'source') continue;
    const name = (row.source?.name ?? '').trim();
    if (name !== '') sources.push(name);
  }
  return { nodeId, hypothesis: (node.research?.hypothesis ?? '').trim(), sources };
}

/* ── the intent (pure) ───────────────────────────────────────────────── */

/** How each kind reads on the button and in the session's title. */
export const SCAN_WORD: Record<SynthesisKind, string> = {
  scan: 'Scan',
  synthesize: 'Synthesize',
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The payload, field by field. Everything a surface or an executor needs is
 * here, and nothing else is: the card, who asked, the question, the wired
 * source names, and how much has arrived.
 */
export function boardScanIntent(
  scope: ScanScope,
  kind: SynthesisKind,
  newMaterial: number,
  trigger: SynthesisTrigger
): ActionIntent {
  const fields = [
    { label: FIELD.card, value: scope.nodeId },
    { label: FIELD.trigger, value: trigger },
    { label: FIELD.question, value: scope.hypothesis },
    ...scope.sources.map((name) => ({ label: FIELD.source, value: name })),
    ...(newMaterial > 0
      ? [{ label: FIELD.material, value: plural(newMaterial, 'item') }]
      : []),
    { label: 'Produces', value: 'one agent session, prefilled and unsent' },
  ];
  return {
    operation: BOARD_SCAN_OPERATION,
    room: 'findings',
    summary:
      kind === 'synthesize'
        ? 'Read the material gathered for this question since the last look, and say what it supports. A draft only: nothing runs, nothing deploys.'
        : 'Read the material gathered for this question and say what it supports. A draft only: nothing runs, nothing deploys.',
    fields,
  };
}

/** The action the lane runs — draft class, so it never raises the approval
 *  dialog, exactly like the findings verb it sits beside. */
export function boardScanAction(
  scope: ScanScope,
  kind: SynthesisKind,
  newMaterial: number,
  trigger: SynthesisTrigger
): AiAction {
  return {
    id: `board-scan-${scope.nodeId}`,
    class: 'draft',
    room: 'findings',
    label: SCAN_WORD[kind],
    icon: 'travel_explore',
    keywords: ['scan', 'synthesize', 'evidence', 'question', 'board'],
    intent: boardScanIntent(scope, kind, newMaterial, trigger),
  };
}

/** A field's value by label — the intent's own words, not a second reading. */
function fieldValue(intent: ActionIntent, label: string): string {
  return intent.fields.find((field) => field.label === label)?.value ?? '';
}

/** The scope an executor is acting on, read back out of the payload it was
 *  handed rather than out of a store that may have moved since. */
export function scopeOfIntent(intent: ActionIntent): ScanScope {
  return {
    nodeId: fieldValue(intent, FIELD.card),
    hypothesis: fieldValue(intent, FIELD.question),
    sources: intent.fields
      .filter((field) => field.label === FIELD.source)
      .map((field) => field.value),
  };
}

/** Whether this dispatch is a first look or a look over accumulated material. */
export function kindOfIntent(intent: ActionIntent): SynthesisKind {
  return fieldValue(intent, FIELD.material) === '' ? 'scan' : 'synthesize';
}

/**
 * Who asked. Anything that is not the standing loop saying so is read as a
 * PERSON: the engine refuses an automatic dispatch over the cap, and an intent
 * that lost its field would then have a press refused on the loop's behalf. The
 * loop is already stopped client-side by {@link autoSynthesisPlan}, so the
 * asymmetry costs nothing and keeps the cap off the one path it may not block.
 */
export function triggerOfIntent(intent: ActionIntent): SynthesisTrigger {
  return fieldValue(intent, FIELD.trigger) === 'auto' ? 'auto' : 'manual';
}

/**
 * The session prompt. Retrieval-grounded and SCOPED: the agent is pointed at
 * the material the engine gathered for this one question, told which sources
 * the person wired in, and told plainly not to go anywhere else. The card id
 * travels so whatever it writes can be tagged back to the question that asked.
 */
export function scanPrompt(intent: ActionIntent): string {
  const scope = scopeOfIntent(intent);
  const kind = kindOfIntent(intent);
  const material = fieldValue(intent, FIELD.material);
  const lines = [
    kind === 'synthesize'
      ? 'Synthesize the evidence gathered for one Board question, in the Auracle workspace.'
      : 'Scan for evidence on one Board question, in the Auracle workspace.',
    '',
    `The question: ${scope.hypothesis || '(nothing written on the card yet)'}`,
    scope.sources.length > 0
      ? `Wired sources: ${scope.sources.join(', ')}.`
      : 'No sources are wired into this question yet.',
    material === '' ? null : `Waiting since the last look: ${material}.`,
    `Board card: ${scope.nodeId}`,
    '',
    'Work from the material the Auracle engine has gathered for THIS question — ' +
      'use its research retrieval rather than a general web search, and stay inside ' +
      'the sources named above. Say what the material supports, what it contradicts, ' +
      'and what it does not touch, and record each finding against this card id. ' +
      'Write no strategy, run nothing, and deploy nothing.',
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

/* ── settling a dispatch ─────────────────────────────────────────────── */

/**
 * What follows a dispatch that actually opened: the engine is told, the
 * material that dispatch consumed stops counting as unseen, and the lane the
 * badge is drawn from re-reads.
 *
 * One function because there are two doors into the same event — the card's
 * verb and the agent's `board_scan_card` tool — and two orderings of these
 * three steps would be two different accounts of one dispatch. It is called
 * only AFTER a session has opened: a hand-off that failed records nothing,
 * consumes nothing and spends nothing.
 *
 * The engine's reply comes back rather than being swallowed, refusal included:
 * a spent month turns an automatic dispatch away with the figures that turned
 * it away, and the re-read below then carries the same verdict onto the card.
 */
export async function settleBoardDispatch(
  nodeId: string,
  kind: SynthesisKind,
  trigger: SynthesisTrigger
): Promise<BoardWriteResult & { budget: SynthesisBudget | null }> {
  const recorded = await recordSynthesis({ nodeId, kind, trigger });
  await resetMaterialCounter(nodeId);
  // Re-read on the lane that is already running rather than opening one of our
  // own: the badge clears when the engine says the counter is back to nothing.
  void gridVitals.refresh();
  return recorded;
}

/* ── the executor ────────────────────────────────────────────────────── */

registerAiExecutor(BOARD_SCAN_OPERATION, async (intent) => {
  const host = agentSessionHost();
  // Feature-detected, like every other hand-off: an older host has no agent
  // lane at all, which is a different fact from a dispatch that failed.
  if (!host?.launchAgentSession) {
    return {
      kind: 'not-wired',
      operation: intent.operation,
      note: 'This build cannot hand off to the agent — update the IDE. Nothing was sent and nothing was spent.',
    };
  }
  const scope = scopeOfIntent(intent);
  if (scope.hypothesis === '') {
    return { kind: 'failed', note: 'Write the question first — there is nothing to look for yet.' };
  }
  const kind = kindOfIntent(intent);

  const launched = await host.launchAgentSession(scanPrompt(intent), {
    title: `${SCAN_WORD[kind]} for evidence`,
  });
  if (!launched.ok) {
    // Nothing opened, so nothing is recorded and nothing is spent.
    return { kind: 'failed', note: launched.error ?? 'The agent hand-off failed.' };
  }

  // The dispatch happened, so it is settled: the engine is told, the material
  // it consumed stops counting as unseen, and the badge re-reads.
  const recorded = await settleBoardDispatch(scope.nodeId, kind, triggerOfIntent(intent));

  const opened =
    'Agent session started with the evidence prompt. Review it and send it — nothing has been written yet.';
  return recorded.ok
    ? { kind: 'done', note: opened }
    : {
        kind: 'done',
        note: `${opened} The engine did not record the dispatch${
          recorded.message ? ` — ${recorded.message}` : ''
        }.`,
      };
});

/* ── what a card shows (pure) ────────────────────────────────────────── */

/** The counter for one card, or null when the engine has not counted. */
export function counterFor(
  counters: readonly MaterialCounter[] | null,
  nodeId: string
): MaterialCounter | null {
  if (counters === null) return null;
  return counters.find((row) => row.nodeId === nodeId) ?? null;
}

/** How a question card's verb reads right now. */
export interface CardVerb {
  kind: SynthesisKind;
  /** The word on the button. */
  label: string;
  /**
   * How much has arrived since the last look, or null when the engine has not
   * answered. Null draws NO badge — a zero would claim a count nobody took.
   */
  newMaterial: number | null;
  /** The engine says this month's dispatches are spent. */
  paused: boolean;
  /** This card has armed the standing loop. */
  auto: boolean;
  /** Whether there is a question to look for at all. */
  ready: boolean;
}

export function cardVerb(
  node: BoardNode,
  counters: readonly MaterialCounter[] | null,
  budget: SynthesisBudget | null
): CardVerb {
  const counted = counterFor(counters, node.id);
  const newMaterial = counted?.newMaterial ?? null;
  const kind: SynthesisKind = (newMaterial ?? 0) > 0 ? 'synthesize' : 'scan';
  return {
    kind,
    label: SCAN_WORD[kind],
    newMaterial,
    paused: budget?.paused === true,
    auto: node.research?.autoSynthesize === true,
    ready: (node.research?.hypothesis ?? '').trim() !== '',
  };
}

/* ── the standing loop ───────────────────────────────────────────────── */

/** One card the loop would act on, and the counter reading it would act on. */
export interface AutoSynthesisStep {
  nodeId: string;
  newMaterial: number;
  asOf: string | null;
}

/**
 * Every card the standing loop may dispatch for, right now.
 *
 * Four conditions, and all of them have to be affirmative:
 *  - the card's own toggle is ON. A card that never asked is never acted on,
 *    which is the whole of the deliberate-spend promise;
 *  - it has a question written on it;
 *  - the engine has COUNTED material for it, and counted more than none;
 *  - the budget has answered AND is not paused. A budget nobody has read is
 *    not permission — spending against silence is exactly the failure the
 *    monthly cap exists to prevent.
 */
export function autoSynthesisPlan(
  graph: BoardGraph,
  counters: readonly MaterialCounter[] | null,
  budget: SynthesisBudget | null
): AutoSynthesisStep[] {
  if (counters === null || budget === null || budget.paused) return [];
  const steps: AutoSynthesisStep[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== 'research') continue;
    if (node.research?.autoSynthesize !== true) continue;
    if ((node.research?.hypothesis ?? '').trim() === '') continue;
    const counted = counterFor(counters, node.id);
    if (!counted || counted.newMaterial <= 0) continue;
    steps.push({ nodeId: node.id, newMaterial: counted.newMaterial, asOf: counted.asOf });
  }
  return steps;
}

/** What a step is, as one string: the same reading twice must not dispatch
 *  twice while the reset is still in flight. */
function signature(step: AutoSynthesisStep): string {
  return `${step.nodeId}|${step.asOf ?? ''}|${step.newMaterial}`;
}

const dispatched = new Set<string>();

/** One pass of the standing loop over whatever the pack currently holds. */
export async function runAutoSynthesis(): Promise<void> {
  const graph = boardGraph.getSnapshot();
  const feeds = engineFeeds.getSnapshot();
  for (const step of autoSynthesisPlan(graph, feeds.material, feeds.budget)) {
    const mark = signature(step);
    if (dispatched.has(mark)) continue;
    const scope = scanScope(graph, step.nodeId);
    if (!scope) continue;
    dispatched.add(mark);
    // The loop asking, not a person — which is what the engine refuses once the
    // month is spent, and the whole of the deliberate-spend promise.
    const result = await requestAiAction(
      boardScanAction(scope, 'synthesize', step.newMaterial, 'auto')
    );
    // The lane was busy, so nothing was sent — and this reading is still
    // waiting, so it must stay eligible for the next pass.
    if (result === null) dispatched.delete(mark);
  }
}

/**
 * Arm the research loop for as long as the Board is on screen: the standing
 * questions follow the graph, and the auto-synthesize pass follows the counters
 * that arrive on the lane the Board is already subscribed to.
 *
 * No poll of its own, in either half. Closing the Board takes both down, which
 * is what makes "the Board polls while it is open" true of this feature too.
 */
export function useBoardResearchLoop(): void {
  useEffect(() => {
    const stopQueries = startStandingQueries();
    const stopFeeds = engineFeeds.subscribe(() => void runAutoSynthesis());
    const stopGraph = boardGraph.subscribe(() => void runAutoSynthesis());
    void runAutoSynthesis();
    return () => {
      stopQueries();
      stopFeeds();
      stopGraph();
    };
  }, []);
}

/** Forget which readings have already been dispatched for. Tests use it for
 *  isolation; nothing in the product calls it. */
export function resetAutoSynthesis(): void {
  dispatched.clear();
}

/* ── pressing the verb ───────────────────────────────────────────────── */

/**
 * Dispatch for one card by hand. Returns null when the lane was busy (another
 * action is already out) so the surface can say so rather than appear to have
 * done nothing.
 *
 * A PAUSED budget does not block this. The cap stops the loop from spending on
 * its own; a person asking for their own evidence is told the state and allowed
 * to decide, which is the difference between a guard and a wall. That is why
 * this path is MANUAL all the way down to the engine's record: the engine runs
 * a manual dispatch over the cap and marks it over budget rather than refusing
 * it, and it can only do that if it is told a person asked.
 */
export function dispatchBoardScan(
  graph: BoardGraph,
  nodeId: string,
  kind: SynthesisKind,
  newMaterial: number
): Promise<AiActionResult | null> {
  const scope = scanScope(graph, nodeId);
  if (!scope) return Promise.resolve(null);
  return requestAiAction(boardScanAction(scope, kind, newMaterial, 'manual'));
}
