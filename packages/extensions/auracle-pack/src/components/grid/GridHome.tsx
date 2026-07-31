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
import { useSyncExternalStore } from 'react';

import { engineFeeds } from '../../engine/gridVitals';
import { boardGraphStore } from '../../engine/boardGraphStore';
import { backtestStore } from '../../engine/backtestStore';
import { boardRuns } from '../../engine/boardRuns';
import { graphArtifacts } from '../../engine/boardArtifacts';
import { questionsOf } from '../../engine/boardStandingQueries';
import { ensurePanelKitStyles, tone } from '../panelkit';
import { ArtifactCard } from './ArtifactCard';
import { GridLedger } from './GridLedger';
import { GridScope } from './GridScope';
import { GridSteps } from './GridSteps';
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

export function GridHome(): JSX.Element {
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
  const artifacts = graphArtifacts(
    boardGraphStore.getSnapshot().graph,
    backtestStore.getSnapshot(),
    boardRuns.getSnapshot()
  );

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
      {/* The ledger is the one thing the redesign ADDS to the persistent set:
          closed by default, always reachable, the price of letting the agent
          act. It is not empty-state art — it is a deliberate fixture. */}
      <GridLedger />
    </section>
  );
}
