import assert from "node:assert/strict";
import test from "node:test";
import {
  FACE_MOTION,
  FACE_MOTION_CYCLE_MS,
  FACE_MOTION_PARTS,
} from "../src/renderer/luke-face-art";
import {
  type FaceContext,
  IDLE_ASIDES,
  nextAside,
  restingMotion,
} from "../src/renderer/luke-face-mood";

function context(overrides: Partial<FaceContext> = {}): FaceContext {
  return {
    speaking: false,
    microphoneLive: false,
    attention: 0,
    working: 0,
    complete: 0,
    total: 0,
    ...overrides,
  };
}

test("the microphone outranks the session list", () => {
  const busy = { attention: 3, working: 2, total: 5 };
  assert.equal(
    restingMotion(context({ ...busy, microphoneLive: true, speaking: true })),
    FACE_MOTION.TALKING,
  );
  assert.equal(restingMotion(context({ ...busy, microphoneLive: true })), FACE_MOTION.LISTENING);
  // Nothing to say into it, but it is still open, and that has to stay visible.
  assert.equal(restingMotion(context({ microphoneLive: true })), FACE_MOTION.LISTENING);
});

test("a session that needs a person outranks one that is working", () => {
  assert.equal(restingMotion(context({ attention: 1, working: 4, total: 5 })), FACE_MOTION.WAITING);
  assert.equal(restingMotion(context({ working: 4, total: 4 })), FACE_MOTION.MONITORING);
});

test("nothing tracked is a different rest from nothing happening", () => {
  assert.equal(restingMotion(context()), FACE_MOTION.SLEEPING);
  // Tracked, but none of them working or waiting: awake with nothing to do.
  assert.equal(restingMotion(context({ complete: 2, total: 2 })), FACE_MOTION.IDLE);
});

test("an aside never repeats the one before it", () => {
  for (const previous of IDLE_ASIDES) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      assert.notEqual(nextAside(previous), previous);
    }
  }
});

test("asides say nothing a rest is already saying", () => {
  // An aside interrupts a rest, so one that carried meaning would overwrite it:
  // Luke must not look like he is waiting on you because a timer fired.
  for (const aside of IDLE_ASIDES) {
    assert.ok(
      ![
        FACE_MOTION.TALKING,
        FACE_MOTION.LISTENING,
        FACE_MOTION.WAITING,
        FACE_MOTION.MONITORING,
        FACE_MOTION.SLEEPING,
        FACE_MOTION.SUCCESS,
        FACE_MOTION.NOTIFICATION,
      ].includes(aside),
      `${aside} carries meaning and cannot be an aside`,
    );
  }
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
