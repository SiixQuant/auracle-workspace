/**
 * Research panel — the front door for the engine's paper-research
 * conveyor (fullscreen pack panel, gutter icon), and the reference
 * implementation of the panelkit surface language.
 *
 * Renders the top ranked findings the scheduled scan maintains, with
 * per-finding watch/dismiss and the Transmog hand-off: "Transmog" hands
 * the finding to the /auracle:transmog agent command (prefilled,
 * review-first — nothing auto-runs), which develops a full strategy from
 * the research; the row then flips to Drafted with an open-the-file
 * affordance once the engine records the finding→strategy link.
 *
 * The corpus and its filters are internal: this is a strategy-development
 * engine, so the interests are fixed engine-side (finance + the sciences
 * that get weaponised into trading) and the panel simply shows the top 20
 * by tradability. Honesty rules: every number on a row is engine-computed
 * and arrives pre-ranked (no client re-scoring), the score's origin is
 * labeled, scan outcomes distinguish "found nothing" from "broke", an
 * engine that predates the research surface is reported as outdated (not
 * unreachable), and the Transmog control is disabled with the reason while
 * the agent is signed out.
 *
 * ## Surface: a calm hairline list (narrowed Hermes)
 * Findings are a single column separated by hairlines, not bordered cards —
 * the list reads as one ranked ledger rather than a wall of framed tiles.
 * The one reserved accent is white (brand only); factor magnitudes and status
 * keep their own quiet neutral / semantic ink. Motion is limited to the
 * existing reduced-motion-guarded `apk-enter` fade; no new keyframes.
 *
 * ## Density decisions (what earns a row)
 * - **Hypothesis** — the engine's sharpened one-line thesis stays PRIMARY and
 *   always visible; it is the whole point of the ranking.
 * - **Six-factor bars** — the engine's tradability breakdown, shown for every
 *   scored row (LLM and heuristic alike) with its origin labeled. Only the six
 *   numeric factor keys render; the payload's `data_note` string is never a
 *   bar. Rows with no numeric factors (older refined rows) draw nothing.
 * - **Abstract** — long, so it hides behind a per-row expand toggle; it only
 *   earns space when the reader asks for it (Escape, scoped to panel focus,
 *   collapses it back).
 * - **arXiv categories** — a different taxonomy from the technique + asset
 *   meta already on the row, so they do NOT get a standing row; they appear
 *   only inside the expanded abstract, where "study this paper" context makes
 *   the source taxonomy genuinely useful.
 * - **data_note** — deliberately not surfaced: it is a scoring aside, and a
 *   sentence per row would undo the calm the hairline list buys.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authState, getJsonDetailed, postJson } from '../engine/client';
import {
  DEEP_RANK_PROMPT,
  DEEP_RANK_SIGNED_OUT_REASON,
  KeyPresence,
  LoadFailure,
  ResearchFeed,
  ResearchFinding,
  ScanStatus,
  TransmogAction,
  classifyLoadFailure,
  factorBars,
  fmtDate,
  fmtWhen,
  normalizeFinding,
  researchContext,
  scanStartError,
  scanSummaryText,
  scoreOrigin,
  scoreOriginLabel,
  sourceLabel,
  transmogAction,
  transmogPrompt,
} from '../engine/research';
import {
  Button,
  CenterState,
  FactorBar,
  InlineNote,
  PanelShell,
  Pill,
  SkeletonRows,
  ToolbarSpring,
  tone,
} from './panelkit';
import { PanelHostLike, agentKeyPresence, useAiPanelContext } from './aiPanel';
import { parseEngineError, type EngineError } from '../engine/paywall';
import { UpgradeGate } from './UpgradeGate';
import { focusStore } from '../engine/focusStore';

/** The engine ranks and gates internally; the panel shows the best 20. */
const FEED_LIMIT = 20;

type LoadState =
  | { phase: 'loading' }
  | { phase: 'failed'; why: LoadFailure }
  | { phase: 'ready'; feed: ResearchFeed };

const BAND_COLOR: Record<string, string> = {
  candidate: tone.ok,
  watchlist: tone.caution,
};

/** The drafted/backtested/watchlist status pill — one honest state word. */
function StatusPill({ status }: { status: string }): JSX.Element | null {
  if (status === 'watchlist') return <Pill kind="caution" dot>Watching</Pill>;
  if (status === 'drafted') return <Pill kind="muted">Drafted</Pill>;
  if (status === 'backtested') return <Pill kind="muted">Backtested</Pill>;
  return null;
}

