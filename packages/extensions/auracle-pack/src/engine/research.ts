/**
 * Research panel view model — types + pure helpers over the engine's
 * /ui/api/research/* surface.
 *
 * Honesty rules carried from the rest of the pack: scores and ordering
 * come from the engine untouched (no client re-ranking), the score's
 * origin is always labeled, and scan outcomes distinguish "found
 * nothing" from "broke" — the server's words, not invented ones.
 */

/**
 * The engine's tradability breakdown: six numeric factors (0–100), in the
 * order the scorer weights them, each with a display label. The engine's
 * `factors` payload also carries a non-numeric `data_note` string — only
 * these six keys are ever surfaced, and only as bars, so the note can never
 * be mistaken for a score. Both the LLM and heuristic scoring paths fill all
 * six; heuristic rows use conservative floors, so their bars carry less
 * signal than LLM-scored rows (the row's origin label and confidence say so).
 */
export const FACTOR_KEYS = [
  { key: 'implementability', label: 'Implementability' },
  { key: 'data_availability', label: 'Data availability' },
  { key: 'expected_edge', label: 'Expected edge' },
  { key: 'regime_robustness', label: 'Regime robustness' },
  { key: 'backtestability', label: 'Backtestability' },
  { key: 'novelty', label: 'Novelty' },
] as const;

export type FactorKey = (typeof FACTOR_KEYS)[number]['key'];

/** The six-factor scores as parsed off the wire — a key is present only when
 *  the engine sent a finite number for it, so older unscored rows are `{}`. */
export type FactorScores = Partial<Record<FactorKey, number>>;

export interface ResearchFinding {
  id: number;
  paper_id: string;
  source: string;
  title: string;
  authors: string | null;
  abstract: string | null;
  hypothesis: string | null;
  technique: string | null;
  asset_classes: string[];
  score: number;
  model: string;
  status: string;
  composite: number;
  band: string;
  confidence: string;
  factors: FactorScores;
  categories: string[];
  primary_category: string | null;
  published_at: string | null;
  url: string | null;
  doi: string | null;
  pdf_url: string | null;
  citation_count: number | null;
  strategy_path: string | null;
}

export interface ResearchFeed {
  findings: ResearchFinding[];
  last_scan: string | null;
}

export interface ResearchInterests {
  categories: string[];
  keywords: string[];
}

export interface ScanResult {
  fetched: number;
  stored: number;
  deduped?: number;
  llm_refined?: number;
}

export interface ScanStatus {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  result: ScanResult | null;
  error: string | null;
  last_scan: string | null;
}

export function normalizeFinding(raw: Record<string, unknown>): ResearchFinding {
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    factors: parseFactors(raw.factors),
    id: num(raw.id, 0),
    paper_id: str(raw.paper_id) ?? '',
    source: str(raw.source) ?? 'arxiv',
    title: str(raw.title) ?? '(untitled)',
    authors: str(raw.authors),
    abstract: str(raw.abstract),
    hypothesis: str(raw.hypothesis),
    technique: str(raw.technique),
    asset_classes: list(raw.asset_classes),
    score: num(raw.score, 0),
    model: str(raw.model) ?? 'heuristic',
    status: str(raw.status) ?? 'surfaced',
    composite: num(raw.composite, 0),
    band: str(raw.band) ?? 'archive',
    confidence: str(raw.confidence) ?? 'low',
    categories: list(raw.categories),
    primary_category: str(raw.primary_category),
    published_at: str(raw.published_at),
    url: str(raw.url),
    doi: str(raw.doi),
    pdf_url: str(raw.pdf_url),
    citation_count:
      typeof raw.citation_count === 'number' ? raw.citation_count : null,
    strategy_path: str(raw.strategy_path),
  };
}

/**
 * Whitelist the six numeric factor keys off a raw `factors` payload, dropping
 * the `data_note` string (and anything non-finite). Never client-invents a
 * score: a key is present only when the engine sent a real number for it, so
 * an unscored legacy row (`factors: {}` or absent) parses to `{}` and renders
 * with no bars.
 */
function parseFactors(v: unknown): FactorScores {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const src = v as Record<string, unknown>;
  const out: FactorScores = {};
  for (const { key } of FACTOR_KEYS) {
    const n = src[key];
    if (typeof n === 'number' && Number.isFinite(n)) out[key] = n;
  }
  return out;
}

/** The present factors in weighted order, ready to render as bars. Empty when
 *  the row carries no numeric factors, so the caller draws nothing (no gap). */
export function factorBars(
  factors: FactorScores
): Array<{ key: FactorKey; label: string; value: number }> {
  return FACTOR_KEYS.flatMap(({ key, label }) => {
    const value = factors[key];
    return typeof value === 'number' ? [{ key, label, value }] : [];
  });
}

/** Who produced the score — never let a keyword match read as judgment. */
export function scoreOrigin(model: string): 'heuristic' | 'agent' | 'llm' {
  if (model === 'heuristic') return 'heuristic';
  if (model.startsWith('agent')) return 'agent';
  return 'llm';
}

/** Display form of the score origin, for labeling the factor breakdown. */
export function scoreOriginLabel(model: string): string {
  const origin = scoreOrigin(model);
  return origin === 'llm' ? 'LLM' : origin === 'agent' ? 'Agent' : 'Heuristic';
}

