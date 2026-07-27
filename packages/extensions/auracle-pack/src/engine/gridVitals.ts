/**
 * The Grid sheet's vitals — one live reading per room.
 *
 * There is no consolidated engine summary route, so this composes the sheet's
 * readings from the SAME sources the pre-Grid panels read: the deployments
 * list, the order feed, the schedule table, the runway stages, the connection
 * registry, the research feed, the QuantConnect project list, the strategy
 * discovery route, plus two in-process stores (alertStore for open incidents,
 * backtestStore for the session's run and its validation). Nothing here
 * computes a number the engine did not supply.
 *
 * HONESTY: a source that did not answer reads QUIET — no note, no figure —
 * never the last value it managed to fetch. A number that survives its source
 * going dark is worse than no number, because the sheet's whole job is to say
 * what is true right now. The one deliberate inheritance is the incident
 * count: alertStore reports ZERO for an engine that did not answer (its
 * documented badge contract), so "none open" here means exactly what the rail
 * badge means.
 *
 * FIRST PAINT: the snapshot is a plain module-level object, so a mount reads
 * it synchronously and paints immediately — from an empty (quiet) table on the
 * first visit, and from the last readings on every later one. Fetches never
 * gate the first frame; they replace it when they land.
 *
 * COST: polling is lazy and stops with the last subscriber, so the sheet costs
 * nothing while a room is open or the Grid is closed. Operate-side feeds move
 * fastest, so they are on the short interval; the rest are on the long one.
 */
import { getJson, onConnectGeneration } from './client';
import { alertStore } from './alertStore';
import { backtestStore, type BacktestSnapshot } from './backtestStore';
import { DEPLOY_FAILED_STATE, isActive, type Deployment } from './live';
import { isConnected, type Connector } from './model';
import type { BlotterOrder, StageTruth } from './monitors';
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

/** A finding as the sheet reads it — the feed is engine-ranked, so the first
 *  row carries the top score and no client-side sorting happens here. */
interface FeedFinding {
  score?: unknown;
}

interface ScheduleLine {
  enabled?: boolean;
}

