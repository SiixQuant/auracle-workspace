/**
 * A live-quote card on the Board — the pack's first streaming surface.
 *
 * It wears the same box as every other card ({@link ./BoardCard}'s `.acard`
 * geometry, so the plane and its wires route against one known size) and adds a
 * body the others do not have: a row per watched contract, each with its last
 * price, its bid/ask, and — the load-bearing part — a QUALITY BADGE.
 *
 * ## The badge is the honesty rule, drawn (I1)
 * Every badge word comes from {@link displayQuality}, which is the one place a
 * quote is allowed to be called live. A delayed quote reads "Delayed", a frozen
 * one "Frozen", and neither is ever dressed as "Live" — not by colour, not by
 * word. The green a live badge takes is a functional "ready" signal, the same
 * one the launcher's lamp defends; a caveat takes caution, absence takes muted.
 *
 * ## Being here is the subscription
 * The card holds no engine line of its own: {@link useLiveQuotes} opens the
 * stream while this is mounted and closes it when it leaves, so the watcher is
 * the card's presence and nothing has to be torn down by hand. Only the
 * contracts that actually resolve ({@link isWatchable}) are streamed; a
 * half-typed row waits in the editor rather than opening a line that cannot fill.
 */
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { BoardNode } from '../../engine/boardGraph';
import {
  contractKey,
  contractLabel,
  displayQuality,
  missingQualifiers,
  quoteReading,
  watchableContracts,
  QUALITY_WORD,
  qualityTone,
  type ContractRef,
  type Quote,
  type QuoteQuality,
} from '../../engine/liveQuotes';
import type { QuoteStreamDeps } from '../../engine/quoteStream';
import { tint, tone } from '../panelkit';
import type { PlacedCard } from './boardLayout';
import type { DropState } from './BoardCard';
import { useLiveQuotes } from './useLiveQuotes';

const STYLE_ID = 'auracle-board-quotecard-styles';

/** How many contract rows fit the card's fixed box; the rest are counted. */
const MAX_ROWS = 3;

/** A quality's hue. Live is the launcher's functional green; the caveats take
 *  caution; absence takes the quiet tier. Kept out of the sheet because it is
 *  read per row, not per card. */
const QUALITY_INK: Record<'ok' | 'caution' | 'muted', string> = {
  ok: tone.ok,
  caution: tone.caution,
  muted: tone.text3,
};

const SHEET = `
.aquote__rows { display: flex; flex-direction: column; gap: 3px; margin-top: 2px; min-width: 0; }
.aquote__empty { font-size: 11.5px; color: ${tone.text3}; }
.aquote__row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.aquote__sym { flex: 0 1 auto; min-width: 0; font-size: 11.5px; font-weight: 600; color: ${tone.text2}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aquote__last { flex: none; font-size: 12px; font-weight: 600; color: ${tone.text}; font-variant-numeric: tabular-nums; }
.aquote__ba { flex: 1 1 auto; min-width: 0; font-size: 10.5px; color: ${tone.text3}; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The badge is a lamp, not decoration: its ink is its meaning. */
.aquote__badge { flex: none; display: inline-flex; align-items: center; gap: 3px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; }
.aquote__badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.aquote__more { font-size: 10.5px; color: ${tone.text3}; }
.aquote__pending { font-size: 10.5px; color: ${tone.text3}; }
`;

export function ensureQuoteCardStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** A number as a price: FX-scale values keep four places, everything else two.
 *  Absent reads as an em dash, never as zero. */
export function formatQuoteNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const digits = Math.abs(value) !== 0 && Math.abs(value) < 10 ? 4 : 2;
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** The card's title: the name a person gave it, or the symbols it watches. */
export function quoteCardTitle(node: BoardNode): string {
  const quote = node.quote;
  const named = (quote?.name ?? '').trim();
  if (named) return named;
  const symbols = (quote?.contracts ?? [])
    .map((contract) => contract.symbol.trim().toUpperCase())
    .filter((symbol) => symbol !== '');
  return symbols.length > 0 ? symbols.join(', ') : 'Live quote';
}

export interface QuoteCardProps {
  node: BoardNode;
  card: PlacedCard;
  editing: boolean;
  drop: DropState;
  onOpen: (node: BoardNode, anchor: HTMLElement) => void;
  onWireEnd: (nodeId: string) => void;
  /** Injected in tests to drive a fake stream; omitted in production. */
  deps?: QuoteStreamDeps;
}

function QualityBadge({
  quality,
  testId,
}: {
  quality: QuoteQuality;
  testId: string;
}): JSX.Element {
  const ink = QUALITY_INK[qualityTone(quality)];
  return (
    <span
      className="aquote__badge"
      data-testid={testId}
      data-quality={quality}
      style={{ color: ink, background: tint(ink, 16) }}
    >
      {QUALITY_WORD[quality]}
    </span>
  );
}

