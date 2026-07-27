/**
 * Incidents — the Operate district's attention room, and the home of the ops
 * action journal.
 *
 * Two sections, in the order a reader needs them. First WHAT IS WRONG: the
 * existing incidents surface, mounted whole, with its severity wall, its
 * "Open the run" hand-off and its dismiss. Then WHAT WE DID ABOUT IT: the
 * engine's ops journal — who changed what, what it looked like before, and the
 * one action that puts it back.
 *
 * The two belong on one page because they are two halves of the same question.
 * An `ops.applied` event shows up in the feed above as an incident-adjacent
 * fact; the journal below is where that same action can be reversed, against
 * the state the engine recorded rather than one reconstructed by hand.
 *
 * HONESTY, carried from `engine/opsJournal`:
 *  - Undo appears only on an entry the ENGINE still calls `applied`. Every
 *    other status is stated and left alone; the page never infers that
 *    something is reversible from its name.
 *  - an engine build that does not serve the journal says so. That is a
 *    different answer from "nothing has been done", and the two never collapse.
 *  - a rejected undo shows the engine's own reason, and the row stays exactly
 *    as it was. The optimistic mark is applied only on a success, and the
 *    re-read that follows lets the engine's record overwrite it.
 */
import { useCallback, useEffect, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { onConnectGeneration } from '../../../engine/client';
import {
  isUndoable,
  readJournal,
  undoEntry,
  type JournalLoad,
  type OpsEntry,
} from '../../../engine/opsJournal';
import { IncidentsPanel, type IncidentsSummary } from '../../MonitorPanels';
import {
  Button,
  InlineNote,
  Pill,
  SectionLabel,
  SkeletonRows,
  ToolbarSpring,
  numeric,
  tone,
} from '../../panelkit';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

/** The status word's semantic colour. An unknown word still renders — as the
 *  engine wrote it — in the neutral tier, rather than being reclassified. */
function statusPill(status: string): 'ok' | 'danger' | 'muted' {
  if (status === 'applied') return 'ok';
  if (status === 'failed' || status === 'error') return 'danger';
  return 'muted';
}

function JournalRow({
  entry,
  busy,
  onUndo,
}: {
  entry: OpsEntry;
  busy: boolean;
  onUndo: () => void;
}): JSX.Element {
  const who = [entry.actor, entry.action].filter((part): part is string => !!part).join(' · ');
  return (
    <div
      data-testid={`ops-journal-entry-${entry.id}`}
      className="apk-row"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        flexWrap: 'wrap',
        padding: '11px 12px',
        borderTop: `1px solid ${tone.border}`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 220 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: tone.text }}>
          {who || entry.action || 'an action'}
          {entry.target ? (
            <span style={{ fontWeight: 400, color: tone.text2 }}>{` → ${entry.target}`}</span>
          ) : null}
        </span>
        {entry.preState ? (
          <span style={{ fontSize: 11.5, color: tone.text3 }}>was {entry.preState}</span>
        ) : null}
        {entry.inverse ? (
          <span style={{ fontSize: 11.5, color: tone.text3 }}>undo runs {entry.inverse}</span>
        ) : null}
        {entry.at || entry.undoneAt ? (
          <span style={{ fontSize: 11, color: tone.text3, ...numeric }}>
            {entry.at ?? ''}
            {entry.undoneAt ? ` · undone ${entry.undoneAt}` : ''}
          </span>
        ) : null}
      </div>
      <span data-testid={`ops-journal-status-${entry.id}`}>
        <Pill kind={statusPill(entry.status)} dot>
          {entry.status}
        </Pill>
      </span>
      {isUndoable(entry) ? (
        <Button
          variant="quiet"
          busy={busy}
          testId={`ops-journal-undo-${entry.id}`}
          title={entry.inverse ? `Runs ${entry.inverse}` : 'Reverse this action'}
          onClick={onUndo}
        >
          Undo
        </Button>
      ) : null}
    </div>
  );
}

