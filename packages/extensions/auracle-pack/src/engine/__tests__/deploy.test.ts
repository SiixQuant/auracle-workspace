import { describe, expect, it } from 'vitest';

import {
  blockedReasonText,
  deployWizardMode,
  exclusionsFromDiscovery,
  resolveDeployableFromFile,
  splitDiscoveryByKind,
  type DeploySnapshot,
  type StrategyOption,
} from '../deploy';

/** A discovery row as the engine's ?deployable=1 endpoint returns it. */
const row = (path: string, kind: 'class' | 'function' = 'class', doc = '') => ({ path, kind, doc });

const T25 = 'strategies.desk.Potential.a3_target25.T25Composite';
const SFX_FN = 'strategies.desk.Potential.a2_sfx_longshort.backtest_angel_engine';

describe('splitDiscoveryByKind', () => {
  it('separates class rows from function rows, defaulting missing kind to class', () => {
    const { classes, functions } = splitDiscoveryByKind([
      row(T25, 'class'),
      row(SFX_FN, 'function'),
      { path: 'strategies.desk.legacy.Legacy' }, // no kind -> class
    ]);
    expect(classes.map((c) => c.cls).sort()).toEqual(['Legacy', 'T25Composite']);
    expect(functions.map((f) => f.cls)).toEqual(['backtest_angel_engine']);
  });

  it('is empty for empty input', () => {
    expect(splitDiscoveryByKind([])).toEqual({ classes: [], functions: [] });
  });
});

describe('resolveDeployableFromFile', () => {
  it('binds a single-class file to its one deployable strategy', () => {
    const r = resolveDeployableFromFile(
      '/Users/x/Desktop/Auracle Strategies/Potential/a3_target25.py',
      [row(T25), row(SFX_FN, 'function')]
    );
    expect(r.kind).toBe('one');
    if (r.kind === 'one') expect(r.option.path).toBe(T25);
  });

  it('returns many scoped to that file when it defines several classes', () => {
    const r = resolveDeployableFromFile('/w/pair.py', [
      row('strategies.desk.pair.Foo'),
      row('strategies.desk.pair.Bar'),
      row('strategies.desk.other.Other'),
    ]);
    expect(r.kind).toBe('many');
    if (r.kind === 'many') expect(r.options.map((o) => o.cls).sort()).toEqual(['Bar', 'Foo']);
  });

  it('blocks a function-only file with the backtest-function reason', () => {
    const r = resolveDeployableFromFile('/w/Potential/a2_sfx_longshort.py', [
      row(T25), // a class, but a different file
      row(SFX_FN, 'function'),
    ]);
    expect(r.kind).toBe('blocked');
    if (r.kind === 'blocked') expect(r.reason).toBe('function-only');
  });

  it('prefers the class when a file has both a class and a backtest function', () => {
    const r = resolveDeployableFromFile('/w/combo.py', [
      row('strategies.desk.combo.Combo', 'class'),
      row('strategies.desk.combo.backtest_combo', 'function'),
    ]);
    expect(r.kind).toBe('one');
    if (r.kind === 'one') expect(r.option.cls).toBe('Combo');
  });

  it('blocks an unmatched file as no-match', () => {
    const r = resolveDeployableFromFile('/w/utils.py', [row(T25), row(SFX_FN, 'function')]);
    expect(r.kind).toBe('blocked');
    if (r.kind === 'blocked') expect(r.reason).toBe('no-match');
  });

  it('blocks (no-match) when discovery is empty', () => {
    const r = resolveDeployableFromFile('/w/anything.py', []);
    expect(r.kind).toBe('blocked');
    if (r.kind === 'blocked') expect(r.reason).toBe('no-match');
  });
});

describe('exclusionsFromDiscovery', () => {
  it('reads file + reason rows from the additive field', () => {
    const excl = exclusionsFromDiscovery({
      excluded: [
        { file: 'strategies/desk/broken.py', reason: "ImportError: No module named 'ta'" },
        { file: 'strategies/desk/notes.py', reason: 'no Strategy class' },
      ],
    });
    expect(excl).toHaveLength(2);
    expect(excl[0]).toEqual({ file: 'strategies/desk/broken.py', reason: "ImportError: No module named 'ta'" });
  });

  it('renders nothing on an older engine that omits the field', () => {
    expect(exclusionsFromDiscovery({ strategies: [] } as never)).toEqual([]);
    expect(exclusionsFromDiscovery({})).toEqual([]);
    expect(exclusionsFromDiscovery(null)).toEqual([]);
    expect(exclusionsFromDiscovery(undefined)).toEqual([]);
  });

  it('tolerates a non-array field and drops entries without a file', () => {
    expect(exclusionsFromDiscovery({ excluded: 'oops' as never })).toEqual([]);
    expect(
      exclusionsFromDiscovery({ excluded: [{ reason: 'no file' }, { file: 'ok.py', reason: 'x' }] as never })
    ).toEqual([{ file: 'ok.py', reason: 'x' }]);
  });
});

describe('blockedReasonText', () => {
  it('names the backtest-function reason for a function-only file', () => {
    const { title, detail } = blockedReasonText('function-only');
    expect(title.toLowerCase()).toContain('deploy live');
    expect(detail).toContain('Strategy class');
    expect(detail).toContain('backtest');
  });

  it('points a no-match file at the exclusions list', () => {
    const { detail } = blockedReasonText('no-match');
    expect(detail).toContain('exclusions');
  });
});

describe('deployWizardMode', () => {
  const base: DeploySnapshot = { file: null, phase: 'idle', option: null, options: [], reason: null, outdated: false };
  const option: StrategyOption = { path: T25, cls: 'T25Composite', label: 'T25Composite' };

  it('shows the global picker for no binding (null or idle)', () => {
    expect(deployWizardMode(null)).toEqual({ view: 'form', locked: null });
    expect(deployWizardMode(base)).toEqual({ view: 'form', locked: null });
  });

  it('locks the identity row for a single resolved strategy', () => {
    expect(deployWizardMode({ ...base, phase: 'one', option })).toEqual({ view: 'form', locked: option });
  });

  it('offers a scoped chooser for an ambiguous file', () => {
    const mode = deployWizardMode({ ...base, phase: 'many', options: [option] });
    expect(mode).toEqual({ view: 'chooser', options: [option] });
  });

  it('shows the honest blocked state with its reason', () => {
    expect(deployWizardMode({ ...base, phase: 'blocked', reason: 'function-only' })).toEqual({
      view: 'blocked',
      reason: 'function-only',
    });
  });

  it('surfaces the engine-down state and its outdated flag', () => {
    expect(deployWizardMode({ ...base, phase: 'engine-down', outdated: true })).toEqual({
      view: 'engine-down',
      outdated: true,
    });
  });

  it('shows the resolving placeholder while in flight', () => {
    expect(deployWizardMode({ ...base, phase: 'resolving' })).toEqual({ view: 'resolving' });
  });
});
