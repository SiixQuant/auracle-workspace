import { describe, expect, it } from 'vitest';
import {
  fieldsFromPayload,
  intentFromConfirmation,
  isEngineConfirmation,
  roomForAction,
  type EngineConfirmation,
} from '../engineConfirmation';

/**
 * The engine's "ask first" answer, as the approval dialog receives it.
 *
 * These pin the properties that make the dialog trustworthy. A prompt that
 * silently drops a field, or reworded the engine's sentence, would still look
 * like supervision while no longer being it.
 */

/**
 * The room ids, copied rather than imported.
 *
 * `rooms` pulls in every page component — and therefore plotly — which cannot
 * load in a node test environment; `gridAiActions` carries the same warning and
 * for the same reason imports it inside functions only.
 *
 * ★ The COMPILER is the real guard on this, not the list below. `roomForAction`
 * returns `RoomId`, which is a union of exactly these, so naming a room that
 * does not exist is a type error at build time. That is what caught the first
 * version of the mapping, which had been written against the web app's copy of
 * the registry and used two rooms this pack does not have.
 */
const ROOM_IDS = [
  'findings', 'qc', 'strategies', 'strategy', 'backtest', 'validation',
  'deploys', 'blotter', 'incidents', 'schedules', 'runway',
] as const;

const confirmation: EngineConfirmation = {
  confirmation_required: true,
  action: 'mcp.add_security',
  payload: { symbol: 'LOOPTEST', exchange: 'NYSE', asset_class: 'STK', name: null },
  summary: "Register a new security so Auracle can ingest data and trade it. With symbol 'LOOPTEST'.",
  confirm_path: '/confirm',
};

describe('recognising the engine’s request', () => {
  it('accepts the whole shape', () => {
    expect(isEngineConfirmation(confirmation)).toBe(true);
  });

  it('treats a partial shape as ordinary data', () => {
    expect(isEngineConfirmation({ confirmation_required: true })).toBe(false);
    expect(isEngineConfirmation({ action: 'x', summary: 'y', payload: {} })).toBe(false);
    expect(isEngineConfirmation(null)).toBe(false);
    expect(isEngineConfirmation('confirmation_required')).toBe(false);
  });
});

describe('the intent the dialog quotes', () => {
  it('keeps the operation as the confirmation scope', () => {
    // The executor registry keys on this and the engine binds its stamp to it.
    // If they ever differ, what was approved is not what runs.
    expect(intentFromConfirmation(confirmation).operation).toBe('mcp.add_security');
  });

  it('does not reword the engine’s sentence', () => {
    // The browser shows this same string. Rewording here is how the two
    // surfaces start describing one action differently.
    expect(intentFromConfirmation(confirmation).summary).toBe(confirmation.summary);
  });

  it('shows every field, including the empty ones', () => {
    const fields = fieldsFromPayload(confirmation.payload);

    // The stamp binds to a hash of the whole payload, so a field hidden here
    // is a field somebody approved without seeing.
    expect(fields.map((f) => f.label)).toEqual(['symbol', 'exchange', 'asset_class', 'name']);
    expect(fields.find((f) => f.label === 'name')?.value).toBe('—');
  });

  it('renders a nested value rather than "[object Object]"', () => {
    const fields = fieldsFromPayload({ params: { fast: 10, slow: 30 } });
    expect(fields[0]?.value).toBe('{"fast":10,"slow":30}');
  });
});

describe('which room an operation belongs to', () => {
  it('only ever names a room this pack has', () => {
    const tools = [
      'mcp.create_strategy', 'mcp.add_security', 'mcp.ingest_historical_bars',
      'mcp.run_backtest_now', 'mcp.run_manifest_backtest', 'mcp.run_walkforward',
      'mcp.run_manifest_paper', 'mcp.draft_manifest', 'mcp.add_schedule',
      'mcp.set_schedule_enabled', 'mcp.research_refine', 'mcp.idea_save',
      'mcp.board_upsert_source', 'mcp.remember', 'mcp.something_new',
    ];
    for (const tool of tools) {
      expect(ROOM_IDS).toContain(roomForAction(tool));
    }
  });

  it('prefers the more specific prefix', () => {
    expect(roomForAction('mcp.run_manifest_backtest')).toBe('backtest');
    expect(roomForAction('mcp.run_manifest_paper')).toBe('deploys');
  });

  it('places an unknown tool rather than refusing it', () => {
    // A tool added to the engine must not become unapprovable in the IDE
    // because this table has not caught up.
    expect(ROOM_IDS).toContain(roomForAction('mcp.a_tool_written_tomorrow'));
  });
});
