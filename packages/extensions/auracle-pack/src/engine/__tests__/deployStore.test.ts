import { afterEach, describe, expect, it } from 'vitest';

import { deployStore } from '../deployStore';

/**
 * Stub the main-process engine bridge the client calls. deploy() only hits
 * GET /ui/api/backtest/strategies?deployable=1, so one response drives it.
 */
function installBridge(response: { ok: boolean; status: number; body: unknown }) {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    invoke: async (channel: string) => (channel === 'auracle:engine-request' ? response : null),
  };
}

const ok = (strategies: Array<Record<string, unknown>>) => ({
  ok: true,
  status: 200,
  body: { strategies },
});

const row = (path: string, kind: 'class' | 'function' = 'class') => ({ path, kind });

afterEach(() => {
  deployStore.clear();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('deployStore.deploy resolution → binding', () => {
  it('binds a single-class file (phase one)', async () => {
    installBridge(ok([row('strategies.desk.atlas.AtlasMomentum')]));
    await deployStore.deploy('/w/desk/atlas.py');
    const snap = deployStore.getSnapshot();
    expect(snap.phase).toBe('one');
    expect(snap.option?.cls).toBe('AtlasMomentum');
    expect(snap.file).toBe('/w/desk/atlas.py');
  });

  it('offers a scoped chooser for a multi-class file (phase many)', async () => {
    installBridge(ok([row('strategies.desk.pair.Foo'), row('strategies.desk.pair.Bar')]));
    await deployStore.deploy('/w/desk/pair.py');
    const snap = deployStore.getSnapshot();
    expect(snap.phase).toBe('many');
    expect(snap.options.map((o) => o.cls).sort()).toEqual(['Bar', 'Foo']);
  });

  it('blocks a function-only file with the backtest reason', async () => {
    installBridge(ok([row('strategies.desk.signals.backtest_meanrev', 'function')]));
    await deployStore.deploy('/w/desk/signals.py');
    const snap = deployStore.getSnapshot();
    expect(snap.phase).toBe('blocked');
    expect(snap.reason).toBe('function-only');
  });

  it('blocks an unrecognized file as no-match', async () => {
    installBridge(ok([row('strategies.desk.atlas.AtlasMomentum')]));
    await deployStore.deploy('/w/desk/scratch.py');
    const snap = deployStore.getSnapshot();
    expect(snap.phase).toBe('blocked');
    expect(snap.reason).toBe('no-match');
  });

  it('reports engine-down (outdated) on a 404 and unreachable on a dead socket', async () => {
    installBridge({ ok: false, status: 404, body: null });
    await deployStore.deploy('/w/desk/atlas.py');
    expect(deployStore.getSnapshot()).toMatchObject({ phase: 'engine-down', outdated: true });

    installBridge({ ok: false, status: 0, body: null });
    await deployStore.deploy('/w/desk/atlas.py');
    expect(deployStore.getSnapshot()).toMatchObject({ phase: 'engine-down', outdated: false });
  });
});

describe('deployStore.choose / clear', () => {
  it('locks the wizard to a chosen option, then clears back to idle', () => {
    deployStore.choose({ path: 'strategies.desk.pair.Foo', cls: 'Foo', label: 'Foo' });
    expect(deployStore.getSnapshot()).toMatchObject({ phase: 'one', option: { cls: 'Foo' } });

    deployStore.clear();
    expect(deployStore.getSnapshot().phase).toBe('idle');
  });
});
