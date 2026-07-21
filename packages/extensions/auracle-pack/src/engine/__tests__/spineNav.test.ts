import { describe, expect, it } from 'vitest';

import { strategySourceFromDotted } from '../spineNav';

describe('strategySourceFromDotted — shape awareness', () => {
  it('strips the trailing class only when the caller says the id carries one', () => {
    // Validation reports `module.Class`; the class is not part of the file.
    expect(strategySourceFromDotted('strategies.momentum.Mom', { hasClassSuffix: true })).toEqual({
      path: 'strategies/momentum.py',
      openable: true,
    });
    // A deployment reports the module alone; nothing may be dropped.
    expect(strategySourceFromDotted('strategies.momentum', { hasClassSuffix: false })).toEqual({
      path: 'strategies/momentum.py',
      openable: true,
    });
  });

  it('never drops a real module segment for the module-only shape', () => {
    // With hasClassSuffix:false the last segment is a module, not a class.
    expect(
      strategySourceFromDotted('strategies.pkg.sub.strat', { hasClassSuffix: false })
    ).toEqual({ path: 'strategies/pkg/sub/strat.py', openable: true });
  });

  it('maps a nested workspace strategy the same for both shapes', () => {
    const withClass = strategySourceFromDotted('strategies.pkg.sub.strat.StratClass', {
      hasClassSuffix: true,
    });
    const moduleOnly = strategySourceFromDotted('strategies.pkg.sub.strat', {
      hasClassSuffix: false,
    });
    expect(withClass).toEqual({ path: 'strategies/pkg/sub/strat.py', openable: true });
    expect(moduleOnly).toEqual(withClass);
  });
});

describe('strategySourceFromDotted — non-openable degradations', () => {
  it('flags a desk-grafted strategy as not openable, with a reason and its path', () => {
    const fromValidation = strategySourceFromDotted(
      'strategies.desk.Potential.a3_target25.T25Composite',
      { hasClassSuffix: true }
    );
    const fromDeployment = strategySourceFromDotted(
      'strategies.desk.Potential.a3_target25',
      { hasClassSuffix: false }
    );
    expect(fromValidation).toEqual({
      path: 'strategies/desk/Potential/a3_target25.py',
      openable: false,
      reason: expect.stringContaining('mounted'),
    });
    // Both shapes agree on the desk case.
    expect(fromDeployment).toEqual(fromValidation);
  });

  it('flags a strategy outside the strategies package as not openable', () => {
    const src = strategySourceFromDotted('auracle.examples.momentum.Mom', {
      hasClassSuffix: true,
    });
    expect(src).toEqual({
      path: 'auracle/examples/momentum.py',
      openable: false,
      reason: expect.stringContaining('outside your workspace'),
    });
  });

  it('treats a bare `strategies` module (no submodule) as not openable', () => {
    expect(strategySourceFromDotted('strategies.Mom', { hasClassSuffix: true })).toEqual({
      path: 'strategies.py',
      openable: false,
      reason: expect.stringContaining('outside your workspace'),
    });
  });
});

describe('strategySourceFromDotted — degenerate input', () => {
  it('returns null when there is no module to derive a path from', () => {
    expect(strategySourceFromDotted('', { hasClassSuffix: false })).toBeNull();
    expect(strategySourceFromDotted('   ', { hasClassSuffix: true })).toBeNull();
    // A class-only id (single segment) with hasClassSuffix leaves no module.
    expect(strategySourceFromDotted('Mom', { hasClassSuffix: true })).toBeNull();
  });

  it('tolerates surrounding and interior blank segments', () => {
    expect(strategySourceFromDotted(' strategies..momentum. ', { hasClassSuffix: false })).toEqual(
      { path: 'strategies/momentum.py', openable: true }
    );
  });

  it('never yields an absolute path', () => {
    for (const shape of [true, false]) {
      const src = strategySourceFromDotted('strategies.a.b.C', { hasClassSuffix: shape });
      expect(src?.path.startsWith('/')).toBe(false);
    }
  });
});
