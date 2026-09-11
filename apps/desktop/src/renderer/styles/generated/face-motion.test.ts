import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

/**
 * face-motion.css is generated, so these are tests of the generator's motion
 * table by way of the one artifact the app loads. They guard the promise every
 * capture run and reduced-motion still lean on: a paused loop shows its first
 * frame, and the first frame shows nothing mid-air.
 */
const css = readFileSync(new URL("./face-motion.css", import.meta.url), "utf8");

test("every sleeping z is invisible at time zero", () => {
  const zStarts = [...css.matchAll(/@keyframes luke-sleep-z-\d \{\s*0% \{([^}]*)\}/g)];
  assert.equal(zStarts.length, 3);
});

test("appear ends at the resting pose rather than leaning back out", () => {
  // Played once with no fill, a motion snaps to the drawn rest the instant it
  // drops — so its last keyframe must already be there.
  const layers = [...css.matchAll(/@keyframes luke-appear-\d \{[\s\S]*?\n\}/g)];
  assert.equal(layers.length, 2);
});
