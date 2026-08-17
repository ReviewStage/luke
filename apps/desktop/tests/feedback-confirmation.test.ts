import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFIRMATION_CYCLE,
  CONFIRMATION_ENTRANCE_MS,
  CONFIRMATION_REST_MS,
  CONFIRMATION_SCENE,
  confirmationHoldMs,
  feedbackConfirmation,
  STILL_CONFIRMATION_MS,
} from "../src/renderer/feedback-confirmation";
import { FACE_MOTION, FACE_MOTION_CYCLE_MS } from "../src/renderer/luke-face-art";

test("the first landed send gets the shockwave, and only the first", () => {
  const first = feedbackConfirmation(0);

  assert.equal(first.motion, FACE_MOTION.SUCCESS);
  assert.equal(first.scene, CONFIRMATION_SCENE.SHOCKWAVE);
  // Nothing in the ring repeats the welcome.
  for (const step of CONFIRMATION_CYCLE) {
    assert.notEqual(step.scene, CONFIRMATION_SCENE.SHOCKWAVE);
  }
});

test("a count the store could not supply lands on the first send's scene", () => {
  // The worst a lost or corrupt count can cost is replaying the welcome.
  assert.equal(feedbackConfirmation(-3).scene, CONFIRMATION_SCENE.SHOCKWAVE);
  assert.equal(feedbackConfirmation(Number.NaN).scene, CONFIRMATION_SCENE.SHOCKWAVE);
  assert.equal(feedbackConfirmation(0.5).scene, CONFIRMATION_SCENE.SHOCKWAVE);
});

test("every send after the first walks the ring in order and wraps", () => {
  const ring = [
    FACE_MOTION.BOOP,
    FACE_MOTION.REVIEWING,
    FACE_MOTION.DIZZY,
    FACE_MOTION.FLOATING,
    FACE_MOTION.WINK,
    FACE_MOTION.IDLE,
    FACE_MOTION.YES,
    FACE_MOTION.REFRESH,
    FACE_MOTION.SHIMMY,
    FACE_MOTION.GLANCE,
  ];

  ring.forEach((motion, index) => {
    assert.equal(feedbackConfirmation(index + 1).motion, motion);
  });
  // The eleventh send after the first is the boop again: the ring wraps
  // rather than running out of celebrations.
  assert.equal(feedbackConfirmation(ring.length + 1).motion, FACE_MOTION.BOOP);
  assert.equal(feedbackConfirmation(2 * ring.length).motion, FACE_MOTION.GLANCE);
});

test("only the boop landing dresses the exclamation mark", () => {
  const dressed = CONFIRMATION_CYCLE.filter((step) => step.scene === CONFIRMATION_SCENE.BOOP);

  assert.equal(dressed.length, 1);
  assert.equal(dressed[0]?.motion, FACE_MOTION.BOOP);
});

test("every motion in the ring is one the artwork describes", () => {
  for (const step of CONFIRMATION_CYCLE) {
    const cycle = FACE_MOTION_CYCLE_MS[step.motion];
    assert.ok(cycle > 0, `${step.motion} has no cycle`);
  }
});

test("the hold spans the swoop, the gesture, and a beat of rest", () => {
  const hold = confirmationHoldMs({ motion: FACE_MOTION.SUCCESS, still: false });

  assert.equal(
    hold,
    CONFIRMATION_ENTRANCE_MS + FACE_MOTION_CYCLE_MS[FACE_MOTION.SUCCESS] + CONFIRMATION_REST_MS,
  );
});

test("with motion asked away the hold is only long enough to read", () => {
  // No gesture plays, so there is no gesture to wait out — whichever motion
  // this send would have drawn.
  assert.equal(
    confirmationHoldMs({ motion: FACE_MOTION.REFRESH, still: true }),
    STILL_CONFIRMATION_MS,
  );
  assert.equal(
    confirmationHoldMs({ motion: FACE_MOTION.IDLE, still: true }),
    STILL_CONFIRMATION_MS,
  );
});
