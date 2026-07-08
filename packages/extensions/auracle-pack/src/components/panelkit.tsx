/**
 * panelkit — the shared surface language for every auracle-pack panel.
 *
 * Pack panels render inside the host DOM but are bundled separately, so
 * host Tailwind utilities are unavailable (purged) — the kit therefore
 * builds on the host's THEME VARIABLES via inline styles, plus ONE
 * injected stylesheet for what inline styles cannot express (hover /
 * focus-visible / keyframes / reduced-motion). Every color rides a host
 * var with a dark fallback, so panels track the IDE theme.
 *
 * Design contract (PRODUCT.md): native-first, one primary action per
 * panel, states are the design (skeleton / empty / error / outdated are
 * first-class), engine-computed honesty, density with rhythm.
 */
import type { CSSProperties, ReactNode } from 'react';

/* ── tokens ─────────────────────────────────────────────────────────── */

export const tone = {
  text: 'var(--text-primary, #d7dae0)',
  text2: 'var(--text-secondary, #b9bec7)',
  text3: 'var(--text-tertiary, #8a8f98)',
  border: 'var(--border-primary, rgba(127,127,127,0.22))',
  borderStrong: 'var(--border-primary, rgba(127,127,127,0.35))',
  surface: 'var(--bg-secondary, rgba(255,255,255,0.018))',
  sunken: 'var(--bg-primary, rgba(0,0,0,0.2))',
  accent: 'var(--accent-primary, #0053fd)',
  ok: '#2ea043',
  danger: '#c4554d',
  caution: '#d4a017',
  font: 'var(--font-family-ui, system-ui, sans-serif)',
} as const;

/* ── injected stylesheet (once) ─────────────────────────────────────── */

const STYLE_ID = 'auracle-panelkit-styles';

const SHEET = `
.apk-btn { transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out, opacity 150ms ease-out, filter 150ms ease-out; }
.apk-btn:focus-visible, .apk-input:focus-visible { outline: 2px solid ${'var(--accent-primary, #0053fd)'}; outline-offset: 1px; }
.apk-btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
.apk-btn-primary:active:not(:disabled) { filter: brightness(0.94); }
.apk-btn-ghost:hover:not(:disabled), .apk-btn-quiet:hover:not(:disabled) { background: color-mix(in srgb, var(--text-primary, #d7dae0) 7%, transparent); }
.apk-btn-ghost:active:not(:disabled), .apk-btn-quiet:active:not(:disabled) { background: color-mix(in srgb, var(--text-primary, #d7dae0) 11%, transparent); }
.apk-card { transition: border-color 150ms ease-out, background-color 150ms ease-out; }
.apk-card:hover { border-color: var(--border-primary, rgba(127,127,127,0.45)); }
.apk-input { transition: border-color 150ms ease-out; }
.apk-input:focus { border-color: var(--accent-primary, #0053fd); }
.apk-enter { animation: apk-enter 180ms cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes apk-enter { from { opacity: 0; transform: translateY(2px); } }
.apk-skeleton { background: linear-gradient(90deg, color-mix(in srgb, var(--text-primary, #d7dae0) 5%, transparent) 25%, color-mix(in srgb, var(--text-primary, #d7dae0) 10%, transparent) 50%, color-mix(in srgb, var(--text-primary, #d7dae0) 5%, transparent) 75%); background-size: 200% 100%; animation: apk-shimmer 1.6s ease-in-out infinite; border-radius: 4px; }
@keyframes apk-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.apk-spin { animation: apk-spin 800ms linear infinite; }
@keyframes apk-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .apk-btn, .apk-card, .apk-input { transition: none; }
  .apk-enter { animation: none; }
  .apk-skeleton { animation: none; background: color-mix(in srgb, var(--text-primary, #d7dae0) 7%, transparent); }
  .apk-spin { animation: none; }
}
`;

export function ensurePanelKitStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/* ── shell ──────────────────────────────────────────────────────────── */

