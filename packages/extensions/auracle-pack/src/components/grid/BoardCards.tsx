/**
 * The Board's materialized cards — strategy, test, deploy — and the metrics
 * peek that opens on one.
 *
 * These are the cards nobody places. They appear because a strategy file was
 * discovered, a backtest finished, or something is deployed
 * (`engine/boardMaterialize` decides that; this file only draws it), so every
 * one of them is a statement that an artifact EXISTS. That is why they are
 * drawn in the plan's card language rather than a language of their own: a
 * person reading either face is reading the same platform, and a title, a
 * one-line state note and a health dot already mean something specific here.
 *
 * ## The peek is where the numbers are, and only the numbers that are real
 * Resting on a strategy or a test card lifts the same {@link RoomPeek}-shaped
 * card the plan uses — floated through a portal, `pointer-events: none`, hover
 * only, `aria-hidden` — carrying the run's equity curve, its four headline
 * figures, the overfit check's standing, and the PROVENANCE BADGE. Everything
 * it says is also on the card's own `aria-label`, so a keyboard or touch
 * session is told the same facts without a hover it will never perform, and a
 * screen reader is not read them twice.
 *
 * A deploy card has no peek. Its numbers live in the Plan's Deployments room,
 * which stays the operational home — the card links across rather than
 * reproducing a console next to a canvas.
 *
 * ## Where a press goes
 * A strategy or test card opens the full Backtest room on ITS run: the room
 * that already exists, through the routing lane every other hand-off uses
 * ({@link openRoomFocused}), so the Board adds no second way into a page. A
 * deploy card opens the Deployments room on its deployment. Nothing on a
 * materialized card is editable — these cards report, and the artifact's own
 * page is where it is worked on.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { FloatingPortal, flip, offset, shift, useFloating } from '@floating-ui/react';
import { moduleOf } from '../../engine/backtest';
import { backtestStore, type BacktestSnapshot } from '../../engine/backtestStore';
import type { BoardGraph, BoardNode } from '../../engine/boardGraph';
import { BACKTEST_REF, startBoardMaterialization } from '../../engine/boardMaterialize';
import {
  peekMetrics,
  provenanceBadge,
  sparklinePath,
  validationReading,
  type ProvenanceBadge,
} from '../../engine/boardMetrics';
import { boardRuns, runFor, type BoardRun } from '../../engine/boardRuns';
import { engineFeeds, type Health } from '../../engine/gridVitals';
import { statDecimal } from '../../engine/houseStats';
import { DEPLOY_FAILED_STATE, isActive, stateLabel, type Deployment } from '../../engine/live';
import { tint, tone } from '../panelkit';
import { LABEL_BAND, RANK_LABEL } from './boardLayout';
import { HEALTH_COLOR, HEALTH_WORD } from './districts';
import { openRoomFocused, subscribeGrid, zoomOriginFrom } from './gridNav';
import { GRID_ACCENT } from './gridTheme';
import { TREE_MIN_WIDTH } from './gridWires';

const STYLE_ID = 'auracle-board-card-styles';

/** The kinds this file draws. The two a person places are drawn beside it. */
const MATERIALIZED = new Set(['strategy', 'test', 'deploy']);

/** Material Symbols ligature per kind, in the plan's icon vocabulary. */
const CARD_ICONS: Record<string, string> = {
  strategy: 'description',
  test: 'query_stats',
  deploy: 'rocket_launch',
};

/** What each card calls itself when its artifact has no name of its own. */
const CARD_KIND_WORD: Record<string, string> = {
  strategy: 'Strategy',
  test: 'Backtest',
  deploy: 'Deployment',
};

/** The peek's box, and the geometry its curve is built for. */
const PEEK_WIDTH = 244;
const SPARK_WIDTH = 220;
const SPARK_HEIGHT = 40;

/** One column of the materialized block on the plane. Narrower than a card in
 *  the ranks, because these carry a name and one line and nothing else. */
const MATERIALIZED_COLUMN = 232;

/** Where a third column earns its place: a pane wide enough that two would
 *  leave the block reading as a stripe again. */
const WIDE_BOARD_WIDTH = 1400;

/** Matches the plan's rest-before-it-answers pause exactly. */
export const BOARD_PEEK_DELAY_MS = 230;

/** The label band, matched to the plane's {@link LABEL_BAND} so the three
 *  section headings sit on one line across the whole board. */
