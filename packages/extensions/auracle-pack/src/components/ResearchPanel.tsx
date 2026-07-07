/**
 * Research panel — the front door for the engine's paper-research
 * conveyor (fullscreen pack panel, gutter icon).
 *
 * Renders the ranked findings feed the scheduled scan maintains, with
 * interests steering, per-finding watch/dismiss, and the draft leg:
 * "Draft strategy" hands the finding to the /auracle:draft-strategy
 * agent command (prefilled, review-first — nothing auto-runs), then the
 * card flips to Drafted with an open-the-file affordance once the
 * engine records the finding→strategy link. Honesty rules: every number
 * on a card is engine-computed and arrives pre-ranked (no client
 * re-scoring), the score's origin is labeled, scan outcomes distinguish
 * "found nothing" from "broke", and the draft control is disabled with
 * the reason while the agent is signed out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authState, getJson, postJson } from '../engine/client';
import {
  DEEP_RANK_PROMPT,
  DEEP_RANK_SIGNED_OUT_REASON,
  DraftAction,
  ResearchFeed,
  ResearchFinding,
  ResearchInterests,
  ScanStatus,
  draftAction,
  draftPrompt,
  fmtDate,
  fmtWhen,
  normalizeFinding,
  scanSummaryText,
  scoreOrigin,
  sourceLabel,
  splitTerms,
} from '../engine/research';

/**
 * Structural slice of the PanelHost this panel uses — feature-detected so
 * the panel renders (with the hand-off disabled) on hosts that predate
 * launchAgentSession.
 */
interface PanelHostLike {
  openFile?: (path: string) => void;
  launchAgentSession?: (
    prompt: string,
    opts?: { title?: string }
  ) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
}

const ACCENT = 'var(--accent-primary, #0053fd)';
const OK = '#2ea043';
const DANGER = '#c4554d';
const CAUTION = '#d4a017';
const MUTED = 'var(--text-tertiary, #8a8f98)';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'unreachable' }
  | { phase: 'ready'; feed: ResearchFeed };

