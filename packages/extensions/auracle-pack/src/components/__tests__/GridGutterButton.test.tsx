/**
 * The rail badge is the only thing that can say "something needs you" once
 * every surface lives behind one button, so its number has to come from the
 * engine's incident feed and follow it — including down to nothing, and
 * including an engine that stops answering (which must read zero, not the
 * last count it managed to fetch).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../engine/client', () => ({
  getJson: vi.fn(),
  onConnectGeneration: vi.fn(() => () => {}),
}));

import { getJson } from '../../engine/client';
import { alertStore } from '../../engine/alertStore';
import { GridGutterButton } from '../grid/GridGutterButton';

/** `n` open incidents on the feed the badge reads. */
function feed(n: number): void {
  vi.mocked(getJson).mockResolvedValue({
    incidents: Array.from({ length: n }, (_, i) => ({ id: i, severity: 'warning' })),
  } as never);
}

/** The engine did not answer — getJson erases the body. */
function unreachable(): void {
  vi.mocked(getJson).mockResolvedValue(null as never);
}

async function refresh(): Promise<void> {
  await act(async () => {
    await alertStore.refresh();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  cleanup();
  // Drain the store back to zero so the module-level count can't leak.
  unreachable();
  await refresh();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function renderButton(onActivate = vi.fn()): { onActivate: ReturnType<typeof vi.fn> } {
  render(<GridGutterButton isActive={false} onActivate={onActivate} theme="dark" />);
  return { onActivate };
}

describe('the badge carries the open-alert count', () => {
  it('shows the number the incident feed reports', async () => {
    feed(3);
    renderButton();
    await refresh();

    expect(screen.getByTestId('auracle-grid-gutter-badge').textContent).toBe('3');
    expect(screen.getByTestId('auracle-grid-gutter-button').getAttribute('data-alert-count')).toBe(
      '3'
    );
  });

  it('follows the feed down and back up', async () => {
    feed(2);
    renderButton();
    await refresh();
    expect(screen.getByTestId('auracle-grid-gutter-badge').textContent).toBe('2');

    feed(5);
    await refresh();
    expect(screen.getByTestId('auracle-grid-gutter-badge').textContent).toBe('5');

    feed(0);
    await refresh();
    // No alerts, no badge — a "0" is decoration, not information.
    expect(screen.queryByTestId('auracle-grid-gutter-badge')).toBeNull();
    expect(screen.getByTestId('auracle-grid-gutter-button').getAttribute('data-alert-count')).toBe(
      '0'
    );
  });

  it('reads zero when the engine did not answer, never a stale count', async () => {
    feed(4);
    renderButton();
    await refresh();
    expect(screen.getByTestId('auracle-grid-gutter-badge').textContent).toBe('4');

    unreachable();
    await refresh();
    expect(screen.queryByTestId('auracle-grid-gutter-badge')).toBeNull();
  });

  it('caps the glyph but keeps the exact count readable to a screen reader', async () => {
    feed(140);
    renderButton();
    await refresh();

    expect(screen.getByTestId('auracle-grid-gutter-badge').textContent).toBe('99+');
    expect(screen.getByTestId('auracle-grid-gutter-button').getAttribute('aria-label')).toBe(
      'Auracle (140 open alerts)'
    );
  });

  it('names the count for a screen reader, singular and plural', async () => {
    feed(1);
    renderButton();
    await refresh();
    expect(screen.getByTestId('auracle-grid-gutter-button').getAttribute('aria-label')).toBe(
      'Auracle (1 open alert)'
    );

    feed(2);
    await refresh();
    expect(screen.getByTestId('auracle-grid-gutter-button').getAttribute('aria-label')).toBe(
      'Auracle (2 open alerts)'
    );
  });
});

describe('the button still opens the panel', () => {
  it('activates on click', async () => {
    feed(0);
    const { onActivate } = renderButton();
    await refresh();

    fireEvent.click(screen.getByTestId('auracle-grid-gutter-button'));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

describe('the feed is only polled while something is watching', () => {
  it('reads on mount and stops polling once the button unmounts', async () => {
    feed(1);
    renderButton();
    // The mount read is the store's own; let it settle.
    await act(async () => {});
    const afterMount = vi.mocked(getJson).mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    cleanup();
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(vi.mocked(getJson).mock.calls.length).toBe(afterMount);
  });
});
