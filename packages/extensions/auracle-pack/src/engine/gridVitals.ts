/**
 * The Grid sheet's vitals — one live reading per room.
 *
 * ## One call for the districts the engine consolidates
 * The engine serves `GET /ui/api/summary`: every district's vitals in one pass,
 * fanned in server-side from the same store queries each room's own endpoint
 * uses. So the sheet asks once instead of once per room, and for every room it
 * covers the home cannot disagree with what you find when you open it — the
 * two are reading the same query.
 *
 * Three rooms are NOT in that payload, because the engine has no district block
 * for them: the QuantConnect project list, the deployable-strategy list, and
 * the order blotter. Those keep their own reads, on the slow lane, and the
 * table below says so rather than pretending the one call covers everything.
 *
 * Connections is a fourth exception, and a subtler one: the consolidated
 * payload's connections block counts BROKERS only, while the shared connection
 * feed (engineFeeds.connections) carries brokers, data providers and
 * integrations alike — the Board's source cards and the data-source advisory
 * read from it — so this keeps the full registry read those surfaces need
 * rather than the broker-only count.
 *
 * The Board's research counters are a fifth, and the strictest: they are read
 * only while a question is actually registered with the engine, so an install
 * that has never posed one pays nothing at all for them.
 *
 * ## Counts come from the summary; rows do not
 * The consolidated payload is counts. Two surfaces need more than a count from
 * the deployments block — the AI strip says which deployment stopped rather
 * than how many, and the Board draws a card per deployment carrying its own
 * state — so one detail read follows when the summary reports anything
 * deployed, and ONLY then. Nothing deployed, nothing extra is fetched.
 *
 * ## Honesty
 * A source that did not answer reads QUIET — no note, no figure — never the
 * last value it managed to fetch. A number that survives its source going dark
 * is worse than no number, because the sheet's whole job is to say what is true
 * right now. The engine applies the same rule inside the one call: a district
 * whose read failed comes back null and names itself in `degraded`, and a null
 * block lands here as quiet exactly like an unanswered fetch.
 *
 * Validation is the one block that is null BY DESIGN — the engine measures the
 * overfit signals on demand and no run stores its tally — so that reading stays
 * client-derived from the session's own run, which is the only place the answer
 * exists at all.
 *
 * ## First paint
 * The snapshot is a plain module-level object, so a mount reads it
 * synchronously and paints immediately — from an empty (quiet) table on the
 * first visit, and from the last readings on every later one. Fetches never
 * gate the first frame; they replace it when they land.
 *
 * ## Cost
 * Polling is lazy and stops with the last subscriber, so the sheet costs
 * nothing while a room is open or the Grid is closed.
 */
import { getJson, onConnectGeneration } from './client';
import { backtestStore, type BacktestSnapshot } from './backtestStore';
import {
  readMaterialCounters,
  readSynthesisBudget,
  type MaterialCounter,
  type SynthesisBudget,
} from './boardResearch';
import { hasStandingQueries } from './boardStandingQueries';
import { DEPLOY_FAILED_STATE, type Deployment } from './live';
import { type Connector } from './model';
import type { BlotterOrder } from './monitors';
// Type-only: erased at build time, so the engine layer keeps no runtime
// dependency on the component that owns the room table.
import type { RoomId } from '../components/grid/rooms';

/** How a room reads at a glance. `nominal` is also the honest state of a room
 *  whose source has not answered — quiet, rather than a claim. */
export type Health = 'nominal' | 'degraded' | 'fault';

export interface RoomVital {
  health: Health;
  /** The room card's live note line. Null when nothing is known yet. */
  note: string | null;
  /** A short fragment the district's summary line is composed from. Null when
   *  the room has nothing worth saying at district altitude. */
  fact: string | null;
  /**
   * What this reading is ABOUT, when it is about named things — the errored
   * deployments behind a faulted `deploys`, say. Empty when the room's reading
   * names nothing.
   *
   * It lives on the vital rather than being re-fetched by whoever wants to
   * name the trouble, so a surface that says "one alert, and it is THIS one"
   * is quoting the same reading the sheet drew its red dot from. Nothing
   * derives the fault a second time: `health` is still the only state.
   */
  subjects: readonly string[];
}

