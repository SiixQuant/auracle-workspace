/**
 * Keeping the engine's list of watched questions equal to the Board's.
 *
 * A research card is a question somebody wrote. Registering it as a STANDING
 * QUERY is what makes the engine keep reading against it, and that registration
 * has to track the card without anybody pressing anything: written, edited,
 * emptied, removed. This module is the whole of that lifecycle, and it is
 * deliberately the only place that decides when to call
 * {@link ./boardResearch} — the client stays a set of requests.
 *
 * ## Why it is debounced, and idempotent, and both
 * Every keystroke in a card's editor is a store write (there is no Save
 * button), so a pass runs on a rest rather than on a change. That is the
 * debounce. Separately, a pass compares what it has already registered against
 * what the Board now holds and sends NOTHING when they agree — which is what
 * makes re-opening a Board, re-rendering it, or a poll landing beside it free.
 * The engine's route is an upsert on the node id as well, so the two halves of
 * the guarantee hold even if a request is somehow made twice.
 *
 * ## What is never sent
 *  - A BLANK question. A card that has been placed but not written is not a
 *    question yet; registering it would ask the engine to watch for material
 *    about nothing.
 *  - A DEREGISTRATION for a card this session never registered. Switching
 *    workspaces drops what is remembered here WITHOUT withdrawing anything: the
 *    other Board's questions still exist, this window simply stopped being able
 *    to see them, and "I can no longer see it" is not "delete it".
 *
 * ## Cost
 * Nothing here polls. It follows the graph store, which only moves when the
 * Board is open and somebody is editing, and it is started and stopped with the
 * Board exactly like {@link ./boardMaterialize}.
 */
import { boardGraphStore } from './boardGraphStore';
import type { BoardGraph } from './boardGraph';
import { deregisterStandingQuery, registerStandingQuery } from './boardResearch';

/** How long an edit rests before the question is re-stated to the engine. */
export const STANDING_QUERY_DELAY_MS = 700;

/** What this session has registered, by node id, with the text it registered. */
const registered = new Map<string, string>();

/** The workspace those registrations belong to. See the header's second rule. */
let openWorkspace: string | null = null;

let timer: ReturnType<typeof setTimeout> | undefined;
let chain: Promise<void> = Promise.resolve();
let delayMs = STANDING_QUERY_DELAY_MS;

/**
 * Whether anything is being watched right now.
 *
 * Read by the shared poll lane to decide whether the counters are worth asking
 * for: a workspace with no questions on its Board must cost no extra request,
 * which is the same conditional-read rule the deployment feed follows.
 */
export function hasStandingQueries(): boolean {
  return registered.size > 0;
}

/** The node ids currently registered — what a counter read is expected to be
 *  about. Sorted, so a test can compare it without ordering assumptions. */
export function standingQueryIds(): string[] {
  return [...registered.keys()].sort();
}

/**
 * The questions a graph is asking, by node id. Pure: a research card with
 * something written on it is a question, and nothing else is.
 */
export function questionsOf(graph: BoardGraph): Map<string, string> {
  const out = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'research') continue;
    const text = (node.research?.hypothesis ?? '').trim();
    if (text === '') continue;
    out.set(node.id, text);
  }
  return out;
}

/**
 * What one pass would send, given what is registered and what the Board holds.
 *
 * Pure, and separated from the sending for the reason the rest of the Board's
 * arithmetic is: this is the part that has to be right. A question whose text
 * is unchanged appears in neither list, which is the idempotence the header
 * promises stated as a value a test can hold.
 */
export function standingQueryPlan(
  known: ReadonlyMap<string, string>,
  wanted: ReadonlyMap<string, string>
): { register: Array<{ nodeId: string; hypothesis: string }>; deregister: string[] } {
  const register: Array<{ nodeId: string; hypothesis: string }> = [];
  for (const [nodeId, hypothesis] of wanted) {
    if (known.get(nodeId) === hypothesis) continue;
    register.push({ nodeId, hypothesis });
  }
  const deregister: string[] = [];
  for (const nodeId of known.keys()) {
    if (!wanted.has(nodeId)) deregister.push(nodeId);
  }
  return { register, deregister };
}

/**
 * One pass. A refused request leaves the local record UNCHANGED, so the next
 * pass tries again rather than believing a registration that never landed.
 */
async function runPass(): Promise<void> {
  const snapshot = boardGraphStore.getSnapshot();
  // A closed Board says nothing about what the engine should be watching, so
  // it withdraws nothing. The pass re-runs when a workspace opens.
  if (snapshot.status === 'closed') return;

  if (snapshot.workspaceId !== openWorkspace) {
    openWorkspace = snapshot.workspaceId;
    registered.clear();
  }

  const wanted = questionsOf(snapshot.graph);
  const plan = standingQueryPlan(registered, wanted);

  for (const entry of plan.register) {
    const result = await registerStandingQuery(entry);
    if (result.ok) registered.set(entry.nodeId, entry.hypothesis);
  }
  for (const nodeId of plan.deregister) {
    const result = await deregisterStandingQuery(nodeId);
    if (result.ok) registered.delete(nodeId);
  }
}

function enqueuePass(): Promise<void> {
  chain = chain.then(runPass, runPass);
  return chain;
}

function schedule(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void enqueuePass();
  }, delayMs);
}

/**
 * Follow the Board for as long as it is on screen, and return the teardown.
 *
 * The first pass is scheduled rather than immediate: a Board opening is
 * followed within milliseconds by the load landing, and registering against the
 * empty graph in between would withdraw every question and put it straight
 * back.
 */
export function startStandingQueries(options: { delayMs?: number } = {}): () => void {
  if (options.delayMs !== undefined) delayMs = options.delayMs;
  const stop = boardGraphStore.subscribe(schedule);
  schedule();
  return () => {
    stop();
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

/** Run the pending pass now and wait for it. Tests use it instead of waiting
 *  out the debounce; nothing in the product calls it. */
export async function flushStandingQueries(): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  await enqueuePass();
}

/** Forget everything this session registered, WITHOUT withdrawing any of it —
 *  the same rule a workspace switch follows. Tests use it for isolation. */
export function resetStandingQueries(): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  registered.clear();
  openWorkspace = null;
  chain = Promise.resolve();
  delayMs = STANDING_QUERY_DELAY_MS;
}
