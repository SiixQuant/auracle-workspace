import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../engine/client', () => ({ postJson: vi.fn() }));
// `gridAiActions` imports `rooms` at module scope, which pulls every page
// component and the plotly bundle. Nothing under test reads a room.
vi.mock('../components/grid/rooms', () => ({ ROOMS: {}, ROOM_IDS: [] }));

import { postJson } from '../engine/client';
import { approvalAiTools } from '../approvalTool';
import { aiRunStore, approveAiAction, declineAiAction } from '../components/grid/gridAiActions';

/**
 * The handoff from the agent to the approval dialog.
 *
 * The properties here decide whether this is supervision or theatre: that
 * nothing runs before a person answers, that "no" is an answer rather than a
 * fault, and that a paraphrased request cannot reach the dialog.
 */

const tool = approvalAiTools[0]!;
const posted = vi.mocked(postJson);

const confirmation = {
  action: 'mcp.add_security',
  payload: { symbol: 'LOOP', exchange: 'NYSE', asset_class: 'STK', name: null },
  summary: "Register a new security. With symbol 'LOOP'.",
};

const ctx = {} as never;

beforeEach(() => {
  posted.mockReset();
  aiRunStore.reset();
});

describe('what the agent is offered', () => {
  it('tells it to pass the request back unchanged, and not to retry a refusal', () => {
    expect(tool.name).toBe('auracle_ask_before_changing');
    expect(tool.description).toMatch(/EXACTLY/);
    expect(tool.description).toMatch(/do not retry/i);
  });
});

describe('raising it', () => {
  it('parks for a person and runs nothing until they answer', async () => {
    posted.mockResolvedValue({ ok: true, status: 200, body: { ok: true, result: { plain: 'Done.' } } });

    const pending = tool.handler(confirmation, ctx);
    await Promise.resolve();

    expect(aiRunStore.getSnapshot().pending?.intent.operation).toBe('mcp.add_security');
    expect(posted).not.toHaveBeenCalled();

    await approveAiAction();
    const out = await pending;

    expect(posted).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ success: true, message: 'Done.' });
  });

  it('quotes the engine’s own sentence in the dialog', async () => {
    posted.mockResolvedValue({ ok: true, status: 200, body: { ok: true, result: { plain: 'ok' } } });

    const pending = tool.handler(confirmation, ctx);
    await Promise.resolve();

    // Not reworded on the way through — the browser shows the same string.
    expect(aiRunStore.getSnapshot().pending?.intent.summary).toBe(confirmation.summary);

    await approveAiAction();
    await pending;
  });
});

describe('declining', () => {
  it('is an answer, not a failure', async () => {
    const pending = tool.handler(confirmation, ctx);
    await Promise.resolve();

    declineAiAction();
    const out = await pending;

    // ★ success: true. An agent that cannot tell "they said no" from "it
    // broke" will retry a refusal, which is the one thing a gate must not
    // invite.
    expect(out.success).toBe(true);
    expect(out.message).toMatch(/Declined\. Nothing happened\./);
    expect(posted).not.toHaveBeenCalled();
  });
});

describe('what it refuses to raise', () => {
  it('rejects a request the engine did not issue', async () => {
    // An agent that paraphrased would otherwise put words the engine never
    // said in front of someone, above a real Approve button.
    const out = await tool.handler({ action: 'add_security', payload: {} }, ctx);

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/exactly as the engine tool returned/);
    expect(aiRunStore.getSnapshot().pending).toBeNull();
  });

  it('rejects a malformed request', async () => {
    const out = await tool.handler({ action: 'mcp.add_security' }, ctx);
    expect(out.success).toBe(false);
    expect(posted).not.toHaveBeenCalled();
  });

  it('refuses to queue behind something already waiting', async () => {
    const first = tool.handler(confirmation, ctx);
    await Promise.resolve();

    const second = await tool.handler(
      { ...confirmation, payload: { ...confirmation.payload, symbol: 'OTHER' } },
      ctx,
    );

    // Two changes racing off one conversation is exactly what nobody can
    // reason about afterwards.
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already waiting/);

    declineAiAction();
    await first;
  });
});
