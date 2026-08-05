/**
 * Human-readable renderings of the engine's raw wire vocabulary.
 *
 * The engine speaks in codes: ops-journal action slugs (rearm_schedule),
 * dotted module paths (strategies.desk.resga_v2), pipeline-prefixed strategy
 * slugs (forge-resga), broker ids (ibkr). Those are exact and belong on the
 * wire and in anything the agent must act on, but they read as jargon the
 * moment they reach a person. This is the ONE place that turns them into a
 * phrase, so every panel humanizes a code the same way and no surface invents
 * its own vocabulary.
 *
 * It never HIDES information: an unknown action still renders (titleized rather
 * than dropped), a prettified slug keeps its recognisable stem, and callers are
 * free to keep the raw value in a tooltip. The rule is readability, not
 * concealment.
 */

/**
 * The maintenance actions the ops journal actually records today.
 *
 * The journal's sole writer is journal.record(), whose sole caller is
 * repair.apply_operation() (engine auracle/ops/repair.py), and that accepts
 * exactly these three action codes. Phrased in the PAST tense because the
 * ledger is a record of what WAS done, mirroring the engine's own present-tense
 * ACTION_LABELS ('restart the data feed' becomes 'Restarted the data feed').
 *
 * run_backtest is a real engine operation named in the tearsheet PRD's example
 * set; it is not journaled yet, but mapping it now means it reads right the day
 * it lands. Everything else falls through to the titleized default.
 */
const ACTION_VERBS: Record<string, string> = {
  restart_data_feed: 'Restarted the data feed',
  redeploy_deployment: 'Redeployed a deployment',
  rearm_schedule: 'Re-armed a schedule',
  run_backtest: 'Ran a backtest',
};

/** Broker/execution-connector ids to the display labels the rest of the
 *  product uses (each broker adapter's display_label field, engine
 *  auracle/brokers/<name>/adapter.py). An id not listed is titleized rather
 *  than shown raw, so a broker added engine-side still reads as words. */
const BROKER_LABELS: Record<string, string> = {
  ibkr: 'Interactive Brokers',
  ibkr_cp: 'Interactive Brokers (Web Portal)',
  alpaca: 'Alpaca',
  clearstreet: 'ClearStreet',
  hyperliquid: 'Hyperliquid',
  tradier: 'Tradier',
  tradovate: 'Tradovate',
  simulator: 'Paper Simulator',
};

/** Pipeline prefixes stripped before a strategy slug is shown (the retired
 *  Forge pipeline named its outputs forge-something). */
const PIPELINE_PREFIXES = ['forge-', 'forge_'];

/** Source-file extensions dropped when a path is read as a strategy name. */
const CODE_EXTENSION = /\.(py|ipynb|ts|tsx|js)$/i;

/** Any run of separators between words in a slug/code/path. */
const SEPARATORS = /[\s._-]+/;

/** Words of a slug/code, empties dropped. */
function words(raw: string): string[] {
  return raw.trim().split(SEPARATORS).filter(Boolean);
}

/** First letter upper, the rest left as-is (so an acronym the engine already
 *  emitted in caps survives a titleize). */
function capitalize(token: string): string {
  return token.length === 0 ? token : token.charAt(0).toUpperCase() + token.slice(1);
}

function stripPipelinePrefix(raw: string): string {
  const lower = raw.toLowerCase();
  for (const prefix of PIPELINE_PREFIXES) {
    if (lower.startsWith(prefix) && raw.length > prefix.length) {
      return raw.slice(prefix.length);
    }
  }
  return raw;
}

/**
 * A raw ops-journal action code as a human phrase. A known code gets its
 * curated past-tense verb; an unknown one is rendered as a sentence
 * (pause_deployment becomes 'Pause deployment') rather than left as a slug.
 * Null/blank in, null out, so a caller can drop the segment entirely.
 */
export function humanizeAction(code: string | null | undefined): string | null {
  if (!code) return null;
  const known = ACTION_VERBS[code];
  if (known) return known;
  const parts = words(code);
  if (parts.length === 0) return null;
  // Sentence case: only the first word is capitalized, matching the curated
  // phrases like 'Re-armed a schedule'.
  return [capitalize(parts[0].toLowerCase()), ...parts.slice(1).map((w) => w.toLowerCase())].join(
    ' '
  );
}