const SHEET = `
.abrd__group { display: flex; flex-direction: column; min-width: 0; margin-top: 12px; }
.abrd__label { display: flex; align-items: flex-end; height: ${LABEL_BAND}px; margin: 0; padding-bottom: 7px; font-size: 9.5px; font-weight: 600; line-height: 1; letter-spacing: 0.09em; text-transform: uppercase; color: ${tone.text3}; }
.abrd__cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin: 0; padding: 0; list-style: none; }
.abrd__slot { display: flex; min-width: 0; }
/* Same material as a card on the plane: one step of surface off the ground and
   a top edge a shade brighter, so both layers read as one board. */
.abrd__card { appearance: none; flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; text-align: left; font: inherit; cursor: pointer; padding: 11px 13px; border-radius: 7px; border: 1px solid ${tone.border}; border-top-color: ${tone.borderStrong}; background: ${tone.surface2}; transition: border-color 150ms ease-out, background-color 150ms ease-out; }
.abrd__card[data-health='degraded'] { border-color: ${tint(tone.caution, 45)}; }
.abrd__card[data-health='fault'] { border-color: ${tint(tone.danger, 55)}; }
/* Neutral: a hover is where the pointer is, not where the eye should go. The
   accent is spent on the focus ring alone here — these cards have no open
   state of their own, because nothing on one is editable. */
.abrd__card:hover { background: ${tone.surface3}; border-color: ${tone.borderStrong}; }
.abrd__card:focus-visible { outline: 2px solid ${GRID_ACCENT}; outline-offset: 1px; }
.abrd__top { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.abrd__ico { font-size: 14px; line-height: 1; flex: none; margin-top: 3px; color: ${tone.text3}; }
.abrd__card[data-health='degraded'] .abrd__ico { color: ${tone.caution}; }
.abrd__card[data-health='fault'] .abrd__ico { color: ${tone.danger}; }
/* A discovered symbol can be sixty characters of unbroken CamelCase, which is
   why this clamps to two lines and breaks anywhere rather than trusting a word
   boundary that is not there. The whole name stays on the title attribute. */
.abrd__title { flex: 1; min-width: 0; font-size: 14px; font-weight: 500; line-height: 1.3; color: ${tone.text}; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.abrd__dot { flex: none; margin-top: 5px; width: 6px; height: 6px; border-radius: 50%; }
.abrd__note { width: 0; min-width: 100%; font-size: 11px; font-weight: 400; color: ${tone.text3}; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.abrd__card[data-health='fault'] .abrd__note { color: ${tone.danger}; }

@container auracle-grid (min-width: 640px) {
  .abrd__cards { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
}

@container auracle-grid (min-width: ${TREE_MIN_WIDTH}px) {
  /* On the plane the group is the pipeline's LAST column, so it sits at the
     top of its own band and its label lines up with the ranks' captions.
     A fixed pitch, not \`auto-fit\`: the layer above lays out at max-content, and
     an auto-fit track in a shrink-to-fit box collapses to a single column —
     which is exactly the tall stripe this block is meant not to be. */
  .abrd__group { margin-top: 0; }
  .abrd__cards { grid-template-columns: repeat(2, ${MATERIALIZED_COLUMN}px); gap: 12px; }
}

@container auracle-grid (min-width: ${WIDE_BOARD_WIDTH}px) {
  .abrd__cards { grid-template-columns: repeat(3, ${MATERIALIZED_COLUMN}px); }
}

@media (prefers-reduced-motion: reduce) {
  .abrd__card { transition: none; }
}
`;

function ensureBoardCardStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/* ── reading a card (pure) ───────────────────────────────────────────── */

/** The trailing symbol of a dotted id — what a strategy card is called. */
function symbolOf(id: string): string {
  return id.split('.').pop() || id;
}

/**
 * How a deployment's lifecycle state reads as a dot.
 *
 * The same three-way reading the plan's deployments room makes, so one
 * deployment cannot be red on one face and grey on the other: errored is a
 * FAULT, anything the engine counts as active is nominal, and everything else
 * (stopped, archived, a draft that never went out) is DEGRADED — not broken,
 * but not doing the thing it was deployed to do.
 */
export function deployHealth(state: string): Health {
  if (state === DEPLOY_FAILED_STATE) return 'fault';
  return isActive(state) ? 'nominal' : 'degraded';
}

/** The deployment a deploy card points at, or undefined when the feed has not
 *  answered or no longer lists it. */
function deploymentFor(node: BoardNode, rows: Deployment[] | null): Deployment | undefined {
  if (!rows || !node.ref) return undefined;
  return rows.find((row) => String(row.id) === node.ref?.id);
}

