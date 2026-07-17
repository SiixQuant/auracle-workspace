import { describe, expect, it } from 'vitest';
import {
  applyModeVisibility,
  countTreeFiles,
  isSimpleAllowlistedFile,
  normalizeVisibilityPath,
  SIMPLE_MODE_ALLOWED_EXTENSIONS,
  CANONICAL_FOLDERS,
  type ModeTreeNode,
} from '../modeVisibility';

/**
 * Unit tests for the Simple/Developer mode tree-visibility decision.
 *
 * `applyModeVisibility` is the pure chokepoint that Simple mode composes on
 * top of the user-selectable file-tree filter. Developer mode is identity;
 * Simple mode keeps a positive allowlist of file classes, the Canonical
 * folders as containers, and any open/revealed file (via `openPaths`).
 */

function file(path: string): ModeTreeNode {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { name, path, type: 'file' };
}

function dir(path: string, children: ModeTreeNode[] = []): ModeTreeNode {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { name, path, type: 'directory', children };
}

const NO_OPEN = new Set<string>();

describe('applyModeVisibility - developer mode identity', () => {
  it('returns the raw tree unchanged (same reference) when developer mode is on', () => {
    const tree = [dir('/ws/node_modules', [file('/ws/node_modules/index.js')]), file('/ws/data.csv')];
    const result = applyModeVisibility(tree, { developerMode: true, openPaths: NO_OPEN });
    expect(result).toBe(tree);
  });
});

describe('applyModeVisibility - allowlist', () => {
  it('keeps .py strategy files (allowlist explicitly includes .py)', () => {
    const tree = [file('/ws/alpha.py')];
    const result = applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN });
    expect(result.map(n => n.name)).toEqual(['alpha.py']);
  });

  it('keeps every allowlisted class: .py .flow.json .md .pdf .ipynb', () => {
    const tree = [
      file('/ws/a.py'),
      file('/ws/b.flow.json'),
      file('/ws/c.md'),
      file('/ws/d.pdf'),
      file('/ws/e.ipynb'),
    ];
    const result = applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN });
    expect(result.map(n => n.name)).toEqual(['a.py', 'b.flow.json', 'c.md', 'd.pdf', 'e.ipynb']);
  });

  it('hides non-allowlisted files: .json, .csv, and a bare slate.json', () => {
    const tree = [
      file('/ws/config.json'),
      file('/ws/prices.csv'),
      file('/ws/slate.json'),
      file('/ws/keep.py'),
    ];
    const result = applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN });
    expect(result.map(n => n.name)).toEqual(['keep.py']);
  });

  it('does not treat a plain .json as the compound .flow.json', () => {
    const tree = [file('/ws/strategy.json'), file('/ws/strategy.flow.json')];
    const result = applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN });
    expect(result.map(n => n.name)).toEqual(['strategy.flow.json']);
  });

  it('matches extensions case-insensitively', () => {
    const tree = [file('/ws/Report.PDF'), file('/ws/Model.PY')];
    const result = applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN });
    expect(result.map(n => n.name)).toEqual(['Report.PDF', 'Model.PY']);
  });
});

describe('applyModeVisibility - canonical folders', () => {
  it('shows a top-level canonical folder even when it is empty', () => {
    const tree = [dir('/ws/Potential', [])];
    const result = applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN });
    expect(result.map(n => n.name)).toEqual(['Potential']);
    expect(result[0].children).toEqual([]);
  });

  it('shows a canonical folder that contains only hidden files, as an empty container', () => {
    const tree = [dir('/ws/Analysis', [file('/ws/Analysis/notes.csv'), file('/ws/Analysis/.no-strategies')])];
    const result = applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN });
    expect(result.map(n => n.name)).toEqual(['Analysis']);
    expect(result[0].children).toEqual([]);
  });

  it('keeps every canonical folder as a container', () => {
    const tree = [...CANONICAL_FOLDERS].map(name => dir(`/ws/${name}`, []));
    const result = applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN });
    expect(new Set(result.map(n => n.name))).toEqual(CANONICAL_FOLDERS);
  });

  it('does not treat a nested folder named like a canonical folder as canonical', () => {
    // "Testing" is only canonical at the top level.
    const tree = [dir('/ws/Potential', [dir('/ws/Potential/Testing', [])])];
    const result = applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN });
    expect(result.map(n => n.name)).toEqual(['Potential']);
    expect(result[0].children).toEqual([]);
  });
});

describe('applyModeVisibility - non-canonical directories', () => {
  it('drops a non-canonical directory that has no surviving children', () => {
    const tree = [dir('/ws/scratch', [file('/ws/scratch/tmp.csv')])];
    const result = applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN });
    expect(result).toEqual([]);
  });

  it('keeps a non-canonical directory that has at least one surviving child', () => {
    const tree = [dir('/ws/ideas', [file('/ws/ideas/momentum.py'), file('/ws/ideas/scratch.csv')])];
    const result = applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN });
    expect(result.map(n => n.name)).toEqual(['ideas']);
    expect(result[0].children!.map(n => n.name)).toEqual(['momentum.py']);
  });
});

