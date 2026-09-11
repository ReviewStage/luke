import assert from "node:assert/strict";
import {
  FACE_MOTION,
  FACE_MOTION_CYCLE_MS,
  FACE_MOTION_PARTS,
  type FaceMotion,
} from "@sidecar/surface";
import { test } from "vitest";
import {
  asidePool,
  chooseAside,
  type FaceContext,
  type FaceObservation,
  HOVER_ASIDES,
  noticedMotion,
  restingMotion,
  speechFaceInputs,
  thinkingDotsShown,
} from "./luke-face-mood";

function context(overrides: Partial<FaceContext> = {}): FaceContext {
  return {
    speaking: false,
    microphoneLive: false,
    thinking: false,
    announcementsHeld: false,
    settled: true,
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

test("nothing about the session list holds the face at all", () => {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // A rest repeats for as long as it is true, so anything the sessions could ask
  // for would be a loop that never stops for anyone whose sessions usually need
  // them. Sessions waiting, sessions working, sessions doing neither: the face
  // is still, and what the sessions do is spent on gestures between stillnesses.
  assert.equal(restingMotion(context({ attention: ["a"], working: 4, total: 5 })), undefined);
  assert.equal(restingMotion(context({ attention: ["a"], total: 1 })), undefined);
  assert.equal(restingMotion(context({ working: 4, total: 4 })), undefined);
  assert.equal(restingMotion(context({ complete: 2, total: 2 })), undefined);
});

test("a run still going holds the face in the conversation wait's own hop", () => {
  // The same success hop, on repeat, that the Conversation tab's wait plays.
  assert.equal(restingMotion(context({ thinking: true })), FACE_MOTION.SUCCESS);
  // Speech outranks it: a spoken exchange already reads on the face turn by
  // turn, and the wait resumes when the turn ends.
  assert.equal(
    restingMotion(context({ thinking: true, microphoneLive: true })),
    FACE_MOTION.LISTENING,
  );
  assert.equal(restingMotion(context({ thinking: true, speaking: true })), FACE_MOTION.TALKING);
  // It outranks the sleeps: a meeting holds announcements, never the
  // developer's own ask, and an empty roster says nothing about a run.
  assert.equal(
    restingMotion(context({ thinking: true, announcementsHeld: true })),
    FACE_MOTION.SUCCESS,
  );
  assert.equal(restingMotion(context({ thinking: true, total: 0 })), FACE_MOTION.SUCCESS);
});

test("the wait's dots stand beside a drawn face whenever a run is going", () => {
  assert.equal(thinkingDotsShown(context({ thinking: true }), true), true);
  // No run, no dots — the hop alone is a completion's one-shot gesture.
  assert.equal(thinkingDotsShown(context(), true), false);
  // The exchange has the face and the wait still has the dots: a run under a
  // held talk key is the case the panel otherwise reported not at all.
  assert.equal(thinkingDotsShown(context({ thinking: true, microphoneLive: true }), true), true);
  assert.equal(thinkingDotsShown(context({ thinking: true, speaking: true }), true), true);
  assert.equal(
    thinkingDotsShown(context({ thinking: true, speaking: true, microphoneLive: true }), true),
    true,
  );
  // The listening face without a run of its own still draws none.
  assert.equal(thinkingDotsShown(context({ microphoneLive: true }), true), false);
  // The gate displaced the face; dots without one would be orphaned.
  assert.equal(thinkingDotsShown(context({ thinking: true }), false), false);
  assert.equal(thinkingDotsShown(context({ thinking: true, microphoneLive: true }), false), false);
});

test("the fidget answers a session that has just started asking", () => {
  const asking = observed(["a"]);
  assert.equal(noticedMotion(asking, observed(["a", "b"])), FACE_MOTION.WAITING);
  // The same session still asking is not news, however long it goes on asking.
  assert.equal(noticedMotion(asking, observed(["a"])), undefined);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
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

test("a meeting the calendar is holding through puts the face to sleep", () => {
  // The one visual report the quiet makes — and it holds whatever the
  // sessions are doing, because the sessions are exactly what is being held.
  assert.equal(
    restingMotion(context({ announcementsHeld: true, attention: ["a"], working: 3, total: 5 })),
    FACE_MOTION.SLEEPING,
  );
  // A developer who opens a turn mid-meeting is still talking to a face.
  assert.equal(
    restingMotion(context({ announcementsHeld: true, speaking: true })),
    FACE_MOTION.TALKING,
  );
  assert.equal(
    restingMotion(context({ announcementsHeld: true, microphoneLive: true })),
    FACE_MOTION.LISTENING,
  );
});

test("a roster not yet read holds the face awake rather than asleep", () => {
  // At launch the zero is the reading's absence, not an empty desk: the face
  // waits still until the first roster lands, and only a settled zero sleeps.
  assert.equal(restingMotion(context({ settled: false })), undefined);
  assert.equal(restingMotion(context()), FACE_MOTION.SLEEPING);
  // The meeting's sleep reports the calendar's hold, not the roster, so it
  // does not wait for one; and speech is speech whatever has been read.
  assert.equal(
    restingMotion(context({ settled: false, announcementsHeld: true })),
    FACE_MOTION.SLEEPING,
  );
  assert.equal(restingMotion(context({ settled: false, speaking: true })), FACE_MOTION.TALKING);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("only what stays true for as long as it holds may hold the face", () => {
  // Nothing to watch at all, which is a different thing from nothing happening.
  assert.equal(restingMotion(context()), FACE_MOTION.SLEEPING);
  // The three rests are the whole of what repeats, so they are the whole of what
  // the artwork is allowed to loop.
  const rests: readonly FaceMotion[] = [
    FACE_MOTION.TALKING,
    FACE_MOTION.LISTENING,
    FACE_MOTION.SLEEPING,
  ];
  for (const pool of [asidePool(true), asidePool(false)]) {
    for (const aside of pool) {
      assert.ok(!rests.includes(aside.motion), `${aside.motion} is a rest and cannot be a gesture`);
    }
  }
});

/**
 * Every motion that says something about the world: the three rests, the three
 * moments, and the sway that means work. Nothing fired by a mere timer or a
 * passing hand may play one, or the face is lying about the sessions.
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

test("a gesture says nothing a rest or a moment already says", () => {
  // A gesture arrives because a timer fired, so one that carried meaning would
  // be a lie: Luke must not look like a session just started asking, finished,
  // or turned up, and he must not look like he is listening to a closed
  // microphone. The sway is the exception that proves the rule — it means work
  // is happening, so it is only offered while work is happening.
  for (const aside of asidePool(false)) {
    assert.ok(!SPOKEN.includes(aside.motion), `${aside.motion} carries meaning and cannot be idle`);
  }
  const working = asidePool(true).map((aside) => aside.motion);
  assert.ok(working.includes(FACE_MOTION.MONITORING));
  assert.deepEqual(
    working.filter((motion) => motion !== FACE_MOTION.MONITORING),
    asidePool(false).map((aside) => aside.motion),
  );
});

test("a moment is sampled by weight, and the smallest gesture is most of the pool", () => {
  const idle = asidePool(false);
  const weight = idle.reduce((sum, aside) => sum + aside.weight, 0);
  // A roll walks the pool in order, so each boundary is exactly a weight — read
  // off the pool rather than written down, or the test only proves itself.
  const blink = (idle[0]?.weight ?? 0) / weight;
  assert.equal(chooseAside(idle, 0), FACE_MOTION.IDLE);
  assert.equal(chooseAside(idle, blink - 0.001), FACE_MOTION.IDLE);
  assert.equal(chooseAside(idle, blink + 0.001), FACE_MOTION.WINK);
  assert.equal(chooseAside(idle, 0.999), FACE_MOTION.HIDING);
  // The blink is half of every pool, and the duck is a rarity in both.
  for (const pool of [idle, asidePool(true)]) {
    const total = pool.reduce((sum, aside) => sum + aside.weight, 0);
    const share = (motion: (typeof pool)[number]["motion"]) =>
      (pool.find((aside) => aside.motion === motion)?.weight ?? 0) / total;
    assert.ok(share(FACE_MOTION.IDLE) > 0.35, "the blink has to be the usual moment");
    assert.ok(share(FACE_MOTION.HIDING) < 0.02, "ducking out of frame has to stay a surprise");
    // Every weight is a real share, or the pool is lying about its own odds.
    for (const aside of pool) assert.ok(aside.weight > 0, `${aside.motion} can never be chosen`);
  }
});

test("a hover earns a trick, and the trick says nothing about the sessions", () => {
  // A hand crosses the strip whenever it likes, so nothing a hover plays may
  // mean anything — not a rest, not a moment, not the sway that means work.
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

test("the sway is offered only while there is work for it to mean", () => {
  const working = asidePool(true);
  const sway = working.filter((aside) => aside.motion === FACE_MOTION.MONITORING);
  assert.equal(sway.length, 1);
  assert.equal(chooseAside(working, 0.999), FACE_MOTION.MONITORING);
  assert.equal(
    asidePool(false).some((aside) => aside.motion === FACE_MOTION.MONITORING),
    false,
  );
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
  assert.deepEqual(speechFaceInputs({ listening: true, lukeSpeaking: true }), {
    speaking: true,
    microphoneLive: true,
  });
  assert.deepEqual(speechFaceInputs({ listening: false, lukeSpeaking: false }), {
    speaking: false,
    microphoneLive: false,
  });
});

test("the speakers drive the resting motion the face plays", () => {
  const sessions = {
    settled: true,
    attention: ["session-a"],
    working: 2,
    complete: 0,
    total: 3,
    thinking: false,
    announcementsHeld: false,
  };

  // Waiting sessions do not outrank a conversation in progress.
  assert.equal(
    restingMotion({ ...sessions, ...speechFaceInputs({ listening: false, lukeSpeaking: true }) }),
    FACE_MOTION.TALKING,
  );
  assert.equal(
    restingMotion({ ...sessions, ...speechFaceInputs({ listening: true, lukeSpeaking: false }) }),
    FACE_MOTION.LISTENING,
  );
  // Both heard at once: Luke's own voice is what his face shows, and the
  // developer's is answered on the other wing.
  assert.equal(
    restingMotion({ ...sessions, ...speechFaceInputs({ listening: true, lukeSpeaking: true }) }),
    FACE_MOTION.TALKING,
  );
});
