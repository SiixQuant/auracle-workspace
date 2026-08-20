/**
 * What this desk is connected to, one line in the header flow.
 *
 * ★ IT STATES, IT DOES NOT SET. There is no switch here and that is the
 * design. Everything configurable about a connection lives in Settings, so
 * there is exactly one place a connection can be changed and exactly one
 * place it can be read. A control in two places is two places to leave a
 * stale opinion, and a toggle under a passing cursor on the thing that
 * routes orders is one somebody hits by accident.
 *
 * ★ IT NEVER WRITES THE VERDICT ITSELF. The engine already composes the
 * sentence: `price_source_plain` reads "Prices come from X; orders go to
 * Y." Deriving that here would put a second opinion about the order path
 * on screen, and the screen is the convincing one when the two disagree.
 * So the sentence is rendered, never assembled — the same rule
 * GridHealthLine follows when it refuses to derive a fault twice.
 *
 * Part of the header flow, never an overlay: the line takes its own height
 * and covers nothing. The card floats, and floats through
 * `@floating-ui/react` rather than hand-set coordinates, so it flips and
 * shifts at a viewport edge instead of being clipped by the panel's own
 * overflow.
 */
import { useEffect, useState } from 'react';
import {
  FloatingPortal,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  safePolygon,
} from '@floating-ui/react';

import { getJson } from '../../engine/client';
import { ensurePanelKitStyles, tone } from '../panelkit';

const STYLE_ID = 'auracle-grid-connection-styles';

const SHEET = `
.aconn { flex: none; display: flex; align-items: flex-start; gap: 26px; padding: 0 10px 8px; flex-wrap: wrap; }
.aconn__unit { display: grid; grid-template-columns: 8px auto; gap: 0 8px; align-items: start; appearance: none; border: 0; background: none; padding: 0; margin: 0; text-align: left; font: inherit; font-family: ${tone.mono}; font-size: 12.5px; line-height: 1.35; color: ${tone.text}; }
.aconn__unit--live .aconn__name { text-decoration: underline dotted ${tone.text3}; text-underline-offset: 3px; }
.aconn__unit--live:hover .aconn__name, .aconn__unit--live:focus-visible .aconn__name { color: #fff; text-decoration-color: ${tone.text2}; }
.aconn__unit--live:focus-visible { outline: 2px solid ${tone.text2}; outline-offset: 3px; border-radius: 3px; }
.aconn__dot { grid-row: 1 / span 2; width: 8px; height: 8px; border-radius: 999px; margin-top: 5px; }
.aconn__state { grid-column: 2; color: ${tone.text2}; }
.aconn__card { z-index: 60; width: 232px; background: ${tone.surface}; border: 1px solid ${tone.border}; border-radius: 8px; box-shadow: 0 10px 26px rgba(0,0,0,.55); overflow: hidden; font-size: 12px; color: ${tone.text}; font-family: ${tone.font}; }
.aconn__row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 7px 10px; }
.aconn__row + .aconn__row { border-top: 1px solid ${tone.border}; }
.aconn__label { flex: none; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; font-weight: 600; color: ${tone.text3}; }
.aconn__value { text-align: right; font-family: ${tone.mono}; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.aconn__value--muted { color: ${tone.text2}; }
.aconn__verdict { padding: 7px 10px; border-top: 1px solid ${tone.border}; font-size: 11.5px; line-height: 1.4; }
.aconn__where { padding: 6px 10px; border-top: 1px solid ${tone.border}; font-size: 11px; color: ${tone.text3}; }
`;

function ensureConnectionStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

/** The engine's truth table. Unknowns say "unknown"; this renders them so. */
interface Capabilities {
  active_broker: string | null;
  price_source: string | null;
  price_source_plain: string | null;
  live_allowed: boolean;
  plain: string | null;
  brokers: Record<string, { capabilities: Record<string, string> }>;
}

/**
 * ★ Sixty seconds, not one. A broker connection changes when somebody
 * configures it or a gateway drops, both minute-scale. Prices that tick
 * belong on the quote stream, which is a different mechanism entirely.
 */
