/**
 * The resting state — what the panel says when nobody is asking it anything.
 *
 * One line stating whether anything is running, and below it the standing
 * watches quietly accumulating material. Nothing else. The rule that shapes
 * this file is the redesign's second acceptance line: everything beyond the
 * status appears because it EXISTS, so an install with no watches shows the
 * status sentence alone — no empty-state art, no ghost anything, no hint about
 * what a person could place. The conversation is where things start; this
 * surface only reports.
 *
 * Everything here is read from stores the panel already runs:
 *
 *  - the run store says what the agent is doing right now;
 *  - the board graph holds the standing questions (their text is the watch);
 *  - the shared feed lane carries each question's new-material count.
 *
 * No fetch of its own, no poll of its own, and — deliberately — no handlers:
 * the rows are records, not controls. Opening a watch's material arrives with
 * the artifact-card slice; until then a row states what is gathering and how
 * much, which is the whole promise of the resting state.
 *
 * WHAT THIS FILE CANNOT SEE: jsdom applies no container queries, so the wide
 * tier's measure is asserted in a real browser; tests below the fold claim
 * structure and copy only.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PanelHost } from '@nimbalyst/extension-sdk';

import { engineFeeds } from '../../engine/gridVitals';
import { boardGraphStore } from '../../engine/boardGraphStore';
import { backtestStore } from '../../engine/backtestStore';
import { boardRuns } from '../../engine/boardRuns';
import { graphArtifacts } from '../../engine/boardArtifacts';
import { questionsOf } from '../../engine/boardStandingQueries';
import { focusStore } from '../../engine/focusStore';
import { tearsheetRuns, type RecentRun } from '../../engine/client';
import { CenterState, ensurePanelKitStyles, tone } from '../panelkit';
import { ArtifactCard } from './ArtifactCard';
import { CredentialPaste } from './CredentialPaste';
import { GridConnect } from './GridConnect';
import { GridLedger } from './GridLedger';
import { GridScope } from './GridScope';
import { GridSteps } from './GridSteps';
import { Tearsheet } from './pages/Tearsheet';
import { aiRunStore, resultLine } from './gridAiActions';
import { ROOMS } from './rooms';

const STYLE_ID = 'auracle-grid-home-styles';

const SHEET = `
.ahome { display: flex; flex-direction: column; gap: 18px; height: 100%; padding: 22px 18px; overflow-y: auto; }
.ahome__status { margin: 0; font-size: 13.5px; color: ${tone.text2}; }
.ahome__status strong { font-weight: 600; color: ${tone.text}; }
.ahome__watches { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.ahome__watch { display: flex; align-items: baseline; gap: 10px; padding: 7px 10px; border-radius: 8px; }
.ahome__watch + .ahome__watch { border-top: 1px solid ${tone.border}; border-top-left-radius: 0; border-top-right-radius: 0; }
.ahome__question { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; color: ${tone.text2}; }
.ahome__count { flex: none; font-family: ${tone.mono}; font-variant-numeric: tabular-nums; font-size: 10.5px; color: ${tone.text}; border: 1px solid ${tone.border}; border-radius: 999px; padding: 2px 8px; background: ${tone.surface}; }
.ahome__quiet { flex: none; font-size: 10.5px; color: ${tone.text3}; }
.ahome__artifacts { display: flex; flex-direction: column; gap: 10px; }
@container auracle-grid (min-width: 640px) {
  .ahome { padding: 30px 26px; max-width: 720px; }
}
`;

function ensureHomeStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** One watch row: the question, and what has gathered for it. */
interface WatchRow {
  id: string;
  question: string;
  newMaterial: number;
}

function watchRows(): WatchRow[] {
  const snapshot = boardGraphStore.getSnapshot();
  const feeds = engineFeeds.getSnapshot();
  const counts = new Map<string, number>();
  for (const counter of feeds.material ?? []) {
    counts.set(counter.nodeId, counter.newMaterial);
  }
  const rows: WatchRow[] = [];
  for (const [id, question] of questionsOf(snapshot.graph)) {
    rows.push({ id, question, newMaterial: counts.get(id) ?? 0 });
  }
  return rows;
}

