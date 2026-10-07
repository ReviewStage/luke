import assert from "node:assert/strict";
import {
  FACE_MOTION,
  FACE_MOTION_CYCLE_MS,
  FACE_MOTION_PARTS,
  type FaceMotion,
} from "@sidecar/surface";
import { test } from "vitest";
import {
  chooseAside,
  HOVER_ASIDES,
  IDLE_ASIDES,
  restingMotion,
  speechFaceInputs,
} from "./luke-face-mood";

test("the microphone holds the face, and speech outranks it", () => {
  assert.equal(restingMotion({ microphoneLive: true, speaking: true }), FACE_MOTION.TALKING);
  // Nothing to say into it, but it is still open, and that has to stay visible.
  assert.equal(restingMotion({ microphoneLive: true, speaking: false }), FACE_MOTION.LISTENING);
  // No call heard at all: the face is still, and spends its moments on gestures.
  assert.equal(restingMotion({ microphoneLive: false, speaking: false }), undefined);
});

/**
 * Every motion that says something about the world. Nothing fired by a mere
 * timer or a passing hand may play one, or the face is lying.
 */
const SPOKEN: readonly FaceMotion[] = [
  FACE_MOTION.TALKING,
  FACE_MOTION.LISTENING,
  FACE_MOTION.SLEEPING,
  FACE_MOTION.HUSHED,
  FACE_MOTION.WAITING,
  FACE_MOTION.SUCCESS,
  FACE_MOTION.NOTIFICATION,
  FACE_MOTION.MONITORING,
];

test("a gesture says nothing a rest already says", () => {
  // A gesture arrives because a timer fired, so one that carried meaning would
  // be a lie: Luke must not look like he is listening to a closed microphone.
  for (const aside of IDLE_ASIDES) {
    assert.ok(!SPOKEN.includes(aside.motion), `${aside.motion} carries meaning and cannot be idle`);
  }
});

test("a moment is sampled by weight, and the smallest gesture is most of the pool", () => {
  const weight = IDLE_ASIDES.reduce((sum, aside) => sum + aside.weight, 0);
  // A roll walks the pool in order, so each boundary is exactly a weight — read
  // off the pool rather than written down, or the test only proves itself.
  const blink = (IDLE_ASIDES[0]?.weight ?? 0) / weight;
  assert.equal(chooseAside(IDLE_ASIDES, 0), FACE_MOTION.IDLE);
  assert.equal(chooseAside(IDLE_ASIDES, blink - 0.001), FACE_MOTION.IDLE);
  assert.equal(chooseAside(IDLE_ASIDES, blink + 0.001), FACE_MOTION.WINK);
  assert.equal(chooseAside(IDLE_ASIDES, 0.999), FACE_MOTION.HIDING);
  const share = (motion: FaceMotion) =>
    (IDLE_ASIDES.find((aside) => aside.motion === motion)?.weight ?? 0) / weight;
  assert.ok(share(FACE_MOTION.IDLE) > 0.35, "the blink has to be the usual moment");
  assert.ok(share(FACE_MOTION.HIDING) < 0.02, "ducking out of frame has to stay a surprise");
  // Every weight is a real share, or the pool is lying about its own odds.
  for (const aside of IDLE_ASIDES)
    assert.ok(aside.weight > 0, `${aside.motion} can never be chosen`);
});

test("a hover earns a trick, and the trick says nothing", () => {
  // A hand crosses the window whenever it likes, so nothing a hover plays may
  // mean anything.
  for (const aside of HOVER_ASIDES) {
    assert.ok(
      !SPOKEN.includes(aside.motion),
      `${aside.motion} carries meaning and cannot be hover`,
    );
    assert.ok(aside.weight > 0, `${aside.motion} can never be chosen`);
  }
  // The flyoff is the showpiece: the likeliest answer to a hover, and near
  // enough half the pool that most visits get the big one.
  const total = HOVER_ASIDES.reduce((sum, aside) => sum + aside.weight, 0);
  const flyoff = HOVER_ASIDES.find((aside) => aside.motion === FACE_MOTION.FLYOFF);
  assert.ok(flyoff, "the flyoff is what the hover was built for");
  assert.ok((flyoff?.weight ?? 0) / total > 0.4, "the flyoff has to be the usual trick");
  assert.equal(chooseAside(HOVER_ASIDES, 0), FACE_MOTION.FLYOFF);
});

test("every motion the renderer can play is one the artwork describes", () => {
  for (const motion of Object.values(FACE_MOTION)) {
    assert.ok(FACE_MOTION_CYCLE_MS[motion] > 0, `${motion} has no cycle`);
    assert.ok(FACE_MOTION_PARTS[motion], `${motion} has no parts`);
  }
  // Only sleeping closes the eyes, and it is the only one that needs the z's:
  // the renderer draws lids instead of eyes, so anything else would go blind.
  const withLids = Object.values(FACE_MOTION).filter((motion) => FACE_MOTION_PARTS[motion].lids);
  assert.deepEqual(withLids, [FACE_MOTION.SLEEPING]);
});

test("the face's mouth follows Luke's own track alone", () => {
  // The session is full duplex: the developer talking under Luke's answer says
  // nothing about whether he is talking, and his answer over the microphone
  // does not close it.
  assert.deepEqual(speechFaceInputs({ listening: true, lukeSpeaking: false }), {
    speaking: false,
    microphoneLive: true,
  });
  assert.deepEqual(speechFaceInputs({ listening: false, lukeSpeaking: true }), {
    speaking: true,
    microphoneLive: false,
  });
  assert.equal(
    restingMotion(speechFaceInputs({ listening: true, lukeSpeaking: true })),
    FACE_MOTION.TALKING,
  );
});