export type GridVitals = Readonly<Record<RoomId, RoomVital>>;

/* ── the consolidated payload ───────────────────────────────────────── */

/** The research district's block. */
export interface ResearchBlock {
  findings?: number | null;
  top_score?: number | null;
}

/** The deployments district's block — counts only; no names. */
export interface DeploymentsBlock {
  total?: number | null;
  running?: number | null;
  errored?: number | null;
}

export interface SchedulesBlock {
  total?: number | null;
  active?: number | null;
}

export interface RunwayBlock {
  /** Stage name → the engine's own reached word (`yes` when it has been). */
  reached?: Record<string, string> | null;
}

/**
 * `GET /ui/api/summary`. Every block is optional and nullable because the
 * engine returns null for a district whose read failed — that is the honest
 * shape, and reading it as anything else would invent a number.
 */
export interface SummaryBody {
  /** The open-incident count — the incidents feed's own length. */
  open_alerts?: number | null;
  research?: ResearchBlock | null;
  deployments?: DeploymentsBlock | null;
  schedules?: SchedulesBlock | null;
  runway?: RunwayBlock | null;
  /** The districts whose read failed, by name. */
  degraded?: string[];
}

/** A schedule/QC/strategy row is only ever counted, so nothing is typed. */
interface QcBody {
  connected?: boolean;
  projects?: unknown[];
}

/** Everything the readings are derived from. Null means "no answer yet". */
export interface VitalSources {
  /** The one consolidated read. */
  summary: SummaryBody | null;
  /**
   * The errored deployments by name, read only when the summary reports some.
   * Null when nothing has been read; empty when nothing is errored.
   */
  errored: string[] | null;
  /**
   * The deployment rows themselves, read only when the summary reports that
   * something is deployed. Null when nothing has been read; empty when the
   * engine answered and listed nothing.
   */
  deployments: Deployment[] | null;
  /** Rooms the consolidated payload has no block for, or counts differently. */
  qc: QcBody | null;
  strategies: unknown[] | null;
  orders: BlotterOrder[] | null;
  connections: Connector[] | null;
  /**
   * The Board's new-material counters, read only while a question is actually
   * registered. Null when nothing has been read; empty when the engine answered
   * and counted nothing.
   */
  material: MaterialCounter[] | null;
  /** The synthesis allowance, read on the same condition. */
  budget: SynthesisBudget | null;
  /** Always present: an in-process store, not a fetch. */
  run: BacktestSnapshot;
}

/* ── derivation (pure) ──────────────────────────────────────────────── */

/** Shared empty list — a reading that names nothing allocates nothing. */
const NO_SUBJECTS: readonly string[] = [];

const QUIET: RoomVital = { health: 'nominal', note: null, fact: null, subjects: NO_SUBJECTS };

