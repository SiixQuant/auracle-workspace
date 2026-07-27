/**
 * The Grid sheet's vitals — one live reading per room.
 *
 * ## One call for the districts the engine consolidates
 * The engine serves `GET /ui/api/summary`: every district's vitals in one pass,
 * fanned in server-side from the same store queries each room's own endpoint
 * uses. So the sheet asks once instead of once per room, and the home can never
 * disagree with the room you open from it — they are reading the same query.
 *
 * Three rooms are NOT in that payload, because the engine has no district block
 * for them: the QuantConnect project list, the deployable-strategy list, and
 * the order blotter. Those keep their own reads, on the slow lane, and the
 * table below says so rather than pretending the one call covers everything.
 *
 * ## Counts come from the summary; names do not
 * The consolidated payload is counts. When it reports errored deployments the
 * sheet needs to NAME them — the AI strip says which deployment stopped rather
 * than how many — so one detail read follows, and ONLY then. Nothing is
 * errored, nothing extra is fetched: the steady state is a single request.
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
import { DEPLOY_FAILED_STATE, type Deployment } from './live';
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

/** Connector health as the engine's in-memory poll cache reports it. */
export interface ConnectionsBlock {
  total?: number | null;
  by_state?: Record<string, number> | null;
  connected?: number | null;
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
  connections?: ConnectionsBlock | null;
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
  /** Rooms the consolidated payload has no block for. */
  qc: QcBody | null;
  strategies: unknown[] | null;
  orders: BlotterOrder[] | null;
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

/** Connector states that mean "wired but not healthy" — worth an amber dot,
 *  not a red one. `not_configured` is deliberately absent: the platform is
 *  keyless by default, so an unconfigured connector is a choice. */
const DEGRADED_CONN_STATES = ['degraded', 'disconnected', 'connecting', 'reconnecting'];

function connsVital(block: ConnectionsBlock | null | undefined): RoomVital {
  if (!block) return QUIET;
  const total = figure(block.total);
  if (total === null) return QUIET;
  if (total === 0) return vital('nominal', 'none available');
  const by = block.by_state ?? {};
  const errored = figure(by.error) ?? 0;
  if (errored > 0) return vital('fault', `${errored} of ${total} in error`, `${errored} in error`);
  const degraded = DEGRADED_CONN_STATES.reduce((sum, state) => sum + (figure(by[state]) ?? 0), 0);
  if (degraded > 0) {
    return vital('degraded', `${degraded} of ${total} degraded`, `${degraded} degraded`);
  }
  const connected = figure(block.connected) ?? 0;
  return vital('nominal', `${connected} of ${total} connected`, `${connected}/${total} up`);
}

/** Every room's reading, from whatever the sources currently hold. */
export function deriveRooms(sources: VitalSources): GridVitals {
  const summary = sources.summary;
  return {
    findings: findingsVital(summary?.research),
    qc: qcVital(sources.qc),
    strategies: strategiesVital(sources.strategies),
    backtest: backtestVital(sources.run),
    validation: validationVital(sources.run.validation),
    deploys: deploysVital(summary?.deployments, sources.errored),
    blotter: blotterVital(sources.orders),
    incidents: incidentsVital(figure(summary?.open_alerts)),
    schedules: schedulesVital(summary?.schedules),
    runway: runwayVital(summary?.runway),
    conns: connsVital(summary?.connections),
  };
}

/** The worse of two readings — how a district inherits its rooms' state. */
export function worseHealth(a: Health, b: Health): Health {
  if (a === 'fault' || b === 'fault') return 'fault';
  if (a === 'degraded' || b === 'degraded') return 'degraded';
  return 'nominal';
}

/* ── store ──────────────────────────────────────────────────────────── */

/** The consolidated read: everything a person watches while something runs. */
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
    qc: null,
    strategies: null,
    orders: null,
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

function apply(patch: Partial<VitalSources>): void {
  sources = { ...sources, ...patch };
  republish();
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
 * The one consolidated read, plus the naming read it triggers only when the
 * engine reports a deployment errored. Nothing errored, one request.
 */
async function readSummary(): Promise<void> {
  const summary = await getJson<SummaryBody>(SUMMARY_PATH);
  if (summary === null || (figure(summary.deployments?.errored) ?? 0) === 0) {
    apply({ summary, errored: summary === null ? null : [] });
    return;
  }
  const rows = await getJson<Deployment[]>('/deployments');
  apply({ summary, errored: erroredNames(Array.isArray(rows) ? rows : null) });
}

/** The three rooms the consolidated payload carries no block for. */
async function readUncovered(): Promise<void> {
  const [qc, strategies, orders] = await Promise.all([
    getJson<QcBody>('/ui/api/quantconnect/projects'),
    getJson<{ strategies?: unknown[] }>('/ui/api/backtest/strategies?deployable=1'),
    getJson<{ orders?: BlotterOrder[] }>('/ui/api/orders'),
  ]);
  apply({
    qc,
    strategies: rowsOf<unknown>(strategies, 'strategies'),
    orders: rowsOf<BlotterOrder>(orders, 'orders'),
  });
}

function start(): void {
  if (fastTimer !== null) return;
  // The in-process store first: it answers synchronously, so the sheet's second
  // frame already carries the session's run and its validation.
  stopRunWatch = backtestStore.subscribe(() => apply({ run: backtestStore.getSnapshot() }));
  apply({ run: backtestStore.getSnapshot() });
  void readSummary();
  void readUncovered();
  fastTimer = setInterval(() => void readSummary(), FAST_MS);
  slowTimer = setInterval(() => void readUncovered(), SLOW_MS);
  // A reconnect (new key, engine restarted) invalidates every reading at once.
  stopGenerationWatch = onConnectGeneration(() => {
    void readSummary();
    void readUncovered();
  });
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

/** Shaped for `useSyncExternalStore`: a cached object, replaced only when a
 *  reading moves, so the sheet re-renders exactly when something changed. */
export const gridVitals = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    start();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) stop();
    };
  },

  getSnapshot(): GridVitals {
    return vitals;
  },

  /** Read every source now (a manual refresh, and what the tests drive). */
  async refresh(): Promise<void> {
    await Promise.all([readSummary(), readUncovered()]);
  },

  /** Drop every reading back to quiet. Tests use it for isolation; nothing in
   *  the product calls it, because a live sheet re-reads rather than blanks. */
  reset(): void {
    sources = emptySources();
    vitals = deriveRooms(sources);
    for (const listener of listeners) listener();
  },
};