function FindingRow({
  finding,
  first,
  busy,
  action,
  expanded,
  onToggleExpand,
  onWatch,
  onDismiss,
  onTransmog,
  onOpen,
}: {
  finding: ResearchFinding;
  /** First row draws no divider; every later row is separated by a hairline. */
  first: boolean;
  busy: boolean;
  action: TransmogAction;
  expanded: boolean;
  onToggleExpand: () => void;
  onWatch: () => void;
  onDismiss: () => void;
  onTransmog: () => void;
  onOpen: () => void;
}) {
  const meta: JSX.Element[] = [
    <span
      key="src"
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: 0.3,
        padding: '1px 7px',
        borderRadius: 999,
        border: `1px solid ${tone.borderStrong}`,
        color: tone.text2,
        whiteSpace: 'nowrap',
      }}
    >
      {sourceLabel(finding.source)}
    </span>,
  ];
  const published = fmtDate(finding.published_at);
  if (published) meta.push(<span key="pub">{published}</span>);
  if (finding.citation_count !== null && finding.citation_count > 0) {
    meta.push(<span key="cites">{finding.citation_count} citations</span>);
  }
  if (finding.technique) meta.push(<span key="tech">{finding.technique}</span>);
  if (finding.asset_classes.length) {
    meta.push(<span key="assets">{finding.asset_classes.join(' · ')}</span>);
  }

  const bars = factorBars(finding.factors);
  const abstractId = `abstract-${finding.id}`;

  return (
    <article
      className="apk-row"
      style={{
        display: 'flex',
        gap: 16,
        padding: '14px 6px',
        borderTop: first ? 'none' : `1px solid ${tone.border}`,
        borderRadius: 6,
      }}
    >
      <div
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 46 }}
        title="Engine-computed six-factor composite (0–100)"
      >
        <span
          style={{
            fontSize: 20,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.1,
          }}
        >
          {finding.composite}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: BAND_COLOR[finding.band] ?? tone.text3,
          }}
        >
          {finding.band}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
        {finding.url ? (
          <a
            href={finding.url}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 13.5, fontWeight: 600, color: tone.text, textDecoration: 'none' }}
          >
            {finding.title}
          </a>
        ) : (
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{finding.title}</span>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            fontSize: 11.5,
            color: tone.text3,
          }}
        >
          {meta}
        </div>
        {finding.hypothesis ? (
          <p style={{ margin: 0, fontSize: 12.5, color: tone.text2, maxWidth: '75ch' }}>
            {finding.hypothesis}
          </p>
        ) : null}

        {bars.length ? (
          <div
            data-testid={`factors-${finding.id}`}
            style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2 }}
          >
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: tone.text3,
              }}
            >
              Six-factor score · {scoreOriginLabel(finding.model)}
            </span>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                gap: '4px 20px',
                maxWidth: '75ch',
              }}
            >
              {bars.map((bar) => (
                <FactorBar
                  key={bar.key}
                  label={bar.label}
                  value={bar.value}
                  testId={`factor-${finding.id}-${bar.key}`}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: tone.text3 }}>
          <span>
            scored: {scoreOrigin(finding.model)} · confidence {finding.confidence}
          </span>
          {finding.url ? (
            <a href={finding.url} target="_blank" rel="noreferrer" style={{ color: tone.text3 }}>
              Paper ↗
            </a>
          ) : null}
          {finding.pdf_url ? (
            <a href={finding.pdf_url} target="_blank" rel="noreferrer" style={{ color: tone.text3 }}>
              PDF ↗
            </a>
          ) : null}
          {finding.abstract ? (
            <button
              type="button"
              data-testid={`abstract-toggle-${finding.id}`}
              aria-expanded={expanded}
              aria-controls={abstractId}
              onClick={onToggleExpand}
              style={{
                border: 'none',
                background: 'none',
                padding: 0,
                margin: 0,
                cursor: 'pointer',
                color: tone.text3,
                font: 'inherit',
              }}
            >
              {expanded ? 'Hide abstract ▴' : 'Abstract ▾'}
            </button>
          ) : null}
        </div>

        {expanded && finding.abstract ? (
          <div
            id={abstractId}
            data-testid={abstractId}
            className="apk-enter"
            style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2, maxWidth: '75ch' }}
          >
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: tone.text2 }}>
              {finding.abstract}
            </p>
            {finding.categories.length ? (
              <div style={{ fontSize: 10.5, color: tone.text3 }}>
                arXiv: {finding.categories.join(' · ')}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
          whiteSpace: 'nowrap',
        }}
      >
        <StatusPill status={finding.status} />
        {action.kind === 'open' ? (
          <Button variant="quiet" onClick={onOpen}>
            Open strategy
          </Button>
        ) : null}
        {action.kind === 'transmog' ? (
          <Button
            variant="primary"
            busy={busy}
            disabled={action.disabled}
            testId={`transmog-${finding.id}`}
            title={
              action.disabled
                ? action.reason ?? undefined
                : 'Hand this research to the agent to develop a full strategy'
            }
            onClick={onTransmog}
          >
            ⚗ Transmog
          </Button>
        ) : null}
        {action.kind === 'gate' ? (
          // No model connected: a plain explanation in place of the button, so
          // the click is never dead and the agent is never handed work it has
          // no LLM to do. Wraps (the column is otherwise nowrap).
          <div
            role="note"
            data-testid={`transmog-gate-${finding.id}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              maxWidth: 220,
              whiteSpace: 'normal',
              textAlign: 'right',
              fontSize: 11,
              color: tone.caution,
            }}
          >
            <span style={{ fontWeight: 600 }}>Connect a model</span>
            <span style={{ color: tone.text3 }}>{action.reason}</span>
          </div>
        ) : null}
        {finding.status === 'surfaced' ? (
          <Button variant="quiet" disabled={busy} onClick={onWatch}>
            ☆ Watch
          </Button>
        ) : null}
        <Button variant="quiet" disabled={busy} onClick={onDismiss}>
          ✕ Dismiss
        </Button>
      </div>
    </article>
  );
}

export function ResearchPanel({ host }: { host?: PanelHostLike } = {}): JSX.Element {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const [scanNote, setScanNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [scanGate, setScanGate] = useState<EngineError | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [keyPresence, setKeyPresence] = useState<KeyPresence>('unknown');
  // The one row whose abstract is expanded (density: abstracts hide by default).
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const draftPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ambient: publish the current feed to the AI chat so the agent knows what
  // research the user is looking at.
  useAiPanelContext(host, load.phase === 'ready' ? researchContext(load.feed) : null);

  const refresh = useCallback(async () => {
    const result = await getJsonDetailed<Record<string, unknown>>(
      `/ui/api/research/feed?limit=${FEED_LIMIT}`
    );
    if (!result.ok) {
      setLoad({ phase: 'failed', why: classifyLoadFailure(result.status) });
      return;
    }
    const body = result.body;
    const rows = Array.isArray(body.findings) ? (body.findings as Record<string, unknown>[]) : [];
    setLoad({
      phase: 'ready',
      feed: {
        findings: rows.map(normalizeFinding),
        last_scan: typeof body.last_scan === 'string' ? body.last_scan : null,
      },
    });
    // A working feed disproves any lingering load/scan transport error.
    setScanNote((note) => (note?.kind === 'err' ? null : note));
  }, []);

  useEffect(() => {
    void refresh();
    void authState().then((auth) => setSignedIn(auth.signedIn));
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (draftPollTimer.current) clearInterval(draftPollTimer.current);
    };
  }, [refresh]);

  // Ask the host whether the agent has a model connected. Feature-detected and
  // fail-open (see agentKeyPresence): an older host or a failed call stays
  // 'unknown', which never gates the Transmog control.
  useEffect(() => {
    void agentKeyPresence(host).then(setKeyPresence);
  }, [host]);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const startPolling = useCallback(() => {
    stopPolling();
    pollTimer.current = setInterval(() => {
      void (async () => {
        const result = await getJsonDetailed<ScanStatus>('/ui/api/research/scan/status');
        if (!result.ok) return; // transient; keep polling
        setScan(result.body);
        if (!result.body.running) {
          stopPolling();
          const text = scanSummaryText(result.body);
          if (text) setScanNote({ kind: result.body.error ? 'err' : 'ok', text });
          void refresh();
        }
      })();
    }, 2000);
  }, [refresh]);

  const kickScan = async () => {
    setScanNote(null);
    setScanGate(null);
    const response = await postJson('/ui/api/research/scan');
    if (response.ok) {
      setScan({
        running: true,
        started_at: null,
        finished_at: null,
        result: null,
        error: null,
        last_scan: null,
      });
      startPolling();
      return;
    }
    if (response.status === 409) {
      setScanNote({ kind: 'ok', text: 'A scan is already running; watching it.' });
      startPolling();
      return;
    }
    // The scan drives the LLM conveyor, so a tier gate or blocked license
    // surfaces as the shared upgrade card; any other failure stays inline.
    const err = parseEngineError(response.status, response.body, scanStartError(response.status));
    if (err.kind === 'generic') {
      setScanNote({ kind: 'err', text: err.message });
    } else {
      setScanGate(err);
    }
  };

  const act = async (finding: ResearchFinding, verb: 'watch' | 'dismiss') => {
    setBusyId(finding.id);
    const response = await postJson(`/ui/api/research/findings/${finding.id}/${verb}`);
    setBusyId(null);
    if (!response.ok) {
      setScanNote({
        kind: 'err',
        text: `Could not ${verb} that finding (${response.status || 'engine unreachable'}).`,
      });
      return;
    }
    setLoad((prev) => {
      if (prev.phase !== 'ready') return prev;
      const findings =
        verb === 'dismiss'
          ? prev.feed.findings.filter((f) => f.id !== finding.id)
          : prev.feed.findings.map((f) =>
              f.id === finding.id ? { ...f, status: 'watchlist' } : f
            );
      return { phase: 'ready', feed: { ...prev.feed, findings } };
    });
  };

  /**
   * After a Transmog hand-off, watch the finding's link until the agent
   * records the drafted state, then refresh the feed and open the new
   * strategy for review. Bounded (10 min) and single-flight — a second
   * Transmog click repoints the watcher.
   */
  const watchDraftLink = useCallback(
    (findingId: number) => {
      if (draftPollTimer.current) clearInterval(draftPollTimer.current);
      let ticks = 0;
      draftPollTimer.current = setInterval(() => {
        void (async () => {
          ticks += 1;
          if (ticks > 120) {
            if (draftPollTimer.current) clearInterval(draftPollTimer.current);
            draftPollTimer.current = null;
            return;
          }
          const link = await getJsonDetailed<{ status: string; strategy_path: string | null }>(
            `/ui/api/research/findings/${findingId}/link`
          );
          if (!link.ok || link.body.status !== 'drafted' || !link.body.strategy_path) return;
          if (draftPollTimer.current) clearInterval(draftPollTimer.current);
          draftPollTimer.current = null;
          void refresh();
          setScanNote({ kind: 'ok', text: 'Strategy built — opening it for review.' });
          focusStore.publish({ strategy: { filePath: `strategies/${link.body.strategy_path}` } });
          host?.openFile?.(`strategies/${link.body.strategy_path}`);
        })();
      }, 5000);
    },
    [host, refresh]
  );

  /** Bounded feed re-poll after a deep-rank hand-off: the agent writes
   * refined rows back over minutes, so pick up re-sorts without asking
   * the user to mash refresh. */
  const watchFeedForRefinement = useCallback(() => {
    if (draftPollTimer.current) clearInterval(draftPollTimer.current);
    let ticks = 0;
    draftPollTimer.current = setInterval(() => {
      ticks += 1;
      if (ticks > 30) {
        if (draftPollTimer.current) clearInterval(draftPollTimer.current);
        draftPollTimer.current = null;
        return;
      }
      void refresh();
    }, 10000);
  }, [refresh]);

  const startDeepRank = async () => {
    if (!host?.launchAgentSession) {
      setScanNote({
        kind: 'err',
        text: 'This build cannot hand off to the agent — update the IDE.',
      });
      return;
    }
    const result = await host.launchAgentSession(DEEP_RANK_PROMPT, {
      title: 'Deep-rank findings',
    });
    if (!result.ok) {
      setScanNote({ kind: 'err', text: result.error ?? 'The agent hand-off failed.' });
      return;
    }
    setScanNote({
      kind: 'ok',
      text: 'Handed to the agent — review the prefilled command and send it.',
    });
    watchFeedForRefinement();
  };

  const startTransmog = async (finding: ResearchFinding) => {
    if (!host?.launchAgentSession) {
      setScanNote({
        kind: 'err',
        text: 'This build cannot hand off to the agent — update the IDE.',
      });
      return;
    }
    setBusyId(finding.id);
    const result = await host.launchAgentSession(transmogPrompt(finding.id), {
      title: `Transmog: ${finding.title}`.slice(0, 60),
    });
    setBusyId(null);
    if (!result.ok) {
      setScanNote({ kind: 'err', text: result.error ?? 'The agent hand-off failed.' });
      return;
    }
    setScanNote({
      kind: 'ok',
      text: 'Handed to the agent — review the prefilled command and send it to build the strategy.',
    });
    watchDraftLink(finding.id);
  };

  const scanning = scan?.running === true;
  const lastScan =
    (load.phase === 'ready' ? load.feed.last_scan : null) ?? scan?.last_scan ?? null;

  return (
    <PanelShell
      title="Research"
      description="The top 20 quantitative findings, ranked for tradability. The engine scans finance and the adjacent sciences daily and filters internally; every score is engine-computed."
      meta={lastScan ? `Last scan ${fmtWhen(lastScan)}` : 'No scan recorded yet'}
      toolbar={
        <>
          <Button variant="primary" busy={scanning} onClick={() => void kickScan()}>
            {scanning ? 'Scanning…' : 'Scan now'}
          </Button>
          <Button
            variant="ghost"
            disabled={!signedIn}
            title={
              signedIn
                ? 'Re-rank the top findings with the agent (review-first)'
                : DEEP_RANK_SIGNED_OUT_REASON
            }
            onClick={() => void startDeepRank()}
          >
            Deep-rank
          </Button>
          {scanNote ? (
            <InlineNote
              kind={scanNote.kind}
              onDismiss={scanNote.kind === 'err' ? () => setScanNote(null) : undefined}
            >
              {scanNote.text}
            </InlineNote>
          ) : !signedIn && load.phase === 'ready' ? (
            // One quiet line instead of a caption on every card.
            <InlineNote kind="muted">
              Sign in to transmog or deep-rank — the agent works on your account.
            </InlineNote>
          ) : null}
          <ToolbarSpring />
        </>
      }
    >
      {scanGate ? (
        <div style={{ marginBottom: 4 }}>
          <UpgradeGate info={scanGate} />
        </div>
      ) : null}
      {load.phase === 'loading' ? (
        <SkeletonRows rows={4} />
      ) : load.phase === 'failed' && load.why === 'outdated' ? (
        <CenterState
          title="Engine update required"
          detail="This engine build predates the research conveyor, so the feed and scans aren't available. Update the Auracle stack from the launcher, then re-check."
          actions={
            <Button variant="ghost" onClick={() => void refresh()}>
              Re-check
            </Button>
          }
        />
      ) : load.phase === 'failed' ? (
        <CenterState
          title="The engine didn't respond"
          detail="The research feed lives on your local Auracle engine. Make sure the stack is running, then retry."
          actions={
            <Button variant="primary" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : load.feed.findings.length === 0 ? (
        <CenterState
          title="No findings yet"
          detail="Run a scan now, or let tonight's scheduled scan fill the feed — results are ranked for tradability as they land."
          actions={
            <Button variant="primary" busy={scanning} onClick={() => void kickScan()}>
              {scanning ? 'Scanning…' : 'Scan now'}
            </Button>
          }
        />
      ) : (
        <div
          className="apk-enter"
          // Escape collapses an open abstract, but only while focus is inside
          // the list — the keydown is scoped to this container, so it never
          // swallows Escape for the rest of the IDE. Handled only when there is
          // something to close, so an idle list leaves Escape alone.
          onKeyDown={(e) => {
            if (e.key === 'Escape' && expandedId !== null) {
              e.stopPropagation();
              setExpandedId(null);
            }
          }}
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ fontSize: 11.5, color: tone.text3, marginBottom: 6 }}>
            Top {load.feed.findings.length} · ranked by tradability
          </div>
          {load.feed.findings.map((finding, i) => (
            <FindingRow
              key={finding.id}
              finding={finding}
              first={i === 0}
              busy={busyId === finding.id}
              action={transmogAction(finding, signedIn, keyPresence)}
              expanded={expandedId === finding.id}
              onToggleExpand={() =>
                setExpandedId((cur) => (cur === finding.id ? null : finding.id))
              }
              onWatch={() => void act(finding, 'watch')}
              onDismiss={() => void act(finding, 'dismiss')}
              onTransmog={() => void startTransmog(finding)}
              onOpen={() => {
                if (finding.strategy_path) {
                  focusStore.publish({ strategy: { filePath: `strategies/${finding.strategy_path}` } });
                  host?.openFile?.(`strategies/${finding.strategy_path}`);
                }
              }}
            />
          ))}
        </div>
      )}
    </PanelShell>
  );
}