/** Everything the readings are derived from. Null means "no answer yet". */
export interface VitalSources {
  findings: FeedFinding[] | null;
  qc: { connected?: boolean; projects?: unknown[] } | null;
  strategies: unknown[] | null;
  /** Always present: an in-process store, not a fetch. */
  run: BacktestSnapshot;
  deployments: Deployment[] | null;
  orders: BlotterOrder[] | null;
  /** Open-incident count from alertStore, or null before its first read. */
  incidents: number | null;
  schedules: ScheduleLine[] | null;
  runway: Record<string, StageTruth> | null;
  connections: Connector[] | null;
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

/** The research feed is served capped, so a full page is reported as "N+" —
 *  the sheet never states a total the route did not establish. */
export const FINDINGS_LIMIT = 20;

function findingsVital(rows: FeedFinding[] | null): RoomVital {
  if (rows === null) return QUIET;
  if (rows.length === 0) return vital('nominal', 'no findings yet');
  const capped = rows.length >= FINDINGS_LIMIT;
  const many = capped ? `${FINDINGS_LIMIT}+ findings` : count(rows.length, 'finding');
  const top = rows[0]?.score;
  const note =
    typeof top === 'number' && Number.isFinite(top) ? `${many} · top ${Math.round(top)}` : many;
  return vital('nominal', note, many);
}

function qcVital(body: VitalSources['qc']): RoomVital {
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

function deploysVital(rows: Deployment[] | null): RoomVital {
  if (rows === null) return QUIET;
  if (rows.length === 0) return vital('nominal', 'nothing deployed');
  const failed = rows.filter((row) => row.state === DEPLOY_FAILED_STATE);
  const running = rows.filter((row) => isActive(row.state)).length;
  if (failed.length > 0) {
    // The names travel with the reading, so an annotation can say WHICH
    // deployment stopped without going back to the feed for a second opinion.
    // A row the engine sent without a name is identified by its id rather than
    // rendered blank.
    const named = failed.map((row) => row.name || `deployment ${row.id}`);
    return vital(
      'fault',
      `${running} running · ${failed.length} errored`,
      `${failed.length} errored`,
      named
    );
  }
  return vital('nominal', `${running} running of ${rows.length}`, `${running} running`);
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

function schedulesVital(rows: ScheduleLine[] | null): RoomVital {
  if (rows === null) return QUIET;
  if (rows.length === 0) return vital('nominal', 'nothing scheduled');
  const enabled = rows.filter((row) => row.enabled === true).length;
  return vital('nominal', `${enabled} enabled of ${rows.length}`, `${enabled} enabled`);
}

function runwayVital(stages: Record<string, StageTruth> | null): RoomVital {
  if (stages === null) return QUIET;
  const names = Object.keys(stages);
  if (names.length === 0) return vital('nominal', 'no stages reported');
  const reached = names.filter((name) => stages[name]?.reached === 'yes').length;
  return vital('nominal', `${reached} of ${names.length} stages reached`, `${reached}/${names.length} stages`);
}

/** Connector states that mean "wired but not healthy" — worth an amber dot,
 *  not a red one. `not_configured` is deliberately absent: the platform is
 *  keyless by default, so an unconfigured connector is a choice. */
const DEGRADED_CONN_STATES = new Set(['degraded', 'disconnected', 'connecting', 'reconnecting']);

function connsVital(rows: Connector[] | null): RoomVital {
  if (rows === null) return QUIET;
  if (rows.length === 0) return vital('nominal', 'none available');
  const errored = rows.filter((row) => row.status?.state === 'error').length;
  if (errored > 0) return vital('fault', `${errored} of ${rows.length} in error`, `${errored} in error`);
  const degraded = rows.filter((row) => DEGRADED_CONN_STATES.has(row.status?.state ?? '')).length;
  if (degraded > 0) {
    return vital('degraded', `${degraded} of ${rows.length} degraded`, `${degraded} degraded`);
  }
  const connected = rows.filter((row) => isConnected(row.status)).length;
  return vital('nominal', `${connected} of ${rows.length} connected`, `${connected}/${rows.length} up`);
}

/** Every room's reading, from whatever the sources currently hold. */
export function deriveRooms(sources: VitalSources): GridVitals {
  return {
    findings: findingsVital(sources.findings),
    qc: qcVital(sources.qc),
    strategies: strategiesVital(sources.strategies),
    backtest: backtestVital(sources.run),
    validation: validationVital(sources.run.validation),
    deploys: deploysVital(sources.deployments),
    blotter: blotterVital(sources.orders),
    incidents: incidentsVital(sources.incidents),
    schedules: schedulesVital(sources.schedules),
    runway: runwayVital(sources.runway),
    conns: connsVital(sources.connections),
  };
}

/** The worse of two readings — how a district inherits its rooms' state. */
export function worseHealth(a: Health, b: Health): Health {
  if (a === 'fault' || b === 'fault') return 'fault';
  if (a === 'degraded' || b === 'degraded') return 'degraded';
  return 'nominal';
}

/* ── store ──────────────────────────────────────────────────────────── */

/** Operate-side feeds: the ones a user watches while something is running. */
const FAST_MS = 30_000;
/** Everything else — a project list or a stage table does not move by the second. */
const SLOW_MS = 60_000;

function emptySources(): VitalSources {
  return {
    findings: null,
    qc: null,
    strategies: null,
    run: backtestStore.getSnapshot(),
    deployments: null,
    orders: null,
    incidents: null,
    schedules: null,
    runway: null,
    connections: null,
  };
}

let sources: VitalSources = emptySources();
let vitals: GridVitals = deriveRooms(sources);
const listeners = new Set<() => void>();
let fastTimer: ReturnType<typeof setInterval> | null = null;
let slowTimer: ReturnType<typeof setInterval> | null = null;
let stopGenerationWatch: (() => void) | null = null;
let stopAlertWatch: (() => void) | null = null;
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

async function readFast(): Promise<void> {
  const [deployments, orders, schedules] = await Promise.all([
    getJson<Deployment[]>('/deployments'),
    getJson<{ orders?: BlotterOrder[] }>('/ui/api/orders'),
    getJson<{ schedules?: ScheduleLine[] }>('/ui/api/schedules.json'),
  ]);
  apply({
    deployments: Array.isArray(deployments) ? deployments : null,
    orders: rowsOf<BlotterOrder>(orders, 'orders'),
    schedules: rowsOf<ScheduleLine>(schedules, 'schedules'),
  });
}

async function readSlow(): Promise<void> {
  const [findings, qc, strategies, runway, connections] = await Promise.all([
    getJson<{ findings?: FeedFinding[] }>(`/ui/api/research/feed?limit=${FINDINGS_LIMIT}`),
    getJson<{ connected?: boolean; projects?: unknown[] }>('/ui/api/quantconnect/projects'),
    getJson<{ strategies?: unknown[] }>('/ui/api/backtest/strategies?deployable=1'),
    getJson<{ stages?: Record<string, StageTruth> }>('/ui/api/runway'),
    getJson<{ connections?: Connector[] }>('/ui/api/connections?kind=all'),
  ]);
  apply({
    findings: rowsOf<FeedFinding>(findings, 'findings'),
    qc,
    strategies: rowsOf<unknown>(strategies, 'strategies'),
    runway: runway === null ? null : ((runway.stages ?? {}) as Record<string, StageTruth>),
    connections: rowsOf<Connector>(connections, 'connections'),
  });
}

/**
 * The open-alert count, read through the store the rail badge reads. That
 * store only notifies when the count CHANGES, so a genuinely empty feed would
 * never announce itself — one explicit read is what tells the sheet the
 * difference between "nothing read yet" (quiet) and "none open".
 */
async function readAlerts(): Promise<void> {
  await alertStore.refresh();
  apply({ incidents: alertStore.getSnapshot() });
}

function start(): void {
  if (fastTimer !== null) return;
  // In-process stores first: they answer synchronously, so the sheet's second
  // frame already carries the session's run and its validation.
  stopRunWatch = backtestStore.subscribe(() => apply({ run: backtestStore.getSnapshot() }));
  stopAlertWatch = alertStore.subscribe(() => apply({ incidents: alertStore.getSnapshot() }));
  apply({ run: backtestStore.getSnapshot() });
  void readAlerts();
  void readFast();
  void readSlow();
  fastTimer = setInterval(() => void readFast(), FAST_MS);
  slowTimer = setInterval(() => void readSlow(), SLOW_MS);
  // A reconnect (new key, engine restarted) invalidates every reading at once.
  stopGenerationWatch = onConnectGeneration(() => {
    void readFast();
    void readSlow();
  });
}

function stop(): void {
  if (fastTimer !== null) clearInterval(fastTimer);
  if (slowTimer !== null) clearInterval(slowTimer);
  fastTimer = null;
  slowTimer = null;
  stopGenerationWatch?.();
  stopGenerationWatch = null;
  stopAlertWatch?.();
  stopAlertWatch = null;
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
    await Promise.all([readFast(), readSlow(), readAlerts()]);
  },

  /** Drop every reading back to quiet. Tests use it for isolation; nothing in
   *  the product calls it, because a live sheet re-reads rather than blanks. */
  reset(): void {
    sources = emptySources();
    vitals = deriveRooms(sources);
    for (const listener of listeners) listener();
  },
};