/**
 * A raw slug (a strategy slug, a schedule name, a connector id) as a readable
 * name: pipeline prefix stripped, separators to spaces, Title Cased. A purely
 * numeric target (a deployment id) is left as itself, and a blank input returns
 * null so a caller can omit the segment.
 */
export function prettifySlug(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (/^\d+$/.test(trimmed)) return trimmed; // a bare id stays itself
  const parts = words(stripPipelinePrefix(trimmed));
  if (parts.length === 0) return trimmed;
  return parts.map(capitalize).join(' ');
}

/**
 * A dotted module path (or file path) as a readable strategy name: the last
 * segment, prettified. So 'strategies.desk.resga_v2' becomes 'Resga V2',
 * 'Sandbox/breakout.py' becomes 'Breakout', 'strategies.momentum.Mom' becomes
 * 'Mom'. Blank input returns null.
 */
export function prettifyPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // filename / last path segment, then the extension off, then the last dotted
  // segment (a dotted module's tail is its name). Order matters: strip the
  // extension BEFORE splitting on dots, or 'breakout.py' would read as 'py'.
  const fileSeg = trimmed.split(/[\\/]+/).filter(Boolean).pop() ?? trimmed;
  const noExt = fileSeg.replace(CODE_EXTENSION, '');
  const nameSeg = noExt.split('.').filter(Boolean).pop() ?? noExt;
  return prettifySlug(nameSeg);
}

/**
 * A broker/execution-connector id as its display label. 'none' and blank both
 * read as 'none' (the honest 'no broker is active' state the chip already
 * showed); an unmapped id is titleized rather than shown as a raw slug.
 */
export function brokerLabel(id: string | null | undefined): string {
  const key = (id ?? '').trim().toLowerCase();
  if (key === '' || key === 'none') return 'none';
  return BROKER_LABELS[key] ?? prettifySlug(id) ?? 'none';
}

/**
 * Indicator abbreviations that must print in their canonical caps rather than
 * be Title-Cased (prettifySlug would render 'ma' as 'Ma', 'rsi' as 'Rsi'). Only
 * the tokens a SignalFact rule slug actually carries; an unlisted alphabetic
 * token stays lower-case, which is the right register inside a fact clause.
 */
const INDICATOR_TOKENS: Record<string, string> = {
  ma: 'MA',
  ema: 'EMA',
  sma: 'SMA',
  wma: 'WMA',
  dma: 'DMA',
  rsi: 'RSI',
  macd: 'MACD',
  atr: 'ATR',
  adx: 'ADX',
  roc: 'ROC',
  vwap: 'VWAP',
  obv: 'OBV',
  cci: 'CCI',
  mfi: 'MFI',
  bbands: 'Bollinger',
  bollinger: 'Bollinger',
  stoch: 'Stochastic',
};

/**
 * A SignalFact rule slug as a readable clause label, in CLAUSE register — lower
 * case except known indicator abbreviations, with numeric parameters lifted to
 * the front as an "A/B" period pair. So 'ma_cross_20_50' reads '20/50 MA cross'
 * and 'rsi_oversold' reads 'RSI oversold'. The numbers-first convention mirrors
 * the reference tearsheet's own phrasing for moving-average crosses (the primary
 * built-in rule family); a rule that reads better with its number last should
 * name it so engine-side. Blank in ⇒ null, so the composer falls back to a bare
 * 'signal'. This never HIDES a token: an unknown stem still renders, lower-cased.
 */
export function humanizeRule(rule: string | null | undefined): string | null {
  if (!rule) return null;
  const trimmed = rule.trim();
  if (trimmed.length === 0) return null;
  const nums: string[] = [];
  const alpha: string[] = [];
  for (const token of words(trimmed)) {
    if (/^\d+(?:\.\d+)?$/.test(token)) nums.push(token);
    else alpha.push(token);
  }
  const stem = alpha
    .map((token) => INDICATOR_TOKENS[token.toLowerCase()] ?? token.toLowerCase())
    .join(' ');
  const periods = nums.join('/');
  if (periods && stem) return `${periods} ${stem}`;
  return stem || periods || null;
}
