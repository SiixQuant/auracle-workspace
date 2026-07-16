/**
 * Guards the one invariant a whole class of invisible-control bugs violates:
 * anything drawn ON the primary fill must take its foreground from
 * `--nim-on-primary`, never from a hardcoded light colour.
 *
 * WHY THIS EXISTS. `--nim-primary` is not a fixed brightness — it is a dark
 * blue in the Light theme and WHITE in Dark and Cursor Dark. A hardcoded
 * `text-white` on that fill is therefore correct in exactly one theme and
 * invisible in the other two. When the palette went white, 152 call sites
 * carrying that assumption turned into blank buttons and shipped, because
 * unit tests, typecheck, and a screenshot of one panel were all green.
 *
 * The bug then survived a first fix, because the pair can be spelled at least
 * seven ways and the fix only searched one. Each `FORMS` entry below is a
 * spelling that actually shipped broken. Add to it rather than trusting a
 * single grep.
 *
 * This is a source-text check on purpose: it costs milliseconds, it runs on
 * every commit, and it fails on the SPELLING rather than on a rendered pixel,
 * so it catches a reintroduction the moment it is typed.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '../../../../..');

/** These shell out to grep across every package; the 5s unit default is not
 *  a realistic budget for a whole-tree source scan. */
const SCAN_TIMEOUT = 60_000;

/** Ripgrep the packages tree, returning matching `file:line:text` rows. */
function scan(pattern: string, glob = '*'): string[] {
  try {
    const out = execFileSync(
      'grep',
      ['-rn', '--include', glob, '-E', pattern, 'packages'],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return out.split('\n').filter((l) => l && !l.includes('node_modules'));
  } catch {
    return []; // grep exits 1 on no matches
  }
}

/** A light foreground, however it is spelled. */
const LIGHT_INK = String.raw`text-white|text-\[#fff|bg-white|stroke="white"|fill="white"|color: '(white|#fff)|color:\s*(#fff|white)\b`;

describe('ink on the primary fill', () => {
  it('no Tailwind class pairs a primary fill with hardcoded light text', () => {
    // Both spellings of the fill: the arbitrary form and the theme alias.
    const hits = scan(String.raw`bg-(\[var\(--nim-primary\)\]|nim-primary)`)
      .filter((l) => /text-white|text-\[#fff/.test(l))
      // A ternary may legitimately carry text-white on a DIFFERENT branch's
      // chromatic fill; those are correct and stay.
      .filter((l) => !/bg-\[#[0-9a-f]{6}\] text-white/i.test(l));
    expect(hits).toEqual([]);
  }, SCAN_TIMEOUT);

  it('no inline style pairs a primary background with white text', () => {
    const hits = scan(String.raw`background[a-zA-Z]*: 'var\(--nim-primary\)'`, '*.tsx');
    const bad = hits.filter((row) => {
      const [file, line] = row.split(':');
      // The ink usually sits on the next line or two of the style object.
      const near = scan(String.raw`color: '(white|#fff)`, '*.tsx').filter((r) => {
        const [f, l] = r.split(':');
        return f === file && Math.abs(Number(l) - Number(line)) <= 3;
      });
      return near.length > 0;
    });
    expect(bad).toEqual([]);
  }, SCAN_TIMEOUT);

  it('no CSS rule fills with primary and hardcodes white ink', () => {
    // The fill and the ink are often in DIFFERENT selectors — a rule paints
    // the background and a DESCENDANT rule paints the glyph:
    //
    //   .card-edit:hover                        { background: var(--nim-primary) }
    //   .card-edit:hover .material-symbols-...  { color: white }
    //
    // A block-scoped check passes that happily and the icon still disappears.
    // So collect the filled selectors first, then flag any rule that is one of
    // them OR a descendant of one and paints white.
    const files = [
      ...new Set(
        scan(String.raw`background(-color)?:\s*var\(--nim-primary\)`, '*.css').map(
          (l) => l.split(':')[0],
        ),
      ),
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      const css = execFileSync('cat', [rel], { cwd: REPO, encoding: 'utf8' });
      const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
        sel: m[1].trim().split('\n').pop()!.trim(),
        body: m[2],
      }));
      const filled = blocks
        .filter((b) => /background(-color)?:\s*var\(--nim-primary\)/.test(b.body))
        .map((b) => b.sel);
      for (const b of blocks) {
        if (!/(?<!-)color:\s*(#fff\b|#ffffff\b|white\b)/i.test(b.body)) continue;
        const onFill = filled.some((f) => b.sel === f || b.sel.startsWith(`${f} `));
        if (onFill) offenders.push(`${rel}: ${b.sel}`);
      }
    }
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT);

  it('no knob, dot, or glyph is painted white on a primary fill', () => {
    // The foreground is not always a TEXT colour: a radio dot and a toggle
    // knob are backgrounds, and an icon is SVG paint. This is the form that
    // survived the first fix entirely.
    // Both sides are scanned ONCE and joined in memory — grepping per hit is
    // correct but takes ~30s, which is too slow to run on every commit.
    const inks = scan(String.raw`stroke="white"|fill="white"|rounded-full bg-white|before:bg-white`);
    const fills = new Map<string, number[]>();
    for (const row of scan(String.raw`bg-(\[var\(--nim-primary\)\]|nim-primary)`)) {
      const [file, line] = row.split(':');
      const arr = fills.get(file) ?? [];
      arr.push(Number(line));
      fills.set(file, arr);
    }
    const bad = inks.filter((row) => {
      const [file, line] = row.split(':');
      // The fill is on the element itself or a parent a few lines above.
      return (fills.get(file) ?? []).some((f) => Number(line) - f >= 0 && Number(line) - f <= 4);
    });
    expect(bad.map((b) => b.slice(0, 90))).toEqual([]);
  }, SCAN_TIMEOUT);

  it('no opacity modifier is applied to the on-primary ink', () => {
    // Tailwind 3.4 SILENTLY DROPS an opacity modifier on an arbitrary CSS var
    // (`text-[var(--x)]/80` emits NO rule), so the element falls back to
    // inherited colour — a dead class that looks correct in review. Use
    // `color-mix(in_srgb,var(--nim-on-primary)_80%,transparent)` instead.
    //
    // Scoped to on-primary: the same trap affects ~25 pre-existing
    // `bg-[var(--nim-primary)]/5`-style tints across the tree, which are a
    // separate (and older) cleanup than this invariant.
    const hits = scan(String.raw`\[var\(--nim-on-primary\)\]/[0-9]+`).filter(
      (l) => !l.includes('THEMING.md'),
    );
    expect(hits).toEqual([]);
  }, SCAN_TIMEOUT);
});
