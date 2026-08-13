import assert from "node:assert/strict";
import test from "node:test";
import {
  FACE_MOTION,
  FACE_MOTION_CYCLE_MS,
  FACE_MOTION_PARTS,
} from "../src/renderer/luke-face-art";
import {
  type FaceContext,
  type FaceObservation,
  IDLE_ASIDES,
  nextAside,
  noticedMotion,
  playedMotion,
  restingMotion,
} from "../src/renderer/luke-face-mood";

function context(overrides: Partial<FaceContext> = {}): FaceContext {
  return {
    speaking: false,
    microphoneLive: false,
    attention: [],
    working: 0,
    complete: 0,
    total: 0,
    ...overrides,
  };
}

function observed(attention: readonly string[], counts: Partial<FaceObservation> = {}) {
  return { attention: new Set(attention), complete: 0, total: attention.length, ...counts };
}

test("the microphone outranks the session list", () => {
  const busy = { attention: ["a", "b", "c"], working: 2, total: 5 };
  assert.equal(
    restingMotion(context({ ...busy, microphoneLive: true, speaking: true })),
    FACE_MOTION.TALKING,
  );
  assert.equal(restingMotion(context({ ...busy, microphoneLive: true })), FACE_MOTION.LISTENING);
  // Nothing to say into it, but it is still open, and that has to stay visible.
  assert.equal(restingMotion(context({ microphoneLive: true })), FACE_MOTION.LISTENING);
});

test("a session that needs a person does not hold the face for as long as it waits", () => {
  // Anyone whose sessions are usually waiting on them would otherwise get a
  // face that fidgets permanently, which is the count badge's sentence said
  // twice and leaves nothing to notice when one more session starts asking.
  assert.equal(
    restingMotion(context({ attention: ["a"], working: 4, total: 5 })),
    FACE_MOTION.MONITORING,
  );
  assert.equal(restingMotion(context({ attention: ["a"], total: 1 })), FACE_MOTION.IDLE);
  assert.equal(restingMotion(context({ working: 4, total: 4 })), FACE_MOTION.MONITORING);
});

test("the fidget answers a session that has just started asking", () => {
  const asking = observed(["a"]);
  assert.equal(noticedMotion(asking, observed(["a", "b"])), FACE_MOTION.WAITING);
  // The same session still asking is not news, however long it goes on asking.
  assert.equal(noticedMotion(asking, observed(["a"])), undefined);
  // One answered as another starts leaves the count where it was, and is
  // exactly the moment counting would have missed.
  assert.equal(noticedMotion(asking, observed(["b"])), FACE_MOTION.WAITING);
  // Answered and not replaced: the panel says so, and the face has no news.
  assert.equal(noticedMotion(asking, observed([])), undefined);
});

test("a session that arrives already asking bounces rather than greeting itself", () => {
  const empty = observed([], { total: 0 });
  assert.equal(noticedMotion(empty, observed(["a"], { total: 1 })), FACE_MOTION.WAITING);
});

test("sessions arriving and finishing are still counted rather than named", () => {
  const two = observed([], { total: 2 });
  assert.equal(noticedMotion(two, observed([], { complete: 1, total: 2 })), FACE_MOTION.SUCCESS);
  assert.equal(noticedMotion(two, observed([], { total: 3 })), FACE_MOTION.NOTIFICATION);
  // Sessions leaving are not an event: nothing has asked for anyone.
  assert.equal(noticedMotion(two, observed([], { total: 1 })), undefined);
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

test("asides say nothing a rest or a moment already says", () => {
  // An aside interrupts a rest, so one that carried meaning would overwrite it:
  // Luke must not look like a session just started asking because a timer fired.
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

test("a rest that needs the face takes it back from a gesture at once", () => {
  // Scheduling gestures only while the rest is restful is not enough: the rest
  // can change under one that is already playing.
  for (const gesture of [
    ...IDLE_ASIDES,
    FACE_MOTION.SUCCESS,
    FACE_MOTION.NOTIFICATION,
    FACE_MOTION.WAITING,
  ]) {
    // The microphone is what matters most: the capsule reports an open
    // microphone through the face's colour, and only these two motions carry
    // it, so not even a session asking for you may hold the face over one.
    assert.equal(playedMotion(FACE_MOTION.LISTENING, gesture), FACE_MOTION.LISTENING);
    assert.equal(playedMotion(FACE_MOTION.TALKING, gesture), FACE_MOTION.TALKING);
    // The calm rests can still spare it.
    assert.equal(playedMotion(FACE_MOTION.IDLE, gesture), gesture);
    assert.equal(playedMotion(FACE_MOTION.MONITORING, gesture), gesture);
    assert.equal(playedMotion(FACE_MOTION.SLEEPING, gesture), gesture);
  }
});

test("with no gesture the face plays the rest, whatever it is", () => {
  for (const resting of Object.values(FACE_MOTION)) {
    assert.equal(playedMotion(resting, undefined), resting);
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
