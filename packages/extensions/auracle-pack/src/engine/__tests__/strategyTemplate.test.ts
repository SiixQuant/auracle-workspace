import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  STRATEGY_SCAFFOLD,
  classifyScaffoldSave,
  emptyUniverseCopy,
  firstFreeScaffoldRel,
  isEmptyUniverseError,
  isSaveConflict,
  scaffoldBasename,
  scaffoldRelPath,
} from '../strategyTemplate';

describe('STRATEGY_SCAFFOLD', () => {
  it('is the two-blank Strategy skeleton with a trailing newline', () => {
    // A user reads this first, so the opening line names the two blanks.
    expect(STRATEGY_SCAFFOLD.startsWith('"""New strategy - fill in the two blanks below')).toBe(true);
    expect(STRATEGY_SCAFFOLD).toContain('from auracle.backtest import Strategy');
    expect(STRATEGY_SCAFFOLD).toContain('class MyStrategy(Strategy):');
    expect(STRATEGY_SCAFFOLD).toContain('universe: list[tuple[str, str]] = []');
    expect(STRATEGY_SCAFFOLD).toContain('def prices_to_signals(self, prices: pd.DataFrame) -> pd.DataFrame:');
    // Written to disk verbatim — a POSIX file ends in exactly one newline.
    expect(STRATEGY_SCAFFOLD.endsWith('\n')).toBe(true);
    expect(STRATEGY_SCAFFOLD.endsWith('\n\n')).toBe(false);
  });
});

/**
 * Drift guard: the newFileMenu ".py" entry writes its defaultContent to disk
 * verbatim (the host does no templating), so the manifest copy and the module
 * copy must stay byte-identical. If someone edits one, this test flags the
 * other. Reads the real manifest.json, not a fixture.
 */
describe('manifest .py scaffold does not drift from STRATEGY_SCAFFOLD', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../../manifest.json', import.meta.url), 'utf8')
  ) as { contributions?: { newFileMenu?: Array<{ extension?: string; defaultContent?: string }> } };
  const entry = (manifest.contributions?.newFileMenu ?? []).find((e) => e.extension === '.py');

  it('ships a .py newFileMenu entry', () => {
    expect(entry).toBeDefined();
  });

  it('its defaultContent is exactly STRATEGY_SCAFFOLD', () => {
    expect(entry?.defaultContent).toBe(STRATEGY_SCAFFOLD);
  });

  it('the shipped scaffold carries the two anchors the user fills in', () => {
    expect(entry?.defaultContent).toContain('class MyStrategy(Strategy)');
    expect(entry?.defaultContent).toContain('universe: list[tuple[str, str]] = []');
  });
});

describe('isEmptyUniverseError', () => {
  it('is true when the engine stop names an empty universe', () => {
    expect(isEmptyUniverseError('Strategy universe is empty; add symbols first.')).toBe(true);
    // Case-insensitive — engines vary on capitalization.
    expect(isEmptyUniverseError('Universe is empty')).toBe(true);
  });

  it('is false for any other failure', () => {
    expect(isEmptyUniverseError('The backtest run failed.')).toBe(false);
    expect(isEmptyUniverseError('KeyError: close')).toBe(false);
    expect(isEmptyUniverseError('')).toBe(false);
  });
});

describe('emptyUniverseCopy', () => {
  it('titles the fix and names the concrete step in the body', () => {
    const copy = emptyUniverseCopy();
    expect(copy.title).toBe('Add your universe');
    expect(copy.body).toContain('universe');
    expect(copy.body).toContain('(ticker, exchange)');
    expect(copy.body).toContain('Run again');
  });
});

describe('scaffoldRelPath', () => {
  it('numbers the slots Potential/my_strategy[_N].py from the second on', () => {
    expect(scaffoldRelPath(1)).toBe('Potential/my_strategy.py');
    expect(scaffoldRelPath(2)).toBe('Potential/my_strategy_2.py');
    expect(scaffoldRelPath(9)).toBe('Potential/my_strategy_9.py');
  });
});

describe('isSaveConflict', () => {
  it('reads the overwrite guard: a taken slot is a conflict', () => {
    expect(isSaveConflict(409, {})).toBe(true);
    expect(isSaveConflict(200, { error: 'File already exists' })).toBe(true);
    expect(isSaveConflict(400, { detail: 'a strategy with that path already exists' })).toBe(true);
    expect(isSaveConflict(200, { conflict: true })).toBe(true);
  });

  it('a clean save or an unrelated error is not a conflict', () => {
    expect(isSaveConflict(200, { ok: true })).toBe(false);
    expect(isSaveConflict(500, { error: 'engine crashed' })).toBe(false);
    expect(isSaveConflict(0, null)).toBe(false);
  });
});

describe('classifyScaffoldSave', () => {
  it('a clean save is created — the rescue card opens it', () => {
    expect(classifyScaffoldSave(true, 200, { ok: true, created: true })).toEqual({ kind: 'created' });
    // The engine overwrote an existing scaffold slot without signalling a
    // conflict: still a save the card can open, not an error.
    expect(classifyScaffoldSave(true, 200, { ok: true, created: false })).toEqual({ kind: 'created' });
  });

  it('a taken slot is a conflict — the loop steps, carrying the engine message', () => {
    expect(classifyScaffoldSave(false, 409, {})).toEqual({ kind: 'conflict', message: '' });
    expect(classifyScaffoldSave(false, 400, { error: 'a strategy with that path already exists' })).toEqual({
      kind: 'conflict',
      message: 'a strategy with that path already exists',
    });
    expect(classifyScaffoldSave(true, 200, { conflict: true, detail: 'slot in use' })).toEqual({
      kind: 'conflict',
      message: 'slot in use',
    });
  });

  it('any other failure is an error with a message', () => {
    expect(classifyScaffoldSave(false, 400, { ok: false, error: 'SyntaxError on line 3' })).toEqual({
      kind: 'error',
      message: 'SyntaxError on line 3',
    });
    // Transport failure (bridge could not reach the engine).
    expect(classifyScaffoldSave(false, 0, null)).toEqual({
      kind: 'error',
      message: 'Could not create the strategy (engine unreachable).',
    });
  });
});

describe('firstFreeScaffoldRel', () => {
  it('takes the first slot when nothing is taken', () => {
    expect(firstFreeScaffoldRel(new Set())).toBe('Potential/my_strategy.py');
  });

  it('steps past taken basenames to the first free slot', () => {
    expect(firstFreeScaffoldRel(new Set(['my_strategy']))).toBe('Potential/my_strategy_2.py');
    expect(firstFreeScaffoldRel(new Set(['my_strategy', 'my_strategy_2']))).toBe(
      'Potential/my_strategy_3.py'
    );
  });

  it('returns null when every slot (1..9) is taken', () => {
    const all = new Set([scaffoldBasename(1), ...Array.from({ length: 8 }, (_, i) => scaffoldBasename(i + 2))]);
    expect(firstFreeScaffoldRel(all)).toBeNull();
  });

  it('ignores an unrelated taken name', () => {
    expect(firstFreeScaffoldRel(new Set(['breakout', 'my_strategy_3']))).toBe(
      'Potential/my_strategy.py'
    );
  });
});
