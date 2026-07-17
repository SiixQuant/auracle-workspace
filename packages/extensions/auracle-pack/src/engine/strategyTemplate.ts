/**
 * The strategy scaffold — the exact source a "New Strategy" file is born with,
 * plus the copy the Backtest panel shows when a run stops because the scaffold
 * still has an empty universe.
 *
 * STRATEGY_SCAFFOLD is duplicated verbatim as the ".py" newFileMenu entry's
 * defaultContent in manifest.json (the host writes defaultContent to disk with
 * no templating). The drift test in strategyTemplate.test.ts asserts the two
 * copies stay byte-identical, so a new hand always starts from a runnable,
 * engine-recognized file with only two blanks to fill.
 */

/**
 * A ready-to-run Strategy skeleton. It IS a valid Strategy subclass — the
 * engine discovers it the moment it lands, so the only reason a fresh file
 * fails to backtest is the empty `universe` (which the panel then explains).
 * Two blanks carry the whole idea: the symbols and the signal.
 */
export const STRATEGY_SCAFFOLD = `"""New strategy - fill in the two blanks below, then press Run backtest.

A strategy is a Python class that inherits from Strategy and answers
two questions:

  1. WHICH symbols may it trade?   ->  the \`universe\` list
  2. HOW MUCH of each to hold?     ->  the \`prices_to_signals\` method

That is the whole contract. Market data, the backtester, tearsheets,
scheduling, and live deployment are already built around this file.
You only write the idea.

\`prices\` is a table indexed by date. Its columns are (field, symbol),
where field is one of: open, high, low, close, adj_close, volume.
"""

from __future__ import annotations

import pandas as pd

from auracle.backtest import Strategy


class MyStrategy(Strategy):
    """Rename this class to whatever your strategy is called."""

    # 1) UNIVERSE - the symbols this strategy is allowed to trade.
    #    Each entry is (ticker, exchange), for example:
    #        universe = [("AAPL", "NASDAQ"), ("MSFT", "NASDAQ")]
    #    Left empty, Run stops and asks you to add symbols first.
    universe: list[tuple[str, str]] = []

    def prices_to_signals(self, prices: pd.DataFrame) -> pd.DataFrame:
        """2) SIGNAL - how much of each symbol to hold, each day.

        Return a table shaped like \`close\`: one number per symbol per day.
            > 0 = long    < 0 = short    0 = flat
        Magnitude is conviction - the engine turns your numbers into
        portfolio weights for you.
        """
        close = prices.xs("close", axis=1, level=0)

        # TODO: your signal here. Zeros mean "hold nothing" (a flat backtest).
        return pd.DataFrame(0.0, index=close.index, columns=close.columns)
`;

/**
 * True when a backtest failure message is the engine's empty-universe stop —
 * the friendly "you haven't named any symbols yet" case, not a real error.
 * Case-insensitive: the exact phrasing varies, the phrase "universe is empty"
 * does not.
 */
export function isEmptyUniverseError(message: string): boolean {
  return typeof message === 'string' && message.toLowerCase().includes('universe is empty');
}

/**
 * The panel copy for the empty-universe stop. Not an error rest — a next step:
 * name the fix in the title, name the concrete action in the body.
 */
export function emptyUniverseCopy(): { title: string; body: string } {
  return {
    title: 'Add your universe',
    body:
      'This strategy has no symbols yet, so there is nothing to backtest. Add (ticker, exchange) ' +
      'pairs to the universe list — for example ("AAPL", "NASDAQ") — then Run again.',
  };
}

/**
 * The relative path for the Nth scaffold the rescue card creates, under the
 * workspace's Potential/ bucket. The first is unnumbered; collisions step to
 * `_2`, `_3`, … so a second "Start from the scaffold" never clobbers the first.
 */
export function scaffoldRelPath(n: number): string {
  return n <= 1 ? 'Potential/my_strategy.py' : `Potential/my_strategy_${n}.py`;
}

/**
 * True when a strategy-source save was refused because a file already sits at
 * that path — the rescue card reads this to step to the next slot instead of
 * overwriting. Tolerant of how the engine signals it (a 409, an explicit
 * conflict flag, or an error string that says the path already exists), since
 * the overwrite guard lives on the host side of this contract.
 */
export function isSaveConflict(
  status: number,
  body: { error?: string; detail?: string; conflict?: boolean; exists?: boolean } | null | undefined
): boolean {
  if (status === 409) return true;
  if (!body) return false;
  if (body.conflict === true || body.exists === true) return true;
  const message = `${body.error ?? ''} ${body.detail ?? ''}`.toLowerCase();
  return /already exists|already a strategy|path exists|file exists/.test(message);
}

/** How the rescue card reads a POST /ui/api/strategy/source response. */
export type ScaffoldSaveOutcome =
  | { kind: 'created' }
  | { kind: 'conflict'; message: string }
  | { kind: 'error'; message: string };

/**
 * Classify a scaffold-create response so the rescue card's collision loop
 * stays out of response-shape guesswork: a taken slot is a `conflict` (step to
 * the next slot without clobbering), a clean save is `created` (open it), and
 * anything else is an `error` to surface. `ok` is the transport-level HTTP ok;
 * `status`/`body` are the engine's. Conflicts carry the engine's own message
 * (may be blank on a bare 409) so an all-slots-taken stop can show it.
 */
export function classifyScaffoldSave(ok: boolean, status: number, body: unknown): ScaffoldSaveOutcome {
  const b = (body ?? {}) as {
    ok?: boolean;
    error?: string;
    detail?: string;
    conflict?: boolean;
    exists?: boolean;
  };
  if (isSaveConflict(status, b)) return { kind: 'conflict', message: b.error ?? b.detail ?? '' };
  if (ok && b.ok !== false) return { kind: 'created' };
  return {
    kind: 'error',
    message: b.error ?? b.detail ?? `Could not create the strategy (${status || 'engine unreachable'}).`,
  };
}

/** The module basename of the Nth scaffold slot (no directory, no `.py`). */
export function scaffoldBasename(n: number): string {
  return n <= 1 ? 'my_strategy' : `my_strategy_${n}`;
}

/**
 * The relative path of the first scaffold slot (1..9) whose basename the engine
 * does not already know, or null when every slot is taken. Choosing a free slot
 * BEFORE the save is what keeps the rescue from overwriting a user's file: the
 * engine's strategy-source save is itself an overwrite, so the guard has to be
 * "don't write onto an existing name" rather than "recover after a conflict".
 */
export function firstFreeScaffoldRel(taken: ReadonlySet<string>): string | null {
  for (let n = 1; n <= 9; n += 1) {
    if (!taken.has(scaffoldBasename(n))) return scaffoldRelPath(n);
  }
  return null;
}
