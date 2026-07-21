/**
 * The one card every paywall renders. Given a classified engine failure (from
 * `parseEngineError`), it shows the plan context instead of a bare status code:
 * what the install is on, what the feature needs, and where to upgrade — or, for
 * a blocked license, that renewing (not upgrading) restores service. Deploy,
 * connections, and the research/agent conveyor all mount THIS, so the upgrade
 * moment reads identically wherever the user meets it.
 *
 * A `generic` verdict renders as a plain error line — upgrading cannot fix a
 * validation failure, so it must never wear the upgrade card.
 */
import type { ReactNode } from 'react';
import type { EngineError } from '../engine/paywall';
import { displayTierName } from '../engine/entitlements';
import { InlineNote, tint, tone } from './panelkit';

function Card({
  accent,
  kind,
  children,
}: {
  accent: string;
  kind: 'paywall' | 'license';
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className="apk-enter"
      role="alert"
      data-testid="upgrade-gate"
      data-paywall-kind={kind}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 14px',
        borderRadius: 9,
        border: `1px solid ${tint(accent, 38)}`,
        background: tint(accent, 9),
        color: tone.text2,
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

function Headline({ children }: { children: ReactNode }): JSX.Element {
  return <span style={{ fontSize: 13, fontWeight: 600, color: tone.text }}>{children}</span>;
}

/** External upgrade / renew destination. Rendered as a plain link so the host
 *  opens it in the user's browser; never navigated automatically. */
function UpgradeLink({ href, label }: { href: string; label: string }): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-testid="upgrade-gate-link"
      style={{ color: tone.accentText, fontWeight: 600, textDecoration: 'underline', width: 'fit-content' }}
    >
      {label}
    </a>
  );
}

export function UpgradeGate({ info }: { info: EngineError }): JSX.Element {
  if (info.kind === 'generic') {
    return <InlineNote kind="err">{info.message}</InlineNote>;
  }

  if (info.kind === 'license') {
    return (
      <Card accent={tone.danger} kind="license">
        <Headline>License inactive</Headline>
        <span>{info.message}</span>
        {info.reason ? <span style={{ color: tone.text3 }}>Reason: {info.reason}</span> : null}
      </Card>
    );
  }

  const current = info.currentTier ? displayTierName(info.currentTier) : null;
  const required = info.requiredTier ? displayTierName(info.requiredTier) : null;

  return (
    <Card accent={tone.caution} kind="paywall">
      <Headline>Upgrade required</Headline>
      <span>{info.message}</span>
      {current || required ? (
        <span data-testid="upgrade-gate-plans" style={{ color: tone.text3 }}>
          {current ? (
            <>
              You’re on <strong style={{ color: tone.text2 }}>{current}</strong>
            </>
          ) : null}
          {current && required ? ' · ' : null}
          {required ? (
            <>
              {current ? '' : 'Requires '}
              <strong style={{ color: tone.text2 }}>{required}</strong>
              {current ? ' required' : ''}
            </>
          ) : null}
        </span>
      ) : null}
      {info.upgradeUrl ? <UpgradeLink href={info.upgradeUrl} label="View plans" /> : null}
    </Card>
  );
}
