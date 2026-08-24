import {
  FACE_MOTION,
  FACE_MOTION_CYCLE_MS,
  FACE_MOTION_PARTS,
  type FaceMotion,
} from "@sidecar/surface";

/**
 * The animations reference page's own vocabulary, held apart from the
 * component that draws it so the roster and the asset index can be asserted
 * without a DOM. Everything here restates generated facts —
 * `design/generate-brand-assets.mjs` writes the motion table this reads and
 * the SVGs the index files — and nothing is authored by hand that could
 * drift from them.
 */

/**
 * The two cuts every motion SVG is committed in. Dark leads because the admin
 * page itself is dark: the variant matching the reader's surface previews
 * first.
 */
export const ANIMATION_VARIANT = {
  DARK: "dark",
  LIGHT: "light",
} as const;

export type AnimationVariant = (typeof ANIMATION_VARIANT)[keyof typeof ANIMATION_VARIANT];

export const ANIMATION_VARIANT_LABEL = {
  dark: "Dark mode",
  light: "Light mode",
} as const satisfies Record<AnimationVariant, string>;

/**
 * The ground each variant is previewed on. The SVGs carry their stroke colors
 * baked in — #f5f5f7 for the dark cut, #1d1d1f for the light — so the swatch
 * is each cut's opposite number rather than the page's own theme tokens,
 * which would leave the light cut invisible on the dark page.
 */
export const ANIMATION_SWATCH = {
  dark: "#1d1d1f",
  light: "#f5f5f7",
} as const satisfies Record<AnimationVariant, string>;

/** What a motion draws beyond the resting smile and eyes, worded for the page. */
export function animationExtraParts(motion: FaceMotion): readonly string[] {
  const parts = FACE_MOTION_PARTS[motion];
  const labels: string[] = [];
  if (parts.brows) labels.push("brows");
  if (parts.lids) labels.push("closed lids");
  if (parts.sleepZ) labels.push("sleep z's");
  return labels;
}

export interface AnimationEntry {
  readonly motion: FaceMotion;
  readonly cycleMs: number;
  readonly extraParts: readonly string[];
}

/** Every motion the artwork defines, in the artwork table's own order. */
export const ANIMATION_ROSTER: readonly AnimationEntry[] = Object.values(FACE_MOTION).map(
  (motion) => ({
    motion,
    cycleMs: FACE_MOTION_CYCLE_MS[motion],
    extraParts: animationExtraParts(motion),
  }),
);

/** A cycle drawn the way the keyframes state it: seconds, e.g. "0.65s", "3s". */
export function formatCycleSeconds(cycleMs: number): string {
  return `${cycleMs / 1000}s`;
}

/**
 * A committed motion asset's name: `luke-<motion>-<variant>.svg`, anchored to
 * the end of its import path.
 */
const ASSET_FILE = /\/luke-([a-z]+)-(dark|light)\.svg$/;

/**
 * The committed motion SVGs indexed by the motion and variant their file
 * names state. Built from names rather than assumed, so a motion whose asset
 * is missing draws an honest gap on the page instead of a broken frame, and a
 * file the motion table does not name is left out rather than shown as a
 * motion the artwork does not define.
 */
export function indexAnimationAssets(
  assets: Readonly<Record<string, string>>,
): ReadonlyMap<FaceMotion, ReadonlyMap<AnimationVariant, string>> {
  const motions = new Map<string, FaceMotion>(
    Object.values(FACE_MOTION).map((motion) => [motion, motion]),
  );
  const variants = new Map<string, AnimationVariant>(
    Object.values(ANIMATION_VARIANT).map((variant) => [variant, variant]),
  );
  const index = new Map<FaceMotion, Map<AnimationVariant, string>>();
  for (const [path, svg] of Object.entries(assets)) {
    const match = ASSET_FILE.exec(path);
    if (match === null) continue;
    const motion = motions.get(match[1] ?? "");
    const variant = variants.get(match[2] ?? "");
    if (motion === undefined || variant === undefined) continue;
    const byVariant = index.get(motion) ?? new Map<AnimationVariant, string>();
    byVariant.set(variant, svg);
    index.set(motion, byVariant);
  }
  return index;
}