export function QuoteCard({
  node,
  card,
  editing,
  drop,
  onOpen,
  onWireEnd,
  deps,
}: QuoteCardProps): JSX.Element {
  ensureQuoteCardStyles();
  const contracts = node.quote?.contracts ?? [];
  // Only the contracts that resolve open a line; a half-typed row waits.
  const watched = watchableContracts(contracts);
  const { quotes, status } = useLiveQuotes(watched, deps);

  const shown = contracts.slice(0, MAX_ROWS);
  const hidden = contracts.length - shown.length;

  const liveQualities: QuoteQuality[] = [];
  for (const contract of watched) {
    const quote = quotes.get(contractKey(contract));
    if (quote) liveQualities.push(displayQuality(quote));
  }
  const reading = quoteReading(status, liveQualities);

  const title = quoteCardTitle(node);
  const label = [
    `Live quote: ${title}`,
    reading.word,
    ...shown.map((contract) => rowSpeech(contract, quotes.get(contractKey(contract)) ?? null)),
    'Configure',
  ].join('. ');

  return (
    <div
      className="acard aquote"
      data-testid={`board-card-${node.id}`}
      data-node={node.id}
      data-kind="quote"
      data-health={reading.health}
      data-editing={editing ? 'true' : 'false'}
      data-drop={drop === 'none' ? undefined : drop}
      data-status={status}
      style={{ left: card.x, top: card.y }}
      onMouseUp={() => onWireEnd(node.id)}
    >
      <button
        type="button"
        className="acard__face"
        data-testid={`board-card-face-${node.id}`}
        aria-label={label}
        onClick={(event: ReactMouseEvent<HTMLButtonElement>) =>
          onOpen(node, event.currentTarget.parentElement ?? event.currentTarget)
        }
      >
        <span className="acard__top">
          <span className="material-symbols-outlined acard__ico" aria-hidden>
            monitoring
          </span>
          <span className="acard__title" data-testid={`board-card-title-${node.id}`}>
            {title}
          </span>
          <span
            className="acard__dot"
            data-testid={`board-card-dot-${node.id}`}
            data-health={reading.health}
            aria-hidden
          />
        </span>
        <div className="aquote__rows" data-testid={`quote-rows-${node.id}`}>
          {contracts.length === 0 ? (
            <span className="aquote__empty" data-testid={`quote-empty-${node.id}`}>
              No contract yet — open to add one.
            </span>
          ) : (
            shown.map((contract) => {
              const key = contractKey(contract);
              const quote = quotes.get(key) ?? null;
              const missing = missingQualifiers(contract);
              const incomplete = contract.symbol.trim() === '' || missing.length > 0;
              const quality = quote ? displayQuality(quote) : null;
              return (
                <span
                  key={key}
                  className="aquote__row"
                  data-testid={`quote-row-${node.id}-${key}`}
                  data-quality={quality ?? 'pending'}
                >
                  <span className="aquote__sym">{contractLabel(contract)}</span>
                  {incomplete ? (
                    <span className="aquote__pending">needs {missing.join(', ') || 'a symbol'}</span>
                  ) : quote ? (
                    <>
                      <span className="aquote__last" data-testid={`quote-last-${node.id}-${key}`}>
                        {formatQuoteNumber(quote.last)}
                      </span>
                      <span className="aquote__ba">
                        {formatQuoteNumber(quote.bid)} / {formatQuoteNumber(quote.ask)}
                      </span>
                      <QualityBadge quality={quality as QuoteQuality} testId={`quote-badge-${node.id}-${key}`} />
                    </>
                  ) : (
                    <span className="aquote__pending">waiting…</span>
                  )}
                </span>
              );
            })
          )}
          {hidden > 0 ? (
            <span className="aquote__more" data-testid={`quote-more-${node.id}`}>
              +{hidden} more
            </span>
          ) : null}
        </div>
      </button>
      <div className="acard__verbs">
        <span className="acard__count" data-testid={`quote-status-${node.id}`}>
          {reading.word}
        </span>
      </div>
    </div>
  );
}

/** What one row says to a screen reader — the same facts the badge shows,
 *  quality named, so a live-vs-delayed distinction is never colour-only. */
function rowSpeech(contract: ContractRef, quote: Quote | null): string {
  const name = contractLabel(contract);
  if (!quote) return `${name} waiting`;
  const quality = displayQuality(quote);
  return `${name} ${formatQuoteNumber(quote.last)} ${QUALITY_WORD[quality]}`;
}
