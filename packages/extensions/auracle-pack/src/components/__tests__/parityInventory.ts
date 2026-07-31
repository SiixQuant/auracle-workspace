/**
 * The parity inventory, read from PARITY.md rather than kept in a second copy
 * here. The point of the parity suite is that the document and the tests can
 * never drift: the suite parses the very table a person edits, so adding a row
 * to the document with no proof, or changing a disposition, is felt by the
 * suite at once.
 *
 * One row is one task. `id` anchors it to a proof or an absence check; the
 * disposition decides which. Nothing in this file asserts — it only reads the
 * document and hands back its rows.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type Disposition = 'carried' | 'subsumed' | 'dropped';

export interface ParityRow {
  /** The stable id in the first table cell, e.g. `card-3`. */
  readonly id: string;
  /** The task text in the second cell. */
  readonly task: string;
  readonly disposition: Disposition;
}

/**
 * Locate PARITY.md from the runner's working directory. Vitest runs at the
 * config root, so the package-relative path is the common case; the fallbacks
 * cover a run started inside the package. `import.meta.url` is avoided on
 * purpose — the jsdom environment rewrites it to an http origin, which
 * `fileURLToPath` then rejects.
 */
function resolveParityPath(): string {
  const candidates = [
    'packages/extensions/auracle-pack/PARITY.md',
    'PARITY.md',
    '../PARITY.md',
    '../../PARITY.md',
  ];
  for (const rel of candidates) {
    const path = resolve(process.cwd(), rel);
    if (existsSync(path)) return path;
  }
  throw new Error(`PARITY.md not found from ${process.cwd()}`);
}

export const PARITY_PATH = resolveParityPath();

/**
 * A table row and nothing else: a leading pipe, an `id` cell shaped `word-123`,
 * a task cell, a where-today cell, then the disposition in bold. The legend
 * lines (`- **carried** ...`) and the header (`| id | Task | ...`) do not match:
 * the legend has no leading pipe, and the header's first cell is not `word-123`.
 */
const ROW =
  /^\|\s*([a-z]+-\d+)\s*\|\s*([^|]+?)\s*\|\s*[^|]*\|\s*\*\*(carried|subsumed|dropped)\*\*\s*\|/;

export function parseInventory(markdown: string): ParityRow[] {
  const rows: ParityRow[] = [];
  for (const line of markdown.split('\n')) {
    const match = ROW.exec(line);
    if (!match) continue;
    rows.push({ id: match[1], task: match[2].trim(), disposition: match[3] as Disposition });
  }
  return rows;
}

/** Every task on the panel, dispositioned, in document order. */
export const PARITY_ROWS: readonly ParityRow[] = parseInventory(readFileSync(PARITY_PATH, 'utf8'));

export const rowsByDisposition = (disposition: Disposition): ParityRow[] =>
  PARITY_ROWS.filter((row) => row.disposition === disposition);

/** The rows that must each prove a working path (carried or subsumed). */
export const PROVABLE_ROWS: readonly ParityRow[] = PARITY_ROWS.filter(
  (row) => row.disposition !== 'dropped'
);

/** The rows that must each be asserted gone (dropped). */
export const DROPPED_ROWS: readonly ParityRow[] = rowsByDisposition('dropped');