export function sourceLabel(source: string): string {
  if (source === 'arxiv') return 'arXiv';
  if (source === 's2') return 'Semantic Scholar';
  return source;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Short "Jun 07, 14:30 UTC" stamp, matching the engine's own label. */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${p(d.getUTCDate())}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** Date-only variant for a paper's publication stamp. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * One honest line for the scan strip. Empty string when nothing has
 * been triggered this session (last_scan carries the ambient state).
 */
export function scanSummaryText(status: ScanStatus | null): string {
  if (!status) return '';
  if (status.running) return 'Scanning…';
  if (status.error) return `Scan failed — ${status.error}`;
  const r = status.result;
  if (!r) return '';
  if (!r.fetched) return 'Scan complete — no new papers for your interests.';
  const deduped = r.deduped ? `, ${r.deduped} duplicates collapsed` : '';
  return `Scan complete — ${r.fetched} papers fetched${deduped}, ${r.stored} findings stored.`;
}

/**
 * Whether the Auracle Agent has an LLM key/model connected, as reported by
 * the host's optional key-state lane. `unknown` covers both an older host
 * that predates the lane and a lane that failed to answer — in either case
 * the pack must not block, so `unknown` is treated like `present`.
 */
export type KeyPresence = 'present' | 'absent' | 'unknown';

/**
 * The card's primary affordance — "Transmog": hand the finding to the
 * agent with the full strategy-development harness. Derived honestly from
 * the finding's state, the agent sign-in, and whether the agent has a model
 * connected, so the render can't show a control whose action doesn't exist:
 *  - drafted/backtested with a recorded link -> open the built strategy
 *  - drafted without a link (legacy rows)    -> nothing to open, no lie
 *  - surfaced/watchlist, signed out          -> transmog (disabled + reason —
 *    the hand-off runs on the user's account)
 *  - surfaced/watchlist, signed in, no key   -> a connect-a-key gate instead
 *    of a button that would hand off to an agent with no model to build with
 *  - surfaced/watchlist, signed in, key or unknown -> transmog
 */
export type TransmogAction =
  | { kind: 'transmog'; disabled: false; reason: null }
  | { kind: 'transmog'; disabled: true; reason: string }
  | { kind: 'gate'; reason: string }
  | { kind: 'open'; path: string }
  | { kind: 'none' };

export const TRANSMOG_SIGNED_OUT_REASON =
  'Sign in to transmog — the agent builds on your account.';

export const TRANSMOG_NO_KEY_REASON =
  'Connect a model for the Auracle Agent to transmog — it needs an LLM to build the strategy.';

export function transmogAction(
  finding: Pick<ResearchFinding, 'status' | 'strategy_path'>,
  signedIn: boolean,
  keyPresence: KeyPresence = 'unknown'
): TransmogAction {
  if (finding.status === 'drafted' || finding.status === 'backtested') {
    return finding.strategy_path
      ? { kind: 'open', path: `strategies/${finding.strategy_path}` }
      : { kind: 'none' };
  }
  if (finding.status !== 'surfaced' && finding.status !== 'watchlist') {
    return { kind: 'none' };
  }
  // Sign-in gate first, untouched: the hand-off runs on the user's account,
  // so nothing can transmog while signed out regardless of the key state.
  if (!signedIn) {
    return { kind: 'transmog', disabled: true, reason: TRANSMOG_SIGNED_OUT_REASON };
  }
  // Only an affirmative "no key" gates; `unknown` (older host or a lane that
  // failed to answer) degrades to the normal control rather than blocking.
  if (keyPresence === 'absent') {
    return { kind: 'gate', reason: TRANSMOG_NO_KEY_REASON };
  }
  return { kind: 'transmog', disabled: false, reason: null };
}

/**
 * The exact plugin command the Transmog hand-off prefills — id only. The
 * large strategy-development harness lives in the command's own .md
 * (rides the plugin injection), not in this prompt string.
 */
export function transmogPrompt(findingId: number): string {
  return `/auracle:transmog ${findingId}`;
}

/** The deep-rank hand-off command (whole-feed action, no arguments). */
export const DEEP_RANK_PROMPT = '/auracle:deep-rank';

export const DEEP_RANK_SIGNED_OUT_REASON =
  'Sign in to deep-rank — the agent works on your account.';

/**
 * Why the feed failed to load, from the HTTP status the transport kept.
 * 404/405 mean this engine build predates the research surface — a fix
 * the user can actually apply (update the stack) — while a dead socket
 * (status 0) means nothing answered at all. Conflating them sent users
 * chasing network trouble when the engine was simply old.
 */
export type LoadFailure = 'outdated' | 'unreachable';

export function classifyLoadFailure(status: number): LoadFailure {
  return status === 404 || status === 405 ? 'outdated' : 'unreachable';
}

/** Ambient context: a compact view of the research feed the user is browsing. */
export function researchContext(feed: ResearchFeed): Record<string, unknown> {
  return {
    panel: 'research',
    last_scan: feed.last_scan,
    count: feed.findings.length,
    top: feed.findings.slice(0, 8).map((f) => ({
      id: f.id,
      title: f.title,
      composite: f.composite,
      band: f.band,
      technique: f.technique,
      asset_classes: f.asset_classes,
      status: f.status,
    })),
  };
}

/** One honest line for a scan-start rejection, keyed off the status. */
export function scanStartError(status: number): string {
  if (status === 404 || status === 405) {
    return 'This engine build has no research scanning — update the Auracle stack, then retry.';
  }
  if (status === 0) return 'The engine did not respond, so the scan never started.';
  return `The engine refused the scan (HTTP ${status}).`;
}
