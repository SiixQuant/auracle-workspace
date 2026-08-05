/**
 * The Grid's own accent — scoped to this module, deliberately not the pack's.
 *
 * WHY THIS IS NOT `tone.accent`: the pack's accent is WHITE on purpose. It is
 * the launcher's primary pill, and its achromatic value is asserted
 * (tokens.test.ts pins `chroma(tone.accent) === 0`) so that a status can never
 * be re-pointed at the brand and quietly stop meaning anything. That rule is
 * not in question here, and nothing in this file touches the token table.
 *
 * WHY THE GRID NEEDS ONE ANYWAY: the Grid is the only pack surface that draws
 * a MAP rather than a control — a root node, four district ranks, a room grid,
 * and the wires between them. Those are STRUCTURAL marks, and in white they
 * read at the same weight as the health colours that are the one thing on the
 * sheet a person is meant to chase. So the plan's structure takes a warm
 * orange: unmistakably not a status, and used nowhere outside the Grid.
 *
 * THE RULE THAT SURVIVES INTACT: nothing carrying STATE is drawn with this.
 * Health stays on `tone.caution` / `tone.danger` / `tone.text3`, always, on
 * the dots, the flags, the card borders and the wires alike.
 */
import { tint } from '../panelkit';

/** The Grid's structural accent — a warm orange, deliberately distinct from
 *  the white pack accent (`tone.accent`) and from every semantic status hue. */
export const GRID_ACCENT = '#f26430';

/** The accent as a hairline — the root node's ring, a hovered room's border. */
export const GRID_ACCENT_DIM = tint(GRID_ACCENT, 38);

/** The faintest wash of it — the root node's fill. */
export const GRID_ACCENT_SOFT = tint(GRID_ACCENT, 11);
