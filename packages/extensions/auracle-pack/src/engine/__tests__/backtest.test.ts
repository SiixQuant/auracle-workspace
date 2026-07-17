import { describe, expect, it } from 'vitest';

import {
  backtestContext,
  backtestPrompt,
  excludedFromDiscovery,
  excludedReasonForFile,
  fileStem,
  knownStrategyBasenames,
  moduleOf,
  resolveStrategyFromFile,
  strategyOptionsFromDiscovery,
  type StrategyOption,
} from '../backtest';

describe('strategyOptionsFromDiscovery', () => {
  it('shapes rows into class + label and drops empty paths', () => {
    const opts = strategyOptionsFromDiscovery([
      { path: 'strategies.desk.momo.Momo', doc: 'Momentum book' },
      { path: 'strategies.example_ma.MACrossover' },
      { path: '' },
      { doc: 'no path' },
    ]);
    expect(opts).toHaveLength(2);
    expect(opts[0]).toEqual({
      path: 'strategies.desk.momo.Momo',
      cls: 'Momo',
      label: 'Momo — Momentum book',
    });
    // No docstring -> label is just the class name.
    expect(opts[1].label).toBe('MACrossover');
  });
});

describe('fileStem / moduleOf', () => {
  it('fileStem strips the directory and the .py suffix', () => {
    expect(fileStem('/Users/x/Desktop/Auracle Strategies/Potential/a3_target25.py')).toBe('a3_target25');
    expect(fileStem('strategies/example_ma.py')).toBe('example_ma');
    expect(fileStem('Bare.PY')).toBe('Bare');
  });

  it('moduleOf drops the trailing symbol segment', () => {
    expect(moduleOf('strategies.desk.Potential.a3_target25.T25Composite')).toBe(
      'strategies.desk.Potential.a3_target25'
    );
    expect(moduleOf('strategies.example_ma.MACrossover')).toBe('strategies.example_ma');
  });
});

describe('resolveStrategyFromFile', () => {
  const opt = (path: string): StrategyOption => strategyOptionsFromDiscovery([{ path }])[0];
  const t25 = opt('strategies.desk.Potential.a3_target25.T25Composite');
  const sfxFn = opt('strategies.desk.Potential.a2_sfx_longshort.backtest_angel_engine');
  const ma = opt('strategies.example_ma.MACrossover');

  it('matches a nested Strategy class file to its one discovery id', () => {
    const r = resolveStrategyFromFile(
      '/Users/x/Desktop/Auracle Strategies/Potential/a3_target25.py',
      [t25, sfxFn, ma]
    );
    expect(r.kind).toBe('one');
    if (r.kind === 'one') expect(r.option.path).toBe('strategies.desk.Potential.a3_target25.T25Composite');
  });

  it('matches a function strategy file the same way (module basename, not the symbol)', () => {
    const r = resolveStrategyFromFile('/w/a2_sfx_longshort.py', [t25, sfxFn, ma]);
    expect(r.kind).toBe('one');
    if (r.kind === 'one') expect(r.option.cls).toBe('backtest_angel_engine');
  });

  it('matches a top-level module file', () => {
    const r = resolveStrategyFromFile('/w/strategies/example_ma.py', [t25, ma]);
    expect(r.kind).toBe('one');
  });

  it('returns many when a file defines more than one strategy', () => {
    const foo = opt('strategies.desk.pair.Foo');
    const bar = opt('strategies.desk.pair.Bar');
    const r = resolveStrategyFromFile('/w/pair.py', [foo, bar, ma]);
    expect(r.kind).toBe('many');
    if (r.kind === 'many') expect(r.options.map((o) => o.cls).sort()).toEqual(['Bar', 'Foo']);
  });

  it('returns none when the open file is not a discovered strategy', () => {
    expect(resolveStrategyFromFile('/w/utils.py', [t25, ma]).kind).toBe('none');
    expect(resolveStrategyFromFile('', [t25]).kind).toBe('none');
  });

  it('disambiguates same-basename files in different packages by directory', () => {
    const potential = opt('strategies.desk.Potential.breakout.Breakout');
    const sandbox = opt('strategies.desk.Sandbox.breakout.Breakout');
    // Opening the Sandbox file must run the Sandbox strategy, not Potential's.
    const r = resolveStrategyFromFile(
      '/Users/x/Desktop/Auracle Strategies/Sandbox/breakout.py',
      [potential, sandbox]
    );
    expect(r.kind).toBe('one');
    if (r.kind === 'one') expect(r.option.path).toBe('strategies.desk.Sandbox.breakout.Breakout');
  });

  it('still resolves a nested file when only its directory sibling shares the stem', () => {
    const potential = opt('strategies.desk.Potential.breakout.Breakout');
    const sandbox = opt('strategies.desk.Sandbox.breakout.Breakout');
    const r = resolveStrategyFromFile(
      '/Users/x/Desktop/Auracle Strategies/Potential/breakout.py',
      [potential, sandbox]
    );
    expect(r.kind).toBe('one');
    if (r.kind === 'one') expect(r.option.path).toBe('strategies.desk.Potential.breakout.Breakout');
  });

  it('handles Windows path separators', () => {
    const r = resolveStrategyFromFile('C:\\w\\Potential\\a3_target25.py', [t25, ma]);
    expect(r.kind).toBe('one');
    if (r.kind === 'one') expect(r.option.path).toBe('strategies.desk.Potential.a3_target25.T25Composite');
  });
});

