/**
 * The credential paste — the one surviving input, and write-only in earnest.
 *
 *  - it posts the secret to the vault slot and clears the field the instant it
 *    does: the value lives in the component only as long as the request that
 *    carries it;
 *  - it never reads a value back. The engine answers with state, and the paste
 *    shows "key stored" or "key needed", never a value or a masked preview;
 *  - an empty field cannot be stored, and a store that fails says why.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getJsonDetailed: vi.fn(async () => ({ ok: false, status: 404, body: null })),
  postJson: vi.fn(async () => ({ ok: true, status: 200, body: {} })),
}));

import { getJsonDetailed, postJson } from '../../engine/client';
import { CredentialPaste } from '../grid/CredentialPaste';

function slotState(set: boolean): void {
  vi.mocked(getJsonDetailed).mockResolvedValue({
    ok: true,
    status: 200,
    body: { name: 'polygon', set, updated_at: set ? '2026-07-30T00:00:00Z' : null },
  } as never);
}

beforeEach(() => {
  // Clear call history between tests (the vi.mock factory fns accumulate it),
  // then re-apply the default resolutions clearAllMocks wiped.
  vi.clearAllMocks();
  vi.mocked(getJsonDetailed).mockResolvedValue({ ok: false, status: 404, body: null } as never);
  vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, body: {} } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('when a slot is empty', () => {
  it('prompts for the key and stores it write-only', async () => {
    slotState(false);
    // The store's answer flips the slot to set, which takes the input away.
    vi.mocked(postJson).mockResolvedValue({
      ok: true,
      status: 200,
      body: { name: 'polygon', set: true, updated_at: '2026-07-30T00:00:00Z' },
    } as never);
    render(<CredentialPaste slot="polygon" sourceName="Polygon" />);

    await waitFor(() => expect(screen.getByTestId('credential-input-polygon')).toBeTruthy());
    const field = screen.getByTestId('credential-input-polygon') as HTMLInputElement;
    // A secret field, not a text field.
    expect(field.type).toBe('password');
    expect(screen.getByTestId('credential-state-polygon').textContent).toContain('key needed');

    fireEvent.change(field, { target: { value: 'sk-live-abc123' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('credential-save-polygon'));
    });

    // Posted to the slot's own route, exactly what was typed.
    const call = vi.mocked(postJson).mock.calls.find((c) => String(c[0]).includes('/credentials/polygon'));
    expect(call).toBeTruthy();
    expect((call?.[1] as { secret: string }).secret).toBe('sk-live-abc123');
    // And the field is gone: a stored slot offers no place the value could
    // linger, which is the strongest form of "cleared the instant it posted".
    await waitFor(() =>
      expect(screen.getByTestId('credential-state-polygon').textContent).toContain('key stored')
    );
    expect(screen.queryByTestId('credential-input-polygon')).toBeNull();
  });

  it('will not store an empty field', async () => {
    slotState(false);
    render(<CredentialPaste slot="polygon" />);
    await waitFor(() => expect(screen.getByTestId('credential-save-polygon')).toBeTruthy());

    expect((screen.getByTestId('credential-save-polygon') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('when a slot already holds a key', () => {
  it('shows that it is stored and never a value', async () => {
    slotState(true);
    render(<CredentialPaste slot="polygon" sourceName="Polygon" />);

    await waitFor(() =>
      expect(screen.getByTestId('credential-state-polygon').textContent).toContain('key stored')
    );
    // No input is offered for a slot already set, and nothing on screen is the
    // secret: the component was never handed one to show.
    expect(screen.queryByTestId('credential-input-polygon')).toBeNull();
    expect(screen.getByTestId('credential-clear-polygon')).toBeTruthy();
  });
});

describe('write-only in earnest', () => {
  it('reads the slot with a GET that asks for state, and posts only on save', async () => {
    slotState(false);
    render(<CredentialPaste slot="polygon" />);
    await waitFor(() => expect(screen.getByTestId('credential-input-polygon')).toBeTruthy());

    // On mount it only READ state; it has posted nothing.
    expect(vi.mocked(getJsonDetailed)).toHaveBeenCalled();
    expect(vi.mocked(postJson)).not.toHaveBeenCalled();
  });

  it('surfaces a refusal rather than pretending it stored', async () => {
    slotState(false);
    vi.mocked(postJson).mockResolvedValue({
      ok: false,
      status: 403,
      body: { detail: 'vault is locked' },
    } as never);
    render(<CredentialPaste slot="polygon" />);
    await waitFor(() => expect(screen.getByTestId('credential-input-polygon')).toBeTruthy());

    fireEvent.change(screen.getByTestId('credential-input-polygon'), {
      target: { value: 'x' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('credential-save-polygon'));
    });

    expect(screen.getByTestId('credential-note-polygon').getAttribute('data-kind')).toBe('error');
  });
});
