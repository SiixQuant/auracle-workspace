/**
 * Strategies — the Build-Test district's workspace room.
 *
 * The only room whose body has no pre-Grid panel behind it: strategies were
 * previously reachable only as a dropdown inside other surfaces (Validation's
 * picker, the Deploy wizard, the QC export), so there was nowhere to simply
 * SEE what the engine can run. This page is that list, and nothing more — it
 * owns no new domain logic:
 *
 *  - the list is the engine's own discovery route, shaped by the existing
 *    `strategyOptionsFromDiscovery` / `excludedFromDiscovery` helpers;
 *  - "Backtest" and "Deploy" are the existing Spine hand-offs
 *    (`spineActions`), the same ones the editor header and the Flow nodes fire;
 *  - "Open" resolves through `strategySourceFromDotted`, which is the one
 *    transform that knows a desk-mounted strategy has no editable file — so the
 *    control is disabled with the reason instead of opening a path the editor
 *    cannot resolve.
 *
 * Honesty: a strategy the engine DISCARDED is listed with the engine's own
 * reason rather than hidden. A file that silently never appears is the thing
 * that makes people distrust discovery.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import {
  excludedFromDiscovery,
  strategyOptionsFromDiscovery,
  type ExcludedStrategy,
  type StrategyOption,
} from '../../../engine/backtest';
import { getJsonDetailed } from '../../../engine/client';
import { focusStore } from '../../../engine/focusStore';
import { prettifyPath } from '../../../engine/humanize';
import { classifyLoadFailure, type LoadFailure } from '../../../engine/research';
import { strategySourceFromDotted } from '../../../engine/spineNav';
import {
  Button,
  CenterState,
  PanelShell,
  Pill,
  SectionLabel,
  SkeletonRows,
  ToolbarSpring,
  tone,
} from '../../panelkit';
import { backtestOption, deployOption } from '../../spineActions';
import { RoomPage, type RoomStatus, type PageVital } from '../RoomPage';
import { ROOM_CONTEXT } from '../roomContext';

type ListState =
  | { phase: 'loading' }
  | { phase: 'failed'; why: LoadFailure }
  | { phase: 'ready'; options: StrategyOption[]; excluded: ExcludedStrategy[] };

/** The engine serves discovery deployable-filtered — the same query every
 *  other strategy picker in the pack uses, so the rooms agree on the set. */
const DISCOVERY = '/ui/api/backtest/strategies?deployable=1';

