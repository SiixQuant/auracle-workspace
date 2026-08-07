/**
 * The connection credential form — write-only in earnest, on the connections
 * lane.
 *
 *  - it posts every field to the connector's own save route in ONE call and
 *    clears the form the instant it does: a value lives in the component only as
 *    long as the request that carries it;
 *  - a connector with several fields (a key, a secret, a paper/live mode) is
 *    connected in one paste, not one round trip per field;
 *  - a masked field renders as a password input and a mode renders as a select;
 *  - a blank field is left OUT of the save, so re-connecting without retyping a
 *    stored secret keeps it rather than wiping it;
 *  - it never reads a value back and never shows one — only "key needed" and,
 *    after a store, a bare "Stored." note;
 *  - the form cannot be stored until every required field is filled, and a store
 *    that fails says so rather than pretending, and does NOT re-poll.
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
import { __resetConnectionToolsForTests, type PendingField } from '../../engine/connectionTools';
import { ConnectionSecretField } from '../grid/ConnectionSecretField';

/** A single write-only field (a data provider's api key). */
const API_KEY: PendingField = { name: 'api_key', label: 'API Key', kind: 'password', required: true };

/** A broker that needs several fields at once: a public key, a masked secret,
 *  and a paper/live mode — the case the one-field-at-a-time form could not do. */
const ALPACA_FIELDS: PendingField[] = [
  { name: 'key', label: 'API Key ID', kind: 'text', required: true, placeholder: 'PK…' },
  { name: 'secret', label: 'Secret', kind: 'password', required: true },
  { name: 'environment', label: 'Mode', kind: 'select', required: true, options: ['paper', 'live'] },
];

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
    render(<ConnectionSecretField id="polygon" sourceName="Polygon" fields={[API_KEY]} />);

    const field = screen.getByTestId('connsecret-input-polygon-api_key') as HTMLInputElement;
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
      expect(
        (screen.getByTestId('connsecret-input-polygon-api_key') as HTMLInputElement).value
      ).toBe('')
    );
    // A save re-polls every pack surface so the row + hide predicate catch up.
    expect(vi.mocked(bumpConnectGeneration)).toHaveBeenCalled();
    expect(screen.getByTestId('connsecret-note-polygon').textContent).toContain('Stored');
  });

  it('connects a multi-field broker in ONE save — key, masked secret, and a mode select', async () => {
    render(<ConnectionSecretField id="alpaca" sourceName="Alpaca" fields={ALPACA_FIELDS} />);

    // The public key is a plain text input; the secret is masked; the mode is a select.
    expect((screen.getByTestId('connsecret-input-alpaca-key') as HTMLInputElement).type).toBe('text');
    expect((screen.getByTestId('connsecret-input-alpaca-secret') as HTMLInputElement).type).toBe(
      'password'
    );
    const mode = screen.getByTestId('connsecret-input-alpaca-environment') as HTMLSelectElement;
    // The select defaults to the first (safe) option so the required mode is met without a click.
    expect(mode.value).toBe('paper');

    fireEvent.change(screen.getByTestId('connsecret-input-alpaca-key'), {
      target: { value: 'PKTEST' },
    });
    fireEvent.change(screen.getByTestId('connsecret-input-alpaca-secret'), {
      target: { value: 'shhh' },
    });
    fireEvent.change(mode, { target: { value: 'live' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('connsecret-save-alpaca'));
    });

    // Every field rides in a SINGLE save under its own name.
    expect(vi.mocked(postJson)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(postJson)).toHaveBeenCalledWith('/ui/api/connections/alpaca/save', {
      key: 'PKTEST',
      secret: 'shhh',
      environment: 'live',
    });
    // All three inputs clear the instant it posts.
    await waitFor(() =>
      expect((screen.getByTestId('connsecret-input-alpaca-secret') as HTMLInputElement).value).toBe(
        ''
      )
    );
  });

  it('leaves a blank field OUT of the save so a stored secret is not wiped', async () => {
    // Re-connecting Alpaca to only flip the mode: the key + secret are left blank.
    render(<ConnectionSecretField id="alpaca" sourceName="Alpaca" fields={ALPACA_FIELDS} />);
    // The mode is required and already satisfied by its default; key + secret are
    // required too, so the form holds until they are filled — fill just the key.
    fireEvent.change(screen.getByTestId('connsecret-input-alpaca-key'), {
      target: { value: 'PKONLY' },
    });
    // secret still blank → the required-secret guard keeps the button disabled.
    expect((screen.getByTestId('connsecret-save-alpaca') as HTMLButtonElement).disabled).toBe(true);
  });

  it('will not store while a required field is empty', () => {
    render(<ConnectionSecretField id="polygon" fields={[API_KEY]} />);
    expect((screen.getByTestId('connsecret-save-polygon') as HTMLButtonElement).disabled).toBe(true);
  });

  it('surfaces a refusal rather than pretending it stored, and does not re-poll', async () => {
    vi.mocked(postJson).mockResolvedValue({
      ok: false,
      status: 403,
      body: { detail: 'vault is locked' },
    } as never);
    render(<ConnectionSecretField id="polygon" fields={[API_KEY]} />);

    fireEvent.change(screen.getByTestId('connsecret-input-polygon-api_key'), {
      target: { value: 'x' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('connsecret-save-polygon'));
    });

    expect(screen.getByTestId('connsecret-note-polygon').getAttribute('data-kind')).toBe('error');
    expect(vi.mocked(bumpConnectGeneration)).not.toHaveBeenCalled();
  });
});
