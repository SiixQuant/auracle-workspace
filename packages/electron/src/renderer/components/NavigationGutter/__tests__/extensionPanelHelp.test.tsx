/**
 * An extension panel's manifest `tooltip` must be reachable from its gutter
 * button — including panels that bring their own button, which is the Auracle
 * pack's case. These tests serve the pack's REAL manifest through the real
 * registry sync into the real NavigationGutter, hover the button, and read the
 * help tooltip a user would see.
 *
 * Faked boundaries, exactly: the extension loader (in production it reads the
 * same manifest.json from disk), the pack's exported button component (a
 * single-root stub stands in; the pack's own registration test pins that the
 * real export exists), and the gutter's off-topic children with IPC/service
 * wiring. The registry, the gutter markup, HelpTooltip, and HelpContent all
 * run for real, on the same Jotai store the app mounts with.
 */
// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import type { LoadedPanel } from '@nimbalyst/runtime';
import { store } from '@nimbalyst/runtime/store';
import auraclePackManifest from '../../../../../../extensions/auracle-pack/manifest.json';
import { initializePanelRegistry } from '../../../extensions/panels/PanelRegistry';
import { NavigationGutter } from '../NavigationGutter';

const loaderState = vi.hoisted(() => ({
  panels: [] as unknown[],
}));

// The registry syncs from the extension loader singleton; this seam feeds it.
vi.mock('@nimbalyst/runtime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getExtensionLoader: () => ({
      getPanels: () => loaderState.panels,
      getLoadedExtensions: () => [],
      subscribe: () => () => {},
    }),
  };
});

// Off-topic gutter children with their own IPC/service wiring.
vi.mock('posthog-js/react', () => ({ usePostHog: () => undefined }));
vi.mock('../../ThemeToggleButton/ThemeToggleButton', () => ({ ThemeToggleButton: () => null }));
vi.mock('../../SyncStatusButton/SyncStatusButton', () => ({ SyncStatusButton: () => null }));
vi.mock('../../TrustIndicator', () => ({ TrustIndicator: () => null }));
vi.mock('../../ExtensionDevIndicator', () => ({ ExtensionDevIndicator: () => null }));
vi.mock('../../BackgroundTaskIndicator', () => ({ BackgroundTaskIndicator: () => null }));
vi.mock('../../UnifiedAI/VoiceModeButton', () => ({ VoiceModeButton: () => null }));
vi.mock('../UserMenuPopover', () => ({ UserMenuPopover: () => null }));
vi.mock('../GutterContextMenu', () => ({ GutterContextMenu: () => null }));
vi.mock('../../../hooks/useTheme', () => ({ useThemeValue: () => 'dark' }));
vi.mock('../../../store', async () => {
  const { atom } = await import('jotai');
  return { setActiveSessionAtom: atom(null, () => {}) };
});

type Contribution = LoadedPanel['contribution'];

// Pin the fixture by identity, not position: a manifest gaining another panel
// must not silently retarget these tests away from the Grid.
const gridContribution = auraclePackManifest.contributions.panels.find(
  (p) => p.id === 'grid'
) as unknown as Contribution;
const gridPanelId = `${auraclePackManifest.id}.grid`;
const gridTestId = `extension-panel-${gridPanelId}`;

// Stand-in for the pack's exported gutterButton: a single rooted button, the
// SDK-documented shape. The help content under test comes from the manifest,
// not from this component.
function StubGridButton({ isActive, onActivate }: { isActive: boolean; onActivate: () => void }) {
  return (
    <button type="button" data-testid="stub-grid-button" aria-pressed={isActive} onClick={onActivate}>
      G
    </button>
  );
}

const NoopPanel = () => null;

function loadedPanel(overrides: Partial<LoadedPanel> & { contribution: Contribution }): LoadedPanel {
  const extensionId = overrides.extensionId ?? auraclePackManifest.id;
  return {
    id: `${extensionId}.${overrides.contribution.id}`,
    extensionId,
    component: NoopPanel,
    ...overrides,
  } as LoadedPanel;
}

function seedPanels(panels: LoadedPanel[]): void {
  loaderState.panels = panels;
  initializePanelRegistry();
}

