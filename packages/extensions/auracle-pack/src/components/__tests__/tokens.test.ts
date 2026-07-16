/**
 * Contrast assertions for the Hermes-on-dark token table (PRD #59).
 *
 * These are the design system's load-bearing guarantees, checked as WCAG
 * relative-luminance math over the literal token values so a future palette
 * tweak cannot silently ship illegible text:
 *  - every text tier reads on every surface it is allowed to sit on;
 *  - the accent is a WHITE fill carrying BLACK ink, matching the launcher's
 *    primary pill, and is deliberately a single tier;
 *  - semantic status colours read as text on cards AND stay distinct from
 *    the accent, so state never renders as brand.
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

  it('black ink passes AA on both accent fill tiers', () => {
    // The accent is the launcher's white pill, so its ink is BLACK. This is
    // the inverse of the retired blue ramp, where the fill was dark and the
    // ink was white — get it backwards and the primary button goes blank.
    expect(contrast(tone.accentInk, tone.accent)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(tone.accentInk, tone.accentHover)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('the accent ramp is deliberately one colour — white reads anywhere', () => {
    // The retired blue ramp needed a separate brightened `accentText` tier
    // because #0053fd failed as text on charcoal (~3.2:1). White does not,
    // so the two tiers are intentionally the same value now. If they ever
    // diverge again, the ramp grew a tier that needs its own contrast proof.
    expect(tone.accentText).toBe(tone.accent);
    expect(contrast(tone.accent, tone.surface)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('every semantic colour stays chromatic — state never renders as brand', () => {
    // The load-bearing rule of the black-and-white system. The launcher
    // states it at app.css:2160 — a status lamp "keeps its semantic colour
    // (green = ready / red = needs you) ... a functional signal, not
    // decoration". Now that the accent IS white, a status re-pointed at it
    // would read as an ordinary brand mark and say nothing. Legibility is
    // covered above; what this pins is that each status stays a distinct HUE
    // rather than drifting toward the achromatic accent.
    const chroma = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    expect(chroma(tone.accent)).toBe(0); // the accent is pure white
    for (const c of [tone.ok, tone.danger, tone.caution]) {
      expect(c).not.toBe(tone.accent);
      expect(chroma(c)).toBeGreaterThan(60);
    }
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
