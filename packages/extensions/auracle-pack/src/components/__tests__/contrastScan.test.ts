/**
 * Source-scan guard against the white-on-white regression.
 *
 * When the accent flipped from blue to a WHITE fill, every control that inked
 * itself with a hardcoded `#fff` went blank on its own background. The token
 * table's contrast math (tokens.test.ts) proves `accentInk` is legible, but it
 * cannot see a panel that bypasses the token and paints `color: '#fff'` inline.
 * This scans the pack's own source and fails if any PAINT property is given an
 * opaque white hex literal — those must go through `tone.accentInk` (black on
 * the white fill) or the appropriate token, never a raw `#fff`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACK_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN_DIRS = ['components', 'engine'];

// A style value that PAINTS ink/fill (not a translucent rgba wash, not a token
// definition key like `accent:`), quoted as a real string literal so comment
// prose ("background: #fff") and interpolations (`${tone.accent}`) don't match.
const OFFENDER =
  /\b(color|background|backgroundColor|borderColor|borderTopColor|fill|stroke)\s*:\s*['"`]#(?:fff|ffffff)\b/i;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('no hardcoded #fff-on-accent in the pack', () => {
  const files = SCAN_DIRS.flatMap((d) => sourceFiles(path.join(PACK_SRC, d)));

  it('scans a non-trivial set of source files', () => {
    // Guards against a broken path silently scanning nothing.
    expect(files.length).toBeGreaterThan(10);
  });

  it('the scanner catches a planted violation (not vacuously green)', () => {
    expect(OFFENDER.test("color: '#fff'")).toBe(true);
    expect(OFFENDER.test('borderTopColor: "#FFFFFF"')).toBe(true);
    // Must NOT flag the legitimate uses.
    expect(OFFENDER.test("accent: '#ffffff'")).toBe(false); // token definition
    expect(OFFENDER.test('background: rgba(255,255,255,0.14)')).toBe(false); // wash
    expect(OFFENDER.test('background: `${tone.accent}`')).toBe(false); // interpolation
  });

  it('has zero offending sites across the pack', () => {
    const hits = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => `${path.relative(PACK_SRC, file)}:${i + 1}  ${line.trim()}`)
        .filter((line) => OFFENDER.test(line))
    );
    // A non-empty list names every offending site in the failure message.
    expect(hits).toEqual([]);
  });
});