const EVERY_MS = 60_000;

function useCapabilities(): { caps: Capabilities | null; problem: string | null } {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const read = async (): Promise<void> => {
      const body = await getJson<Capabilities>('/ui/api/capabilities');
      if (!alive) return;
      if (body === null) {
        // Named, not blank. An empty readout reads as "nothing is
        // connected", which is a different and wrong answer from "I could
        // not ask".
        setProblem('cannot read');
        return;
      }
      setProblem(null);
      setCaps(body);
    };
    void read();
    const timer = setInterval(() => void read(), EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return { caps, problem };
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="aconn__row">
      <span className="aconn__label">{label}</span>
      <span className={muted ? 'aconn__value aconn__value--muted' : 'aconn__value'}>{value}</span>
    </div>
  );
}

export function GridConnectionLine(): JSX.Element | null {
  ensurePanelKitStyles();
  ensureConnectionStyles();

  const { caps, problem } = useCapabilities();
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    middleware: [offset(9), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  // safePolygon keeps the card open while the pointer travels toward it,
  // so a 232px panel is not lost to a diagonal cursor path.
  const hover = useHover(context, { handleClose: safePolygon(), delay: { open: 120, close: 80 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  // Nothing at all until it has an answer. A placeholder in a status
  // readout is a state somebody can misread as "connected, dimly".
  if (!caps && !problem) return null;

  if (problem || !caps) {
    return (
      <div className="aconn">
        <span className="aconn__unit">
          <span className="aconn__dot" style={{ background: tone.caution }} />
          <span className="aconn__name">connections</span>
          <span className="aconn__state">{problem ?? 'cannot read'}</span>
        </span>
      </div>
    );
  }

  const broker = caps.active_broker;
  const name = broker ?? caps.price_source ?? 'connections';
  const state = broker ? (caps.live_allowed ? 'live ok' : 'paper only') : 'no broker';
  const quotes = broker ? caps.brokers?.[broker]?.capabilities?.data : undefined;
  const sentence = caps.price_source_plain ?? caps.plain;

  return (
    <div className="aconn" data-testid="grid-connection-line">
      <button
        ref={refs.setReference}
        type="button"
        className="aconn__unit aconn__unit--live"
        aria-label="What this desk is connected to"
        {...getReferenceProps()}
      >
        <span
          className="aconn__dot"
          style={
            // Shape as well as colour: a hollow ring for nothing-set
            // survives a colourblind eye where a grey dot does not.
            broker
              ? { background: caps.live_allowed ? tone.ok : tone.caution }
              : { background: 'transparent', border: `1.5px solid ${tone.text3}` }
          }
        />
        <span className="aconn__name">{name}</span>
        <span className="aconn__state">{state}</span>
      </button>

      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="aconn__card"
            aria-label="Connections"
            {...getFloatingProps()}
          >
            <Row label="Orders" value={broker ?? 'none set'} muted={!broker} />
            <Row label="Prices" value={caps.price_source ?? 'none'} muted={!caps.price_source} />
            {quotes ? (
              <Row
                label="Quotes"
                // "unknown" stays unknown. Rendering it as "no" would be a
                // guess wearing a fact's clothes.
                value={
                  quotes === 'yes'
                    ? `${broker} can quote`
                    : quotes === 'no'
                      ? `${broker} cannot quote`
                      : 'unknown'
                }
                muted={quotes !== 'yes'}
              />
            ) : null}
            {sentence ? (
              <div
                className="aconn__verdict"
                style={{
                  background: broker
                    ? `color-mix(in srgb, ${tone.ok} 7%, transparent)`
                    : `color-mix(in srgb, ${tone.caution} 7%, transparent)`,
                  color: broker ? tone.ok : tone.caution,
                }}
              >
                {sentence}
              </div>
            ) : null}
            <div className="aconn__where">Change these in Settings.</div>
          </div>
        </FloatingPortal>
      ) : null}
    </div>
  );
}
