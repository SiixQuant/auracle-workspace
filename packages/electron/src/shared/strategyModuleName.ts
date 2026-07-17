/**
 * Naming helpers for strategy (.py) files, shared between main and renderer.
 * These are pure string functions with no Node.js dependencies so they work in
 * both processes (see the note at the top of pathUtils.ts).
 *
 * The engine imports each strategy file as a Python module, so the filename has
 * to be a valid module name. Two engine rules drive the sanitizer:
 *   - a module name cannot start with a digit; and
 *   - files whose name starts with "_" are SKIPPED by engine discovery, so a
 *     leading underscore would make the freshly created strategy invisible.
 */

/**
 * Turn a user-typed base name (without extension) into a valid, discoverable
 * Python module name.
 *
 * Pipeline: lowercase -> drop non-ascii characters -> collapse every run of
 * non `[a-z0-9]` characters (spaces, hyphens, dots, punctuation) into a single
 * underscore -> trim leading/trailing underscores -> prefix `strategy_` if it
 * still starts with a digit -> fall back to `my_strategy` when nothing is left.
 */
export function sanitizeStrategyModuleName(name: string): string {
  const lowered = (name ?? '').toLowerCase();
  // Drop anything outside printable ascii (accented letters, CJK, control
  // chars). These are removed outright rather than becoming separators so a
  // name like "Ütf" yields "tf", not "_tf".
  const ascii = lowered.replace(/[^\x20-\x7e]/g, '');
  // Every run of non-module characters becomes one underscore. The `+` also
  // collapses repeats, so "a...b" and "a   b" both yield "a_b".
  const underscored = ascii.replace(/[^a-z0-9]+/g, '_');
  // A leading underscore hides the file from engine discovery; a trailing one
  // is just noise.
  const trimmed = underscored.replace(/^_+|_+$/g, '');

  if (trimmed === '') {
    return 'my_strategy';
  }

  // Python module names can't start with a digit.
  if (/^[0-9]/.test(trimmed)) {
    return `strategy_${trimmed}`;
  }

  return trimmed;
}

/**
 * Given a base name and a predicate that reports whether a candidate is already
 * taken, return the first free name in the sequence `base`, `base_2`, ...,
 * `base_${maxSuffix}`. Returns `null` when every candidate is taken.
 *
 * The suffix is appended to the (already sanitized) base BEFORE any file
 * extension, so callers compose the final filename as `${result}${ext}`.
 */
export function nextAvailableName(
  base: string,
  exists: (candidate: string) => boolean,
  maxSuffix: number = 9,
): string | null {
  if (!exists(base)) {
    return base;
  }
  for (let suffix = 2; suffix <= maxSuffix; suffix++) {
    const candidate = `${base}_${suffix}`;
    if (!exists(candidate)) {
      return candidate;
    }
  }
  return null;
}