/** The one sentence the panel owes at rest.
 *
 * While the agent works, the sentence is the headline and the step list below
 * carries the operation and its cost, so the two do not say the same thing
 * twice. When work has just settled, the sentence is its one-line outcome —
 * an honest terminal state rather than a jump straight back to quiet. */
function statusLine(): { text: string; detail: string | null } {
  const run = aiRunStore.getSnapshot();
  if (run.running) {
    return { text: `Working on ${ROOMS[run.running.room].title}.`, detail: null };
  }
  if (run.outcome) {
    return { text: `${run.outcome.action.label}:`, detail: resultLine(run.outcome.result) };
  }
  if (boardGraphStore.getSnapshot().status === 'loading') {
    return { text: 'Catching up.', detail: null };
  }
  return { text: 'Nothing is running.', detail: null };
}

/** Whether the workspace has a chartable backtest to show yet: 'checking' until
 *  the recent-runs read returns, then 'present' (one is focused / focusable) or
 *  'empty' (there is nothing to show). */
type RunProbe = 'checking' | 'present' | 'empty';

/**
 * On the FIRST mount of the resting state, point the focus at the latest
 * backtest so its tearsheet — the thing the owner wants seen first — is already
 * showing. Runs exactly once, and NEVER clobbers a focus that is already set (or
 * one that lands while the recent-runs read is in flight). Reports the probe so
 * the hero can rest on an honest empty state rather than a blank; any failed
 * read counts as "nothing to show".
 */
