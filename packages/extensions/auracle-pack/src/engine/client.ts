/**
 * Renderer-side engine client for the Auracle pack. All HTTP goes through the
 * main-process bridge (`auracle:engine-request`), which owns the cookie +
 * double-submit CSRF contract the engine's /ui surface requires — headers a
 * renderer fetch cannot set.
 */
import type { ConnectCheck } from './model';

interface BridgeResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

interface ElectronBridge {
  electronAPI?: {
    invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
    /** Host shell bridge — opens an absolute URL in the user's browser
     *  (`open-external`). Feature-detected: absent in tests and older hosts. */
    openExternal?: (url: string) => Promise<void>;
  };
}

function bridge(): ((channel: string, ...args: unknown[]) => Promise<unknown>) | null {
  const api = (window as unknown as ElectronBridge).electronAPI;
  return api?.invoke ? api.invoke.bind(api) : null;
}

export async function engineConfig(): Promise<{ engineUrl: string; hasKey: boolean }> {
  const invoke = bridge();
  if (!invoke) return { engineUrl: '', hasKey: false };
  try {
    return (await invoke('auracle:engine-config')) as { engineUrl: string; hasKey: boolean };
  } catch {
    return { engineUrl: '', hasKey: false };
  }
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<BridgeResponse> {
  const invoke = bridge();
  if (!invoke) return { ok: false, status: 0, body: null };
  try {
    return (await invoke(
      'auracle:engine-request',
      method,
      path,
      body,
      headers
    )) as BridgeResponse;
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/** GET returning parsed JSON, or null on any transport/HTTP failure. */
export async function getJson<T>(path: string): Promise<T | null> {
  const response = await request('GET', path);
  return response.ok && response.body !== null ? (response.body as T) : null;
}

/**
 * GET that keeps the HTTP status on failure, so callers can distinguish
 * "this engine build doesn't serve the route" (404 — engine outdated)
 * from "nothing answered" (status 0 — unreachable). getJson erases that
 * difference, which is how the Research panel once reported a stale
 * engine as network trouble.
 */
export async function getJsonDetailed<T>(
  path: string
): Promise<{ ok: true; body: T } | { ok: false; status: number; body: unknown }> {
  const response = await request('GET', path);
  if (response.ok && response.body !== null) return { ok: true, body: response.body as T };
  // Keep the parsed body on failure too: an HTTP 4xx (e.g. a 422 with {detail})
  // still carries a reason the caller may want to surface. getJson drops it.
  return { ok: false, status: response.status, body: response.body };
}

/**
 * Mutation returning the full bridge response so callers can render errors
 * honestly. `headers` carries the per-request stamps the engine expects on its
 * guarded operations; the bridge accepts only the names it knows and assembles
 * the credential headers itself.
 */
export async function postJson(
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<BridgeResponse> {
  return request('POST', path, body, headers);
}

export async function putJson(path: string, body?: unknown): Promise<BridgeResponse> {
  return request('PUT', path, body);
}

/**
 * Queue a backtest of `strategyPath` (a dotted `module.Symbol` discovery id).
 * The engine runs it as a background job, so this returns the job id; poll
 * {@link backtestJobStatus} until the status is terminal. Blank dates let the
 * engine default the window (last ~5 years).
 */
export async function runBacktest(
  strategyPath: string,
  start = '',
  end = ''
): Promise<{ ok: true; jobId: number } | { ok: false; status: number; error?: string }> {
  const res = await postJson('/ui/api/backtest/run', {
    strategy_path: strategyPath,
    start,
    end,
  });
  const body = (res.body ?? {}) as { ok?: boolean; job_id?: number; error?: string };
  if (res.ok && body.ok && typeof body.job_id === 'number') {
    return { ok: true, jobId: body.job_id };
  }
  return { ok: false, status: res.status, error: body.error };
}

/** Poll a backtest job's status. `status` is 'pending'|'running'|'succeeded'|'failed'. */
export async function backtestJobStatus(
  jobId: number
): Promise<{ ok: true; status: string } | { ok: false; status: number }> {
  const res = await getJsonDetailed<{ status?: string }>(
    `/ui/api/backtest/job/${jobId}/status`
  );
  if (res.ok) {
    return { ok: true, status: typeof res.body.status === 'string' ? res.body.status : 'unknown' };
  }
  return { ok: false, status: res.status };
}

/**
 * A cumulative-return series aligned to `chart.labels` — the benchmark overlay
 * the tearsheet draws behind the strategy line. `points` are in the same PERCENT
 * units the engine hands `chart.points` (e.g. 173.0 means +173%), not fractions.
 * Null on a run the engine computed no benchmark for.
 */
export interface BenchmarkSeries {
  labels: string[];
  points: number[];
  /** The benchmark's ticker (e.g. "SPY"), when the engine names it. */
  symbol?: string;
}

/** A completed backtest's chartable result (equity curve + headline stats). */
export interface BacktestResultBody {
  status: string;
  /** false when the payload has no plottable curve (function/signal strategies). */
  chartable?: boolean;
  strategy_path?: string;
  as_of?: string;
  n_bars?: number;
  /** Headline metrics; NaN/Inf come through as null. */
  stats?: Record<string, number | null>;
  chart?: { labels: string[]; points: number[] };
  drawdown?: { labels: string[]; points: number[] };
  /** The benchmark cumulative-return overlay (WS-A / FR-A1), or null when the
   *  engine computed none. Additive — an older engine omits the key entirely. */
  benchmark?: BenchmarkSeries | null;
  trades?: number;
  /** Where the run came from when it is not a local backtest — a persisted
   *  external run declares its origin so the viewer can label it. Read both
   *  the explicit `source` and the persisted result `kind` (a QC-imported run
   *  carries kind "qc_import"); a local run declares neither. */
  source?: string;
  kind?: string;
}

/**
 * The non-local source a result payload declares, or undefined for a local
 * backtest. Prefers an explicit `source`; otherwise derives it from the
 * persisted result `kind` ("qc_import" → "quantconnect"). Local markers
 * ("local"/"backtest"/"engine") resolve to undefined so a plain run stays
 * unlabelled.
 */
export function resolveRunSource(body: {
  source?: unknown;
  kind?: unknown;
}): string | undefined {
  const raw =
    typeof body.source === 'string' && body.source
      ? body.source
      : body.kind === 'qc_import'
        ? 'quantconnect'
        : typeof body.kind === 'string' && body.kind && body.kind !== 'backtest'
          ? body.kind
          : undefined;
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase();
  return key === '' || key === 'local' || key === 'engine' || key === 'backtest'
    ? undefined
    : raw;
}

/**
 * Fetch a succeeded backtest's equity curve + stats. Returns `ok:false` on an
 * older engine that predates the route (404) — the caller then simply omits
 * the chart rather than inventing one.
 */
export async function backtestJobResult(
  jobId: number
): Promise<{ ok: true; body: BacktestResultBody } | { ok: false; status: number }> {
  const res = await getJsonDetailed<BacktestResultBody>(
    `/ui/api/backtest/job/${jobId}/result`
  );
  if (res.ok) return { ok: true, body: res.body };
  return { ok: false, status: res.status };
}

/**
 * The factor-attribution battery for a completed run: the engine reconstructs
 * the run's daily returns from its stored equity curve, regresses them on the
 * bundled Fama-French + momentum factors, and returns annualized alpha,
 * per-factor loadings, t-stats, p-values and fit — each rolled into a
 * categorical verdict and a plain-English reading computed server-side. The
 * client only renders the strings; it derives no statistical judgment.
 */
export interface FactorBatteryBody {
  ok: boolean;
  /** Present on a rejection (4xx/5xx): the engine's plain reason (window too
   *  short, no factor overlap, run not found, quant extra missing). */
  error?: string;
  job_id?: number;
  n_obs?: number;
  factor_set?: string[];
  window?: { start?: string; end?: string };
  factor_data?: {
    source?: string;
    coverage_start?: string;
    coverage_end?: string;
    stale?: boolean;
    note?: string;
  };
  hac_lags?: number;
  periods_per_year?: number;
  /** One measure per row: alpha, market exposure, each style tilt, fit — each
   *  carrying `measure`, `label`, `verdict`, `reading` plus its own numerics. */
  measures?: Array<Record<string, unknown>>;
  regression?: {
    alpha?: number | null;
    alpha_annual?: number | null;
    alpha_tstat?: number | null;
    alpha_pvalue?: number | null;
    loadings?: Array<{ factor?: string; beta?: number | null; tstat?: number | null; pvalue?: number | null }>;
    r_squared?: number | null;
    r_squared_adj?: number | null;
  };
}

/**
 * Fetch the factor battery for a job. Keeps the HTTP status and body on
 * failure so the caller can render the engine's own explanation for a 4xx
 * (short window / no overlap / not found) rather than inventing an excuse or
 * leaving a blank section.
 */
export async function backtestJobFactors(
  jobId: number
): Promise<{ ok: true; body: FactorBatteryBody } | { ok: false; status: number; body: unknown }> {
  const res = await getJsonDetailed<FactorBatteryBody>(
    `/ui/api/backtest/job/${jobId}/factors`
  );
  if (res.ok) return { ok: true, body: res.body };
  return { ok: false, status: res.status, body: res.body };
}

/**
 * The tearsheet's result fetch (WS-E). A thin `getJson` read of the same
 * `/result` route {@link backtestJobResult} uses, but returning the parsed body
 * (or null) directly so the tearsheet room can drive off one mockable seam —
 * benchmark overlay and the QuantStats-extra stats ride along in the additive
 * keys. Null on any 404/transport failure: the room then shows its honest
 * "no chartable run" state rather than a fabricated curve.
 */
export async function tearsheetResult(jobId: number): Promise<BacktestResultBody | null> {
  return getJson<BacktestResultBody>(`/ui/api/backtest/job/${jobId}/result`);
}

/**
 * The tearsheet's factor fetch (FR-A3) — the alpha row's only source. Read
 * through `getJson` (not the status-keeping {@link backtestJobFactors}) so the
 * whole tearsheet fetches through one seam; a failed factor read simply leaves
 * Alpha as an em dash rather than blocking the sheet.
 */
export async function tearsheetFactors(jobId: number): Promise<FactorBatteryBody | null> {
  return getJson<FactorBatteryBody>(`/ui/api/backtest/job/${jobId}/factors`);
}

/**
 * One recent chartable backtest, as the tearsheet's run picker (and the home
 * hero's auto-focus) lists it. Every figure is the engine's own, already
 * summarized for the row — the panel recomputes none of them. `totalReturn`,
 * `sharpe` and `maxDrawdown` are null when the engine had no value, so the row
 * shows an em dash rather than a fabricated number.
 */
export interface RecentRun {
  jobId: number;
  strategyPath: string;
  asOf: string;
  nBars: number;
  finishedAt: string;
  totalReturn: number | null;
  sharpe: number | null;
  maxDrawdown: number | null;
}

/**
 * The recent-backtests feed. A thin `getJson` read of `/ui/api/backtest/jobs`
 * (newest first, already user-scoped by the engine, agent runs included),
 * mapping the wire's snake_case onto the pack's camelCase. Returns [] on any
 * 404/transport failure — the picker then shows nothing rather than a
 * fabricated list, exactly as the other tearsheet* reads rest on their empties.
 */
export async function tearsheetRuns(limit = 20): Promise<RecentRun[]> {
  const body = await getJson<{ jobs?: Array<Record<string, unknown>> }>(
    `/ui/api/backtest/jobs?limit=${limit}`
  );
  const jobs = body && Array.isArray(body.jobs) ? body.jobs : [];
  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return jobs.map((job) => ({
    jobId: Number(job.job_id),
    strategyPath: typeof job.strategy_path === 'string' ? job.strategy_path : '',
    asOf: typeof job.as_of === 'string' ? job.as_of : '',
    nBars: typeof job.n_bars === 'number' ? job.n_bars : 0,
    finishedAt: typeof job.finished_at === 'string' ? job.finished_at : '',
    totalReturn: numOrNull(job.total_return),
    sharpe: numOrNull(job.sharpe),
    maxDrawdown: numOrNull(job.max_drawdown),
  }));
}

/**
 * A structured, logged reason a position was entered (WS-B / FR-B1). `rule` is
 * the engine's rule slug (e.g. "ma_cross_20_50"); `values` are the named facts
 * it recorded at the entry, each a number or a boolean. The panel NEVER invents
 * these — a trade that logged none renders facts-only, no thesis sentence
 * (INV-2). The panel only reads them; it derives no signal of its own.
 */
export interface SignalFact {
  rule: string;
  values: Record<string, number | boolean>;
}

/**
 * One position episode within a run (WS-B / FR-B3, FR-B4). `side` is long/short
 * from the position's weight sign. `contribution_pct` is the position's
 * contribution to the PORTFOLIO's return — NOT a standalone trade P&L or a
 * per-trade return (recon Q3); the Trades view labels it "Contribution" and
 * shows no dollar figure. `signals` is the ordered SignalFact set, possibly
 * empty.
 */
export interface TradeRecord {
  symbol: string;
  side: 'long' | 'short';
  entry_date: string;
  exit_date: string;
  hold_days: number;
  contribution_pct: number;
  signals: SignalFact[];
}

/** The per-trade list payload from `/…/job/{id}/trades` (WS-B / FR-B4). */
export interface TradesBody {
  status: string;
  trades: TradeRecord[];
}

/**
 * The tearsheet's per-trade fetch (WS-G / FR-B4). Mirrors {@link tearsheetResult}:
 * a thin `getJson` read of `/…/job/{id}/trades` returning the parsed body (or
 * null on any 404/transport failure) so the Trades view drives off one mockable
 * seam. Null lets the view show its honest "trades could not be loaded" rest
 * rather than a fabricated record.
 */
export async function tearsheetTrades(jobId: number): Promise<TradesBody | null> {
  return getJson<TradesBody>(`/ui/api/backtest/job/${jobId}/trades`);
}

/**
 * A strategy's plain-English summary (WS-D / FR-F1), keyed by `strategy_path`.
 * `is_fallback` marks the docstring stand-in the engine serves until an agent
 * has authored one; `stale` marks a stored summary whose source run or strategy
 * file changed since it was written. `summary_text` may be empty when neither
 * exists.
 */
export interface StrategySummaryBody {
  summary_text: string;
  source_run_id: number | null;
  generated_at: string | null;
  stale: boolean;
  is_fallback: boolean;
}

/**
 * The tearsheet's summary fetch (FR-F1). Mirrors {@link tearsheetResult}: a thin
 * `getJson` read of `/ui/api/strategy/summary?strategy_path=…` returning the
 * parsed body (or null on any 404/transport failure) so the Overview drives off
 * one mockable seam. Null lets the strip show its quiet empty rest rather than
 * fabricating prose.
 */
export async function tearsheetSummary(
  strategyPath: string
): Promise<StrategySummaryBody | null> {
  return getJson<StrategySummaryBody>(
    `/ui/api/strategy/summary?strategy_path=${encodeURIComponent(strategyPath)}`
  );
}

/**
 * A generated research dossier's persisted record (FR-F2/F3). The engine builds
 * the PDF into its `reports/` volume and returns this handle; `cached` is true
 * when the build was already on disk for this run. The panel never reads the
 * file itself — it opens the engine's download URL (see {@link openReport}).
 */
export interface DossierReport {
  id: string;
  filename: string;
  path: string;
  created_at: string;
  cached: boolean;
}

/**
 * Ask the engine to build (or return the cached) AuraPoint dossier for a
 * Strategy+Run (FR-F2/F3, E5). Keeps the HTTP status on failure so the card can
 * tell the honest states apart: a 503 = the engine build lacks the PDF
 * generator (WeasyPrint), a 400/404 = the run can't be built, status 0 =
 * unreachable. The engine owns every number in the PDF (INV-1); the panel only
 * triggers and opens it.
 */
export async function buildDossier(
  strategyPath: string,
  jobId: number
): Promise<
  { ok: true; report: DossierReport } | { ok: false; status: number; error?: string }
> {
  const res = await postJson('/ui/api/strategy/dossier', {
    strategy_path: strategyPath,
    job_id: jobId,
  });
  const body = (res.body ?? {}) as {
    ok?: boolean;
    report?: DossierReport;
    error?: string;
    detail?: string;
  };
  if (res.ok && body.ok && body.report && typeof body.report.id === 'string') {
    return { ok: true, report: body.report };
  }
  const error = body.error ?? (typeof body.detail === 'string' ? body.detail : undefined);
  return { ok: false, status: res.status, error };
}

/**
 * Open a generated report's PDF in the user's browser. No pack surface opened an
 * engine URL before, so this builds the download URL from the resolved engine
 * base ({@link engineConfig}) and hands it to the host's shell through the same
 * `electronAPI` bridge the engine requests ride — feature-detected, so a
 * renderer without it (tests, older host) is a no-op that reports false.
 * Returns false when the engine base is unknown or the bridge is absent, so the
 * card can stay honest about whether the file actually opened.
 */
export async function openReport(reportId: string): Promise<boolean> {
  if (!reportId) return false;
  const { engineUrl } = await engineConfig();
  if (!engineUrl) return false;
  const url = `${engineUrl.replace(/\/+$/, '')}/ui/api/reports/${encodeURIComponent(reportId)}`;
  const api = (window as unknown as ElectronBridge).electronAPI;
  if (!api?.openExternal) return false;
  try {
    await api.openExternal(url);
    return true;
  } catch {
    return false;
  }
}

/** Engine reachability + identity probe (`/ui/api/ide/connect-check`). */
export async function connectCheck(): Promise<ConnectCheck | null> {
  return getJson<ConnectCheck>('/ui/api/ide/connect-check');
}

/**
 * Same probe, keeping the HTTP status on failure so a caller can tell a rejected
 * credential (401/403) from an engine that never answered (status 0) — a
 * distinction {@link connectCheck} erases by collapsing every failure to null.
 */
export async function connectCheckDetailed(): Promise<
  { ok: true; body: ConnectCheck } | { ok: false; status: number; body: unknown }
> {
  return getJsonDetailed<ConnectCheck>('/ui/api/ide/connect-check');
}

/**
 * Keyless sign-in transport. `/auth/*` is unauthenticated JSON served by both
 * the hosted identity deployment (HQ) and the local engine; the bridge tries
 * HQ first and reports which base opened the session, and every later call is
 * pinned to that base.
 */
export async function authBases(): Promise<{ hq: string; engine: string }> {
  const invoke = bridge();
  if (!invoke) return { hq: '', engine: '' };
  try {
    return (await invoke('auracle:auth-bases')) as { hq: string; engine: string };
  } catch {
    return { hq: '', engine: '' };
  }
}

export async function authStart(
  email: string
): Promise<BridgeResponse & { base: string | null }> {
  const invoke = bridge();
  if (!invoke) return { ok: false, status: 0, body: null, base: null };
  try {
    return (await invoke('auracle:auth-start', email)) as BridgeResponse & {
      base: string | null;
    };
  } catch {
    return { ok: false, status: 0, body: null, base: null };
  }
}

export async function authRequest(
  base: string,
  path: string,
  body?: unknown
): Promise<BridgeResponse> {
  const invoke = bridge();
  if (!invoke) return { ok: false, status: 0, body: null };
  try {
    return (await invoke('auracle:auth-request', base, path, body)) as BridgeResponse;
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/**
 * Shared session store (main-process, OS-encrypted). One identity for every
 * surface: the native Account panel and this pack read and write the same
 * state; tokens never reach the renderer.
 */
export interface AuthState {
  signedIn: boolean;
  email?: string;
  tier?: string;
  offline?: boolean;
  expired?: boolean;
}

export async function authState(): Promise<AuthState> {
  const invoke = bridge();
  if (!invoke) return { signedIn: false };
  try {
    return (await invoke('auracle:auth-state')) as AuthState;
  } catch {
    return { signedIn: false };
  }
}

export async function authPersist(payload: {
  base: string;
  signed_jwt?: string;
  refresh_token?: string;
  email?: string;
  tier?: string;
}): Promise<void> {
  const invoke = bridge();
  if (!invoke) return;
  try {
    await invoke('auracle:auth-persist', payload);
  } catch {
    // surfaced by the next authState() read
  }
}

export async function authSignout(): Promise<void> {
  const invoke = bridge();
  if (!invoke) return;
  try {
    await invoke('auracle:auth-signout');
  } catch {
    // surfaced by the next authState() read
  }
}

/**
 * Connect generation: bumped after every saved/disconnected connection so all
 * pack surfaces re-poll immediately instead of waiting out their intervals.
 * In-process because the whole pack is one extension.
 */
type GenerationListener = () => void;
const generationListeners = new Set<GenerationListener>();
let generation = 0;

export function bumpConnectGeneration(): void {
  generation += 1;
  for (const listener of generationListeners) listener();
}

export function connectGenerationValue(): number {
  return generation;
}

export function onConnectGeneration(listener: GenerationListener): () => void {
  generationListeners.add(listener);
  return () => generationListeners.delete(listener);
}