describe('excludedFromDiscovery', () => {
  it('shapes rows into {path, reason}, tolerating field-name variants', () => {
    const rows = excludedFromDiscovery([
      { path: 'strategies/desk/Potential/my_strategy.py', reason: 'universe is empty' },
      { rel_path: 'strategies/desk/Sandbox/scratch.py', detail: 'no Strategy subclass found' },
      { file: 'strategies/desk/Potential/wip.py', why: 'syntax error on line 3' },
      // Dropped: no path, or no reason.
      { reason: 'orphan reason' },
      { path: 'strategies/desk/Potential/lonely.py' },
    ]);
    expect(rows).toEqual([
      { path: 'strategies/desk/Potential/my_strategy.py', reason: 'universe is empty' },
      { path: 'strategies/desk/Sandbox/scratch.py', reason: 'no Strategy subclass found' },
      { path: 'strategies/desk/Potential/wip.py', reason: 'syntax error on line 3' },
    ]);
  });

  it('is empty for a non-array or absent value', () => {
    expect(excludedFromDiscovery(undefined)).toEqual([]);
    expect(excludedFromDiscovery({ nope: 1 })).toEqual([]);
  });
});

describe('excludedReasonForFile', () => {
  const excluded = excludedFromDiscovery([
    { path: 'strategies/desk/Potential/my_strategy.py', reason: 'universe is empty' },
    { path: 'strategies/desk/Sandbox/breakout.py', reason: 'no Strategy subclass found' },
  ]);

  it('returns the reason of the excluded file the open file matches by trailing segments', () => {
    expect(
      excludedReasonForFile('/Users/x/Desktop/Auracle Strategies/Potential/my_strategy.py', excluded)
    ).toBe('universe is empty');
  });

  it('matches a dotted-module excluded path too', () => {
    const dotted = excludedFromDiscovery([
      { path: 'strategies.desk.Potential.my_strategy', reason: 'universe is empty' },
    ]);
    expect(excludedReasonForFile('/w/Potential/my_strategy.py', dotted)).toBe('universe is empty');
  });

  it('disambiguates same-stem excluded files by directory', () => {
    const both = excludedFromDiscovery([
      { path: 'strategies/desk/Potential/breakout.py', reason: 'potential reason' },
      { path: 'strategies/desk/Sandbox/breakout.py', reason: 'sandbox reason' },
    ]);
    expect(excludedReasonForFile('/w/Sandbox/breakout.py', both)).toBe('sandbox reason');
  });

  it('returns null when nothing shares the stem', () => {
    expect(excludedReasonForFile('/w/Potential/unrelated.py', excluded)).toBeNull();
    expect(excludedReasonForFile('', excluded)).toBeNull();
    expect(excludedReasonForFile('/w/x.py', [])).toBeNull();
  });
});

describe('backtestContext / backtestPrompt', () => {
  const run = { strategyPath: 'strategies.desk.momo.Momo', cls: 'Momo', jobId: 42 };

  it('context is compact and panel-tagged', () => {
    expect(backtestContext(run)).toEqual({
      panel: 'backtest',
      strategy_path: 'strategies.desk.momo.Momo',
      job_id: 42,
    });
  });

  it('prompt names the strategy + job and points the agent at the engine', () => {
    const p = backtestPrompt(run);
    expect(p).toContain('strategies.desk.momo.Momo');
    expect(p).toContain('job 42');
    expect(p).toContain('re-run the backtest');
  });
});

describe('knownStrategyBasenames', () => {
  it('collects module basenames from discovered options and excluded files', () => {
    const options: StrategyOption[] = [
      { path: 'strategies.desk.Potential.my_strategy.MyStrategy', cls: 'MyStrategy', label: 'MyStrategy' },
      { path: 'strategies.desk.Live.t25.T25', cls: 'T25', label: 'T25' },
    ];
    // Excluded entries carry the file path relative to the strategies root.
    const excluded = [
      { path: 'desk/Potential/my_strategy_2.py', reason: 'no Strategy class' },
      { path: 'desk/Sandbox/broken.py', reason: 'ImportError' },
    ];
    const taken = knownStrategyBasenames(options, excluded);
    expect(taken.has('my_strategy')).toBe(true);
    expect(taken.has('t25')).toBe(true);
    expect(taken.has('my_strategy_2')).toBe(true);
    expect(taken.has('broken')).toBe(true);
    expect(taken.has('never_seen')).toBe(false);
  });

  it('is empty for empty discovery', () => {
    expect(knownStrategyBasenames([], []).size).toBe(0);
  });
});
