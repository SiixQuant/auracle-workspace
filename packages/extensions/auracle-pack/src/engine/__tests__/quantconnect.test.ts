import { describe, expect, it } from 'vitest';

import {
  QcProject,
  compilePhase,
  headlineStats,
  normalizeProject,
  qcContext,
  qcPrompt,
} from '../quantconnect';

describe('normalizeProject', () => {
  it('coerces id shapes and defaults the name', () => {
    expect(normalizeProject({ projectId: 42, name: 'Alpha', language: 'Py' })).toEqual({
      projectId: 42,
      name: 'Alpha',
      language: 'Py',
    });
    expect(normalizeProject({ id: '7' })).toEqual({
      projectId: 7,
      name: 'Project 7',
      language: '',
    });
    expect(normalizeProject({ name: 'no id' })).toBeNull();
  });
});

describe('compilePhase', () => {
  it('reads QC build states, defaulting to still-building', () => {
    expect(compilePhase('BuildSuccess')).toBe('success');
    expect(compilePhase('BuildError')).toBe('error');
    expect(compilePhase('InQueue')).toBe('building');
    expect(compilePhase(null)).toBe('building');
    expect(compilePhase(undefined)).toBe('building');
  });
});

describe('headlineStats', () => {
  it('picks the headline keys in order and skips blanks/missing', () => {
    const stats = headlineStats({
      'Sharpe Ratio': '1.23',
      'Total Return': '45%',
      'Drawdown': '',
      'Win Rate': '58%',
      'Some Other Stat': '9',
    });
    expect(stats).toEqual([
      { label: 'Sharpe Ratio', value: '1.23' },
      { label: 'Total Return', value: '45%' },
      { label: 'Win Rate', value: '58%' },
    ]);
  });

  it('never throws on missing statistics', () => {
    expect(headlineStats(null)).toEqual([]);
    expect(headlineStats(undefined)).toEqual([]);
    expect(headlineStats({})).toEqual([]);
  });
});

const project: QcProject = { projectId: 42, name: 'Alpha', language: 'Py' };

describe('qcContext (ambient)', () => {
  it('summarizes the active project + translation', () => {
    const ctx = qcContext(project, { coverage: 0.8, unmapped: ['OnData'] }, 'strategies/alpha.py');
    expect(ctx.panel).toBe('qc-import');
    expect(ctx.project_id).toBe(42);
    expect(ctx.imported).toBe(true);
    expect(ctx.coverage).toBe(0.8);
    expect(ctx.unmapped).toEqual(['OnData']);
    expect(ctx.saved_path).toBe('strategies/alpha.py');
  });

  it('marks not-yet-imported when there is no report', () => {
    expect(qcContext(project, null, null).imported).toBe(false);
  });
});

describe('qcPrompt (hand-off)', () => {
  it('references the saved file when saved, and lists the unmapped pieces', () => {
    const prompt = qcPrompt(
      project,
      { coverage: 0.8, unmapped: ['OnData', 'Consolidators'] },
      'strategies/alpha.py'
    );
    expect(prompt).toContain('"Alpha" (#42');
    expect(prompt).toContain('covered 80%');
    expect(prompt).toContain('OnData, Consolidators');
    expect(prompt).toContain('`strategies/alpha.py`');
    expect(prompt).not.toContain('```python');
  });

  it('inlines the scaffold when nothing is saved yet', () => {
    const prompt = qcPrompt(project, { coverage: 0.5, scaffold: 'class Alpha: pass' }, null);
    expect(prompt).toContain('```python');
    expect(prompt).toContain('class Alpha: pass');
  });
});
