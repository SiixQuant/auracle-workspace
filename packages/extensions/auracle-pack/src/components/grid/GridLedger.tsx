/**
 * The activity ledger — what was done, when, and what it cost.
 *
 * A conversation scrolls away, so letting the agent act is only tolerable if
 * what it did is recorded somewhere that does not. This surface is that record,
 * and it is READ ONLY: it renders stores that already exist rather than keeping
 * a log of its own. The rows are the engine's operations journal — the same
 * audit trail the Operate room reads — and the header carries the month's
 * agent-session spend, which lives in the synthesis budget. Nothing here
 * writes, and nothing here undoes: reversing an action is the Operate room's
 * job, and a ledger that could act would be a second place to get it wrong.
 *
 * Closed by default, one click from the header, and it fetches the journal
 * only when opened — a record nobody is reading costs nothing to keep.
 *
 * The cost tag on a row is DERIVED, not recorded: the journal says what was
 * done, and a small documented rule marks the actions that moved capital.
 * Over-marking is harmless; the tag is disclosure of a past consequence, not
 * the gate that governed it — that was the approval dialog, at the time.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { engineFeeds } from '../../engine/gridVitals';
import { humanizeAction, prettifySlug } from '../../engine/humanize';
import { readJournal, type OpsEntry } from '../../engine/opsJournal';
import { ensurePanelKitStyles, tone } from '../panelkit';

const STYLE_ID = 'auracle-grid-ledger-styles';

/** Actions whose names show they moved capital, positions or a live
 *  deployment. The list is a heuristic with a safe default: an action not
 *  matched reads as free, and an action wrongly matched only over-states a
 *  past cost, which misleads no one into a worse decision. */
const CAPITAL_HINTS = ['deploy', 'liquidat', 'order', 'position', 'stop', 'route', 'trade'];

type Cost = 'capital' | 'free';

function costOf(action: string | null): Cost {
  const a = (action ?? '').toLowerCase();
  return CAPITAL_HINTS.some((hint) => a.includes(hint)) ? 'capital' : 'free';
}

/** ISO to a stable, locale-free 'YYYY-MM-DD HH:mm'. Deterministic on purpose:
 *  a ledger row's time should read the same in every timezone a test runs in. */
function stamp(at: string | null): string {
  if (!at) return '—';
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(at);
  return match ? `${match[1]} ${match[2]}` : at;
}

interface LedgerRow {
  id: string;
  at: string;
  what: string;
  actor: string;
  cost: Cost;
  undone: boolean;
}

export function toRows(entries: OpsEntry[]): LedgerRow[] {
  return entries.map((entry) => ({
    id: entry.id,
    at: stamp(entry.at),
    // Humanized at the leak: the raw action code becomes a past-tense verb and
    // the raw target a readable name (FR-H3). `costOf` still reads the RAW
    // action, so the capital-hint match keeps working on the engine's codes.
    what: [humanizeAction(entry.action), prettifySlug(entry.target)].filter(Boolean).join(': ') ||
      'an action',
    actor: entry.actor ?? 'unknown',
    cost: costOf(entry.action),
    undone: entry.undoneAt !== null,
  }));
}

const COST_WORD: Record<Cost, string> = {
  capital: 'capital action',
  free: 'free',
};

const SHEET = `
.aledger { display: flex; flex-direction: column; }
.aledger__toggle { display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; appearance: none; font: inherit; font-size: 11.5px; font-weight: 600; padding: 5px 4px; border: 0; background: transparent; color: ${tone.text3}; cursor: pointer; }
.aledger__toggle:hover { color: ${tone.text2}; }
.aledger__chev { font-size: 10px; }
.aledger__summary { font-weight: 400; color: ${tone.text3}; }
.aledger__rows { display: flex; flex-direction: column; gap: 1px; margin: 4px 0 0; padding: 0; list-style: none; }
.aledger__row { display: grid; grid-template-columns: auto 1fr auto; align-items: baseline; gap: 12px; padding: 6px 8px; font-size: 12px; color: ${tone.text2}; border-top: 1px solid ${tone.border}; }
.aledger__at { font-family: ${tone.mono}; font-variant-numeric: tabular-nums; font-size: 10.5px; color: ${tone.text3}; }
.aledger__what { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aledger__what[data-undone='true'] { text-decoration: line-through; color: ${tone.text3}; }
.aledger__cost { font-size: 10px; font-weight: 600; letter-spacing: 0.02em; padding: 2px 7px; border-radius: 999px; }
.aledger__cost[data-cost='free'] { color: ${tone.text3}; }
.aledger__cost[data-cost='capital'] { color: ${tone.caution}; border: 1px solid ${tone.caution}; }
.aledger__empty { margin: 4px 0 0; padding: 6px 8px; font-size: 11.5px; color: ${tone.text3}; }
`;

function ensureLedgerStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

type Load =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; rows: LedgerRow[] }
  | { phase: 'unsupported' }
  | { phase: 'unreachable' };

export function GridLedger(): JSX.Element {
  ensurePanelKitStyles();
  ensureLedgerStyles();
  const feeds = useSyncExternalStore(
    engineFeeds.subscribe,
    engineFeeds.getSnapshot,
    engineFeeds.getSnapshot
  );
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ phase: 'idle' });
  // The fetch is a one-shot on first open. Keyed on `open` alone (not on the
  // load phase), so the transition to `loading` cannot re-fire the effect and
  // cancel its own in-flight read.
  const fetched = useRef(false);

  useEffect(() => {
    if (!open || fetched.current) return;
    fetched.current = true;
    let live = true;
    setLoad({ phase: 'loading' });
    void readJournal(30).then((result) => {
      if (!live) return;
      if (result.phase === 'ready') setLoad({ phase: 'ready', rows: toRows(result.entries) });
      else if (result.phase === 'loading') setLoad({ phase: 'loading' });
      else setLoad({ phase: result.phase });
    });
    return () => {
      live = false;
    };
  }, [open]);

  const spent = feeds.budget?.spent ?? null;
  const summary =
    spent !== null ? `${spent} agent ${spent === 1 ? 'session' : 'sessions'} this month` : '';

  const onToggle = useCallback(() => setOpen((value) => !value), []);

  return (
    <div className="aledger" data-testid="grid-ledger" data-open={open ? 'open' : 'closed'}>
      <button
        type="button"
        className="aledger__toggle"
        data-testid="grid-ledger-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="aledger__chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        Activity
        {summary ? <span className="aledger__summary">· {summary}</span> : null}
      </button>
      {open ? <LedgerBody load={load} /> : null}
    </div>
  );
}

function LedgerBody({ load }: { load: Load }): JSX.Element {
  if (load.phase === 'loading' || load.phase === 'idle') {
    return (
      <p className="aledger__empty" data-testid="grid-ledger-empty">
        Reading the log…
      </p>
    );
  }
  if (load.phase === 'unsupported') {
    return (
      <p className="aledger__empty" data-testid="grid-ledger-empty">
        This engine keeps no activity log.
      </p>
    );
  }
  if (load.phase === 'unreachable') {
    return (
      <p className="aledger__empty" data-testid="grid-ledger-empty">
        The log could not be read just now.
      </p>
    );
  }
  if (load.rows.length === 0) {
    return (
      <p className="aledger__empty" data-testid="grid-ledger-empty">
        Nothing has happened yet.
      </p>
    );
  }
  return (
    <ul className="aledger__rows" data-testid="grid-ledger-rows">
      {load.rows.map((row) => (
        <li className="aledger__row" data-testid={`grid-ledger-row-${row.id}`} key={row.id}>
          <span className="aledger__at">{row.at}</span>
          <span className="aledger__what" data-undone={row.undone} title={`${row.what} · ${row.actor}`}>
            {row.what}
          </span>
          <span className="aledger__cost" data-testid={`grid-ledger-cost-${row.id}`} data-cost={row.cost}>
            {COST_WORD[row.cost]}
          </span>
        </li>
      ))}
    </ul>
  );
}
