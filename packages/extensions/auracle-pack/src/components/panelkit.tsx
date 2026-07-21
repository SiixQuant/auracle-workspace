/**
 * panelkit — the shared surface language for every auracle-pack panel.
 *
 * Pack panels render inside the host DOM but are bundled separately, so
 * host Tailwind utilities are unavailable (purged) — the kit therefore
 * styles inline, plus ONE injected stylesheet for what inline styles
 * cannot express (hover / focus-visible / keyframes / reduced-motion).
 * The palette is the pack-owned Hermes-on-dark token table below.
 *
 * Design contract (PRODUCT.md): native-first, one primary action per
 * panel, states are the design (skeleton / empty / error / outdated are
 * first-class), engine-computed honesty, density with rhythm. The register
 * is a precision instrument — layered surfaces, one reserved accent,
 * semantic colour carrying meaning, tabular numerics — not a marketing page.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import {
  FloatingPortal,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';

/* ── tokens ─────────────────────────────────────────────────────────── */

/**
 * Hermes-on-dark, matched to the launcher's implementation (the reference
 * material palette) so all three surfaces — website, launcher, IDE — read
 * as one product. The pack OWNS these values: the host never injected the
 * old --text-primary/--accent-primary variables (panels always rendered
 * their fallbacks), so the palette lives here as literals.
 *
 * Accent ramp discipline: the accent is WHITE, matching the launcher's
 * primary pill (`background: #fff; color: #000`). A white fill is LIGHT,
 * so its ink is black — the inverse of the old blue ramp, where ink was
 * white. White reads at maximum contrast on every surface step, so
 * `accentText` needs no separate brightened tier.
 *
 * The accent is BRAND ONLY: filled primaries, focus rings, selection.
 * Anything conveying STATE — ok/danger/caution — keeps its semantic hue.
 * The launcher states the rule directly (app.css:2160): the lamp core
 * "keeps its semantic colour (green = ready / red = needs you) — that's a
 * functional signal, not decoration, so it stays". Never route a status
 * through `accent`; a white health dot says nothing.
 */
export const tone = {
  text: '#e6edf3',
  text2: '#9da7b3',
  text3: '#7c8694',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
  /** Charcoal canvas the panel column sits on. */
  bg: '#0b0c0e',
  /** Card surface — a real, visible plane, not a 2%-alpha whisper. */
  surface: '#131519',
  /** Interactive controls / hover step above a card. */
  surface2: '#1b1e23',
  /** Pressed / strongest neutral fill. */
  surface3: '#23272d',
  /** Deepest well — inputs, sunken tables. */
  sunken: '#08090b',
  /** Brand fill — the launcher's white pill. Fills and brand moments ONLY. */
  accent: '#ffffff',
  /** Hover tier of the fill — the launcher dims its white pill on hover
   *  (rgba(255,255,255,0.88)); this is that dim as a solid, so the token
   *  table stays literal-hex and testable. */
  accentHover: '#e6edf3',
  /** The accent as something you READ. White needs no brightened tier. */
  accentText: '#ffffff',
  /** Soft brand wash for selected/active backgrounds. */
  accentSoft: 'rgba(255,255,255,0.10)',
  /** Stronger brand stroke for focus borders and emphasis rings. */
  accentDim: 'rgba(255,255,255,0.24)',
  /** Ink on a filled accent — white is light, so black, never white. */
  accentInk: '#000000',
  ok: '#3fb950',
  danger: '#e5534b',
  caution: '#d4a017',
  font: 'var(--font-family-ui, system-ui, sans-serif)',
} as const;

/** Elevated surface for heroes — one step above a card, so summary
 *  bands read as raised above the content they summarise. */
export const RAISE = tone.surface2;

/** Semantic tint of a colour at low alpha — for status backgrounds. */
export const tint = (c: string, pct = 14): string => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

/** Tabular, feature-locked numerics — every figure in a data column. */
export const numeric: CSSProperties = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum" 1' };

/** Green for a gain, red for a loss, quiet for flat/absent. */
export const trendColor = (n: number | null | undefined): string =>
  typeof n !== 'number' || n === 0 ? tone.text3 : n > 0 ? tone.ok : tone.danger;

/* ── injected stylesheet (once) ─────────────────────────────────────── */

