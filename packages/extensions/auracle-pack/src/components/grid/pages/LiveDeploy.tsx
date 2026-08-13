/**
 * The Live tab's deploy pane. Tabbing a strategy over to "Live" lands here: the
 * live deployment wizard, pre-bound to the strategy on screen.
 *
 * The rule the owner asked for — a live trading account is NOT connected until
 * its credentials are filled and submitted here — is enforced structurally. The
 * connect card (broker picker + the write-only {@link ConnectionSecretField})
 * shows until a live-capable broker actually reports connected; only then does
 * the account read as connected and the card give way to the "connected" note.
 * The field posts straight to the engine vault and never through a tool or chat,
 * and the wizard's Live mode stays gated by the engine's `live_allowed`
 * order-path check regardless — so nothing routes a real order before an account
 * is genuinely up. Paper deploy needs no account and is available throughout.
 *
 * It composes the SHIPPED pieces — {@link DeployWizardView} for the deploy form
 * and {@link ConnectionSecretField} for the credentials — rather than a second
 * credential surface, so connections stay the one write-only seam they already
 * are.
 */
import { useCallback, useEffect, useState } from 'react';

import { getJson, onConnectGeneration } from '../../../engine/client';
import { pendingFieldsFor, type PendingField } from '../../../engine/connectionTools';
import type { DeploySnapshot, StrategyOption } from '../../../engine/deploy';
import { isConnected, normalizeConnector, type Connector } from '../../../engine/model';
import { DeployWizardView } from '../../LivePanel';
import { InlineNote, Select, SkeletonRows, tone } from '../../panelkit';
import { ConnectionSecretField } from '../ConnectionSecretField';

/** Brokers that stand in for a real live trading account. The paper simulator is
 *  not one — it needs no credentials and is never a live account. */
const SIMULATOR_IDS: ReadonlySet<string> = new Set(['simulator', 'paper', 'sim']);

/** The live-capable brokers in the registry — every broker except the paper
 *  simulator. Exported for a direct unit test of the gate. */
export function liveBrokers(connectors: Connector[]): Connector[] {
  return connectors.filter((c) => c.kind === 'broker' && !SIMULATOR_IDS.has(c.id));
}

/** Whether a genuine live trading account is connected: a non-simulator broker
 *  that is up and not paywalled. This is the predicate the connect card turns
 *  on — false until credentials are filled and the engine reports the broker
 *  connected, so a live account is never shown connected before its inputs are
 *  submitted. Exported for a direct unit test of the gate. */
export function liveAccountConnected(connectors: Connector[]): boolean {
  return liveBrokers(connectors).some((c) => isConnected(c.status) && !c.gated);
}

const styles = {
  // One centered column: the connect card and the wizard share the wizard's
  // 640px measure and sit on the room's axis, rather than hugging the left
  // with a dead right column.
  page: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
    width: '100%',
    maxWidth: 640,
    margin: '0 auto',
  },
  card: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    padding: '16px 18px',
    borderRadius: 12,
    border: `1px solid ${tone.border}`,
    background: tone.surface,
  },
  head: { fontSize: 14, fontWeight: 600 as const, color: tone.text },
  sub: { fontSize: 12.5, color: tone.text3, lineHeight: 1.5, margin: 0 },
};

export function LiveDeployPane({
  strategyPath,
  strategyLabel,
}: {
  /** Dotted `module.Symbol` of the strategy on screen, to pre-bind the wizard.
   *  Null (nothing loaded) falls back to the wizard's own strategy picker. */
  strategyPath: string | null;
  strategyLabel?: string | null;
}): JSX.Element {
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [broker, setBroker] = useState('');
  const [fields, setFields] = useState<PendingField[] | null>(null);
  const [unbound, setUnbound] = useState(false);
  const [deployed, setDeployed] = useState(false);

  const reload = useCallback(async () => {
    const body = await getJson<{ connections?: Array<Partial<Connector> & { id: string }> }>(
      '/ui/api/connections?kind=all'
    );
    setConnectors((body?.connections ?? []).map(normalizeConnector));
  }, []);

  useEffect(() => {
    void reload();
    // A connect anywhere — this card's field included — bumps the generation, so
    // re-read the registry and the card clears the instant the account is up.
    const off = onConnectGeneration(() => void reload());
    return off;
  }, [reload]);

  // The picked broker's write-only fields, fetched WITHOUT arming the shared
  // GridHome paste signal — this pane mounts its own field inline.
  useEffect(() => {
    if (!broker) {
      setFields(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = await pendingFieldsFor(broker);
      if (!cancelled) setFields(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [broker]);

  if (connectors === null) return <SkeletonRows rows={4} />;

  const connected = liveAccountConnected(connectors);
  const brokers = liveBrokers(connectors);
  const picked = brokers.find((b) => b.id === broker) ?? null;

  const option: StrategyOption | null = strategyPath
    ? {
        path: strategyPath,
        cls: strategyPath.split('.').pop() || strategyPath,
        label: strategyLabel || strategyPath.split('.').pop() || strategyPath,
      }
    : null;
  // Pre-bind the wizard to this strategy (phase 'one'); "Change" in the wizard
  // drops to the global picker for a different one.
  const snapshot: DeploySnapshot | null =
    option && !unbound
      ? { file: null, phase: 'one', option, options: [], reason: null, outdated: false }
      : null;

  return (
    <div style={styles.page} data-testid="tearsheet-live-deploy">
      {connected ? (
        <InlineNote kind="ok" testId="live-account-connected">
          A live trading account is connected. Choose Live in the wizard to deploy for real, or Paper to rehearse.
        </InlineNote>
      ) : (
        <section style={styles.card} data-testid="live-connect-card">
          <div style={styles.head}>Connect a live trading account</div>
          <p style={styles.sub}>
            No live trading account is connected. Pick your broker and fill its credentials to connect — the account
            stays disconnected, and nothing can go live, until you submit them here. Paper trading in the wizard below
            needs no account.
          </p>
          <Select
            fluid
            ariaLabel="Live broker"
            placeholder="Select your broker…"
            value={broker}
            onChange={setBroker}
            options={brokers.map((b) => ({
              value: b.id,
              label:
                (b.display_label || b.id) +
                (b.gated ? ' — Pro' : isConnected(b.status) ? ' — connecting…' : ''),
              disabled: b.gated,
            }))}
          />
          {broker && fields && fields.length > 0 ? (
            <ConnectionSecretField id={broker} sourceName={picked?.display_label || broker} fields={fields} />
          ) : broker && fields && fields.length === 0 ? (
            <InlineNote kind="muted" testId="live-gateway-note">
              {(picked?.display_label || broker) + ' signs in through its gateway login rather than a pasted key —'}{' '}
              start it from the connect flow, then return here to deploy.
            </InlineNote>
          ) : null}
        </section>
      )}

      {deployed ? (
        <InlineNote kind="ok" testId="live-deployed-note">
          Deployed. Track and manage it from Live Algorithms.
        </InlineNote>
      ) : null}

      <DeployWizardView
        deploy={snapshot}
        onDone={() => {
          setDeployed(true);
          void reload();
        }}
        onCancel={() => setDeployed(false)}
        onClear={() => setUnbound(true)}
      />
    </div>
  );
}
