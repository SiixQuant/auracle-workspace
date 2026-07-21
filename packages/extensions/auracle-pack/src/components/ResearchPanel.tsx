/**
 * Research panel — the front door for the engine's paper-research
 * conveyor (fullscreen pack panel, gutter icon), and the reference
 * implementation of the panelkit surface language.
 *
 * Renders the top ranked findings the scheduled scan maintains, with
 * per-finding watch/dismiss and the Transmog hand-off: "Transmog" hands
 * the finding to the /auracle:transmog agent command (prefilled,
 * review-first — nothing auto-runs), which develops a full strategy from
 * the research; the card then flips to Drafted with an open-the-file
 * affordance once the engine records the finding→strategy link.
 *
 * The corpus and its filters are internal: this is a strategy-development
 * engine, so the interests are fixed engine-side (finance + the sciences
 * that get weaponised into trading) and the panel simply shows the top 20
 * by tradability. Honesty rules: every number on a card is engine-computed
 * and arrives pre-ranked (no client re-scoring), the score's origin is
 * labeled, scan outcomes distinguish "found nothing" from "broke", an
 * engine that predates the research surface is reported as outdated (not
 * unreachable), and the Transmog control is disabled with the reason while
 * the agent is signed out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authState, getJsonDetailed, postJson } from '../engine/client';
import {
  DEEP_RANK_PROMPT,
  DEEP_RANK_SIGNED_OUT_REASON,
  LoadFailure,
  ResearchFeed,
  ResearchFinding,
  ScanStatus,
  TransmogAction,
  classifyLoadFailure,
  fmtDate,
  fmtWhen,
  normalizeFinding,
  researchContext,
  scanStartError,
  scanSummaryText,
  scoreOrigin,
  sourceLabel,
  transmogAction,
  transmogPrompt,
} from '../engine/research';
import {
  Button,
  CenterState,
  InlineNote,
  PanelShell,
  SkeletonRows,
  ToolbarSpring,
  tone,
} from './panelkit';
import { PanelHostLike, useAiPanelContext } from './aiPanel';
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

function FindingCard({
  finding,
  busy,
  action,
  onWatch,
  onDismiss,
  onTransmog,
  onOpen,
}: {
  finding: ResearchFinding;
  busy: boolean;
  action: TransmogAction;
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

  return (
    <article
      className="apk-card"
      style={{
        display: 'flex',
        gap: 14,
        padding: '13px 15px',
        borderRadius: 9,
        border: `1px solid ${tone.border}`,
        background: tone.surface,
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
        </div>
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
        {finding.status === 'watchlist' ? (
          <span style={{ fontSize: 11.5, color: tone.caution }}>★ Watching</span>
        ) : finding.status === 'drafted' ? (
          <span style={{ fontSize: 11, color: tone.text3 }}>Drafted</span>
        ) : finding.status === 'backtested' ? (
          <span style={{ fontSize: 11, color: tone.text3 }}>Backtested</span>
        ) : null}
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
  const [busyId, setBusyId] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(false);
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
    setScanNote({ kind: 'err', text: scanStartError(response.status) });
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
        <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11.5, color: tone.text3 }}>
            Top {load.feed.findings.length} · ranked by tradability
          </div>
          {load.feed.findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              busy={busyId === finding.id}
              action={transmogAction(finding, signedIn)}
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