const STYLE_ID = 'auracle-panelkit-styles';

const SHEET = `
.apk-btn { transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out, opacity 150ms ease-out, box-shadow 150ms ease-out; }
.apk-btn:focus-visible, .apk-input:focus-visible, .apk-selectwrap:focus-within, .apk-rowbtn:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 1px; }
.apk-btn-primary { background: ${tone.accent}; color: ${tone.accentInk}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.14); }
.apk-btn-primary:hover:not(:disabled) { background: ${tone.accentHover}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 2px 12px -4px ${tone.accentDim}; }
.apk-btn-primary:active:not(:disabled) { background: #00379f; box-shadow: none; }
.apk-btn-ghost:hover:not(:disabled), .apk-btn-quiet:hover:not(:disabled) { background: color-mix(in srgb, ${tone.text} 8%, transparent); border-color: color-mix(in srgb, ${tone.text} 28%, transparent); }
.apk-btn-ghost:active:not(:disabled), .apk-btn-quiet:active:not(:disabled) { background: color-mix(in srgb, ${tone.text} 12%, transparent); }
.apk-btn-danger:hover:not(:disabled) { background: color-mix(in srgb, ${tone.danger} 14%, transparent); }
.apk-btn-danger:active:not(:disabled) { background: color-mix(in srgb, ${tone.danger} 20%, transparent); }
.apk-card { transition: border-color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out; }
.apk-card:hover { border-color: color-mix(in srgb, ${tone.text} 22%, transparent); }
.apk-input { transition: border-color 150ms ease-out, box-shadow 150ms ease-out; }
.apk-input:focus { border-color: ${tone.accentDim}; box-shadow: 0 0 0 3px ${tone.accentSoft}; }
.apk-selectwrap { transition: border-color 150ms ease-out; }
.apk-selectwrap:hover { border-color: color-mix(in srgb, ${tone.text} 30%, transparent); }
.apk-select { appearance: none; -webkit-appearance: none; -moz-appearance: none; }
.apk-hubtab { appearance: none; border: 1px solid transparent; background: transparent; color: ${tone.text2}; font-family: inherit; font-size: 12px; font-weight: 600; line-height: 1; padding: 7px 13px; border-radius: 7px; cursor: pointer; white-space: nowrap; transition: background-color 150ms ease-out, color 150ms ease-out; }
.apk-hubtab:hover { background: ${tone.surface2}; color: ${tone.text}; }
.apk-hubtab[data-active] { background: ${tone.accentSoft}; color: ${tone.accentText}; }
.apk-hubtab:focus-visible { outline: 2px solid ${tone.accentText}; outline-offset: 1px; }
.apk-row { transition: background-color 120ms ease-out; }
.apk-row:hover { background: color-mix(in srgb, ${tone.text} 4%, transparent); }
.apk-enter { animation: apk-enter 180ms cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes apk-enter { from { opacity: 0; transform: translateY(2px); } }
.apk-skeleton { background: linear-gradient(90deg, color-mix(in srgb, ${tone.text} 5%, transparent) 25%, color-mix(in srgb, ${tone.text} 11%, transparent) 50%, color-mix(in srgb, ${tone.text} 5%, transparent) 75%); background-size: 200% 100%; animation: apk-shimmer 1.6s ease-in-out infinite; border-radius: 4px; }
@keyframes apk-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.apk-spin { animation: apk-spin 800ms linear infinite; }
@keyframes apk-spin { to { transform: rotate(360deg); } }
.apk-pulse { animation: apk-pulse 2s ease-in-out infinite; }
@keyframes apk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) {
  .apk-btn, .apk-card, .apk-input, .apk-row, .apk-selectwrap { transition: none; }
  .apk-enter { animation: none; }
  .apk-skeleton { animation: none; background: color-mix(in srgb, ${tone.text} 8%, transparent); }
  .apk-spin, .apk-pulse { animation: none; }
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
  hero,
  wide = false,
  children,
}: {
  title: string;
  description?: string;
  /** Right-aligned quiet fact, e.g. "Last scan: 2h ago". */
  meta?: ReactNode;
  toolbar?: ReactNode;
  /** Full-width summary band between the toolbar and the content. */
  hero?: ReactNode;
  /** Data-dense panels (wide tables) opt out of the reading-width cap. */
  wide?: boolean;
  children: ReactNode;
}): JSX.Element {
  ensurePanelKitStyles();
  return (
    <div className="auracle-panel" style={{ height: '100%', overflowY: 'auto', background: tone.bg }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          maxWidth: wide ? 1200 : 900,
          margin: '0 auto',
          padding: '22px 28px 48px',
          color: tone.text,
          font: `13px/1.5 ${tone.font}`,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
            {/* Explicit color: host stylesheets restyle bare headings.
                System sans (the display serif was retired IDE-side); the hero
                moment is carried by weight and tight tracking, not a typeface —
                weight comes back up now that the heavier serif is gone. */}
            <h1
              style={{
                margin: 0,
                fontSize: 21,
                fontWeight: 600,
                letterSpacing: -0.3,
                lineHeight: 1.2,
                color: tone.text,
                fontFamily: tone.font,
                textWrap: 'balance' as never,
              }}
            >
              {title}
            </h1>
            {description ? (
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: tone.text3, maxWidth: '70ch' }}>
                {description}
              </p>
            ) : null}
          </div>
          {meta ? (
            <div style={{ fontSize: 12, color: tone.text3, whiteSpace: 'nowrap', ...numeric }}>{meta}</div>
          ) : null}
        </header>
        {toolbar ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {toolbar}
          </div>
        ) : null}
        {hero}
        {children}
      </div>
    </div>
  );
}

export function ToolbarSpring(): JSX.Element {
  return <span style={{ flex: 1, minWidth: 8 }} />;
}

/** A structural group divider — a real section rule, not a decorative
 *  eyebrow. Medium-weight label, optional right-aligned count, hairline. */
export function SectionLabel({ children, meta }: { children: ReactNode; meta?: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: tone.text2, letterSpacing: 0.1, whiteSpace: 'nowrap' }}>
        {children}
      </span>
      <span style={{ flex: 1, height: 1, background: tone.border }} />
      {meta ? <span style={{ fontSize: 11.5, color: tone.text3, whiteSpace: 'nowrap', ...numeric }}>{meta}</span> : null}
    </div>
  );
}

/* ── buttons ────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'danger';

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
  // Background/ink/shadow live in the injected sheet (.apk-btn-primary) so
  // hover can swap the fill to the darker accent tier — inline backgrounds
  // would win over any :hover rule.
  primary: {
    padding: '6px 14px',
    fontSize: 12.5,
    fontWeight: 600,
    border: '1px solid transparent',
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
  // Compact destructive action — matches `quiet`'s geometry so it sits evenly
  // beside other row controls, but reads red. For cancel / delete / liquidate.
  danger: {
    padding: '3px 9px',
    fontSize: 11.5,
    border: `1px solid color-mix(in srgb, ${tone.danger} 50%, transparent)`,
    background: 'transparent',
    color: tone.danger,
  },
};

export function Button({
  variant = 'ghost',
  busy = false,
  disabled = false,
  title,
  testId,
  onClick,
  children,
}: {
  variant?: ButtonVariant;
  /** Renders an inline spinner and disables the control. */
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  /** Stable kebab-case hook for tests, set on the underlying <button>. */
  testId?: string;
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
      data-testid={testId}
      onClick={onClick}
    >
      {busy ? <Spinner light={variant === 'primary'} /> : null}
      {children}
    </button>
  );
}

function Spinner({ light }: { light?: boolean }): JSX.Element {
  // `light` = riding on a primary button. That fill is now WHITE, so the busy
  // ring is inked in BLACK (accentInk) over a faint black track — a white ring
  // would be invisible on the white button.
  return (
    <span
      aria-hidden
      className="apk-spin"
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        border: `1.5px solid ${light ? tint(tone.accentInk, 30) : tone.border}`,
        borderTopColor: light ? tone.accentInk : tone.text2,
        display: 'inline-block',
      }}
    />
  );
}

/* ── select (styled native — keeps keyboard + a11y) ─────────────────── */

export function Select({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  minWidth = 220,
  fluid = false,
}: {
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  ariaLabel?: string;
  minWidth?: number;
  /** Fill the parent's width (form fields) instead of sizing to content. */
  fluid?: boolean;
}): JSX.Element {
  return (
    <span
      className="apk-selectwrap"
      style={{
        position: 'relative',
        display: fluid ? 'flex' : 'inline-flex',
        alignItems: 'center',
        width: fluid ? '100%' : undefined,
        minWidth: fluid ? undefined : minWidth,
        borderRadius: 7,
        border: `1px solid ${tone.borderStrong}`,
        background: tone.sunken,
      }}
    >
      <select
        className="apk-select"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '7px 30px 7px 11px',
          borderRadius: 7,
          fontSize: 13,
          border: 'none',
          background: 'transparent',
          color: value ? tone.text : tone.text3,
          outline: 'none',
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          right: 11,
          pointerEvents: 'none',
          color: tone.text3,
          fontSize: 10,
          lineHeight: 1,
        }}
      >
        ▾
      </span>
    </span>
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

/* ── status pill ────────────────────────────────────────────────────── */

type PillKind = 'ok' | 'caution' | 'danger' | 'muted' | 'accent';

const PILL_COLOR: Record<PillKind, string> = {
  ok: tone.ok,
  caution: tone.caution,
  danger: tone.danger,
  muted: tone.text3,
  // Pills are READ (state word + thin border) — the ramp's text tier.
  accent: tone.accentText,
};

/**
 * Compact status chip — a state word (running / paused / filled / critical)
 * in its semantic colour. `dot` prepends a state dot; `solid` fills the chip
 * with a tint for stronger presence (use for the one status that matters most
 * in a row, not every chip). One place for the pill shape so panels stop
 * re-declaring the four brand colour literals inline.
 */
export function Pill({
  kind,
  children,
  dot = false,
  solid = false,
}: {
  kind: PillKind;
  children: ReactNode;
  dot?: boolean;
  solid?: boolean;
}): JSX.Element {
  const c = PILL_COLOR[kind];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        padding: dot ? '1px 8px 1px 7px' : '1px 8px',
        borderRadius: 999,
        border: `1px solid color-mix(in srgb, ${c} ${solid ? 34 : 45}%, transparent)`,
        background: solid ? tint(c, 16) : 'transparent',
        color: c,
        whiteSpace: 'nowrap',
        letterSpacing: 0.2,
        flex: 'none',
      }}
    >
      {dot ? (
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: c, flex: 'none' }} />
      ) : null}
      {children}
    </span>
  );
}

/* ── metrics (summary heroes) ───────────────────────────────────────── */

export interface MetricProps {
  label: string;
  value: ReactNode;
  /** Secondary line under the value — a delta, a count, a qualifier. */
  sub?: ReactNode;
  /** Colour of the value (e.g. trendColor for a P&L figure). */
  valueColor?: string;
  emphasis?: boolean;
}

/** A single label / big-value stat. Values are tabular by default. */
export function Metric({ label, value, sub, valueColor, emphasis }: MetricProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: tone.text3 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: emphasis ? 22 : 18,
          fontWeight: 650,
          lineHeight: 1.1,
          letterSpacing: -0.3,
          color: valueColor ?? tone.text,
          ...numeric,
        }}
      >
        {value}
      </span>
      {sub ? <span style={{ fontSize: 11.5, color: tone.text3, ...numeric }}>{sub}</span> : null}
    </div>
  );
}

/** A raised band of metrics divided by hairlines — the panel summary hero. */
/**
 * The house section title: ALL-CAPS, bold, left-aligned. This is the single
 * most recognizable tell of an Auracle results surface — the tearsheet uses
 * it for every chart and table heading, so section headers and chart titles
 * must not drift apart. One implementation, used by both.
 */
export function SectionTitle({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: tone.text,
      }}
    >
      {children}
    </span>
  );
}

/**
 * A wrapping metric grid on a FIXED column count.
 *
 * StatBand is a single non-wrapping `repeat(items.length, 1fr)` row, so past
 * ~6 tiles every value crushes into a sliver. MetricGrid fixes the column
 * count and lets CSS grid flow onto a second row instead, which is what the
 * house's six-card layout actually needs. StatBand is left untouched for the
 * panels already using it.
 */
export function MetricGrid({
  items,
  columns = 6,
}: {
  items: MetricProps[];
  columns?: number;
}): JSX.Element {
  return (
    <div
      className="apk-enter"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: '18px 20px',
        padding: '16px 20px',
        borderRadius: 11,
        border: `1px solid ${tone.border}`,
        background: RAISE,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      {items.map((item) => (
        <Metric key={item.label} {...item} />
      ))}
    </div>
  );
}

/**
 * The house's SAMPLE STATUS strip. The tearsheet's first rule is to lead
 * with what kind of evidence this is, not with the number it produced — so
 * this sits above the metrics, and the panel's one primary verb lives in it,
 * answering the claim the strip makes.
 */
export function SampleStrip({
  headline,
  takeaway,
  actions,
}: {
  headline: ReactNode;
  takeaway?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div
      className="apk-enter"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 16px',
        borderRadius: 10,
        border: `1px solid ${tone.border}`,
        background: 'rgba(255,255,255,0.035)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: tone.text3,
          }}
        >
          Sample status
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 650, color: tone.text }}>{headline}</span>
      </div>
      {takeaway ? (
        <span style={{ fontSize: 11.5, color: tone.text2, marginLeft: 'auto', textAlign: 'right' }}>
          {takeaway}
        </span>
      ) : null}
      {actions ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: takeaway ? 0 : 'auto' }}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function StatBand({ items }: { items: MetricProps[] }): JSX.Element {
  return (
    <div
      className="apk-enter"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        gap: 20,
        padding: '16px 20px',
        borderRadius: 11,
        border: `1px solid ${tone.border}`,
        background: RAISE,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          style={{
            display: 'flex',
            paddingLeft: i === 0 ? 0 : 20,
            borderLeft: i === 0 ? 'none' : `1px solid ${tone.border}`,
          }}
        >
          <Metric {...item} />
        </div>
      ))}
    </div>
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

/* ── overflow menu ──────────────────────────────────────────────────── */

export interface OverflowItem {
  label: string;
  onClick: () => void;
}

/**
 * The secondary actions a panel keeps out of sight so its ONE primary verb
 * reads (the design contract above). Positioned with floating-ui through a
 * portal: pack panels mount at placement:'bottom', i.e. hard against the
 * viewport edge inside a clipping container, where hand-computed coordinates
 * flip or get cut off.
 */
export function OverflowMenu({
  items,
  label = 'More actions',
}: {
  items: OverflowItem[];
  label?: string;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top-end',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'menu' }),
  ]);

  if (!items.length) return null;
  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={label}
        title={label}
        className="apk-btn apk-btn-ghost"
        style={{ ...BUTTON_BASE, ...BUTTON_VARIANTS.ghost, cursor: 'pointer', paddingInline: 9 }}
        {...getReferenceProps()}
      >
        <span aria-hidden style={{ fontSize: 14, lineHeight: '10px', letterSpacing: 1 }}>
          •••
        </span>
      </button>
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className="apk-enter"
            style={{
              ...floatingStyles,
              zIndex: 40,
              minWidth: 168,
              display: 'flex',
              flexDirection: 'column',
              padding: 4,
              borderRadius: 9,
              border: `1px solid ${tone.border}`,
              background: RAISE,
              boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
            }}
            {...getFloatingProps()}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="apk-row"
                style={{
                  ...BUTTON_BASE,
                  justifyContent: 'flex-start',
                  padding: '7px 10px',
                  fontSize: 12.5,
                  // Explicit colour: the kit never inherits a foreground — an
                  // ambient-only colour renders invisible outside the IDE host.
                  color: tone.text,
                  background: 'transparent',
                  border: '1px solid transparent',
                  cursor: 'pointer',
                }}
                {...getItemProps({
                  onClick: () => {
                    setOpen(false);
                    item.onClick();
                  },
                })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </FloatingPortal>
      ) : null}
    </>
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
            background: tone.surface,
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
 * `detail` names the cause or the fix. `icon` is a small glyph set in a
 * ringed medallion above the title — polish for empty / error rests.
 */
export function CenterState({
  title,
  detail,
  icon,
  tone: kind = 'muted',
  actions,
}: {
  title: string;
  detail?: string;
  icon?: ReactNode;
  tone?: 'muted' | 'danger' | 'ok';
  actions?: ReactNode;
}): JSX.Element {
  const ringColor = kind === 'danger' ? tone.danger : kind === 'ok' ? tone.ok : tone.text3;
  return (
    <div
      className="apk-enter"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 7,
        padding: '52px 24px',
      }}
    >
      {icon ? (
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            marginBottom: 6,
            borderRadius: 12,
            border: `1px solid ${tint(ringColor, 40)}`,
            background: tint(ringColor, 10),
            color: ringColor,
            fontSize: 19,
          }}
        >
          {icon}
        </span>
      ) : null}
      {/* Empty/error rests are quiet display moments — system sans throughout;
          the title leans on weight, not a serif. */}
      <div style={{ fontSize: 16, fontWeight: 600, color: tone.text, fontFamily: tone.font, lineHeight: 1.3 }}>
        {title}
      </div>
      {detail ? (
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: tone.text3, maxWidth: '52ch' }}>{detail}</div>
      ) : null}
      {actions ? <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>{actions}</div> : null}
    </div>
  );
}

/* ── equity / return curve ──────────────────────────────────────────── */

/**
 * A dependency-free SVG area+line over an engine-provided series (a backtest
 * equity / cumulative-return curve). Honest: renders nothing when there are
 * fewer than two real points — never a fabricated shape. Green when the run
 * ends above where it started, red below; a dashed line marks the start (0%),
 * and the end point is called out with its total return. `mode` picks the
 * baseline: 'equity' anchors 0% at the first point (growth of $1); 'zero'
 * anchors at y=0 (a drawdown curve that lives at/under the axis).
 */
export function EquityChart({
  points,
  height = 168,
  label,
  color,
  mode = 'equity',
}: {
  points: number[];
  height?: number;
  label?: string;
  color?: string;
  mode?: 'equity' | 'zero';
}): JSX.Element | null {
  const clean = (points ?? []).filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  if (clean.length < 2) return null;
  const n = clean.length;
  const lo = Math.min(...clean, mode === 'zero' ? 0 : clean[0]);
  const hi = Math.max(...clean, mode === 'zero' ? 0 : clean[0]);
  const span = hi - lo || 1;
  const base = clean[0];
  const last = clean[n - 1];
  const up = last >= base;
  const c = color ?? (mode === 'zero' ? tone.danger : up ? tone.ok : tone.danger);
  const nx = (i: number) => (i / (n - 1)) * 100;
  const ny = (v: number) => 100 - ((v - lo) / span) * 100;
  const line = clean.map((v, i) => `${i === 0 ? 'M' : 'L'}${nx(i).toFixed(2)},${ny(v).toFixed(3)}`).join(' ');
  const anchor = mode === 'zero' ? 0 : base;
  const anchorY = ny(anchor);
  const area = `${line} L100,${anchorY.toFixed(3)} L0,${anchorY.toFixed(3)} Z`;
  const gid = `apk-eq-${mode}-${up ? 'up' : 'dn'}`;
  const retPct = mode === 'zero' ? last : (last / base - 1) * 100;

  return (
    <div style={{ width: '100%' }}>
      {label ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: tone.text3 }}>
            {label}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 650, color: c, ...numeric }}>
            {(retPct >= 0 ? '+' : '') + retPct.toFixed(2)}%
          </span>
        </div>
      ) : null}
      <div style={{ position: 'relative', width: '100%', height }}>
        <svg
          width="100%"
          height={height}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity="0.24" />
              <stop offset="100%" stopColor={c} stopOpacity="0" />
            </linearGradient>
          </defs>
          <line
            x1="0"
            y1={anchorY}
            x2="100"
            y2={anchorY}
            stroke={tone.text3}
            strokeOpacity="0.45"
            strokeWidth="1"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
          <path d={area} fill={`url(#${gid})`} />
          <path
            d={line}
            fill="none"
            stroke={c}
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* End-point marker as an HTML overlay so it stays circular under
            preserveAspectRatio="none" (which would squash an SVG <circle>). */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '100%',
            top: `${ny(last)}%`,
            transform: 'translate(-50%, -50%)',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: c,
            boxShadow: `0 0 0 3px ${tint(c, 22)}`,
          }}
        />
      </div>
    </div>
  );
}
