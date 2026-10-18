/**
 * signal-palette.ts -- the one colour each signal is drawn in, in every world.
 *
 * However a world dresses its zones, the six signals read the same in all of
 * them: blueprints are planned, scaffolds are building, the glow is shipped,
 * and so on. Each colour sits at a middle luminance, so it holds at least
 * `SIGNAL_MIN_CONTRAST` against both `SCENE_GROUND`s, a light scene and a
 * dark one, and a world draws it unchanged on either. If you add a signal or
 * move a colour, keep it there: `signal-palette.test.ts` checks it.
 *
 * Colours are `#rrggbb`, which Three.js's `Color` and CSS both read.
 */

/** The colour of each signal a world draws. */
export const SIGNAL_COLOR = {
  /** A Linear issue not yet built: a blueprint. */
  PLANNED: "#5b6cf0",
  /** An agent's pull request under way. */
  BUILDING: "#b87100",
  /** A pull request merged: the glow where it landed. */
  SHIPPED: "#15924a",
  /** An error a monitor reports, or an agent that failed. */
  DEFECT: "#dc3e42",
  /** The zones that depend on what the selected agent touches. */
  BLAST_RADIUS: "#d6409f",
  /** What the developer has selected or hovers. */
  SELECTION: "#0891b2",
} as const;

/** The lightest and the darkest ground a world's scene is drawn on. */
export const SCENE_GROUND = {
  LIGHT: "#f2f1ec",
  DARK: "#0e1014",
} as const;

/** The least WCAG contrast a signal holds against either ground: what WCAG asks of a graphic. */
export const SIGNAL_MIN_CONTRAST = 3;