function vital(
  health: Health,
  note: string | null,
  fact: string | null = null,
  subjects: readonly string[] = NO_SUBJECTS
): RoomVital {
  return { health, note, fact, subjects };
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A block's figure as a number, or null when the engine did not state one.
 *  An absent field is never read as zero: "none" and "not reported" are
 *  different answers and the sheet must not merge them. */
function figure(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function findingsVital(block: ResearchBlock | null | undefined): RoomVital {
  if (!block) return QUIET;
  const findings = figure(block.findings);
  if (findings === null) return QUIET;
  if (findings === 0) return vital('nominal', 'no findings yet');
  const many = count(findings, 'finding');
  const top = figure(block.top_score);
  return vital('nominal', top === null ? many : `${many} · top ${Math.round(top)}`, many);
}

function qcVital(body: QcBody | null): RoomVital {
  if (body === null) return QUIET;
  // A QuantConnect account that was never connected is a choice, not a fault.
  if (body.connected === false) return vital('nominal', 'not connected');
  const n = Array.isArray(body.projects) ? body.projects.length : 0;
  return n === 0 ? vital('nominal', 'no projects') : vital('nominal', count(n, 'project'), count(n, 'project'));
}

function strategiesVital(rows: unknown[] | null): RoomVital {
  if (rows === null) return QUIET;
  if (rows.length === 0) return vital('nominal', 'no strategies yet');
  const line = count(rows.length, 'strategy', 'strategies');
  return vital('nominal', line, line);
}

function backtestVital(run: BacktestSnapshot): RoomVital {
  switch (run.phase) {
    case 'resolving':
    case 'queued':
    case 'running':
      return vital('nominal', 'a run is in progress', 'run in progress');
    case 'succeeded': {
      const sharpe = run.result?.stats?.sharpe;
      if (typeof sharpe === 'number' && Number.isFinite(sharpe)) {
        return vital('nominal', `last run Sharpe ${sharpe.toFixed(2)}`, `Sharpe ${sharpe.toFixed(2)}`);
      }
      return vital('nominal', 'last run finished', 'run finished');
    }
    case 'failed':
      return vital('degraded', 'the last run failed', 'run failed');
    case 'engine-down':
      return vital('degraded', 'the engine did not answer', 'engine unreachable');
    case 'unmatched':
    case 'ambiguous':
      return vital('nominal', 'no strategy resolved');
    default:
      return vital('nominal', 'no run in this session');
  }
}

function validationVital(validation: BacktestSnapshot['validation']): RoomVital {
  switch (validation.phase) {
    case 'running':
      return vital('nominal', 'checking the signals');
    case 'error':
      return vital('degraded', validation.detail ?? 'the engine could not measure this strategy', 'not measurable');
    case 'failed':
      return vital('degraded', 'the check did not complete', 'check failed');
    case 'done': {
      const signals = validation.verdict?.signals ?? [];
      if (signals.length === 0) return vital('nominal', 'no signals returned');
      const red = signals.filter((s) => s.tier === 'red').length;
      return red > 0
        ? vital('degraded', `${red} of ${signals.length} checks need attention`, `${red} red`)
        : vital('nominal', `${signals.length} checks healthy`, `${signals.length} green`);
    }
    default:
      return vital('nominal', 'not run in this session');
  }
}

/**
 * The deployments reading: counts from the consolidated payload, names from the
 * detail read that follows a reported fault.
 *
 * A fault whose names have not landed yet still faults — the dot is drawn from
 * the count the engine gave, and the naming catches up. It never waits on the
 * second read to tell the truth about the first.
 */
function deploysVital(
  block: DeploymentsBlock | null | undefined,
  errored: string[] | null
): RoomVital {
  if (!block) return QUIET;
  const total = figure(block.total);
  if (total === null) return QUIET;
  if (total === 0) return vital('nominal', 'nothing deployed');
  const running = figure(block.running) ?? 0;
  const failed = figure(block.errored) ?? 0;
  if (failed > 0) {
    return vital(
      'fault',
      `${running} running · ${failed} errored`,
      `${failed} errored`,
      errored ?? NO_SUBJECTS
    );
  }
  return vital('nominal', `${running} running of ${total}`, `${running} running`);
}

function blotterVital(rows: BlotterOrder[] | null): RoomVital {
  if (rows === null) return QUIET;
  if (rows.length === 0) return vital('nominal', 'no orders yet');
  const line = count(rows.length, 'order');
  return vital('nominal', line, line);
}

function incidentsVital(open: number | null): RoomVital {
  if (open === null) return QUIET;
  return open === 0 ? vital('nominal', 'none open') : vital('fault', `${open} open`, `${open} open`);
}

function schedulesVital(block: SchedulesBlock | null | undefined): RoomVital {
  if (!block) return QUIET;
  const total = figure(block.total);
  if (total === null) return QUIET;
  if (total === 0) return vital('nominal', 'nothing scheduled');
  const enabled = figure(block.active) ?? 0;
  return vital('nominal', `${enabled} enabled of ${total}`, `${enabled} enabled`);
}

function runwayVital(block: RunwayBlock | null | undefined): RoomVital {
  if (!block) return QUIET;
  const stages = block.reached;
  if (!stages) return QUIET;
  const names = Object.keys(stages);
  if (names.length === 0) return vital('nominal', 'no stages reported');
  const reached = names.filter((name) => stages[name] === 'yes').length;
  return vital('nominal', `${reached} of ${names.length} stages reached`, `${reached}/${names.length} stages`);
}

/** Every room's reading, from whatever the sources currently hold. */
export function deriveRooms(sources: VitalSources): GridVitals {
  const summary = sources.summary;
  return {
    findings: findingsVital(summary?.research),
    qc: qcVital(sources.qc),
    // The catalog is a browsable reference view of what data exists — it has no
    // standing health of its own, so it reads quiet on the plan.
    catalog: QUIET,
    strategies: strategiesVital(sources.strategies),
    // The tearsheet is a viewer of whatever run is focused — it has no
    // independent health source of its own, so it reads quiet (nominal, no fact)
    // on the plan rather than borrowing another room's state.
    strategy: QUIET,
    backtest: backtestVital(sources.run),
    validation: validationVital(sources.run.validation),
    // Like the tearsheet, the factor room is a viewer of the focused run's
    // attribution — no independent health source of its own, so it reads quiet.
    factors: QUIET,
    // The scenario room replays the focused run through historical stress
    // windows — a viewer of that run, no standing health of its own.
    scenario: QUIET,
    // The portfolio room is a what-if blender the user drives; it has no
    // standing health of its own, so it reads quiet on the plan.
    portfolio: QUIET,
    deploys: deploysVital(summary?.deployments, sources.errored),
    blotter: blotterVital(sources.orders),
    incidents: incidentsVital(figure(summary?.open_alerts)),
    schedules: schedulesVital(summary?.schedules),
    runway: runwayVital(summary?.runway),
  };
}

/** The worse of two readings — how a district inherits its rooms' state. */
export function worseHealth(a: Health, b: Health): Health {
  if (a === 'fault' || b === 'fault') return 'fault';
  if (a === 'degraded' || b === 'degraded') return 'degraded';
  return 'nominal';
}

/* ── store ──────────────────────────────────────────────────────────── */

/** The live lane: the districts a person watches while something is running. */
const FAST_MS = 30_000;
/** The three rooms the summary has no block for. A project list or a strategy
 *  list does not move by the second. */
const SLOW_MS = 60_000;

/** Where the districts come from, in one call. */
export const SUMMARY_PATH = '/ui/api/summary';

function emptySources(): VitalSources {
  return {
    summary: null,
    errored: null,
    deployments: null,
    qc: null,
    strategies: null,
    orders: null,
    connections: null,
    material: null,
    budget: null,
    run: backtestStore.getSnapshot(),
  };
}

let sources: VitalSources = emptySources();
let vitals: GridVitals = deriveRooms(sources);
const listeners = new Set<() => void>();
let fastTimer: ReturnType<typeof setInterval> | null = null;
let slowTimer: ReturnType<typeof setInterval> | null = null;
let stopGenerationWatch: (() => void) | null = null;
let stopRunWatch: (() => void) | null = null;

function sameSubjects(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

function unchanged(a: GridVitals, b: GridVitals): boolean {
  for (const key of Object.keys(a) as RoomId[]) {
    if (a[key].health !== b[key].health || a[key].note !== b[key].note || a[key].fact !== b[key].fact) {
      return false;
    }
    // A note that reads the same while the NAMES behind it changed (one
    // deployment recovers as another fails) is still a moved reading — the
    // annotation is naming a different thing.
    if (!sameSubjects(a[key].subjects, b[key].subjects)) return false;
  }
  return true;
}

/** Re-derive and notify only when a reading actually moved — a poll that finds
 *  the same numbers must not re-render eleven cards. */
function republish(): void {
  const next = deriveRooms(sources);
  if (unchanged(vitals, next)) return;
  vitals = next;
  for (const listener of listeners) listener();
}

/**
 * Bumped by `reset` and by every reconnect. A read carries the generation it
 * started under and is DROPPED if that generation has moved on, so a slow
 * answer to a question nobody is asking any more can never overwrite a fresh
 * one — or repaint a store a test has just cleared.
 */
let generation = 0;

/**
 * Whether two reads of the registry say the same thing. Compared field by
 * field, on the fields anything renders: a poll that returns an identical list
 * hands back a NEW array every time, and adopting it would re-render every
 * source card on the Board twice a minute for nothing.
 */
function sameConnectors(a: Connector[] | null, b: Connector[] | null): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.length !== b.length) return false;
  return a.every((row, i) => {
    const other = b[i];
    return (
      row.id === other.id &&
      row.display_label === other.display_label &&
      row.kind === other.kind &&
      row.status?.state === other.status?.state &&
      row.status?.detail === other.status?.detail
    );
  });
}

/**
 * Whether two counter reads say the same thing. The same identity rule the
 * registry follows and for the same reason: a poll that counted the same
 * material hands back a new array every 30 seconds, and adopting it would
 * re-render every question card on the Board for nothing.
 */
function sameCounters(a: MaterialCounter[] | null, b: MaterialCounter[] | null): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.length !== b.length) return false;
  return a.every((row, i) => {
    const other = b[i];
    return (
      row.nodeId === other.nodeId &&
      row.newMaterial === other.newMaterial &&
      row.asOf === other.asOf
    );
  });
}

