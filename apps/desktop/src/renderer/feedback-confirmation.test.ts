import assert from "node:assert/strict";
import test from "node:test";
import { FACE_MOTION, FACE_MOTION_CYCLE_MS } from "@sidecar/surface";
import {
  CONFIRMATION_ENTRANCE_MS,
  CONFIRMATION_REST_MS,
  CONFIRMATION_SCENE,
  confirmationHoldMs,
  feedbackConfirmation,
  STILL_CONFIRMATION_MS,
} from "./feedback-confirmation";

const CONFIRMATIONS = [feedbackConfirmation(() => 0), feedbackConfirmation(() => 0.999)] as const;

test("the coin lands on the shockwave or the boop, and nothing else", () => {
  const low = feedbackConfirmation(() => 0);
  const high = feedbackConfirmation(() => 0.999);

  assert.equal(low.motion, FACE_MOTION.SUCCESS);
  assert.equal(low.scene, CONFIRMATION_SCENE.SHOCKWAVE);
  assert.equal(high.motion, FACE_MOTION.BOOP);
  assert.equal(high.scene, CONFIRMATION_SCENE.BOOP);
  assert.equal(CONFIRMATIONS.length, 2);
});

test("every landing the coin can draw is one the artwork describes", () => {
  for (const landing of CONFIRMATIONS) {
    const cycle = FACE_MOTION_CYCLE_MS[landing.motion];
    assert.ok(cycle > 0, `${landing.motion} has no cycle`);
  }
});

test("the hold spans the swoop, the gesture, and a beat of rest", () => {
  for (const landing of CONFIRMATIONS) {
    assert.equal(
      confirmationHoldMs({ motion: landing.motion, still: false }),
      CONFIRMATION_ENTRANCE_MS + FACE_MOTION_CYCLE_MS[landing.motion] + CONFIRMATION_REST_MS,
    );
  }
});

test("with motion asked away the hold is only long enough to read", () => {
  // No gesture plays, so there is no gesture to wait out — whichever landing
  // this send would have drawn.
  assert.equal(
    confirmationHoldMs({ motion: FACE_MOTION.SUCCESS, still: true }),
    STILL_CONFIRMATION_MS,
  );
  assert.equal(
    confirmationHoldMs({ motion: FACE_MOTION.BOOP, still: true }),
    STILL_CONFIRMATION_MS,
  );
});
