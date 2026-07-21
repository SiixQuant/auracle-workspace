import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFocusAmbient,
  focusContext,
  focusStore,
  type Focus,
  type FocusAmbientSink,
} from '../focusStore';

afterEach(() => {
  focusStore.clear();
  vi.useRealTimers();
});

/* ── publish + follow ──────────────────────────────────────────────────── */

describe('focusStore publish / follow', () => {
  it('starts on the unfocused default (empty focus)', () => {
    expect(focusStore.getSnapshot()).toEqual({});
  });

  it('publishes a strategy and reads it back (follow)', () => {
    focusStore.publish({ strategy: { filePath: 'strategies/desk/atlas.py' } });
    expect(focusStore.getSnapshot()).toEqual({
      strategy: { filePath: 'strategies/desk/atlas.py' },
    });
  });

  it('carries a typed run identity for each kind', () => {
    const kinds: Focus['run'][] = [
      { kind: 'backtest', id: '42' },
      { kind: 'deployment', id: 'dep-7' },
      { kind: 'validation', id: 'strategies.desk.atlas.AtlasMomentum' },
    ];
    for (const run of kinds) {
      focusStore.publish({ run });
      expect(focusStore.getSnapshot().run).toEqual(run);
    }
  });

  it('notifies subscribers on a real change and replaces (not merges) focus', () => {
    const seen: Focus[] = [];
    const unsubscribe = focusStore.subscribe(() => seen.push(focusStore.getSnapshot()));

    focusStore.publish({
      strategy: { filePath: 'strategies/a.py', dottedPath: 'strategies.a.A' },
      run: { kind: 'backtest', id: '1' },
    });
    // A fresh publish replaces wholesale — the prior run does not linger.
    focusStore.publish({ strategy: { filePath: 'strategies/b.py' } });

    unsubscribe();
    expect(seen).toHaveLength(2);
    expect(focusStore.getSnapshot()).toEqual({ strategy: { filePath: 'strategies/b.py' } });
  });

  it('is a no-op when the published focus is unchanged', () => {
    const listener = vi.fn();
    const unsubscribe = focusStore.subscribe(listener);

    focusStore.publish({ strategy: { filePath: 'strategies/a.py' } });
    focusStore.publish({ strategy: { filePath: 'strategies/a.py' } });

    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears back to the unfocused default', () => {
    focusStore.publish({ run: { kind: 'deployment', id: 'dep-1' } });
    focusStore.clear();
    expect(focusStore.getSnapshot()).toEqual({});
  });

  it('after unsubscribe stops delivering changes', () => {
    const listener = vi.fn();
    focusStore.subscribe(listener)();
    focusStore.publish({ strategy: { filePath: 'strategies/a.py' } });
    expect(listener).not.toHaveBeenCalled();
  });
});

/* ── ambient precedence + debounce ─────────────────────────────────────── */

function mockSink(): FocusAmbientSink & {
  setContext: ReturnType<typeof vi.fn>;
  clearContext: ReturnType<typeof vi.fn>;
} {
  return { setContext: vi.fn(), clearContext: vi.fn() };
}

describe('createFocusAmbient precedence / debounce', () => {
  it('publishes the minimal focus context after the debounce when no panel writes', () => {
    vi.useFakeTimers();
    const sink = mockSink();
    const ambient = createFocusAmbient(sink, 600);

    ambient.onFocusChange({
      strategy: { filePath: 'strategies/a.py', dottedPath: 'strategies.a.A' },
      run: { kind: 'backtest', id: '9' },
    });
    expect(sink.setContext).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);
    expect(sink.setContext).toHaveBeenCalledTimes(1);
    expect(sink.setContext).toHaveBeenCalledWith({
      panel: 'focus',
      strategy: { file_path: 'strategies/a.py', dotted_path: 'strategies.a.A' },
      run: { kind: 'backtest', id: '9' },
    });
  });

  it('lets an active panel win: an ambient write cancels the fallback', () => {
    vi.useFakeTimers();
    const sink = mockSink();
    const ambient = createFocusAmbient(sink, 600);

    // A panel publishes focus, then writes its own richer context right after.
    ambient.onFocusChange({ strategy: { filePath: 'strategies/a.py' } });
    ambient.onAmbientWrite();

    vi.advanceTimersByTime(600);
    expect(sink.setContext).not.toHaveBeenCalled();
  });

  it('debounces rapid focus changes into one write of the latest focus', () => {
    vi.useFakeTimers();
    const sink = mockSink();
    const ambient = createFocusAmbient(sink, 600);

    ambient.onFocusChange({ strategy: { filePath: 'strategies/a.py' } });
    vi.advanceTimersByTime(300);
    ambient.onFocusChange({ strategy: { filePath: 'strategies/b.py' } });
    vi.advanceTimersByTime(300);
    // 600ms have elapsed overall, but only 300ms since the latest change.
    expect(sink.setContext).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(sink.setContext).toHaveBeenCalledTimes(1);
    expect(sink.setContext).toHaveBeenCalledWith({
      panel: 'focus',
      strategy: { file_path: 'strategies/b.py' },
    });
  });

  it('leaves the ambient document untouched on the unfocused default', () => {
    vi.useFakeTimers();
    const sink = mockSink();
    const ambient = createFocusAmbient(sink, 600);

    ambient.onFocusChange({});
    vi.advanceTimersByTime(600);

    expect(sink.setContext).not.toHaveBeenCalled();
    expect(sink.clearContext).not.toHaveBeenCalled();
  });

  it('clearing focus disarms a pending fallback', () => {
    vi.useFakeTimers();
    const sink = mockSink();
    const ambient = createFocusAmbient(sink, 600);

    ambient.onFocusChange({ strategy: { filePath: 'strategies/a.py' } });
    vi.advanceTimersByTime(300);
    ambient.onFocusChange({});
    vi.advanceTimersByTime(600);

    expect(sink.setContext).not.toHaveBeenCalled();
  });

  it('dispose cancels a pending fallback', () => {
    vi.useFakeTimers();
    const sink = mockSink();
    const ambient = createFocusAmbient(sink, 600);

    ambient.onFocusChange({ run: { kind: 'validation', id: 'strategies.a.A' } });
    ambient.dispose();
    vi.advanceTimersByTime(600);

    expect(sink.setContext).not.toHaveBeenCalled();
  });
});

/* ── minimal payload shape ─────────────────────────────────────────────── */

describe('focusContext', () => {
  it('omits the dotted path when unknown and omits absent fields', () => {
    expect(focusContext({ strategy: { filePath: 'strategies/a.py' } })).toEqual({
      panel: 'focus',
      strategy: { file_path: 'strategies/a.py' },
    });
    expect(focusContext({ run: { kind: 'deployment', id: 'dep-3' } })).toEqual({
      panel: 'focus',
      run: { kind: 'deployment', id: 'dep-3' },
    });
    expect(focusContext({})).toEqual({ panel: 'focus' });
  });
});
