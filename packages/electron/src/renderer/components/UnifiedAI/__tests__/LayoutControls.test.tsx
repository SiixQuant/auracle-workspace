// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { LayoutControls } from '../LayoutControls';

// The help registry pulls in the shared store; the tooltip wrapper is not what
// these tests are about.
vi.mock('../../../help', () => ({
  HelpTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

afterEach(() => cleanup());

describe('LayoutControls - only offers layouts the session can actually show', () => {
  it('offers the transcript on its own before the session has opened a file', () => {
    render(<LayoutControls mode="transcript" hasTabs={false} onModeChange={vi.fn()} />);

    expect(screen.queryByTestId('layout-maximize-editor')).toBeNull();
    expect(screen.queryByTestId('layout-split-view')).toBeNull();
    expect(screen.getByTestId('layout-maximize-transcript')).toBeTruthy();
  });

  it('offers all three layouts once the session has a file open', () => {
    render(<LayoutControls mode="split" hasTabs={true} onModeChange={vi.fn()} />);

    expect(screen.getByTestId('layout-maximize-editor')).toBeTruthy();
    expect(screen.getByTestId('layout-split-view')).toBeTruthy();
    expect(screen.getByTestId('layout-maximize-transcript')).toBeTruthy();
  });

  it('never renders a dead button', () => {
    render(<LayoutControls mode="editor" hasTabs={true} onModeChange={vi.fn()} />);

    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });
});

describe('LayoutControls - labels stay distinct from the window modes', () => {
  it('labels the layouts Editor and Chat, not Files and Agent', () => {
    render(<LayoutControls mode="transcript" hasTabs={true} onModeChange={vi.fn()} />);

    expect(screen.getByTestId('layout-maximize-editor').textContent).toBe('Editor');
    expect(screen.getByTestId('layout-maximize-transcript').textContent).toBe('Chat');
    expect(screen.queryByText('Files')).toBeNull();
    expect(screen.queryByText('Agent')).toBeNull();
  });
});

describe('LayoutControls - reports the picked layout', () => {
  it('reports each layout the user picks', () => {
    const onModeChange = vi.fn();
    render(<LayoutControls mode="transcript" hasTabs={true} onModeChange={onModeChange} />);

    fireEvent.click(screen.getByTestId('layout-maximize-editor'));
    fireEvent.click(screen.getByTestId('layout-split-view'));
    fireEvent.click(screen.getByTestId('layout-maximize-transcript'));

    expect(onModeChange.mock.calls.map(([mode]) => mode)).toEqual([
      'editor',
      'split',
      'transcript',
    ]);
  });
});