export function PanelShell({
  title,
  description,
  meta,
  toolbar,
  children,
}: {
  title: string;
  description?: string;
  /** Right-aligned quiet fact, e.g. "Last scan: 2h ago". */
  meta?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  ensurePanelKitStyles();
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary, transparent)' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          maxWidth: 860,
          margin: '0 auto',
          padding: '24px 28px 48px',
          color: tone.text,
          font: `13px/1.5 ${tone.font}`,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
            {/* Explicit color: host stylesheets restyle bare headings. */}
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: -0.2, color: tone.text }}>
              {title}
            </h1>
            {description ? (
              <p style={{ margin: 0, fontSize: 12.5, color: tone.text3, maxWidth: '68ch' }}>
                {description}
              </p>
            ) : null}
          </div>
          {meta ? (
            <div style={{ fontSize: 12, color: tone.text3, whiteSpace: 'nowrap' }}>{meta}</div>
          ) : null}
        </header>
        {toolbar ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {toolbar}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function ToolbarSpring(): JSX.Element {
  return <span style={{ flex: 1, minWidth: 8 }} />;
}

/* ── buttons ────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'ghost' | 'quiet';

const BUTTON_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  borderRadius: 7,
  fontFamily: 'inherit',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

const BUTTON_VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: {
    padding: '6px 14px',
    fontSize: 12.5,
    fontWeight: 600,
    border: '1px solid transparent',
    background: tone.accent,
    color: '#fff',
  },
  ghost: {
    padding: '6px 12px',
    fontSize: 12.5,
    border: `1px solid ${tone.borderStrong}`,
    background: 'transparent',
    color: tone.text2,
  },
  quiet: {
    padding: '3px 9px',
    fontSize: 11.5,
    border: `1px solid ${tone.border}`,
    background: 'transparent',
    color: tone.text2,
  },
};

export function Button({
  variant = 'ghost',
  busy = false,
  disabled = false,
  title,
  onClick,
  children,
}: {
  variant?: ButtonVariant;
  /** Renders an inline spinner and disables the control. */
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  children: ReactNode;
}): JSX.Element {
  const off = disabled || busy;
  return (
    <button
      type="button"
      className={`apk-btn apk-btn-${variant}`}
      style={{
        ...BUTTON_BASE,
        ...BUTTON_VARIANTS[variant],
        cursor: off ? 'default' : 'pointer',
        opacity: disabled && !busy ? 0.55 : 1,
      }}
      disabled={off}
      title={title}
      onClick={onClick}
    >
      {busy ? <Spinner light={variant === 'primary'} /> : null}
      {children}
    </button>
  );
}

function Spinner({ light }: { light?: boolean }): JSX.Element {
  return (
    <span
      aria-hidden
      className="apk-spin"
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        border: `1.5px solid ${light ? 'rgba(255,255,255,0.35)' : tone.border}`,
        borderTopColor: light ? '#fff' : tone.text2,
        display: 'inline-block',
      }}
    />
  );
}

/* ── inline status note ─────────────────────────────────────────────── */

export function InlineNote({
  kind,
  children,
  onDismiss,
}: {
  kind: 'ok' | 'err' | 'muted';
  children: ReactNode;
  onDismiss?: () => void;
}): JSX.Element {
  const color = kind === 'ok' ? tone.ok : kind === 'err' ? tone.danger : tone.text3;
  return (
    <span
      className="apk-enter"
      role={kind === 'err' ? 'alert' : 'status'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color,
        minWidth: 0,
      }}
    >
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: '50%', background: color, flex: 'none' }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            border: 'none',
            background: 'none',
            color: 'inherit',
            cursor: 'pointer',
            fontSize: 11,
            padding: '0 2px',
            opacity: 0.7,
          }}
        >
          ✕
        </button>
      ) : null}
    </span>
  );
}

/* ── form primitives ────────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: tone.text2 }}>{label}</span>
      <input
        className="apk-input"
        style={{
          width: '100%',
          padding: '7px 9px',
          borderRadius: 6,
          fontSize: 13,
          border: `1px solid ${tone.borderStrong}`,
          background: tone.sunken,
          color: tone.text,
          outline: 'none',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <span style={{ fontSize: 11.5, color: tone.text3 }}>{hint}</span> : null}
    </label>
  );
}

/** Bordered container for a disclosed configuration section. */
export function Disclosure({ children }: { children: ReactNode }): JSX.Element {
  return (
    <section
      className="apk-enter"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        borderRadius: 9,
        border: `1px solid ${tone.border}`,
        background: tone.surface,
      }}
    >
      {children}
    </section>
  );
}

/* ── content states ─────────────────────────────────────────────────── */

/** Loading rows shaped like the content they stand in for. */
export function SkeletonRows({ rows = 4 }: { rows?: number }): JSX.Element {
  return (
    <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 14,
            padding: '13px 15px',
            borderRadius: 9,
            border: `1px solid ${tone.border}`,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            <span className="apk-skeleton" style={{ width: 30, height: 20 }} />
            <span className="apk-skeleton" style={{ width: 44, height: 8 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
            <span className="apk-skeleton" style={{ width: `${68 - (i % 3) * 9}%`, height: 12 }} />
            <span className="apk-skeleton" style={{ width: '38%', height: 9 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Centered non-content state. `title` states the situation in one line;
 * `detail` names the cause or the fix. Actions are optional and few.
 */
export function CenterState({
  title,
  detail,
  actions,
}: {
  title: string;
  detail?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div
      className="apk-enter"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 6,
        padding: '56px 24px',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, color: tone.text2 }}>{title}</div>
      {detail ? (
        <div style={{ fontSize: 12.5, color: tone.text3, maxWidth: '52ch' }}>{detail}</div>
      ) : null}
      {actions ? <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>{actions}</div> : null}
    </div>
  );
}
