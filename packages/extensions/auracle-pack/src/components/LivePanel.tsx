/**
 * Live Algorithms panel (fullscreen): deployments table with per-row ledger
 * expansion and lifecycle actions, plus the Deploy wizard. Honesty rules:
 * lifecycle buttons render only what the engine allows for the row's state,
 * Liquidate always confirms, the broker list comes from the engine (never a
 * hardcoded set), and every number shown is an engine value.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { authState, getJson, onConnectGeneration, postJson } from '../engine/client';
import { Connector, isConnected, normalizeConnector } from '../engine/model';
import { deployStore } from '../engine/deployStore';
import {
  blockedReasonText,
  deployWizardMode,
  exclusionsFromDiscovery,
  type DeployExclusion,
  type DeploySnapshot,
  type StrategyOption,
} from '../engine/deploy';
import { markLivePanelMounted, markLivePanelUnmounted } from './panelVisibility';
import {
  ACTION_LABELS,
  COMPUTE_LABELS,
  COMPUTE_PAID_REASON,
  Compute,
  DeployWizard,
  Deployment,
  DeploymentEquity,
  DeploymentOrders,
  LiveAction,
  LiveAlgorithms,
  activeCount,
  availableActions,
  canDeploy,
  computeLocked,
  deploymentContext,
  deploymentEquityPoints,
  deploymentPrompt,
  formatReturn,
  isActive,
  isDestructive,
  isPaidTier,
  newWizard,
  selectedDeployment,
  setRows,
  splitStrategyPath,
  stateLabel,
  toRequest,
  validateWizard,
  verbEndpoint,
} from '../engine/live';
import { useAiPanelContext, handOffToAgent, type AgentNote } from './aiPanel';
import { money, price, qty, percent } from '../engine/format';
import {
  Button,
  CenterState,
  InlineNote,
  PanelShell,
  Pill,
  Select,
  SkeletonRows,
  StatBand,
  ToolbarSpring,
  numeric,
  tint,
  tone,
  trendColor,
} from './panelkit';
import { EquityChartShad } from './charts/EquityChartShad';

const POLL_MS = 20_000;

const ACCENT = 'var(--accent-primary, #60a5fa)';
const CAUTION = '#d4a017';
const DANGER = '#c4554d';
const OK = '#2ea043';
const NEUTRAL = 'var(--text-tertiary, #8a8f98)';

/** Status colour by lifecycle state — green live, red errored, amber preparing, grey idle. */
function stateColor(state: string): string {
  switch (state) {
    case 'running':
      return OK;
    case 'errored':
      return DANGER;
    case 'starting':
    case 'restarting':
    case 'preflight':
    case 'provisioning':
    case 'liquidating':
      return CAUTION;
    default:
      return NEUTRAL;
  }
}

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
    padding: 16,
    height: '100%',
    overflow: 'auto',
    color: 'var(--text-primary, #d7dae0)',
    font: '13px/1.5 var(--font-family-ui, system-ui, sans-serif)',
  },
  headerRow: { display: 'flex', alignItems: 'center' as const, justifyContent: 'space-between' as const },
  title: { fontSize: 15, fontWeight: 600 },
  button: (primary?: boolean, danger?: boolean) => ({
    padding: '5px 12px',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    border: `1px solid ${danger ? DANGER : 'var(--border-primary, rgba(127,127,127,0.35))'}`,
    background: primary ? ACCENT : 'transparent',
    color: primary ? '#fff' : danger ? DANGER : 'var(--text-primary, #d7dae0)',
  }),
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: {
    textAlign: 'left' as const,
    padding: '6px 8px',
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    color: 'var(--text-tertiary, #8a8f98)',
    borderBottom: '1px solid var(--border-primary, rgba(127,127,127,0.25))',
  },
  td: { padding: '7px 8px', borderBottom: '1px solid var(--border-primary, rgba(127,127,127,0.15))' },
  tdNum: {
    padding: '7px 8px',
    borderBottom: '1px solid var(--border-primary, rgba(127,127,127,0.15))',
    textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums' as const,
    whiteSpace: 'nowrap' as const,
  },
  note: { fontSize: 12, color: 'var(--text-tertiary, #8a8f98)' },
  input: {
    width: '100%',
    padding: '7px 9px',
    borderRadius: 6,
    fontSize: 13,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    background: 'var(--bg-primary, rgba(0,0,0,0.2))',
    color: 'var(--text-primary, #d7dae0)',
    outline: 'none',
  },
  fieldLabel: { fontSize: 12, color: 'var(--text-secondary, #b9bec7)', marginBottom: 4 },
  error: { fontSize: 12, color: DANGER },

  // --- Deploy wizard chrome -------------------------------------------------
  backBtn: {
    display: 'inline-flex',
    alignItems: 'center' as const,
    gap: 6,
    padding: '4px 10px 4px 6px',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--text-secondary, #b9bec7)',
  },
  wizSubtitle: { fontSize: 12.5, color: 'var(--text-tertiary, #8a8f98)', marginTop: 2 },
  card: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 20,
    maxWidth: 640,
    padding: 20,
    borderRadius: 12,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.22))',
    background: 'var(--bg-secondary, rgba(255,255,255,0.018))',
  },
  section: { display: 'flex', flexDirection: 'column' as const, gap: 12 },
  sectionHead: {
    fontSize: 11,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.7,
    color: 'var(--text-tertiary, #8a8f98)',
  },
  divider: { height: 1, border: 0, margin: 0, background: 'var(--border-primary, rgba(127,127,127,0.16))' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 },
  field: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  labelRow: { display: 'flex', alignItems: 'baseline' as const, justifyContent: 'space-between' as const, gap: 8 },

  // Segmented control (Mode, Compute)
  segWrap: {
    display: 'inline-flex',
    padding: 3,
    gap: 3,
    borderRadius: 8,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.3))',
    background: 'var(--bg-primary, rgba(0,0,0,0.22))',
  },
  seg: (active: boolean, tone?: 'caution') => ({
    padding: '5px 14px',
    borderRadius: 6,
    fontSize: 12.5,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    border: '1px solid transparent',
    whiteSpace: 'nowrap' as const,
    background: active ? (tone === 'caution' ? 'rgba(212,160,23,0.16)' : ACCENT) : 'transparent',
    color: active ? (tone === 'caution' ? CAUTION : '#fff') : 'var(--text-secondary, #b9bec7)',
    boxShadow: active && tone === 'caution' ? `inset 0 0 0 1px ${CAUTION}` : 'none',
  }),

  // AUM hero field
  aumBox: (warn: boolean) => ({
    display: 'flex',
    alignItems: 'center' as const,
    gap: 4,
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${warn ? CAUTION : 'var(--border-primary, rgba(127,127,127,0.35))'}`,
    background: 'var(--bg-primary, rgba(0,0,0,0.22))',
  }),
  aumPrefix: { fontSize: 20, color: 'var(--text-tertiary, #8a8f98)', fontWeight: 500 as const },
  aumInput: {
    flex: 1,
    minWidth: 0,
    border: 'none',
    background: 'transparent',
    outline: 'none',
    color: 'var(--text-primary, #d7dae0)',
    fontSize: 20,
    fontWeight: 600 as const,
    fontVariantNumeric: 'tabular-nums' as const,
    letterSpacing: 0.2,
  },
  reqPill: (required: boolean) => ({
    fontSize: 10.5,
    fontWeight: 600 as const,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
    padding: '2px 7px',
    borderRadius: 999,
    color: required ? CAUTION : 'var(--text-tertiary, #8a8f98)',
    background: required ? 'rgba(212,160,23,0.14)' : 'var(--bg-primary, rgba(0,0,0,0.2))',
  }),

  // Chips (data sources)
  chip: (active: boolean) => ({
    display: 'inline-flex',
    alignItems: 'center' as const,
    gap: 6,
    padding: '5px 11px',
    borderRadius: 999,
    fontSize: 12,
    cursor: 'pointer',
    border: `1px solid ${active ? ACCENT : 'var(--border-primary, rgba(127,127,127,0.3))'}`,
    background: active ? tint(ACCENT, 14) : 'transparent',
    color: active ? 'var(--text-primary, #d7dae0)' : 'var(--text-secondary, #b9bec7)',
  }),

  // Resilience switch row
  switchRow: {
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 12,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.22))',
    background: 'var(--bg-primary, rgba(0,0,0,0.14))',
  },
  track: (on: boolean) => ({
    position: 'relative' as const,
    width: 34,
    height: 20,
    borderRadius: 999,
    flexShrink: 0,
    cursor: 'pointer',
    transition: 'background 120ms ease',
    background: on ? ACCENT : 'var(--border-primary, rgba(127,127,127,0.4))',
  }),
  knob: (on: boolean) => ({
    position: 'absolute' as const,
    top: 2,
    left: on ? 16 : 2,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#fff',
    transition: 'left 120ms ease',
  }),

  caution: { fontSize: 12, color: CAUTION, display: 'flex', alignItems: 'center' as const, gap: 6 },
  help: { fontSize: 11.5, color: 'var(--text-tertiary, #8a8f98)' },
  proTag: {
    marginLeft: 6,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
    padding: '1px 5px',
    borderRadius: 999,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    color: 'var(--text-tertiary, #8a8f98)',
    verticalAlign: 'middle',
  },

  // Footer
  footer: {
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 16,
    flexWrap: 'wrap' as const,
  },
  checklist: { display: 'flex', flexDirection: 'column' as const, gap: 3 },
  checkItem: { display: 'flex', alignItems: 'center' as const, gap: 7, fontSize: 12, color: 'var(--text-tertiary, #8a8f98)' },
  dot: (color: string, filled: boolean) => ({
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
    background: filled ? color : 'transparent',
    boxShadow: filled ? 'none' : `inset 0 0 0 1.5px ${color}`,
  }),
  ready: { display: 'flex', alignItems: 'center' as const, gap: 7, fontSize: 12.5, color: OK, fontWeight: 500 as const },
  deployBtn: (enabled: boolean) => ({
    padding: '8px 20px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600 as const,
    cursor: enabled ? 'pointer' : 'not-allowed',
    border: '1px solid transparent',
    background: enabled ? ACCENT : 'var(--bg-primary, rgba(127,127,127,0.15))',
    color: enabled ? '#fff' : 'var(--text-tertiary, #8a8f98)',
    opacity: enabled ? 1 : 0.85,
  }),
  ghostBtn: {
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    background: 'transparent',
    color: 'var(--text-secondary, #b9bec7)',
  },
  serverError: {
    fontSize: 12.5,
    color: DANGER,
    padding: '9px 12px',
    borderRadius: 8,
    border: `1px solid rgba(196,85,77,0.4)`,
    background: 'rgba(196,85,77,0.1)',
  },

  // Pre-bound strategy identity row (replaces the picker when deploying a file)
  identityRow: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: 10,
    padding: '8px 11px',
    borderRadius: 7,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.35))',
    background: 'var(--bg-primary, rgba(0,0,0,0.22))',
  },
  changeBtn: {
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 11.5,
    cursor: 'pointer',
    border: '1px solid var(--border-primary, rgba(127,127,127,0.3))',
    background: 'transparent',
    color: 'var(--text-secondary, #b9bec7)',
    flexShrink: 0,
  },

  // "N files can't be deployed — why" exclusions expander
  exclWrap: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  exclToggle: {
    display: 'inline-flex',
    alignItems: 'center' as const,
    gap: 6,
    alignSelf: 'flex-start' as const,
    padding: '3px 2px',
    fontSize: 12,
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-secondary, #b9bec7)',
    fontFamily: 'inherit',
  },
  exclList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border-primary, rgba(127,127,127,0.22))',
    background: 'var(--bg-primary, rgba(0,0,0,0.14))',
  },
  exclRow: { display: 'flex', flexDirection: 'column' as const, gap: 1, minWidth: 0 },
  exclFile: {
    fontSize: 12,
    color: 'var(--text-primary, #d7dae0)',
    fontFamily: 'var(--font-family-mono, ui-monospace, SFMono-Regular, monospace)',
    wordBreak: 'break-all' as const,
  },
  exclReason: { fontSize: 11.5, color: 'var(--text-tertiary, #8a8f98)' },
};

/** Dashboard / ledger table language — panelkit-toned, right-aligned money. */
const dash = {
  table: { width: '100%', borderCollapse: 'separate' as const, borderSpacing: 0, fontSize: 13 },
  th: {
    textAlign: 'left' as const,
    padding: '7px 10px',
    fontSize: 10.5,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    color: tone.text3,
    borderBottom: `1px solid ${tone.border}`,
    whiteSpace: 'nowrap' as const,
  },
  thNum: {
    textAlign: 'right' as const,
    padding: '7px 10px',
    fontSize: 10.5,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    color: tone.text3,
    borderBottom: `1px solid ${tone.border}`,
    whiteSpace: 'nowrap' as const,
  },
  td: { padding: '10px', borderBottom: `1px solid ${tone.border}`, verticalAlign: 'middle' as const },
  tdNum: {
    padding: '10px',
    borderBottom: `1px solid ${tone.border}`,
    textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const,
    ...numeric,
  },
} as const;

/** Status → semantic pill kind: green running, red errored, amber preparing, grey idle. */
function statePill(state: string): 'ok' | 'danger' | 'caution' | 'muted' {
  if (state === 'running') return 'ok';
  if (state === 'errored') return 'danger';
  return isActive(state) ? 'caution' : 'muted';
}

/** A deployable strategy as the picker lists it — `path` is the import module
 *  (post-split), `cls` the class; the deploy loader needs them separately. */
interface PickerStrategy {
  path: string;
  cls: string;
  label: string;
}

/** The locked strategy identity, shown instead of the picker on a pre-bound deploy. */
function DeployIdentityRow({ locked, onClear }: { locked: StrategyOption; onClear: () => void }) {
  const modulePath = splitStrategyPath(locked.path).path;
  return (
    <div style={styles.identityRow}>
      <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: ACCENT }}>
        deployed_code
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #d7dae0)' }}>{locked.cls}</span>
        <span
          style={{
            fontSize: 11.5,
            color: 'var(--text-tertiary, #8a8f98)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {modulePath}
        </span>
      </div>
      <span style={{ flex: 1 }} />
      <button type="button" onClick={onClear} style={styles.changeBtn} title="Pick a different strategy">
        Change
      </button>
    </div>
  );
}

/** The honest "N files can't be deployed — why" expander, collapsed by default.
 *  Renders nothing when there are no exclusions (older engine / clean workspace). */
function ExclusionsExpander({ exclusions }: { exclusions: DeployExclusion[] }) {
  const [open, setOpen] = useState(false);
  if (exclusions.length === 0) return null;
  const n = exclusions.length;
  return (
    <div style={styles.exclWrap}>
      <button
        type="button"
        style={styles.exclToggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span aria-hidden style={{ fontSize: 10, color: NEUTRAL }}>
          {open ? '▾' : '▸'}
        </span>
        {n} file{n === 1 ? '' : 's'} can’t be deployed — why
      </button>
      {open ? (
        <div className="apk-enter" style={styles.exclList}>
          {exclusions.map((e) => (
            <div key={e.file} style={styles.exclRow}>
              <span style={styles.exclFile}>{e.file}</span>
              <span style={styles.exclReason}>{e.reason}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Deploy wizard. Opened two ways:
 *  - from the Live Algorithms page (`deploy` null): the full strategy picker,
 *    plus the honest exclusions expander.
 *  - pre-bound from the editor Deploy header (`deploy` set): the resolved file's
 *    strategy as a locked identity row, or an honest non-deployable / scoped
 *    chooser / engine-down state — the wizard owns every failure state.
 * Everything else (mode, brokerage, capital, compute, resilience) is identical.
 */
export function DeployWizardView({
  deploy,
  onDone,
  onCancel,
  onClear,
}: {
  deploy: DeploySnapshot | null;
  onDone: () => void;
  onCancel: () => void;
  onClear: () => void;
}): JSX.Element {
  const mode = deployWizardMode(deploy);

  if (mode.view === 'resolving') {
    return (
      <div style={styles.card}>
        <SkeletonRows rows={3} />
      </div>
    );
  }
  if (mode.view === 'engine-down') {
    return (
      <CenterState
        icon="⚡"
        tone="danger"
        title={mode.outdated ? 'Engine update required' : "The engine isn't reachable"}
        detail={
          mode.outdated
            ? 'This engine build predates the deploy surface. Update the Auracle stack, then deploy again.'
            : 'Deploy reads your strategies from the local Auracle engine. Start the stack, then deploy again.'
        }
        actions={
          <Button variant="ghost" onClick={onCancel}>
            Back
          </Button>
        }
      />
    );
  }
  if (mode.view === 'blocked') {
    const { title, detail } = blockedReasonText(mode.reason);
    return (
      <CenterState
        icon="○"
        title={title}
        detail={detail}
        actions={
          <Button variant="ghost" onClick={onCancel}>
            Back to Live Algorithms
          </Button>
        }
      />
    );
  }
  if (mode.view === 'chooser') {
    return (
      <div className="apk-enter" style={{ ...styles.card, gap: 12 }}>
        <div style={styles.sectionHead}>This file defines more than one strategy</div>
        <span style={{ fontSize: 12.5, color: 'var(--text-secondary, #b9bec7)' }}>Pick which one to deploy:</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mode.options.map((opt) => (
            <Button key={opt.path} variant="ghost" onClick={() => deployStore.choose(opt)}>
              {opt.label}
            </Button>
          ))}
        </div>
        <div>
          <button type="button" style={styles.ghostBtn} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return <DeployForm key={mode.locked?.path ?? 'unbound'} locked={mode.locked} onDone={onDone} onCancel={onCancel} onClear={onClear} />;
}

function DeployForm({
  locked,
  onDone,
  onCancel,
  onClear,
}: {
  locked: StrategyOption | null;
  onDone: () => void;
  onCancel: () => void;
  onClear: () => void;
}) {
  const [wizard, setWizard] = useState<DeployWizard>(() => {
    const w = newWizard();
    if (locked) {
      const { path, cls } = splitStrategyPath(locked.path);
      w.strategy_path = path;
      w.strategy_cls = cls;
    }
    return w;
  });
  const [brokers, setBrokers] = useState<Connector[]>([]);
  const [dataProviders, setDataProviders] = useState<Connector[]>([]);
  const [strategies, setStrategies] = useState<PickerStrategy[]>([]);
  const [exclusions, setExclusions] = useState<DeployExclusion[]>([]);
  const [paid, setPaid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const connections = await getJson<{ connections?: Array<Partial<Connector> & { id: string }> }>(
        '/ui/api/connections?kind=all'
      );
      const all = (connections?.connections ?? []).map(normalizeConnector);
      setBrokers(all.filter((connector) => connector.kind === 'broker'));
      setDataProviders(all.filter((connector) => connector.kind === 'data_provider'));

      const auth = await authState();
      setPaid(isPaidTier(auth.tier));

      // The global picker (and its exclusions) only exists in the unbound
      // wizard — a pre-bound deploy already knows its one strategy.
      if (locked) return;

      // Only the user's own, deployable strategies (bundled/examples dropped,
      // workspace bucket preferred). Discovery hands back the class combined
      // into the path, so split it — the deploy loader needs module + class
      // separately. Function-based backtests can't run live, so drop them.
      const strategiesBody = await getJson<{
        strategies?: Array<{ path?: string; kind?: string; doc?: string }>;
        excluded?: unknown;
      }>('/ui/api/backtest/strategies?deployable=1');
      const options = (strategiesBody?.strategies ?? [])
        .filter((raw) => (raw.kind ?? 'class') === 'class' && typeof raw.path === 'string' && raw.path.length > 0)
        .map((raw) => {
          const { path, cls } = splitStrategyPath(raw.path as string);
          const doc = typeof raw.doc === 'string' ? raw.doc : '';
          return { path, cls, label: doc ? `${cls} — ${doc}` : cls };
        })
        .filter((option) => option.path.length > 0 && option.cls.length > 0);
      setStrategies(options);
      // Additive, dual-read: absent field → [] → no expander.
      setExclusions(exclusionsFromDiscovery(strategiesBody));
    })();
  }, [locked]);

  const errors = useMemo(() => validateWizard(wizard), [wizard]);

  const submit = async () => {
    setSubmitting(true);
    setServerError(null);
    const response = await postJson('/deploy/live', toRequest(wizard));
    setSubmitting(false);
    if (response.ok) {
      onDone();
    } else {
      const body = (response.body ?? {}) as { detail?: unknown };
      setServerError(
        typeof body.detail === 'string'
          ? body.detail
          : `Deploy rejected (${response.status || 'engine unreachable'}).`
      );
    }
  };

  const set = (patch: Partial<DeployWizard>) => setWizard((prev) => ({ ...prev, ...patch }));

  const live = wizard.mode === 'live';
  const ready = canDeploy(wizard);

  return (
    <div style={styles.card}>
      {/* --- What to run ---------------------------------------------------- */}
      <div style={styles.section}>
        <div style={styles.sectionHead}>What to run</div>
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Name</div>
          <input
            style={styles.input}
            placeholder="e.g. Momentum SPY — live"
            value={wizard.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Mode</div>
          <div style={styles.segWrap}>
            {(['paper', 'live'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                style={styles.seg(wizard.mode === mode, mode === 'live' ? 'caution' : undefined)}
                onClick={() => set({ mode })}
              >
                {mode === 'paper' ? 'Paper' : 'Live'}
              </button>
            ))}
          </div>
          {live ? (
            <div style={styles.caution}>
              <span aria-hidden>▲</span> Live places real orders through your broker.
            </div>
          ) : (
            <div style={styles.help}>Paper trades against the simulator. No credentials needed.</div>
          )}
        </div>
        <div style={styles.grid2}>
          <div style={styles.field}>
            <div style={styles.fieldLabel}>Strategy</div>
            {locked ? (
              <DeployIdentityRow locked={locked} onClear={onClear} />
            ) : (
              <Select
                fluid
                ariaLabel="Strategy"
                placeholder="Select a strategy…"
                value={wizard.strategy_path && wizard.strategy_cls ? `${wizard.strategy_path}::${wizard.strategy_cls}` : ''}
                onChange={(next) => {
                  const [path, cls] = next.split('::');
                  set({ strategy_path: path ?? '', strategy_cls: cls ?? '' });
                }}
                options={strategies.map((option) => ({
                  value: `${option.path}::${option.cls}`,
                  label: option.label,
                }))}
              />
            )}
          </div>
          <div style={styles.field}>
            <div style={styles.fieldLabel}>Brokerage</div>
            <Select
              fluid
              ariaLabel="Brokerage"
              placeholder="Select a brokerage…"
              value={wizard.broker ?? ''}
              onChange={(next) => set({ broker: next || null })}
              options={brokers.map((broker) => ({
                value: broker.id,
                label:
                  (broker.display_label || broker.id) +
                  (isConnected(broker.status) ? '' : ' (not connected)'),
              }))}
            />
          </div>
        </div>
        {locked ? null : <ExclusionsExpander exclusions={exclusions} />}
      </div>

      <hr style={styles.divider} />

      {/* --- Capital (the field that matters most) ------------------------- */}
      <div style={styles.section}>
        <div style={styles.labelRow}>
          <div style={styles.sectionHead}>Starting capital / AUM</div>
          <span style={styles.reqPill(live)}>{live ? 'Required' : 'Optional for paper'}</span>
        </div>
        <div style={styles.aumBox(live && !(typeof wizard.aum === 'number' && wizard.aum > 0))}>
          <span style={styles.aumPrefix}>$</span>
          <input
            style={styles.aumInput}
            inputMode="decimal"
            placeholder="100,000"
            value={wizard.aum ?? ''}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[$,\s]/g, '');
              const parsed = cleaned.length > 0 ? Number(cleaned) : null;
              set({ aum: parsed !== null && Number.isFinite(parsed) ? parsed : null });
            }}
          />
        </div>
        <div style={styles.help}>The capital the strategy sizes against. Live orders are capped by your broker buying power.</div>
      </div>

      <hr style={styles.divider} />

      {/* --- Where it runs -------------------------------------------------- */}
      <div style={styles.section}>
        <div style={styles.sectionHead}>Where it runs</div>
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Compute</div>
          <div style={styles.segWrap}>
            {(Object.keys(COMPUTE_LABELS) as Compute[]).map((compute) => {
              const locked = computeLocked(compute, paid);
              return (
                <button
                  key={compute}
                  type="button"
                  disabled={locked}
                  title={locked ? COMPUTE_PAID_REASON : undefined}
                  style={{
                    ...styles.seg(wizard.compute === compute),
                    ...(locked ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
                  }}
                  onClick={() => {
                    if (!locked) set({ compute });
                  }}
                >
                  {COMPUTE_LABELS[compute]}
                  {locked ? <span style={styles.proTag}>Pro</span> : null}
                </button>
              );
            })}
          </div>
          {!paid ? (
            <div style={styles.help}>
              Cloud compute (Oracle Cloud, AWS) is a Pro feature — deployments run on this machine.
            </div>
          ) : null}
        </div>
        <div style={styles.field}>
          <div style={styles.fieldLabel}>
            Data sources{wizard.compute !== 'local' ? ' (at least one for cloud)' : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {dataProviders.map((provider) => {
              const checked = wizard.data_providers.includes(provider.id);
              return (
                <button
                  key={provider.id}
                  type="button"
                  style={styles.chip(checked)}
                  onClick={() =>
                    set({
                      data_providers: checked
                        ? wizard.data_providers.filter((id) => id !== provider.id)
                        : [...wizard.data_providers, provider.id],
                    })
                  }
                >
                  {checked ? <span aria-hidden>✓</span> : null}
                  {provider.display_label || provider.id}
                </button>
              );
            })}
            {dataProviders.length === 0 ? <span style={styles.note}>None reported by the engine.</span> : null}
          </div>
        </div>
      </div>

      <hr style={styles.divider} />

      {/* --- Resilience ----------------------------------------------------- */}
      <div style={styles.switchRow}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13 }}>Auto-restart after interruptions</span>
          <span style={styles.help}>Best-effort restart once the algorithm has run for 5+ minutes.</span>
        </div>
        <div
          role="switch"
          aria-checked={wizard.auto_restart}
          tabIndex={0}
          style={styles.track(wizard.auto_restart)}
          onClick={() => set({ auto_restart: !wizard.auto_restart })}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              set({ auto_restart: !wizard.auto_restart });
            }
          }}
        >
          <span aria-hidden style={styles.knob(wizard.auto_restart)} />
        </div>
      </div>

      {serverError ? <div style={styles.serverError}>{serverError}</div> : null}

      <hr style={styles.divider} />

      {/* --- Footer: what's left + actions --------------------------------- */}
      <div style={styles.footer}>
        {ready ? (
          <span style={styles.ready}>
            <span aria-hidden style={styles.dot(OK, true)} /> Ready to deploy
          </span>
        ) : (
          <div style={styles.checklist}>
            {errors.map((error) => (
              <span key={error} style={styles.checkItem}>
                <span aria-hidden style={styles.dot('var(--text-tertiary, #8a8f98)', false)} />
                {error}
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={styles.ghostBtn} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            style={styles.deployBtn(ready && !submitting)}
            disabled={!ready || submitting}
            onClick={() => void submit()}
          >
            {submitting ? 'Deploying…' : live ? 'Deploy live' : 'Deploy'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EquityView({ deployment }: { deployment: Deployment }) {
  const [points, setPoints] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Reset first, so switching deployments shows no chart until THIS one's
    // curve loads — never the previously-selected deployment's series.
    setPoints(null);
    void (async () => {
      const body = await getJson<DeploymentEquity>(`/deployments/${deployment.id}/equity`);
      if (!cancelled) setPoints(deploymentEquityPoints(body));
    })();
    return () => {
      cancelled = true;
    };
  }, [deployment.id]);

  // Honest: no chartable series yet (no fills) or an older engine without the
  // route → no chart, rather than a flat or invented line. EquityChartShad
  // self-gates too, but returning early keeps the container out of the DOM.
  if (!points || points.length < 2) return null;
  return (
    <EquityChartShad
      points={points}
      title="Equity curve"
      description="Marked to daily closes"
      height={150}
      footerNote="Reconstructed from this deployment's fills"
      format={(v) => `$${qty(v)}`}
    />
  );
}

function LedgerView({ deployment }: { deployment: Deployment }) {
  const [ledger, setLedger] = useState<DeploymentOrders | null | 'unavailable'>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const body = await getJson<DeploymentOrders>(`/deployments/${deployment.id}/orders`);
      if (!cancelled) setLedger(body ?? 'unavailable');
    })();
    return () => {
      cancelled = true;
    };
  }, [deployment.id]);

  if (ledger === null) return <SkeletonRows rows={2} />;
  if (ledger === 'unavailable') {
    return (
      <InlineNote kind="muted">
        This engine build doesn&rsquo;t serve a per-deployment order ledger. Update the stack to see fills here.
      </InlineNote>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={dash.table}>
        <thead>
          <tr>
            <th style={dash.th}>Symbol</th>
            <th style={dash.th}>Side</th>
            <th style={dash.thNum}>Qty</th>
            <th style={dash.thNum}>Filled</th>
            <th style={dash.thNum}>Avg price</th>
            <th style={dash.th}>Status</th>
            <th style={dash.th}>Placed</th>
          </tr>
        </thead>
        <tbody>
          {ledger.orders.map((order) => (
            <tr key={order.id} className="apk-row">
              <td style={{ ...dash.td, fontWeight: 600 }}>{order.symbol}</td>
              <td style={dash.td}>
                <span
                  style={{
                    color: order.action === 'buy' ? tone.ok : order.action === 'sell' ? tone.danger : tone.text2,
                    fontWeight: 600,
                    fontSize: 12,
                    letterSpacing: 0.3,
                  }}
                >
                  {order.action.toUpperCase()}
                </span>
              </td>
              <td style={dash.tdNum}>{qty(order.quantity)}</td>
              <td style={dash.tdNum}>{qty(order.filled_quantity)}</td>
              <td style={dash.tdNum}>{price(order.avg_fill_price)}</td>
              <td style={dash.td}>
                <Pill kind={order.status === 'filled' ? 'ok' : 'muted'}>{order.status}</Pill>
              </td>
              <td style={{ ...dash.td, color: tone.text3, fontSize: 12, whiteSpace: 'nowrap', ...numeric }}>
                {order.created_at ?? '—'}
              </td>
            </tr>
          ))}
          {ledger.orders.length === 0 ? (
            <tr>
              <td style={dash.td} colSpan={7}>
                <span style={styles.note}>No orders yet.</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function LiveAlgorithmsPanel({ host }: PanelHostProps): JSX.Element {
  const [model, setModel] = useState<LiveAlgorithms>({ rows: [], selected: null });
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unreachable'>('loading');
  const [view, setView] = useState<'table' | 'wizard'>('table');
  const [pendingConfirm, setPendingConfirm] = useState<{ id: number; action: LiveAction } | null>(null);
  const [investigateNote, setInvestigateNote] = useState<AgentNote>(null);

  // The editor Deploy button resolves a file to a strategy and hands the
  // binding here; a non-idle phase means "open the wizard pre-bound".
  const deploySnap = useSyncExternalStore(deployStore.subscribe, deployStore.getSnapshot);
  const hasBinding = deploySnap.phase !== 'idle';

  // Report mount state so that Deploy button won't toggle an already-open Live
  // panel shut — it re-renders into the pre-bound wizard instead.
  useEffect(() => {
    markLivePanelMounted();
    return markLivePanelUnmounted;
  }, []);

  // Publish the selected deployment to the AI chat (ambient), and offer a
  // one-click investigate hand-off for it.
  const selectedRow = selectedDeployment(model);
  useAiPanelContext(
    host,
    phase === 'ready' && selectedRow ? deploymentContext(selectedRow) : null
  );
  const investigate = async (d: Deployment) => {
    setInvestigateNote(
      await handOffToAgent(host, deploymentPrompt(d), `Investigate: ${d.name || d.strategy_path}`)
    );
  };

  const load = useCallback(async () => {
    const rows = await getJson<Deployment[]>('/deployments');
    if (rows) {
      setModel((prev) => setRows(prev, rows));
      setPhase('ready');
    } else {
      setPhase('unreachable');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const offGeneration = onConnectGeneration(() => void load());
    return () => {
      clearInterval(timer);
      offGeneration();
    };
  }, [load]);

  const dispatch = async (id: number, action: LiveAction) => {
    if (isDestructive(action) && pendingConfirm?.id !== id) {
      setPendingConfirm({ id, action });
      return;
    }
    setPendingConfirm(null);
    await postJson(verbEndpoint(id, action));
    await load();
  };

  // Cancel / finish: drop any binding and return to the dashboard (reloading so
  // a fresh deploy shows). Change: drop the binding but stay on the global
  // picker so the user can pick a different strategy.
  const closeWizard = () => {
    deployStore.clear();
    setView('table');
    void load();
  };
  const clearBinding = () => {
    deployStore.clear();
    setView('wizard');
  };

  if (view === 'wizard' || hasBinding) {
    return (
      <div style={styles.page}>
        <div>
          <button type="button" style={styles.backBtn} onClick={closeWizard}>
            <span aria-hidden>‹</span> Live Algorithms
          </button>
          <div style={{ ...styles.title, fontSize: 17, marginTop: 4 }}>Deploy a strategy</div>
          <div style={styles.wizSubtitle}>
            Launch to paper or live. You can stop or liquidate it any time from the dashboard.
          </div>
        </div>
        <DeployWizardView
          deploy={hasBinding ? deploySnap : null}
          onDone={closeWizard}
          onCancel={closeWizard}
          onClear={clearBinding}
        />
      </div>
    );
  }

  const rows = model.rows;
  const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
  const deployedAum = rows.reduce((a, r) => a + (finite(r.aum) ? r.aum : 0), 0);
  const totalEquity = rows.reduce((a, r) => a + (finite(r.equity) ? r.equity : 0), 0);
  const pnlRows = rows.filter((r) => finite(r.aum) && finite(r.equity));
  const basis = pnlRows.reduce((a, r) => a + (r.aum as number), 0);
  const netPnl = pnlRows.reduce((a, r) => a + (r.equity as number), 0) - basis;
  const netPct = basis > 0 ? (netPnl / basis) * 100 : null;
  const active = activeCount(model);
  const populated = phase === 'ready' && rows.length > 0;

  return (
    <PanelShell
      title="Live Algorithms"
      description="Every strategy you've deployed to paper or live — its capital, equity, and return — with stop, restart, and liquidate on each."
      wide
      meta={populated ? `${rows.length} deployed · ${active} active` : undefined}
      toolbar={
        <>
          <ToolbarSpring />
          <Button variant="primary" onClick={() => setView('wizard')}>
            Deploy a strategy
          </Button>
        </>
      }
      hero={
        populated ? (
          <StatBand
            items={[
              { label: 'Deployments', value: rows.length, sub: `${active} active` },
              { label: 'Deployed capital', value: money(deployedAum) },
              { label: 'Total equity', value: money(totalEquity) },
              {
                label: 'Net P&L',
                value: money(netPnl),
                valueColor: trendColor(netPnl),
                sub: netPct === null ? 'across funded rows' : percent(netPct),
              },
            ]}
          />
        ) : undefined
      }
    >
      {phase === 'loading' ? (
        <SkeletonRows rows={3} />
      ) : phase === 'unreachable' ? (
        <CenterState
          icon="⚡"
          tone="danger"
          title="The engine isn't reachable"
          detail="Live Algorithms reads from your local Auracle engine. Start the stack and this dashboard will populate."
          actions={
            <Button variant="primary" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <CenterState
          icon="◎"
          title="Nothing deployed yet"
          detail="Deploy a strategy to paper or live. Paper needs no credentials — the simulator broker is the default."
          actions={
            <Button variant="primary" onClick={() => setView('wizard')}>
              Deploy a strategy
            </Button>
          }
        />
      ) : (
        <div className="apk-enter" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={dash.table}>
              <thead>
                <tr>
                  <th style={{ ...dash.th, width: 22 }} aria-hidden />
                  <th style={dash.th}>Strategy</th>
                  <th style={dash.thNum}>AUM</th>
                  <th style={dash.thNum}>Equity</th>
                  <th style={dash.thNum}>Return</th>
                  <th style={dash.th}>Status</th>
                  <th style={{ ...dash.th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <FragmentRow
                    key={row.id}
                    row={row}
                    expanded={model.selected === row.id}
                    pendingConfirm={pendingConfirm}
                    onToggle={() =>
                      setModel((prev) => ({ ...prev, selected: prev.selected === row.id ? null : row.id }))
                    }
                    onAction={(action) => void dispatch(row.id, action)}
                    onCancelConfirm={() => setPendingConfirm(null)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {selectedRow ? (
            <section
              className="apk-enter"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: '14px 16px',
                borderRadius: 10,
                border: `1px solid ${tone.border}`,
                background: tone.surface,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: tone.text }}>
                  {selectedRow.name || selectedRow.strategy_path}
                </span>
                <span style={{ fontSize: 12, color: tone.text3 }}>Order ledger</span>
                <ToolbarSpring />
                <Button variant="ghost" onClick={() => void investigate(selectedRow)}>
                  ⚡ Investigate
                </Button>
              </div>
              {investigateNote ? (
                <InlineNote kind={investigateNote.kind}>{investigateNote.text}</InlineNote>
              ) : null}
              <EquityView deployment={selectedRow} />
              <LedgerView deployment={selectedRow} />
            </section>
          ) : null}
        </div>
      )}
    </PanelShell>
  );
}

function FragmentRow({
  row,
  expanded,
  pendingConfirm,
  onToggle,
  onAction,
  onCancelConfirm,
}: {
  row: Deployment;
  expanded: boolean;
  pendingConfirm: { id: number; action: LiveAction } | null;
  onToggle: () => void;
  onAction: (action: LiveAction) => void;
  onCancelConfirm: () => void;
}) {
  const actions = availableActions(row.state);
  const confirming = pendingConfirm?.id === row.id ? pendingConfirm.action : null;
  return (
    <tr className="apk-row" onClick={onToggle} style={{ cursor: 'pointer' }}>
      <td style={{ ...dash.td, paddingRight: 0 }}>
        <span
          aria-hidden
          className={isActive(row.state) && row.state !== 'running' ? 'apk-pulse' : undefined}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            display: 'inline-block',
            background: stateColor(row.state),
          }}
        />
      </td>
      <td style={dash.td}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: tone.text }}>
            <span aria-hidden style={{ color: tone.text3, fontSize: 10 }}>
              {expanded ? '▾' : '▸'}
            </span>
            {row.name || row.strategy_path}
          </span>
          <span style={{ fontSize: 11.5, color: tone.text3 }}>
            {row.broker || '—'} · {row.mode}
          </span>
        </div>
      </td>
      <td style={dash.tdNum}>{money(row.aum)}</td>
      <td style={dash.tdNum}>{money(row.equity)}</td>
      <td style={{ ...dash.tdNum, color: trendColor(row.return_pct), fontWeight: 600 }}>
        {formatReturn(row.return_pct)}
      </td>
      <td style={dash.td}>
        <Pill kind={statePill(row.state)} dot solid={row.state === 'running'}>
          {stateLabel(row.state)}
        </Pill>
      </td>
      <td style={{ ...dash.td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
        {confirming ? (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 12, color: tone.danger }}>Flatten all positions?</span>
            <Button variant="danger" onClick={() => onAction(confirming)}>
              Confirm
            </Button>
            <Button variant="quiet" onClick={onCancelConfirm}>
              Cancel
            </Button>
          </span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
            {actions.map((action) => (
              <Button
                key={action}
                variant={isDestructive(action) ? 'danger' : 'quiet'}
                onClick={() => onAction(action)}
              >
                {ACTION_LABELS[action]}
              </Button>
            ))}
          </span>
        )}
      </td>
    </tr>
  );
}