function renderGutter(): void {
  render(
    <JotaiProvider store={store}>
      <NavigationGutter contentMode="files" onContentModeChange={vi.fn()} />
    </JotaiProvider>
  );
}

// RTL's fireEvent.mouseEnter/mouseLeave already dispatch the over/out pair
// React's enter-leave handlers are derived from.
function hover(el: Element): void {
  fireEvent.mouseEnter(el);
  act(() => {
    vi.advanceTimersByTime(600);
  });
}

function unhover(el: Element): void {
  fireEvent.mouseLeave(el);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-29T12:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  seedPanels([]);
});

describe('the Auracle pack help entry is served through the gutter', () => {
  it('the manifest still ships the help entry these tests serve', () => {
    expect(gridContribution).toBeTruthy();
    expect(gridContribution.placement).toBe('fullscreen');
    expect(typeof gridContribution.tooltip).toBe('string');
    expect((gridContribution.tooltip ?? '').length).toBeGreaterThan(0);
  });

  it('hovering the pack-contributed button shows the manifest tooltip', () => {
    seedPanels([
      loadedPanel({
        contribution: gridContribution,
        gutterButton: StubGridButton,
      }),
    ]);
    renderGutter();

    // The custom-button branch rendered, not the default icon button.
    expect(screen.getByTestId('stub-grid-button')).toBeTruthy();

    hover(screen.getByTestId(gridTestId));

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain(gridContribution.title);
    // First manifest paragraph as the renderer shows it: bold markers
    // stripped, soft line breaks folded to spaces.
    const firstParagraph = (gridContribution.tooltip ?? '')
      .split('\n\n')[0]
      .trim()
      .replace(/\*\*/g, '')
      .replace(/\n/g, ' ');
    expect(tooltip.textContent).toContain(firstParagraph);
  });

  it('hides the help when the pointer leaves', () => {
    seedPanels([
      loadedPanel({
        contribution: gridContribution,
        gutterButton: StubGridButton,
      }),
    ]);
    renderGutter();

    const target = screen.getByTestId(gridTestId);
    hover(target);
    expect(screen.getByRole('tooltip')).toBeTruthy();

    unhover(target);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('every extension gutter button placement serves its manifest tooltip', () => {
  it('fullscreen panels with the default icon button', () => {
    const contribution: Contribution = {
      id: 'dash',
      title: 'Dashboard',
      icon: 'widgets',
      placement: 'fullscreen',
      tooltip: 'Plain words about the dashboard.',
    };
    seedPanels([loadedPanel({ extensionId: 'com.example.ext', contribution })]);
    renderGutter();

    const button = screen.getByTestId('extension-panel-com.example.ext.dash');
    // The help card replaces the native title bubble; both at once is noise.
    expect(button.getAttribute('title')).toBeNull();

    hover(button);

    expect(screen.getByRole('tooltip').textContent).toContain('Plain words about the dashboard.');
  });

  it('sidebar panels', () => {
    const contribution: Contribution = {
      id: 'notes',
      title: 'Notes',
      icon: 'note',
      placement: 'sidebar',
      tooltip: 'Plain words about the notes rail.',
    };
    seedPanels([loadedPanel({ extensionId: 'com.example.ext', contribution })]);
    renderGutter();

    const button = screen.getByTestId('extension-panel-com.example.ext.notes');
    expect(button.getAttribute('title')).toBeNull();

    hover(button);

    expect(screen.getByRole('tooltip').textContent).toContain('Plain words about the notes rail.');
  });

  it('a panel without a manifest tooltip keeps its native title and shows no help', () => {
    const contribution: Contribution = {
      id: 'mute',
      title: 'Mute',
      icon: 'block',
      placement: 'fullscreen',
    };
    seedPanels([loadedPanel({ extensionId: 'com.example.ext', contribution })]);
    renderGutter();

    const button = screen.getByTestId('extension-panel-com.example.ext.mute');
    // No help entry to serve, so the native title stays as the only label.
    expect(button.getAttribute('title')).toBe('Mute');

    hover(button);

    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