describe('applyModeVisibility - open-tab / revealed exemption', () => {
  it('keeps an off-allowlist file when its path is in openPaths', () => {
    const tree = [file('/ws/notebook.csv')];
    const openPaths = new Set([normalizeVisibilityPath('/ws/notebook.csv')]);
    const result = applyModeVisibility(tree, { developerMode: false, openPaths });
    expect(result.map(n => n.name)).toEqual(['notebook.csv']);
  });

  it('keeps a non-canonical directory alive because a descendant is open', () => {
    const tree = [dir('/ws/vendor', [file('/ws/vendor/data.csv')])];
    const openPaths = new Set([normalizeVisibilityPath('/ws/vendor/data.csv')]);
    const result = applyModeVisibility(tree, { developerMode: false, openPaths });
    expect(result.map(n => n.name)).toEqual(['vendor']);
    expect(result[0].children!.map(n => n.name)).toEqual(['data.csv']);
  });

  it('matches open paths regardless of slash direction', () => {
    const tree = [file('/ws/vendor/data.csv')];
    const openPaths = new Set([normalizeVisibilityPath('\\ws\\vendor\\data.csv')]);
    const result = applyModeVisibility(tree, { developerMode: false, openPaths });
    expect(result.map(n => n.name)).toEqual(['data.csv']);
  });

  it('keeps a directly-revealed hidden folder as a container (reveal is never a no-op)', () => {
    const tree = [dir('/ws/scratch', [file('/ws/scratch/tmp.csv')])];
    const openPaths = new Set([normalizeVisibilityPath('/ws/scratch')]);
    const result = applyModeVisibility(tree, { developerMode: false, openPaths });
    expect(result.map(n => n.name)).toEqual(['scratch']);
  });
});

describe('applyModeVisibility - nested recursion', () => {
  it('recurses through mixed nesting, pruning hidden branches', () => {
    const tree = [
      dir('/ws/Potential', [
        dir('/ws/Potential/mean_reversion', [
          file('/ws/Potential/mean_reversion/entry.py'),
          file('/ws/Potential/mean_reversion/params.json'),
        ]),
        dir('/ws/Potential/empty', [file('/ws/Potential/empty/log.csv')]),
      ]),
      dir('/ws/build', [file('/ws/build/out.js')]),
      file('/ws/README.md'),
    ];
    const result = applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN });

    // Top level: Potential (canonical, has surviving child) + README.md; build dropped.
    expect(result.map(n => n.name)).toEqual(['Potential', 'README.md']);
    const potential = result[0];
    // mean_reversion survives (entry.py); empty dropped (only a .csv).
    expect(potential.children!.map(n => n.name)).toEqual(['mean_reversion']);
    expect(potential.children![0].children!.map(n => n.name)).toEqual(['entry.py']);
  });
});

describe('countTreeFiles - hidden-count derivation', () => {
  it('counts files across nested directories, ignoring directories themselves', () => {
    const tree = [
      dir('/ws/Potential', [file('/ws/Potential/a.py'), file('/ws/Potential/b.csv')]),
      dir('/ws/empty', []),
      file('/ws/c.md'),
    ];
    expect(countTreeFiles(tree)).toBe(3);
  });

  it('derives the hidden count as before minus after', () => {
    const tree = [
      dir('/ws/Potential', [
        file('/ws/Potential/keep.py'),
        file('/ws/Potential/hide1.csv'),
        file('/ws/Potential/hide2.json'),
      ]),
    ];
    const before = countTreeFiles(tree);
    const after = countTreeFiles(applyModeVisibility(tree, { developerMode: false, openPaths: NO_OPEN }));
    expect(before).toBe(3);
    expect(after).toBe(1);
    expect(before - after).toBe(2);
  });

  it('reports zero hidden in developer mode (identity)', () => {
    const tree = [file('/ws/a.csv'), file('/ws/b.py')];
    const before = countTreeFiles(tree);
    const after = countTreeFiles(applyModeVisibility(tree, { developerMode: true, openPaths: NO_OPEN }));
    expect(before - after).toBe(0);
  });
});

describe('module constants', () => {
  it('exposes the Simple allowlist with .py included', () => {
    expect(SIMPLE_MODE_ALLOWED_EXTENSIONS).toContain('.py');
    expect(SIMPLE_MODE_ALLOWED_EXTENSIONS).toContain('.flow.json');
    expect(SIMPLE_MODE_ALLOWED_EXTENSIONS).not.toContain('.json');
  });

  it('exposes the six canonical folders', () => {
    expect(CANONICAL_FOLDERS).toEqual(
      new Set(['Potential', 'Live', 'Tearsheets', 'Testing', 'Trashed', 'Analysis'])
    );
  });

  it('isSimpleAllowlistedFile matches allowlisted names and rejects others', () => {
    expect(isSimpleAllowlistedFile('alpha.py')).toBe(true);
    expect(isSimpleAllowlistedFile('graph.flow.json')).toBe(true);
    expect(isSimpleAllowlistedFile('Report.PDF')).toBe(true);
    expect(isSimpleAllowlistedFile('data.csv')).toBe(false);
    expect(isSimpleAllowlistedFile('config.json')).toBe(false);
  });
});