function sameBudget(a: SynthesisBudget | null, b: SynthesisBudget | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.cap === b.cap && a.spent === b.spent && a.paused === b.paused;
}

function apply(patch: Partial<VitalSources>, startedAt = generation): void {
  if (startedAt !== generation) return;
  const previous = sources.connections;
  const previousMaterial = sources.material;
  const previousBudget = sources.budget;
  sources = { ...sources, ...patch };
  if (sameCounters(previousMaterial, sources.material)) {
    sources = { ...sources, material: previousMaterial };
  }
  if (sameBudget(previousBudget, sources.budget)) {
    sources = { ...sources, budget: previousBudget };
  }
  // Identity is the subscription contract for the rows (useSyncExternalStore
  // compares snapshots by reference, and `engineFeeds` republishes on identity),
  // so a poll that returned the same registry keeps the array it already had
  // rather than a fresh copy of the same rows — otherwise every source card on
  // the Board would re-render twice a minute for nothing.
  if (sameConnectors(previous, sources.connections)) {
    sources = { ...sources, connections: previous };
  }
  republish();
  republishFeeds();
}

/** A feed's rows, or null when the engine did not answer. A body that answered
 *  without the key yields an EMPTY list, not null: the engine spoke, and it
 *  listed nothing. */
function rowsOf<T>(body: unknown, key: string): T[] | null {
  if (body === null || body === undefined) return null;
  const value = (body as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * The errored deployments as the engine names them, for the reading that has to
 * say WHICH one stopped. A row the engine sent without a name is identified by
 * its id rather than rendered blank.
 */
export function erroredNames(rows: Deployment[] | null): string[] | null {
  if (rows === null) return null;
  return rows
    .filter((row) => row.state === DEPLOY_FAILED_STATE)
    .map((row) => row.name || `deployment ${row.id}`);
}

/**
 * The consolidated read and the connection registry, plus the detail read the
 * summary triggers only when it reports something deployed. Nothing deployed,
 * two requests — the districts, and the connectors the one call counts
 * differently (see the header).
 *
 * The trigger is the TOTAL rather than the errored count, because two surfaces
 * now need the rows and only one of them is about faults: the plan names which
 * deployment stopped, and the Board draws a card per deployment with its own
 * state. Widening the same conditional read is what keeps that to one lane —
 * an install with nothing deployed still pays nothing for either.
 */
async function readLive(): Promise<void> {
  const startedAt = generation;
  const [summary, connections] = await Promise.all([
    getJson<SummaryBody>(SUMMARY_PATH),
    getJson<{ connections?: Connector[] }>('/ui/api/connections?kind=all'),
    readBoardResearch(startedAt),
  ]);
  const connectors = rowsOf<Connector>(connections, 'connections');
  if (summary === null || (figure(summary.deployments?.total) ?? 0) === 0) {
    // A summary that did not answer says nothing about deployments either; one
    // that answered "none" is an answer, and reads as an empty list.
    const none = summary === null ? null : [];
    apply({ summary, errored: none, deployments: none, connections: connectors }, startedAt);
    return;
  }
  const rows = await getJson<Deployment[]>('/deployments');
  const list = Array.isArray(rows) ? rows : null;
  apply(
    {
      summary,
      errored: erroredNames(list),
      deployments: list,
      connections: connectors,
    },
    startedAt
  );
}

/**
 * The Board's research readings, on the same lane and under the same rule the
 * deployment detail read follows: asked for ONLY when there is something to ask
 * about. A workspace with no question registered pays nothing, and a Board that
 * is not open registers nothing, so this costs exactly what it is used for.
 *
 * It rides here rather than in a poll of its own because the badge a person
 * watches accumulate has to move on the cadence they are already being shown,
 * and because a second loop would keep running after the Board closed.
 */
async function readBoardResearch(startedAt: number): Promise<void> {
  if (!hasStandingQueries()) return;
  const [material, budget] = await Promise.all([readMaterialCounters(), readSynthesisBudget()]);
  apply({ material, budget }, startedAt);
}

/** The three rooms the consolidated payload carries no block for. */
async function readUncovered(): Promise<void> {
  const startedAt = generation;
  const [qc, strategies, orders] = await Promise.all([
    getJson<QcBody>('/ui/api/quantconnect/projects'),
    getJson<{ strategies?: unknown[] }>('/ui/api/backtest/strategies?deployable=1'),
    getJson<{ orders?: BlotterOrder[] }>('/ui/api/orders'),
  ]);
  apply(
    {
      qc,
      strategies: rowsOf<unknown>(strategies, 'strategies'),
      orders: rowsOf<BlotterOrder>(orders, 'orders'),
    },
    startedAt
  );
}

function start(): void {
  if (fastTimer !== null) return;
  // The in-process store first: it answers synchronously, so the sheet's second
  // frame already carries the session's run and its validation.
  stopRunWatch = backtestStore.subscribe(() => apply({ run: backtestStore.getSnapshot() }));
  apply({ run: backtestStore.getSnapshot() });
  void readLive();
  void readUncovered();
  fastTimer = setInterval(() => void readLive(), FAST_MS);
  slowTimer = setInterval(() => void readUncovered(), SLOW_MS);
  // A reconnect (new key, engine restarted) invalidates every reading at once,
  // including any that is still in flight.
  stopGenerationWatch = onConnectGeneration(() => {
    generation += 1;
    void readLive();
    void readUncovered();
  });
}

/** The last subscriber of EITHER view stops the lanes — see {@link engineFeeds}. */
function release(): void {
  if (listeners.size === 0 && feedListeners.size === 0) stop();
}

function stop(): void {
  if (fastTimer !== null) clearInterval(fastTimer);
  if (slowTimer !== null) clearInterval(slowTimer);
  fastTimer = null;
  slowTimer = null;
  stopGenerationWatch?.();
  stopGenerationWatch = null;
  stopRunWatch?.();
  stopRunWatch = null;
}

/* ── the artifact feeds, as their own read view ─────────────────────── */

/**
 * The two feeds that carry ARTIFACTS rather than readings: what the engine has
 * discovered, and what is deployed.
 *
 * The sheet derives a sentence per room from these; the Board derives CARDS
 * from them. Two subjects, one set of requests — this view exposes the rows the
 * lanes above already fetched instead of opening a second poll for them, which
 * is the house's poll-collapse rule and the reason the Board adds no traffic of
 * its own. Subscribing here starts the same lanes and the last subscriber of
 * either view stops them, so the Board polls while it is open and nothing polls
 * while the panel is closed.
 *
 * `run` is deliberately NOT here: the session's backtest is an in-process store
 * that answers synchronously, and whoever needs it subscribes to it directly.
 */
export interface EngineFeeds {
  /** Raw discovery rows, or null when the engine has not answered. */
  strategies: unknown[] | null;
  /** Deployment rows, or null when nothing has been read. */
  deployments: Deployment[] | null;
  /**
   * The connector REGISTRY rows. The Connections room needs only the count they
   * roll up into; the Board's source cards need which provider and how that one
   * is doing, so the rows ride out here rather than through a second poll — and
   * a provider therefore cannot read healthy on one face of the panel and
   * broken on the other. Null means nothing has answered yet, which a card says
   * as "no reading" rather than as "not linked".
   */
  connections: Connector[] | null;
  /**
   * How much new material each watched question has gathered. Null until the
   * engine answers — which a card draws as no badge rather than as a zero,
   * because "nothing has arrived" and "nobody has counted" are different things
   * to tell somebody waiting on evidence.
   */
  material: MaterialCounter[] | null;
  /**
   * The synthesis allowance, so a card can say plainly that the month's
   * dispatches are spent instead of appearing to do nothing.
   */
  budget: SynthesisBudget | null;
}

let feeds: EngineFeeds = {
  strategies: null,
  deployments: null,
  connections: null,
  material: null,
  budget: null,
};
const feedListeners = new Set<() => void>();

/** Replace the cached view only when a feed's identity moved, so a poll that
 *  changed none of them notifies nobody. */
function republishFeeds(): void {
  if (
    feeds.strategies === sources.strategies &&
    feeds.deployments === sources.deployments &&
    feeds.connections === sources.connections &&
    feeds.material === sources.material &&
    feeds.budget === sources.budget
  ) {
    return;
  }
  feeds = {
    strategies: sources.strategies,
    deployments: sources.deployments,
    connections: sources.connections,
    material: sources.material,
    budget: sources.budget,
  };
  for (const listener of feedListeners) listener();
}

export const engineFeeds = {
  subscribe(listener: () => void): () => void {
    feedListeners.add(listener);
    start();
    return () => {
      feedListeners.delete(listener);
      release();
    };
  },

  getSnapshot(): EngineFeeds {
    return feeds;
  },
};

/** Shaped for `useSyncExternalStore`: a cached object, replaced only when a
 *  reading moves, so the sheet re-renders exactly when something changed. */
export const gridVitals = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    start();
    return () => {
      listeners.delete(listener);
      release();
    };
  },

  getSnapshot(): GridVitals {
    return vitals;
  },

  /** Read every source now (a manual refresh, and what the tests drive). */
  async refresh(): Promise<void> {
    await Promise.all([readLive(), readUncovered()]);
  },

  /** Drop every reading back to quiet. Tests use it for isolation; nothing in
   *  the product calls it, because a live sheet re-reads rather than blanks. */
  reset(): void {
    generation += 1;
    sources = emptySources();
    vitals = deriveRooms(sources);
    for (const listener of listeners) listener();
    republishFeeds();
  },
};