function StrategyRow({
  option,
  focused,
  onOpen,
}: {
  option: StrategyOption;
  focused: boolean;
  onOpen: (option: StrategyOption) => void;
}): JSX.Element {
  const source = strategySourceFromDotted(option.path, { hasClassSuffix: true });
  const focus = source ? { filePath: source.path, dottedPath: option.path } : undefined;

  return (
    <article
      className="apk-row"
      data-testid={`strategy-row-${option.path}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        padding: '11px 6px',
        borderTop: `1px solid ${tone.border}`,
        borderRadius: 6,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{option.cls}</span>
          {focused ? <Pill kind="accent">Focused</Pill> : null}
        </div>
        <span style={{ fontSize: 11.5, color: tone.text3 }}>{option.label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Button
          variant="quiet"
          disabled={!source?.openable}
          title={source?.openable ? 'Open the strategy file' : source?.reason}
          onClick={() => onOpen(option)}
        >
          Open
        </Button>
        <Button variant="quiet" onClick={() => backtestOption(option, focus)}>
          Backtest
        </Button>
        <Button variant="quiet" onClick={() => deployOption(option, focus)}>
          Deploy
        </Button>
      </div>
    </article>
  );
}

function state(list: ListState): { status: RoomStatus; label?: string } {
  if (list.phase === 'loading') return { status: 'degraded', label: 'reading' };
  if (list.phase === 'failed') {
    return {
      status: 'attention',
      label: list.why === 'outdated' ? 'engine outdated' : 'engine unreachable',
    };
  }
  if (list.options.length === 0) return { status: 'degraded', label: 'nothing runnable' };
  if (list.excluded.length > 0) {
    return { status: 'degraded', label: `${list.excluded.length} not runnable` };
  }
  return { status: 'nominal' };
}

export function StrategiesPage({ host }: PanelHostProps): JSX.Element {
  const [list, setList] = useState<ListState>({ phase: 'loading' });
  const focus = useSyncExternalStore(focusStore.subscribe, focusStore.getSnapshot);

  const load = useCallback(async () => {
    const result = await getJsonDetailed<Record<string, unknown>>(DISCOVERY);
    if (!result.ok) {
      setList({ phase: 'failed', why: classifyLoadFailure(result.status) });
      return;
    }
    const rows = Array.isArray(result.body.strategies)
      ? (result.body.strategies as Record<string, unknown>[])
      : [];
    setList({
      phase: 'ready',
      options: strategyOptionsFromDiscovery(rows),
      excluded: excludedFromDiscovery(result.body.excluded),
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openSource = (option: StrategyOption): void => {
    const source = strategySourceFromDotted(option.path, { hasClassSuffix: true });
    if (!source?.openable) return;
    focusStore.publish({ strategy: { filePath: source.path, dottedPath: option.path } });
    host?.openFile?.(source.path);
  };

  const { status, label } = state(list);
  const ready = list.phase === 'ready' ? list : null;
  const focusedFile = focus.strategy?.filePath ?? null;

  const vitals: PageVital[] = [
    { label: 'runnable', value: ready ? String(ready.options.length) : null },
    {
      label: 'not runnable',
      value: ready ? String(ready.excluded.length) : null,
      emphasis: ready && ready.excluded.length > 0 ? 'warn' : undefined,
    },
    {
      label: 'focused',
      value: focusedFile ? (focusedFile.split(/[\\/]/).pop() ?? focusedFile) : null,
    },
  ];

  return (
    <RoomPage
      room="strategies"
      status={status}
      statusLabel={label}
      context={`${ROOM_CONTEXT.strategies} From here a strategy goes to a backtest or to a deployment.`}
      vitals={vitals}
    >
      <PanelShell
        title="Strategies"
        toolbar={
          <>
            <Button variant="ghost" onClick={() => void load()}>
              Refresh
            </Button>
            <ToolbarSpring />
          </>
        }
      >
        {list.phase === 'loading' ? (
          <SkeletonRows rows={4} />
        ) : list.phase === 'failed' && list.why === 'outdated' ? (
          <CenterState
            title="Engine update required"
            detail="This engine build predates strategy discovery. Update the Auracle stack from the launcher, then re-check."
            actions={
              <Button variant="ghost" onClick={() => void load()}>
                Re-check
              </Button>
            }
          />
        ) : list.phase === 'failed' ? (
          <CenterState
            title="The engine didn't respond"
            detail="Strategies are discovered by your local Auracle engine. Make sure the stack is running, then retry."
            actions={
              <Button variant="primary" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        ) : list.options.length === 0 && list.excluded.length === 0 ? (
          <CenterState
            title="No strategies yet"
            detail="Draft one from a finding, import a QuantConnect project, or start from the Auracle scaffold — anything the engine can run shows up here."
          />
        ) : (
          <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {list.options.map((option) => (
              <StrategyRow
                key={option.path}
                option={option}
                focused={
                  focus.strategy?.dottedPath === option.path ||
                  strategySourceFromDotted(option.path, { hasClassSuffix: true })?.path ===
                    focusedFile
                }
                onOpen={openSource}
              />
            ))}

            {list.excluded.length > 0 ? (
              <>
                <SectionLabel meta={`${list.excluded.length}`}>Not runnable</SectionLabel>
                {list.excluded.map((row) => (
                  <div
                    key={row.path}
                    data-testid={`strategy-excluded-${row.path}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 6px' }}
                  >
                    <span style={{ fontSize: 12.5, color: tone.text2 }} title={row.path}>
                      {prettifyPath(row.path) ?? row.path}
                    </span>
                    <span style={{ fontSize: 11.5, color: tone.caution }}>
                      Engine skipped it: {row.reason}
                    </span>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        )}
      </PanelShell>
    </RoomPage>
  );
}