function JournalSection({
  load,
  busyId,
  note,
  onReload,
  onUndo,
}: {
  load: JournalLoad;
  busyId: string | null;
  note: { kind: 'ok' | 'err'; text: string } | null;
  onReload: () => void;
  onUndo: (entry: OpsEntry) => void;
}): JSX.Element {
  const ready = load.phase === 'ready' ? load : null;
  return (
    <section data-testid="ops-journal" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionLabel meta={ready ? `${ready.entries.length}` : undefined}>
        Action journal
      </SectionLabel>
      <p style={{ margin: 0, fontSize: 12, color: tone.text3, maxWidth: '75ch' }}>
        What has been done to the running system, newest first. An entry the engine still holds as
        applied can be reversed here, against the state it recorded at the time.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="ghost" testId="ops-journal-refresh" onClick={onReload}>
          Refresh
        </Button>
        <ToolbarSpring />
        {note ? (
          <InlineNote kind={note.kind} testId="ops-journal-note">
            {note.text}
          </InlineNote>
        ) : null}
      </div>

      {load.phase === 'loading' ? (
        <SkeletonRows rows={3} />
      ) : load.phase === 'unsupported' ? (
        <InlineNote kind="muted" testId="ops-journal-unsupported">
          This engine build does not serve an action journal. Update the Auracle stack to see and
          reverse operator actions here.
        </InlineNote>
      ) : load.phase === 'unreachable' ? (
        <InlineNote kind="err" testId="ops-journal-unreachable">
          The engine did not answer, so the action journal cannot be listed.
        </InlineNote>
      ) : ready && ready.entries.length === 0 ? (
        <InlineNote kind="muted" testId="ops-journal-empty">
          No operator actions recorded yet.
        </InlineNote>
      ) : (
        <div
          className="apk-enter"
          style={{
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 11,
            border: `1px solid ${tone.border}`,
            background: tone.surface,
            overflow: 'hidden',
          }}
        >
          {(ready?.entries ?? []).map((entry) => (
            <JournalRow
              key={entry.id}
              entry={entry}
              busy={busyId === entry.id}
              onUndo={() => onUndo(entry)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function state(wall: IncidentsSummary | null): { status: RoomStatus; label?: string } {
  if (!wall || wall.phase === 'loading') return { status: 'degraded', label: 'reading' };
  if (wall.phase === 'unreachable') return { status: 'attention', label: 'engine unreachable' };
  if ((wall.open ?? 0) > 0) {
    const n = wall.open as number;
    return { status: 'attention', label: `${n} open` };
  }
  return { status: 'nominal', label: 'all clear' };
}

/** A count actually reported, or null for the frame's quiet placeholder. */
function figure(n: number | null | undefined): string | null {
  return typeof n === 'number' ? String(n) : null;
}

export function IncidentsPage({ host }: PanelHostProps): JSX.Element {
  const [wall, setWall] = useState<IncidentsSummary | null>(null);
  const [journal, setJournal] = useState<JournalLoad>({ phase: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadJournal = useCallback(async () => {
    setJournal(await readJournal());
  }, []);

  useEffect(() => {
    void loadJournal();
    // A reconnect (new key, engine restarted) invalidates the journal the same
    // way it invalidates every other reading.
    return onConnectGeneration(() => void loadJournal());
  }, [loadJournal]);

  const undo = async (entry: OpsEntry): Promise<void> => {
    setBusyId(entry.id);
    setNote(null);
    const result = await undoEntry(entry.id);
    setBusyId(null);
    if (!result.ok) {
      setNote({ kind: 'err', text: result.message ?? 'The undo did not go through.' });
      return;
    }
    // Optimistic only on success: mark this one entry undone so the row settles
    // immediately, then re-read so the engine's own record is what stands.
    setJournal((prev) =>
      prev.phase === 'ready'
        ? {
            phase: 'ready',
            entries: prev.entries.map((row) =>
              row.id === entry.id ? { ...row, status: 'undone' } : row
            ),
          }
        : prev
    );
    setNote({ kind: 'ok', text: `Undone: ${entry.action ?? 'the action'}.` });
    void loadJournal();
  };

  const { status, label } = state(wall);
  const entries = journal.phase === 'ready' ? journal.entries : null;

  const vitals: PageVital[] = [
    { label: 'open', value: figure(wall?.open), emphasis: 'bad' },
    { label: 'critical', value: figure(wall?.critical), emphasis: 'bad' },
    { label: 'recorded actions', value: entries ? String(entries.length) : null },
    {
      label: 'reversible',
      value: entries ? String(entries.filter(isUndoable).length) : null,
    },
  ];

  return (
    <RoomPage
      room="incidents"
      status={status}
      statusLabel={label}
      context={`${ROOM_CONTEXT.incidents} Below it, the record of what has been done about it: every reversal runs the engine's own inverse against the state it captured, so undoing a change is not a second guess at what it used to be.`}
      vitals={vitals}
    >
      <div
        data-testid="grid-page-incidents"
        style={{ display: 'flex', flexDirection: 'column', gap: 22 }}
      >
        <IncidentsPanel host={host} onSummary={setWall} />
        <JournalSection
          load={journal}
          busyId={busyId}
          note={note}
          onReload={() => void loadJournal()}
          onUndo={(entry) => void undo(entry)}
        />
      </div>
    </RoomPage>
  );
}