/**
 * The backtest job a card's peek is about: a test card's own run, or the most
 * recent run wired downstream of a strategy card.
 *
 * "Most recent" is the LAST such card on the graph, because materialization
 * appends: a strategy's newest test is the newest node, and a strategy card
 * therefore quotes the run a person just did rather than the one they did
 * first. Undefined when there is no run to quote, which the peek says plainly
 * instead of showing an empty frame of figures.
 */
export function runIdForNode(graph: BoardGraph, node: BoardNode): string | undefined {
  if (node.kind === 'test') return node.ref?.kind === BACKTEST_REF ? node.ref.id : undefined;
  if (node.kind !== 'strategy') return undefined;
  const downstream = graph.edges.filter((edge) => edge.from === node.id).map((edge) => edge.to);
  let latest: string | undefined;
  for (const id of downstream) {
    const child = graph.nodes.find((candidate) => candidate.id === id);
    if (child?.kind === 'test' && child.ref?.kind === BACKTEST_REF) latest = child.ref.id;
  }
  return latest;
}

/** How many runs a strategy card has produced, for its one-line note. */
function runCount(graph: BoardGraph, node: BoardNode): number {
  return graph.edges.filter((edge) => {
    if (edge.from !== node.id) return false;
    const child = graph.nodes.find((candidate) => candidate.id === edge.to);
    return child?.kind === 'test';
  }).length;
}

/**
 * A card's one-line state note, or null when nothing is known — a card whose
 * feed has not answered says nothing rather than showing a placeholder that
 * would read as a reading. Same rule the plan's room cards follow.
 */
export function cardNote(
  node: BoardNode,
  graph: BoardGraph,
  run: BoardRun,
  deployment: Deployment | undefined,
  deploymentsAnswered: boolean
): string | null {
  if (node.kind === 'deploy') {
    if (deployment) return `${stateLabel(deployment.state)} · ${deployment.mode}`;
    return deploymentsAnswered ? 'no longer in the deployment feed' : null;
  }
  if (node.kind === 'test') {
    if (run.phase === 'ready') return `Sharpe ${statDecimal(run.result.stats?.sharpe)}`;
    if (run.phase === 'missing') return 'no figures on this engine';
    return 'result recorded';
  }
  if (node.kind === 'strategy') {
    const runs = runCount(graph, node);
    if (runs === 0) return 'no run yet';
    return runs === 1 ? '1 run on the board' : `${runs} runs on the board`;
  }
  return null;
}

/* ── the peek ────────────────────────────────────────────────────────── */

/** Touch and pen — the plan's own reading of an absent `matchMedia`. */
function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

interface PeekAnchor {
  nodeId: string;
  el: HTMLElement;
}

function BadgePill({ badge }: { badge: ProvenanceBadge }): JSX.Element {
  const certified = badge.kind === 'certified';
  return (
    <span
      data-testid="board-peek-badge"
      data-provenance={badge.kind}
      style={{
        alignSelf: 'flex-start',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.02em',
        padding: '2px 7px',
        borderRadius: 999,
        border: `1px solid ${certified ? tint(GRID_ACCENT, 60) : tone.border}`,
        color: certified ? GRID_ACCENT : tone.text3,
        background: certified ? tint(GRID_ACCENT, 12) : 'transparent',
      }}
    >
      {badge.label}
    </span>
  );
}

/** The equity curve, or nothing at all when there are not two real points. */
function Sparkline({ points }: { points: readonly number[] }): JSX.Element | null {
  const path = sparklinePath(points, SPARK_WIDTH, SPARK_HEIGHT);
  if (path === null) return null;
  return (
    <svg
      data-testid="board-peek-spark"
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      aria-hidden
      style={{ display: 'block', overflow: 'visible' }}
    >
      <path d={path} fill="none" stroke={GRID_ACCENT} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/** The peek body for one card, once its run is known. */
function PeekBody({
  title,
  jobId,
  run,
  session,
}: {
  title: string;
  /** The backtest job this card is about — empty when it has none yet. */
  jobId: string;
  run: BoardRun;
  session: BacktestSnapshot;
}): JSX.Element {
  if (run.phase !== 'ready') {
    return (
      <>
        <span data-testid="board-peek-title" style={{ fontSize: 12.5, fontWeight: 600 }}>
          {title}
        </span>
        <span data-testid="board-peek-empty" style={{ fontSize: 11.5, color: tone.text3 }}>
          {run.phase === 'missing'
            ? 'This engine has no figures for that run.'
            : 'No completed run to show yet.'}
        </span>
      </>
    );
  }

  const result = run.result;
  const badge = provenanceBadge(result.source);
  const metrics = peekMetrics(result);
  // The overfit check belongs to the run the SESSION checked. Asked about THIS
  // card's job, it answers "not checked" for every other one rather than
  // lending a verdict to a run that never had it.
  const checked = validationReading(jobId, session);

  return (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          data-testid="board-peek-title"
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
      </span>
      <BadgePill badge={badge} />
      <Sparkline points={result.equity} />
      <span
        data-testid="board-peek-metrics"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '4px 10px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {metrics.map((metric) => (
          <span key={metric.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ fontSize: 10.5, color: tone.text3 }}>{metric.label}</span>
            <span data-testid={`board-peek-${metric.label.toLowerCase().replace(/\s+/g, '-')}`} style={{ fontSize: 11.5, color: tone.text }}>
              {metric.value}
            </span>
          </span>
        ))}
      </span>
      <span
        data-testid="board-peek-validation"
        data-state={checked.state}
        style={{ fontSize: 11, color: tone.text3 }}
      >
        {`Overfit check: ${checked.label}`}
      </span>
      <span data-testid="board-peek-note" style={{ fontSize: 10.5, color: tone.text3 }}>
        {badge.note}
      </span>
    </>
  );
}