const styles = {
  scroll: {
    height: '100%',
    overflowY: 'auto' as const,
    background: 'var(--bg-primary, transparent)',
  },
  page: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 18,
    maxWidth: 860,
    margin: '0 auto',
    padding: '20px 24px 40px',
    color: 'var(--text-primary, #d7dae0)',
    font: '13px/1.5 var(--font-family-ui, system-ui, sans-serif)',
  },
  header: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  title: { fontSize: 17, fontWeight: 600 as const, letterSpacing: -0.2 },
  subtitle: { fontSize: 12.5, color: MUTED },
  toolbar: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: 10,
    flexWrap: 'wrap' as const,
  },
  toolbarSpring: { flex: 1, minWidth: 12 },
  lastScan: { fontSize: 12, color: MUTED, whiteSpace: 'nowrap' as const },
  primaryBtn: (disabled: boolean) => ({
    padding: '7px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600 as const,
    cursor: disabled ? 'default' : 'pointer',
    border: '1px solid transparent',
    background: ACCENT,
    color: '#fff',
    opacity: disabled ? 0.6 : 1,
  }),
  ghostBtn: (disabled: boolean) => ({
    padding: '7px 14px',
    borderRadius: 8,
    fontSize: 13,
    cursor: disabled ? 'default' : 'pointer',
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    background: 'transparent',
    color: 'var(--text-secondary, #b9bec7)',
    opacity: disabled ? 0.6 : 1,
  }),
  note: (kind: 'ok' | 'err' | 'muted') => ({
    fontSize: 12.5,
    color: kind === 'ok' ? OK : kind === 'err' ? DANGER : MUTED,
    display: 'flex',
    alignItems: 'center' as const,
    gap: 7,
    minWidth: 0,
  }),
  card: {
    display: 'flex',
    gap: 14,
    padding: '13px 15px',
    borderRadius: 10,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.22))',
    background: 'var(--bg-secondary, rgba(255,255,255,0.018))',
  },
  scoreCol: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    gap: 3,
    minWidth: 44,
  },
  scoreNum: {
    fontSize: 20,
    fontWeight: 600 as const,
    fontVariantNumeric: 'tabular-nums' as const,
    lineHeight: 1.1,
  },
  bandTag: (band: string) => ({
    fontSize: 10,
    fontWeight: 600 as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    color: band === 'candidate' ? OK : band === 'watchlist' ? CAUTION : MUTED,
  }),
  mainCol: { display: 'flex', flexDirection: 'column' as const, gap: 6, flex: 1, minWidth: 0 },
  cardTitle: {
    fontSize: 13.5,
    fontWeight: 600 as const,
    color: 'var(--text-primary, #d7dae0)',
    textDecoration: 'none',
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: 8,
    flexWrap: 'wrap' as const,
    fontSize: 11.5,
    color: MUTED,
  },
  srcChip: {
    fontSize: 10.5,
    fontWeight: 600 as const,
    letterSpacing: 0.3,
    padding: '1px 7px',
    borderRadius: 999,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.3))',
    color: 'var(--text-secondary, #b9bec7)',
    whiteSpace: 'nowrap' as const,
  },
  hypothesis: { fontSize: 12.5, color: 'var(--text-secondary, #b9bec7)' },
  originRow: { display: 'flex', alignItems: 'center' as const, gap: 10, fontSize: 11, color: MUTED },
  linkBtn: {
    fontSize: 11.5,
    color: MUTED,
    textDecoration: 'none',
    whiteSpace: 'nowrap' as const,
  },
  actionsCol: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-end' as const,
    gap: 6,
    whiteSpace: 'nowrap' as const,
  },
  tinyBtn: (disabled: boolean) => ({
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: 11.5,
    cursor: disabled ? 'default' : 'pointer',
    border: '1px solid var(--border-primary, rgba(127,127,127,0.3))',
    background: 'transparent',
    color: 'var(--text-secondary, #b9bec7)',
    opacity: disabled ? 0.6 : 1,
  }),
  watchBadge: { fontSize: 11.5, color: CAUTION, whiteSpace: 'nowrap' as const },
  statusBadge: { fontSize: 11, color: MUTED, whiteSpace: 'nowrap' as const },
  editor: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    padding: 16,
    borderRadius: 10,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.22))',
    background: 'var(--bg-secondary, rgba(255,255,255,0.018))',
  },
  field: { display: 'flex', flexDirection: 'column' as const, gap: 5 },
  fieldLabel: { fontSize: 12, color: 'var(--text-secondary, #b9bec7)' },
  fieldHint: { fontSize: 11.5, color: MUTED },
  input: {
    width: '100%',
    padding: '7px 9px',
    borderRadius: 6,
    fontSize: 13,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    background: 'var(--bg-primary, rgba(0,0,0,0.2))',
    color: 'var(--text-primary, #d7dae0)',
    outline: 'none',
    fontFamily: 'inherit',
  },
  centerBox: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    gap: 12,
    padding: '48px 0',
    color: MUTED,
    fontSize: 13,
  },
  retryBtn: {
    padding: '7px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600 as const,
    cursor: 'pointer',
    border: '1px solid transparent',
    background: ACCENT,
    color: '#fff',
  },
};

function statusBadge(finding: ResearchFinding): { text: string; style: object } | null {
  if (finding.status === 'watchlist') return { text: '★ Watching', style: styles.watchBadge };
  if (finding.status === 'drafted') return { text: 'Drafted', style: styles.statusBadge };
  if (finding.status === 'backtested') return { text: 'Backtested', style: styles.statusBadge };
  return null;
}

function FindingCard({
  finding,
  busy,
  action,
  onWatch,
  onDismiss,
  onDraft,
  onOpen,
}: {
  finding: ResearchFinding;
  busy: boolean;
  action: DraftAction;
  onWatch: () => void;
  onDismiss: () => void;
  onDraft: () => void;
  onOpen: () => void;
}) {
  const badge = statusBadge(finding);
  const meta: JSX.Element[] = [];
  meta.push(
    <span key="src" style={styles.srcChip}>
      {sourceLabel(finding.source)}
    </span>
  );
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
    <div style={styles.card}>
      <div style={styles.scoreCol} title="Engine-computed six-factor composite (0–100)">
        <span style={styles.scoreNum}>{finding.composite}</span>
        <span style={styles.bandTag(finding.band)}>{finding.band}</span>
      </div>
      <div style={styles.mainCol}>
        {finding.url ? (
          <a href={finding.url} target="_blank" rel="noreferrer" style={styles.cardTitle}>
            {finding.title}
          </a>
        ) : (
          <span style={styles.cardTitle}>{finding.title}</span>
        )}
        <div style={styles.metaRow}>{meta}</div>
        {finding.hypothesis ? (
          <div style={styles.hypothesis}>{finding.hypothesis}</div>
        ) : null}
        <div style={styles.originRow}>
          <span>
            scored: {scoreOrigin(finding.model)} · confidence {finding.confidence}
          </span>
          {finding.url ? (
            <a href={finding.url} target="_blank" rel="noreferrer" style={styles.linkBtn}>
              Paper ↗
            </a>
          ) : null}
          {finding.pdf_url ? (
            <a href={finding.pdf_url} target="_blank" rel="noreferrer" style={styles.linkBtn}>
              PDF ↗
            </a>
          ) : null}
        </div>
      </div>
      <div style={styles.actionsCol}>
        {badge ? <span style={badge.style}>{badge.text}</span> : null}
        {action.kind === 'open' ? (
          <button type="button" style={styles.tinyBtn(false)} onClick={onOpen}>
            Open file
          </button>
        ) : null}
        {action.kind === 'draft' ? (
          <button
            type="button"
            style={styles.tinyBtn(busy || action.disabled)}
            disabled={busy || action.disabled}
            title={
              action.disabled
                ? action.reason
                : 'Hand this finding to the agent to draft a strategy'
            }
            onClick={onDraft}
          >
            ✎ Draft strategy
          </button>
        ) : null}
        {action.kind === 'draft' && action.disabled ? (
          <span style={styles.statusBadge}>{action.reason}</span>
        ) : null}
        {finding.status === 'surfaced' ? (
          <button type="button" style={styles.tinyBtn(busy)} disabled={busy} onClick={onWatch}>
            ☆ Watch
          </button>
        ) : null}
        <button type="button" style={styles.tinyBtn(busy)} disabled={busy} onClick={onDismiss}>
          ✕ Dismiss
        </button>
      </div>
    </div>
  );
}

