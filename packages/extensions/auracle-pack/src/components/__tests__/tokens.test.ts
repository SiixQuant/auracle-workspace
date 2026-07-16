/**
 * Contrast assertions for the Hermes-on-dark token table (PRD #59).
 *
 * These are the design system's load-bearing guarantees, checked as WCAG
 * relative-luminance math over the literal token values so a future palette
 * tweak cannot silently ship illegible text:
 *  - every text tier reads on every surface it is allowed to sit on;
 *  - the accent ramp keeps its discipline (#0053fd is a FILL — white ink on
 *    top passes AA; the blue itself is never asserted as body text);
 *  - semantic status colours read as text on cards.
 */
import { describe, expect, it } from 'vitest';
import { RAISE, tone } from '../panelkit';

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`expected 6-digit hex, got: ${hex}`);
  const n = parseInt(m[1], 16);
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const AA_TEXT = 4.5;
const AA_UI = 3.0;

describe('Hermes token contrast', () => {
  const surfaces = {
    bg: tone.bg,
    surface: tone.surface,
    surface2: tone.surface2,
    surface3: tone.surface3,
    sunken: tone.sunken,
  };

  it.each(Object.entries(surfaces))('primary text passes AA on %s', (_name, s) => {
    expect(contrast(tone.text, s)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(tone.text2, s)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // text3 is the quiet tier: allowed on canvas, cards, and the hover step.
  // It is NOT rated for surface3 (pressed fills) — anything reading there
  // must use text2 or brighter, which this test pins down.
  it.each([
    ['bg', tone.bg],
    ['surface', tone.surface],
    ['surface2', tone.surface2],
    ['sunken', tone.sunken],
  ])('tertiary text passes AA on %s', (_name, s) => {
    expect(contrast(tone.text3, s)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('accentText reads on every surface step', () => {
    for (const s of Object.values(surfaces)) {
      expect(contrast(tone.accentText, s)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('white ink passes AA on both accent fill tiers', () => {
    expect(contrast(tone.accentInk, tone.accent)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(tone.accentInk, tone.accentHover)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('the accent fill itself is only UI-grade against cards — never body text', () => {
    const c = contrast(tone.accent, tone.surface);
    expect(c).toBeGreaterThanOrEqual(AA_UI);
    // If this ever passes AA_TEXT the ramp collapsed into one colour and the
    // accentText tier lost its reason to exist — that would be a redesign,
    // not a tweak, so fail loudly.
    expect(c).toBeLessThan(AA_TEXT);
  });

  it('semantic status colours read as text on cards', () => {
    for (const c of [tone.ok, tone.danger, tone.caution]) {
      expect(contrast(c, tone.surface)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(c, tone.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('surface steps stay ordered dark to light', () => {
    expect(luminance(tone.sunken)).toBeLessThan(luminance(tone.bg));
    expect(luminance(tone.bg)).toBeLessThan(luminance(tone.surface));
    expect(luminance(tone.surface)).toBeLessThan(luminance(tone.surface2));
    expect(luminance(tone.surface2)).toBeLessThan(luminance(tone.surface3));
  });

  it('RAISE is the interactive step above a card', () => {
    expect(RAISE).toBe(tone.surface2);
  });
});
