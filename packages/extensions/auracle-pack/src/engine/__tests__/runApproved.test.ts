import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../client', () => ({ postJson: vi.fn() }));

// `gridAiActions` imports `rooms` at module scope, and `rooms` pulls in every
// page component — including the plotly bundle, which will not load in a node
// environment. The registry under test never reads a room, so a stub is enough
// and keeps this suite from booting a chart library to check a POST body.
vi.mock('../../components/grid/rooms', () => ({ ROOMS: {}, ROOM_IDS: [] }));

import { postJson } from '../client';
import { intentFromConfirmation, type EngineConfirmation } from '../engineConfirmation';
import { registerEngineConfirmation, runApproved, RUN_APPROVED_PATH } from '../runApproved';

/**
 * Carrying out an approved request.
 *
 * The properties pinned here are the ones that, if they broke, would leave
 * something that still looks like it works: a payload that lost a value on the
 * way back, a refusal reported as a network fault, or an executor that runs a
 * different request than the one on screen.
 */

const confirmation: EngineConfirmation = {
  confirmation_required: true,
  action: 'mcp.add_security',
  payload: { symbol: 'LOOP', exchange: 'NYSE', asset_class: 'STK', name: null },
  summary: 'Register a new security. With symbol \'LOOP\'.',
  confirm_path: '/confirm',
};

const posted = vi.mocked(postJson);

beforeEach(async () => {
  posted.mockReset();
  // The run store is module-level by design — an action can be raised from one
  // surface and settle while another is showing. That also means a settled
  // outcome survives into the next test and the next `requestAiAction` has
  // nowhere to go, which reads as "approve returned undefined".
  const { dismissAiOutcome } = await import('../../components/grid/gridAiActions');
  dismissAiOutcome();
});

describe('running it', () => {
  it('sends the action and payload, and nothing else', async () => {
    posted.mockResolvedValue({ ok: true, status: 200, body: { ok: true, result: { plain: 'Done — tracking LOOP.' } } });

    await runApproved(confirmation.action, confirmation.payload);

    expect(posted).toHaveBeenCalledWith(RUN_APPROVED_PATH, {
      action: 'mcp.add_security',
      payload: confirmation.payload,
    });
    // No stamp goes out, because this surface never has one to send.
    expect(JSON.stringify(posted.mock.calls[0])).not.toContain('confirmation');
  });

  it('reports the tool’s own sentence when it worked', async () => {
    posted.mockResolvedValue({ ok: true, status: 200, body: { ok: true, result: { plain: 'Done — tracking LOOP.' } } });

    expect(await runApproved(confirmation.action, confirmation.payload)).toEqual({
      kind: 'done',
      note: 'Done — tracking LOOP.',
    });
  });

  it('treats a tool refusal as a refusal, not a network fault', async () => {
    // The request succeeded; the tool declined. Calling this a transport
    // failure sends someone to look at the network for a decision the engine
    // made deliberately.
    posted.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true, result: { error: 'this confirmation was already used — confirm the action again.' } },
    });

    expect(await runApproved(confirmation.action, confirmation.payload)).toEqual({
      kind: 'failed',
      note: 'this confirmation was already used — confirm the action again.',
    });
  });

  it('shows the engine’s words when the engine refuses', async () => {
    posted.mockResolvedValue({
      ok: false,
      status: 404,
      body: { detail: { error: 'unknown_action', message: 'This desk has no such tool.' } },
    });

    expect(await runApproved('mcp.nope', {})).toEqual({
      kind: 'failed',
      note: 'This desk has no such tool.',
    });
  });

  it('says nothing was sent when there was no engine to send to', async () => {
    // status 0 is the pack's "no bridge" answer. "Nothing was sent" is the
    // part that matters — the reader has to know whether to retry.
    posted.mockResolvedValue({ ok: false, status: 0, body: null });

    expect(await runApproved(confirmation.action, confirmation.payload)).toEqual({
      kind: 'failed',
      note: 'The engine could not be reached. Nothing was sent.',
    });
  });
});

describe('registering one request', () => {
  it('sends back the ORIGINAL payload, not what the dialog displayed', async () => {
    // ★ The trap. `intent.fields` renders null as an em dash for a reader.
    // Rebuilding the payload from the display would post "—" where the engine
    // expects null, and the stamp binds to a hash of the payload — so it would
    // be refused for a reason that looks nothing like the cause.
    const intent = intentFromConfirmation(confirmation);
    expect(intent.fields.find((f) => f.label === 'name')?.value).toBe('—');

    posted.mockResolvedValue({ ok: true, status: 200, body: { ok: true, result: { plain: 'ok' } } });
    const dispose = registerEngineConfirmation(confirmation);

    // Through the real ceremony: raise it, then approve it. A mutation that
    // ran without passing the dialog would be the one bug worth catching here.
    const { requestAiAction, approveAiAction } = await import('../../components/grid/gridAiActions');
    // `requestAiAction` PARKS a mutation and resolves null; the result comes
    // from `approveAiAction`. Getting this wrong is silent — an action whose
    // class field is misspelled skips the dialog entirely and still "passes".
    expect(await requestAiAction({ id: 'x', label: 'x', class: 'mutation', icon: 'x', intent })).toBeNull();
    await approveAiAction();

    expect(posted.mock.calls[0]?.[1]).toEqual({
      action: 'mcp.add_security',
      payload: { symbol: 'LOOP', exchange: 'NYSE', asset_class: 'STK', name: null },
    });
    dispose();
  });

  it('withdraws cleanly, leaving the operation no more wired than it found it', async () => {
    const dispose = registerEngineConfirmation(confirmation);
    dispose();

    const { requestAiAction, approveAiAction } = await import('../../components/grid/gridAiActions');
    expect(
      await requestAiAction({
        id: 'x', label: 'x', class: 'mutation', icon: 'x',
        intent: intentFromConfirmation(confirmation),
      }),
    ).toBeNull();
    const out = await approveAiAction();

    // Back to the honest stub, which cannot be read as a success.
    expect(out?.kind).toBe('not-wired');
    expect(posted).not.toHaveBeenCalled();
  });
});
