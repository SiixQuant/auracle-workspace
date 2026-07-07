/**
 * Research panel view model — types + pure helpers over the engine's
 * /ui/api/research/* surface.
 *
 * Honesty rules carried from the rest of the pack: scores and ordering
 * come from the engine untouched (no client re-ranking), the score's
 * origin is always labeled, and scan outcomes distinguish "found
 * nothing" from "broke" — the server's words, not invented ones.
 */

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

/** Who produced the score — never let a keyword match read as judgment. */
export function scoreOrigin(model: string): 'heuristic' | 'agent' | 'llm' {
  if (model === 'heuristic') return 'heuristic';
  if (model.startsWith('agent')) return 'agent';
  return 'llm';
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

/** Comma/newline field -> clean term list (mirrors the engine's parser). */
export function splitTerms(raw: string): string[] {
  const out: string[] = [];
  for (const chunk of raw.replace(/\n/g, ',').split(',')) {
    const t = chunk.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 40);
}


/**
 * The card's draft affordance, derived honestly from the finding's state
 * and the agent sign-in. Discriminated so the render can't show a control
 * whose action doesn't exist:
 *  - drafted/backtested with a recorded link -> open the file
 *  - drafted without a link (legacy rows)    -> nothing to open, no lie
 *  - surfaced/watchlist                      -> draft (disabled + reason
 *    while signed out — the hand-off runs on the user's account)
 */
export type DraftAction =
  | { kind: 'draft'; disabled: false; reason: null }
  | { kind: 'draft'; disabled: true; reason: string }
  | { kind: 'open'; path: string }
  | { kind: 'none' };

export const DRAFT_SIGNED_OUT_REASON =
  'Sign in to draft — the agent works on your account.';

export function draftAction(
  finding: Pick<ResearchFinding, 'status' | 'strategy_path'>,
  signedIn: boolean
): DraftAction {
  if (finding.status === 'drafted' || finding.status === 'backtested') {
    return finding.strategy_path
      ? { kind: 'open', path: `strategies/${finding.strategy_path}` }
      : { kind: 'none' };
  }
  if (finding.status !== 'surfaced' && finding.status !== 'watchlist') {
    return { kind: 'none' };
  }
  if (!signedIn) {
    return { kind: 'draft', disabled: true, reason: DRAFT_SIGNED_OUT_REASON };
  }
  return { kind: 'draft', disabled: false, reason: null };
}

/** The exact plugin command the hand-off prefills — id only, no prose. */
export function draftPrompt(findingId: number): string {
  return `/auracle:draft-strategy ${findingId}`;
}
