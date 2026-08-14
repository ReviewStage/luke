import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * face-motion.css is generated, so these are tests of the generator's motion
 * table by way of the one artifact the app loads. They guard the promise every
 * capture run and reduced-motion still lean on: a paused loop shows its first
 * frame, and the first frame shows nothing mid-air.
 */
const css = readFileSync(
  new URL("../src/renderer/styles/face-motion.css", import.meta.url),
  "utf8",
);

test("no generated motion carries a negative delay", () => {
  // A paused animation with a negative delay holds at its resolved current
  // time rather than its first keyframe, so "paused means the first frame"
  // is only true while no generated rule carries one.
  assert.doesNotMatch(css, /animation-delay:\s*-/);
});

test("every sleeping z is invisible at time zero", () => {
  const zStarts = [...css.matchAll(/@keyframes luke-sleep-z-\d \{\s*0% \{([^}]*)\}/g)];
  assert.equal(zStarts.length, 3);
  for (const start of zStarts) {
    assert.match(start[1] ?? "", /opacity: 0;/);
  }
});

test("appear ends at the resting pose rather than leaning back out", () => {
  // Played once with no fill, a motion snaps to the drawn rest the instant it
  // drops — so its last keyframe must already be there.
  const layers = [...css.matchAll(/@keyframes luke-appear-\d \{[\s\S]*?\n\}/g)];
  assert.equal(layers.length, 2);
  assert.match(layers[0]?.[0] ?? "", /100% \{\s*transform: rotate\(0deg\);/);
  assert.match(layers[1]?.[0] ?? "", /100% \{\s*transform: translate\(0px, 0px\);/);
});
