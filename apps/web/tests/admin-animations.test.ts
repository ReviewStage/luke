import assert from "node:assert/strict";
import test from "node:test";
import { FACE_MOTION, FACE_MOTION_CYCLE_MS } from "@sidecar/surface";
import {
  ANIMATION_ROSTER,
  ANIMATION_SWATCH,
  ANIMATION_VARIANT,
  animationExtraParts,
  formatCycleSeconds,
  indexAnimationAssets,
} from "../src/admin-animations";

test("the roster restates the artwork table exactly: every motion once, in its order", () => {
  assert.deepEqual(
    ANIMATION_ROSTER.map((entry) => entry.motion),
    Object.values(FACE_MOTION),
  );
  for (const entry of ANIMATION_ROSTER) {
    assert.equal(entry.cycleMs, FACE_MOTION_CYCLE_MS[entry.motion]);
  }
});

test("extra parts are worded from the generated parts table, not authored beside it", () => {
  // The three cases the table holds today: nothing extra, brows alone, and
  // the sleeping face's lids with its z's.
  assert.deepEqual(animationExtraParts(FACE_MOTION.TALKING), []);
  assert.deepEqual(animationExtraParts(FACE_MOTION.NOTIFICATION), ["brows"]);
  assert.deepEqual(animationExtraParts(FACE_MOTION.SLEEPING), ["closed lids", "sleep z's"]);
});

test("a cycle is drawn in seconds the way the keyframes state it", () => {
  assert.equal(formatCycleSeconds(650), "0.65s");
  assert.equal(formatCycleSeconds(2200), "2.2s");
  assert.equal(formatCycleSeconds(3000), "3s");
});

test("the asset index files each committed SVG under the motion and variant its name states", () => {
  const index = indexAnimationAssets({
    "../../../design/brand/motion/luke-idle-dark.svg": "<svg>idle dark</svg>",
    "../../../design/brand/motion/luke-idle-light.svg": "<svg>idle light</svg>",
    "../../../design/brand/motion/luke-wink-dark.svg": "<svg>wink dark</svg>",
  });
  assert.equal(index.get(FACE_MOTION.IDLE)?.get(ANIMATION_VARIANT.DARK), "<svg>idle dark</svg>");
  assert.equal(index.get(FACE_MOTION.IDLE)?.get(ANIMATION_VARIANT.LIGHT), "<svg>idle light</svg>");
  assert.equal(index.get(FACE_MOTION.WINK)?.get(ANIMATION_VARIANT.DARK), "<svg>wink dark</svg>");
  // A variant with no committed file is an absent entry — the page's honest
  // gap — never an empty string posing as artwork.
  assert.equal(index.get(FACE_MOTION.WINK)?.get(ANIMATION_VARIANT.LIGHT), undefined);
});

test("a file the motion table does not name never becomes a motion on the page", () => {
  const index = indexAnimationAssets({
    "../../../design/brand/motion/luke-frown-dark.svg": "<svg>not a motion</svg>",
    "../../../design/brand/mark/luke-mark-square-dark.svg": "<svg>not a motion asset</svg>",
    "../../../design/brand/motion/luke-idle-dark.png": "not an svg",
  });
  assert.equal(index.size, 0);
});

test("each variant previews on the opposite ground its strokes were cut for", () => {
  // The committed SVGs bake their colors in: the dark cut strokes #f5f5f7 and
  // the light cut #1d1d1f, so the swatches must be those colors' grounds or a
  // cut disappears into its own preview.
  assert.equal(ANIMATION_SWATCH[ANIMATION_VARIANT.DARK], "#1d1d1f");
  assert.equal(ANIMATION_SWATCH[ANIMATION_VARIANT.LIGHT], "#f5f5f7");
});