/* ── the list ────────────────────────────────────────────────────────── */

/** One materialized card. */
function BoardCard({
  node,
  graph,
  run,
  deployment,
  deploymentsAnswered,
  onEnter,
  onLeave,
}: {
  node: BoardNode;
  graph: BoardGraph;
  run: BoardRun;
  deployment: Deployment | undefined;
  deploymentsAnswered: boolean;
  onEnter: (event: ReactMouseEvent<HTMLElement>) => void;
  onLeave: () => void;
}): JSX.Element {
  const health: Health = node.kind === 'deploy' ? deployHealth(deployment?.state ?? '') : 'nominal';
  // A deploy card whose feed has not answered claims nothing: grey, no note.
  const dot: Health = node.kind === 'deploy' && !deployment ? (deploymentsAnswered ? health : 'nominal') : health;
  const title = node.label || (node.ref ? symbolOf(node.ref.id) : CARD_KIND_WORD[node.kind]);
  const note = cardNote(node, graph, run, deployment, deploymentsAnswered);
  const figures =
    run.phase === 'ready'
      ? peekMetrics(run.result)
          .map((metric) => `${metric.label} ${metric.value}`)
          .join(', ')
      : null;
  // Everything the peek would say, on the control itself — the peek is
  // hover-only and aria-hidden, so this is the accessible copy of it.
  const label = [
    `${CARD_KIND_WORD[node.kind] ?? node.kind}: ${title}`,
    note ? `${HEALTH_WORD[dot]}, ${note}` : HEALTH_WORD[dot],
    figures,
    run.phase === 'ready' ? provenanceBadge(run.result.source).label : null,
  ]
    .filter(Boolean)
    .join(' — ');

  return (
    <li className="abrd__slot">
      <button
        type="button"
        className="apk-card abrd__card"
        data-testid={`board-card-${node.id}`}
        data-kind={node.kind}
        data-health={dot}
        aria-label={label}
        onClick={(event) => openCard(node, graph, zoomOriginFrom(event.currentTarget))}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        <span className="abrd__top">
          <span className="material-symbols-outlined abrd__ico" aria-hidden>
            {CARD_ICONS[node.kind] ?? 'auto_awesome'}
          </span>
          {/* Clamped to two lines on the card; whole on the pointer, and whole
              again on the button's own aria-label above. */}
          <span className="abrd__title" title={title}>
            {title}
          </span>
          <span
            aria-hidden
            className="abrd__dot"
            data-testid={`board-dot-${node.id}`}
            data-health={dot}
            style={{ background: HEALTH_COLOR[dot] }}
          />
        </span>
        {note ? (
          <span className="abrd__note" data-testid={`board-note-${node.id}`}>
            {note}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/**
 * Where a card's press lands: the room that already owns the artifact, focused
 * on it. A strategy card carries its own file identity across as well, so the
 * page it opens knows which strategy the run belongs to.
 */
export function openCard(node: BoardNode, graph: BoardGraph, origin?: string | null): void {
  if (node.kind === 'deploy') {
    openRoomFocused(
      'deploys',
      node.ref ? { run: { kind: 'deployment', id: node.ref.id } } : undefined,
      origin
    );
    return;
  }
  const jobId = runIdForNode(graph, node);
  const strategy =
    node.kind === 'strategy' && node.ref
      ? { filePath: moduleOf(node.ref.id), dottedPath: node.ref.id }
      : undefined;
  const hint = {
    ...(strategy ? { strategy } : {}),
    ...(jobId ? { run: { kind: 'backtest' as const, id: jobId } } : {}),
  };
  openRoomFocused('backtest', Object.keys(hint).length > 0 ? hint : undefined, origin);
}

/**
 * Arm materialization for as long as the Board is on screen.
 *
 * Mounted with the Board rather than with the panel: subscribing is what starts
 * the shared engine lanes, so a Board nobody is looking at costs nothing, and
 * an artifact that appeared while the plan was showing materializes on the next
 * poll after the Board comes back.
 */
export function useBoardMaterialization(): void {
  useEffect(() => startBoardMaterialization(), []);
}

/**
 * Every materialized card on the Board, plus the peek one of them can raise.
 *
 * Renders nothing for the kinds a person places — those are drawn by their own
 * layer, and both draw into the same board.
 */
export function BoardCardList({ graph }: { graph: BoardGraph }): JSX.Element | null {
  ensureBoardCardStyles();
  useBoardMaterialization();
  const feeds = useSyncExternalStore(
    engineFeeds.subscribe,
    engineFeeds.getSnapshot,
    engineFeeds.getSnapshot
  );
  const session = useSyncExternalStore(
    backtestStore.subscribe,
    backtestStore.getSnapshot,
    backtestStore.getSnapshot
  );
  const cache = useSyncExternalStore(
    boardRuns.subscribe,
    boardRuns.getSnapshot,
    boardRuns.getSnapshot
  );
  const [anchor, setAnchor] = useState<PeekAnchor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setAnchor((current) => (current === null ? current : null));
  }, []);

  // A peek belongs to the pointer that raised it: a room opening under it, the
  // board scrolling beneath it, and unmount all end it.
  useEffect(() => {
    const onScroll = (): void => clear();
    window.addEventListener('scroll', onScroll, true);
    const stopNav = subscribeGrid(clear);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      stopNav();
      clear();
    };
  }, [clear]);

  const { refs, floatingStyles } = useFloating({
    open: anchor !== null,
    elements: { reference: anchor?.el ?? null },
    placement: 'bottom-start',
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
  });

  const cards = graph.nodes.filter((node) => MATERIALIZED.has(node.kind));
  if (cards.length === 0) return null;

  const runOf = (node: BoardNode): BoardRun => {
    const jobId = runIdForNode(graph, node);
    return jobId ? runFor(jobId, session, cache) : { phase: 'idle' };
  };

  const anchored = anchor ? cards.find((node) => node.id === anchor.nodeId) : undefined;

  return (
    <>
      {/* The pipeline's last column, captioned like the ranks before it: the
          board reads sources, questions, and then what came of them. */}
      <section className="abrd__group" data-testid="board-materialized">
        <h3 className="abrd__label" data-testid="board-section-materialized">
          {RANK_LABEL[2]}
        </h3>
        <ul className="abrd__cards" data-testid="board-cards">
          {cards.map((node) => (
          <BoardCard
            key={node.id}
            node={node}
            graph={graph}
            run={runOf(node)}
            deployment={deploymentFor(node, feeds.deployments)}
            deploymentsAnswered={feeds.deployments !== null}
            onEnter={(event) => {
              // A deploy card's figures live in the room it links to, so it
              // raises no peek — and asks for no result it would not draw.
              if (node.kind === 'deploy' || isCoarsePointer()) return;
              const el = event.currentTarget;
              const jobId = runIdForNode(graph, node);
              if (jobId) void boardRuns.load(jobId);
              if (timer.current !== null) clearTimeout(timer.current);
              timer.current = setTimeout(() => {
                timer.current = null;
                setAnchor({ nodeId: node.id, el });
              }, BOARD_PEEK_DELAY_MS);
            }}
            onLeave={clear}
          />
          ))}
        </ul>
      </section>
      {anchored ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className="apk-enter"
            data-testid="board-peek"
            data-node={anchored.id}
            data-kind={anchored.kind}
            aria-hidden
            style={{
              ...floatingStyles,
              // The one rule that makes this safe rather than clever: it can
              // never keep itself alive or swallow the press underneath it.
              pointerEvents: 'none',
              zIndex: 50,
              width: PEEK_WIDTH,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${tone.borderStrong}`,
              background: tone.surface2,
              boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
              color: tone.text,
              font: `13px/1.5 ${tone.font}`,
            }}
          >
            <PeekBody
              title={anchored.label || (anchored.ref ? symbolOf(anchored.ref.id) : 'Run')}
              jobId={runIdForNode(graph, anchored) ?? ''}
              run={runOf(anchored)}
              session={session}
            />
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