export function ResearchPanel({ host }: { host?: PanelHostLike } = {}): JSX.Element {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const [scanNote, setScanNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [catText, setCatText] = useState('');
  const [kwText, setKwText] = useState('');
  const [interestsBusy, setInterestsBusy] = useState(false);
  const [interestsNote, setInterestsNote] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const draftPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const body = await getJson<Record<string, unknown>>('/ui/api/research/feed?limit=60');
    if (!body) {
      setLoad({ phase: 'unreachable' });
      return;
    }
    const rows = Array.isArray(body.findings) ? (body.findings as Record<string, unknown>[]) : [];
    setLoad({
      phase: 'ready',
      feed: {
        findings: rows.map(normalizeFinding),
        last_scan: typeof body.last_scan === 'string' ? body.last_scan : null,
      },
    });
  }, []);

  const loadInterests = useCallback(async () => {
    const body = await getJson<ResearchInterests>('/ui/api/research/interests');
    if (body) {
      setCatText((body.categories ?? []).join(', '));
      setKwText((body.keywords ?? []).join(', '));
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadInterests();
    void authState().then((auth) => setSignedIn(auth.signedIn));
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (draftPollTimer.current) clearInterval(draftPollTimer.current);
    };
  }, [refresh, loadInterests]);

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
        const body = await getJson<ScanStatus>('/ui/api/research/scan/status');
        if (!body) return; // transient; keep polling
        setScan(body);
        if (!body.running) {
          stopPolling();
          const text = scanSummaryText(body);
          if (text) setScanNote({ kind: body.error ? 'err' : 'ok', text });
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
    setScanNote({
      kind: 'err',
      text: `Could not start the scan (${response.status || 'engine unreachable'}).`,
    });
  };

  const saveInterests = async () => {
    setInterestsBusy(true);
    setInterestsNote(null);
    const response = await postJson('/ui/api/research/interests', {
      categories: splitTerms(catText),
      keywords: splitTerms(kwText),
    });
    setInterestsBusy(false);
    const body = (response.body ?? {}) as Partial<ResearchInterests> & { detail?: string };
    if (response.ok) {
      setCatText((body.categories ?? []).join(', '));
      setKwText((body.keywords ?? []).join(', '));
      setInterestsNote('Saved. The next scan uses these.');
    } else {
      setInterestsNote(
        body.detail ?? `Save failed (${response.status || 'engine unreachable'}).`
      );
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
   * After a hand-off, watch the finding's link until the agent records
   * the drafted state, then refresh the feed and open the new file for
   * review. Bounded (10 min) and single-flight — a second Draft click
   * repoints the watcher.
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
          const link = await getJson<{ status: string; strategy_path: string | null }>(
            `/ui/api/research/findings/${findingId}/link`
          );
          if (!link || link.status !== 'drafted' || !link.strategy_path) return;
          if (draftPollTimer.current) clearInterval(draftPollTimer.current);
          draftPollTimer.current = null;
          void refresh();
          setScanNote({ kind: 'ok', text: 'Draft landed — opening the file for review.' });
          host?.openFile?.(`strategies/${link.strategy_path}`);
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

  const startDraft = async (finding: ResearchFinding) => {
    if (!host?.launchAgentSession) {
      setScanNote({
        kind: 'err',
        text: 'This build cannot hand off to the agent — update the IDE.',
      });
      return;
    }
    setBusyId(finding.id);
    const result = await host.launchAgentSession(draftPrompt(finding.id), {
      title: `Draft: ${finding.title}`.slice(0, 60),
    });
    setBusyId(null);
    if (!result.ok) {
      setScanNote({
        kind: 'err',
        text: result.error ?? 'The agent hand-off failed.',
      });
      return;
    }
    setScanNote({
      kind: 'ok',
      text: 'Handed to the agent — review the prefilled command and send it.',
    });
    watchDraftLink(finding.id);
  };

  const scanning = scan?.running === true;
  const lastScan =
    (load.phase === 'ready' ? load.feed.last_scan : null) ?? scan?.last_scan ?? null;

  return (
    <div style={styles.scroll}>
      <div style={styles.page}>
        <div style={styles.header}>
          <div style={styles.title}>Research</div>
          <div style={styles.subtitle}>
            Fresh quantitative research, ranked for tradability. The engine scans arXiv
            and Semantic Scholar on a daily schedule; every score here is engine-computed.
          </div>
        </div>

        <div style={styles.toolbar}>
          <button
            type="button"
            style={styles.primaryBtn(scanning)}
            disabled={scanning}
            onClick={() => void kickScan()}
          >
            {scanning ? 'Scanning…' : 'Scan now'}
          </button>
          <button
            type="button"
            style={styles.ghostBtn(false)}
            onClick={() => setEditorOpen((open) => !open)}
          >
            Interests
          </button>
          <button
            type="button"
            style={styles.ghostBtn(!signedIn)}
            disabled={!signedIn}
            title={
              signedIn
                ? 'Re-rank the top findings with the agent (review-first)'
                : DEEP_RANK_SIGNED_OUT_REASON
            }
            onClick={() => void startDeepRank()}
          >
            ▲ Deep-rank
          </button>
          {scanNote ? (
            <span style={styles.note(scanNote.kind)}>
              <span aria-hidden>{scanNote.kind === 'ok' ? '●' : '●'}</span>
              {scanNote.text}
            </span>
          ) : scanning ? (
            <span style={styles.note('muted')}>Scanning…</span>
          ) : null}
          <span style={styles.toolbarSpring} />
          <span style={styles.lastScan}>
            {lastScan ? `Last scan: ${fmtWhen(lastScan)}` : 'No scan recorded yet'}
          </span>
        </div>

        {editorOpen ? (
          <div style={styles.editor}>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>Categories</label>
              <input
                style={styles.input}
                value={catText}
                onChange={(e) => setCatText(e.target.value)}
                placeholder="q-fin.TR, q-fin.PM, q-fin.ST"
              />
              <span style={styles.fieldHint}>
                arXiv category terms the scan fetches from. Semantic Scholar has no
                categories; it follows your keywords.
              </span>
            </div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>Keywords</label>
              <input
                style={styles.input}
                value={kwText}
                onChange={(e) => setKwText(e.target.value)}
                placeholder="momentum, mean reversion, statistical arbitrage"
              />
              <span style={styles.fieldHint}>
                Drive the tradability scoring and the Semantic Scholar search. Clearing
                both fields resets to the defaults.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                style={styles.primaryBtn(interestsBusy)}
                disabled={interestsBusy}
                onClick={() => void saveInterests()}
              >
                Save interests
              </button>
              {interestsNote ? <span style={styles.note('muted')}>{interestsNote}</span> : null}
            </div>
          </div>
        ) : null}

        {load.phase === 'loading' ? (
          <div style={styles.centerBox}>Loading the research feed…</div>
        ) : load.phase === 'unreachable' ? (
          <div style={styles.centerBox}>
            <span>The Auracle engine is unreachable, so the research feed can't load.</span>
            <button type="button" style={styles.retryBtn} onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        ) : load.feed.findings.length === 0 ? (
          <div style={styles.centerBox}>
            <span>No findings yet. Scan now, or let tonight's scheduled scan fill the feed.</span>
            <button
              type="button"
              style={styles.retryBtn}
              disabled={scanning}
              onClick={() => void kickScan()}
            >
              {scanning ? 'Scanning…' : 'Scan now'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {load.feed.findings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                busy={busyId === finding.id}
                action={draftAction(finding, signedIn)}
                onWatch={() => void act(finding, 'watch')}
                onDismiss={() => void act(finding, 'dismiss')}
                onDraft={() => void startDraft(finding)}
                onOpen={() => {
                  if (finding.strategy_path) {
                    host?.openFile?.(`strategies/${finding.strategy_path}`);
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
