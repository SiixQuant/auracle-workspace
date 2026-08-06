/**
 * The connection secret paste — write-only in earnest, on the connections lane.
 *
 *  - it posts the secret to the connector's own save route and clears the field
 *    the instant it does: the value lives in the component only as long as the
 *    request that carries it;
 *  - it never reads a value back and never shows one — only "key needed" and,
 *    after a store, a bare "Stored." note;
 *  - an empty field cannot be stored, and a store that fails says so rather than
 *    pretending, and does NOT re-poll.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../engine/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postJson: vi.fn(async () => ({ ok: true, status: 200, body: {} })),
  bumpConnectGeneration: vi.fn(),
}));

import { bumpConnectGeneration, postJson } from '../../engine/client';
import { __resetConnectionToolsForTests } from '../../engine/connectionTools';
import { ConnectionSecretField } from '../grid/ConnectionSecretField';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, body: {} } as never);
});

afterEach(() => {
  cleanup();
  __resetConnectionToolsForTests();
  vi.restoreAllMocks();
});

describe('a pending keyed connection', () => {
  it('posts the pasted secret to the connection save route, clears the input, and re-polls', async () => {
    render(<ConnectionSecretField id="polygon" sourceName="Polygon" fieldName="api_key" />);

    const field = screen.getByTestId('connsecret-input-polygon') as HTMLInputElement;
    // A secret field, not a text field.
    expect(field.type).toBe('password');
    expect(screen.getByTestId('connsecret-state-polygon').textContent).toContain('key needed');

    fireEvent.change(field, { target: { value: 'pk_live_abc123' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('connsecret-save-polygon'));
    });

    // Posted to the connector's own save route, under the field the tool named,
    // exactly what was typed.
    expect(vi.mocked(postJson)).toHaveBeenCalledWith('/ui/api/connections/polygon/save', {
      api_key: 'pk_live_abc123',
    });
    // Cleared the instant it posted — the value cannot linger in the field.
    await waitFor(() =>
      expect((screen.getByTestId('connsecret-input-polygon') as HTMLInputElement).value).toBe('')
    );
    // A save re-polls every pack surface so the row + hide predicate catch up.
    expect(vi.mocked(bumpConnectGeneration)).toHaveBeenCalled();
    expect(screen.getByTestId('connsecret-note-polygon').textContent).toContain('Stored');
  });

  it('will not store an empty field', () => {
    render(<ConnectionSecretField id="polygon" fieldName="api_key" />);
    expect((screen.getByTestId('connsecret-save-polygon') as HTMLButtonElement).disabled).toBe(true);
  });

  it('surfaces a refusal rather than pretending it stored, and does not re-poll', async () => {
    vi.mocked(postJson).mockResolvedValue({
      ok: false,
      status: 403,
      body: { detail: 'vault is locked' },
    } as never);
    render(<ConnectionSecretField id="polygon" fieldName="api_key" />);

    fireEvent.change(screen.getByTestId('connsecret-input-polygon'), { target: { value: 'x' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('connsecret-save-polygon'));
    });

    expect(screen.getByTestId('connsecret-note-polygon').getAttribute('data-kind')).toBe('error');
    expect(vi.mocked(bumpConnectGeneration)).not.toHaveBeenCalled();
  });
});
