/**
 * The ops journal's wire reading — the rules the Incidents room's Undo depends
 * on. Two of them are load-bearing: only the ENGINE decides an entry is still
 * reversible, and a field the engine did not send is never invented.
 */
import { describe, expect, it } from 'vitest';
import {
  describeState,
  isUndoable,
  journalEntries,
  label,
  normalizeEntry,
  undoPath,
} from '../opsJournal';

describe('reading one journal field', () => {
  it('takes a plain string as it is', () => {
    expect(label('stop deployment')).toBe('stop deployment');
    expect(label('  padded  ')).toBe('padded');
  });

  it('names an object target by its label, then by kind and id', () => {
    expect(label({ label: 'Momentum SPY' })).toBe('Momentum SPY');
    expect(label({ kind: 'deployment', id: 4 })).toBe('deployment 4');
    expect(label({ kind: 'schedule' })).toBe('schedule');
  });

  it('reports nothing rather than printing an unreadable object', () => {
    expect(label({})).toBeNull();
    expect(label(null)).toBeNull();
    expect(label('')).toBeNull();
  });

  it('reads a previous state a person can check', () => {
    expect(describeState({ state: 'running', restarts: 2 })).toBe('state=running · restarts=2');
    expect(describeState({ enabled: false })).toBe('enabled=false');
    expect(describeState('was paused')).toBe('was paused');
    expect(describeState({ nested: { a: 1 } })).toBeNull();
  });
});

describe('reading one journal entry', () => {
  const WIRE = {
    id: 'j-8',
    actor: 'operator',
    action: 'stop deployment',
    target: { kind: 'deployment', id: 4 },
    pre_state: { state: 'running' },
    inverse: 'start deployment',
    status: 'applied',
    created_at: '2026-07-27T14:02:00Z',
  };

  it('flattens the engine payload', () => {
    expect(normalizeEntry(WIRE)).toEqual({
      id: 'j-8',
      actor: 'operator',
      action: 'stop deployment',
      target: 'deployment 4',
      preState: 'state=running',
      inverse: 'start deployment',
      status: 'applied',
      at: '2026-07-27T14:02:00Z',
      undoneAt: null,
    });
  });

  it('drops an entry the undo route could not address', () => {
    expect(normalizeEntry({ action: 'stop deployment', status: 'applied' })).toBeNull();
  });

  it('does not claim a status the engine never stated', () => {
    const entry = normalizeEntry({ id: 'j-9' });
    expect(entry?.status).toBe('unknown');
    expect(isUndoable(entry!)).toBe(false);
  });

  it('offers undo only for an applied entry', () => {
    expect(isUndoable(normalizeEntry(WIRE)!)).toBe(true);
    expect(isUndoable(normalizeEntry({ ...WIRE, status: 'undone' })!)).toBe(false);
    expect(isUndoable(normalizeEntry({ ...WIRE, status: 'failed' })!)).toBe(false);
  });

  it('accepts either stamp name for when it was applied', () => {
    expect(normalizeEntry({ id: 'a', applied_at: 'T1' })?.at).toBe('T1');
    expect(normalizeEntry({ id: 'b', ts: 'T2' })?.at).toBe('T2');
  });
});

describe('reading the journal body', () => {
  it('keeps the engine ordering and skips unusable rows', () => {
    const entries = journalEntries({
      entries: [{ id: 'j-2', status: 'applied' }, null, { status: 'applied' }, { id: 'j-1' }],
    });
    expect(entries.map((entry) => entry.id)).toEqual(['j-2', 'j-1']);
  });

  it('reads a body that answered without the key as nothing recorded', () => {
    expect(journalEntries({})).toEqual([]);
    expect(journalEntries(null)).toEqual([]);
  });

  it('addresses the undo route by the engine id', () => {
    expect(undoPath('j-8')).toBe('/ui/api/ops/journal/j-8/undo');
    expect(undoPath('a/b')).toBe('/ui/api/ops/journal/a%2Fb/undo');
  });
});