function useAutoFocusLatestRun(): RunProbe {
  const [probe, setProbe] = useState<RunProbe>(() =>
    focusStore.getSnapshot().run ? 'present' : 'checking'
  );
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (focusStore.getSnapshot().run) {
      setProbe('present');
      return;
    }
    let cancelled = false;
    void (async () => {
      let runs: RecentRun[] = [];
      try {
        runs = await tearsheetRuns(1);
      } catch {
        runs = [];
      }
      if (cancelled) return;
      // A run may have been focused (a hand-off, the picker) while we read —
      // never overwrite it.
      if (focusStore.getSnapshot().run) {
        setProbe('present');
        return;
      }
      const latest = runs[0];
      if (!latest) {
        setProbe('empty');
        return;
      }
      focusStore.publish({
        strategy: { filePath: latest.strategyPath, dottedPath: latest.strategyPath },
        run: { kind: 'backtest', id: String(latest.jobId) },
      });
      setProbe('present');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return probe;
}

/**
 * The tearsheet HERO — the default thing the panel shows. It auto-focuses the
 * latest backtest on open and renders the shared {@link Tearsheet}; a workspace
 * with no chartable backtest yet rests on an honest empty state instead. The
 * single connect entry sits above it, the Activity ledger below.
 */
function HomeTearsheet({ host }: { host: PanelHost }): JSX.Element | null {
  const focus = useSyncExternalStore(focusStore.subscribe, focusStore.getSnapshot);
  const probe = useAutoFocusLatestRun();
  const hasRun = focus.run?.kind === 'backtest';

  if (hasRun) {
    return (
      <div data-testid="grid-tearsheet-hero">
        <Tearsheet host={host} />
      </div>
    );
  }
  if (probe === 'empty') {
    return (
      <div data-testid="grid-tearsheet-empty">
        <CenterState
          title="No backtests yet"
          detail="Run one from the chat or the Backtest room and its tearsheet appears here."
        />
      </div>
    );
  }
  // Still checking, or a run is about to be focused — say nothing rather than
  // flash the empty state.
  return null;
}

export function GridHome({ host }: { host: PanelHost }): JSX.Element {
  ensurePanelKitStyles();
  ensureHomeStyles();
  // Subscribed to all three stores so the sentence and the counts move the
  // moment the stores do; the selectors re-read inside render, which is cheap
  // at this size and keeps this component free of state of its own.
  useSyncExternalStore(aiRunStore.subscribe, aiRunStore.getSnapshot, aiRunStore.getSnapshot);
  useSyncExternalStore(
    boardGraphStore.subscribe,
    boardGraphStore.getSnapshot,
    boardGraphStore.getSnapshot
  );
  useSyncExternalStore(engineFeeds.subscribe, engineFeeds.getSnapshot, engineFeeds.getSnapshot);
  // The artifacts on the stage move with the run stores as well as the graph:
  // a strategy card appears the moment its backtest lands.
  useSyncExternalStore(backtestStore.subscribe, backtestStore.getSnapshot, backtestStore.getSnapshot);
  useSyncExternalStore(boardRuns.subscribe, boardRuns.getSnapshot, boardRuns.getSnapshot);

  const status = statusLine();
  const watches = watchRows();
  // The connector registry the Grid already polls — the connect entry reads it
  // rather than opening a poll of its own, and renders nothing once set up.
  const connectors = engineFeeds.getSnapshot().connections;
  const graph = boardGraphStore.getSnapshot().graph;
  const artifacts = graphArtifacts(graph, backtestStore.getSnapshot(), boardRuns.getSnapshot());
  // Sources the agent stood up that name a vault slot: the only place a key is
  // ever asked for, and the only input left in the panel.
  const keyed = graph.nodes
    .filter((node) => node.kind === 'source' && node.source?.credentialSlot)
    .map((node) => ({ id: node.id, slot: node.source!.credentialSlot as string, name: node.source!.name }));

  return (
    <section className="ahome" data-testid="grid-resting" aria-label="Auracle">
      <p className="ahome__status" data-testid="resting-status">
        {status.text}
        {status.detail ? (
          <>
            {' '}
            <strong>{status.detail}</strong>
          </>
        ) : null}
      </p>
      <GridScope state={aiRunStore.getSnapshot()} />
      <GridSteps state={aiRunStore.getSnapshot()} />
      {watches.length > 0 ? (
        <ul className="ahome__watches" data-testid="resting-watches">
          {watches.map((watch) => (
            <li className="ahome__watch" data-testid={`resting-watch-${watch.id}`} key={watch.id}>
              <span className="ahome__question">{watch.question}</span>
              {watch.newMaterial > 0 ? (
                <span className="ahome__count" data-testid={`resting-watch-count-${watch.id}`}>
                  +{watch.newMaterial} new
                </span>
              ) : (
                <span className="ahome__quiet">gathering</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {artifacts.length > 0 ? (
        <div className="ahome__artifacts" data-testid="resting-artifacts">
          {artifacts.map((artifact) => (
            <ArtifactCard artifact={artifact} key={artifact.id} />
          ))}
        </div>
      ) : null}
      {keyed.length > 0 ? (
        <div className="ahome__artifacts" data-testid="resting-credentials">
          {keyed.map((source) => (
            <CredentialPaste slot={source.slot} sourceName={source.name} key={source.id} />
          ))}
        </div>
      ) : null}
      {/* The single connect entry: a quiet, orange line inviting the operator to
          wire their data + broker. It renders nothing once the box is set up
          (DF4), so a configured install is as quiet as a fresh one is inviting. */}
      <GridConnect connectors={connectors} />
      {/* The tearsheet hero — the default thing seen. Sits BELOW the connect
          entry (kept on top, self-hiding once set up) and ABOVE the ledger; a
          box with no backtest yet rests on an honest empty state. */}
      <HomeTearsheet host={host} />
      {/* The ledger is the one thing the redesign ADDS to the persistent set:
          closed by default, always reachable, the price of letting the agent
          act. It is not empty-state art — it is a deliberate fixture. */}
      <GridLedger />
    </section>
  );
}
