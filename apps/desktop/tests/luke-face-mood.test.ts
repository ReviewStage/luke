import assert from "node:assert/strict";
import test from "node:test";
import {
  FACE_MOTION,
  FACE_MOTION_CYCLE_MS,
  FACE_MOTION_PARTS,
} from "../src/renderer/luke-face-art";
import {
  asidePool,
  chooseAside,
  type FaceContext,
  type FaceObservation,
  facePlay,
  faceYieldsToMeter,
  HOVER_ASIDES,
  noticedMotion,
  playedMotion,
  restingMotion,
  SPEECH_TURN,
  speechFaceInputs,
} from "../src/renderer/luke-face-mood";

function context(overrides: Partial<FaceContext> = {}): FaceContext {
  return {
    speaking: false,
    microphoneLive: false,
    meetingQuiet: false,
    voiceSpent: false,
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
    restingMotion(context({ meetingQuiet: true, attention: ["a"], working: 3, total: 5 })),
    FACE_MOTION.SLEEPING,
  );
  // A developer who opens a turn mid-meeting is still talking to a face.
  assert.equal(restingMotion(context({ meetingQuiet: true, speaking: true })), FACE_MOTION.TALKING);
  assert.equal(
    restingMotion(context({ meetingQuiet: true, microphoneLive: true })),
    FACE_MOTION.LISTENING,
  );
});

test("a spent voice hushes an awake face, and everything else outranks it", () => {
  // Spent voice with sessions still moving: watching continues, so the face
  // stays awake — hushed rather than asleep.
  assert.equal(
    restingMotion(context({ voiceSpent: true, attention: ["a"], working: 3, total: 5 })),
    FACE_MOTION.HUSHED,
  );
  // A meeting's hold and an empty roster each say more about this moment
  // than the meter does; speech says the most of all. Speech over a spent
  // meter can still happen — the day's last call keeps working after the
  // meter it was minted against reads zero.
  assert.equal(
    restingMotion(context({ voiceSpent: true, meetingQuiet: true, total: 2 })),
    FACE_MOTION.SLEEPING,
  );
  assert.equal(restingMotion(context({ voiceSpent: true })), FACE_MOTION.SLEEPING);
  assert.equal(
    restingMotion(context({ voiceSpent: true, speaking: true, total: 2 })),
    FACE_MOTION.TALKING,
  );
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("only what stays true for as long as it holds may hold the face", () => {
  // Nothing to watch at all, which is a different thing from nothing happening.
  assert.equal(restingMotion(context()), FACE_MOTION.SLEEPING);
  // The four rests are the whole of what repeats, so they are the whole of what
  // the artwork is allowed to loop.
  const rests = [
    FACE_MOTION.TALKING,
    FACE_MOTION.LISTENING,
    FACE_MOTION.SLEEPING,
    FACE_MOTION.HUSHED,
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
const SPOKEN = [
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

test("a rest takes the face back from a gesture at once, and keeps it", () => {
  // The rest can change under a gesture that is already playing, and the
  // microphone is what matters most: the capsule reports an open microphone
  // through the face's colour, and only these two motions carry it, so not even
  // a session asking for you may hold the face over one.
  for (const gesture of [...asidePool(true).map((aside) => aside.motion), FACE_MOTION.WAITING]) {
    assert.equal(playedMotion(FACE_MOTION.LISTENING, gesture), FACE_MOTION.LISTENING);
    assert.equal(playedMotion(FACE_MOTION.TALKING, gesture), FACE_MOTION.TALKING);
    // Asleep is a rest like the others: a sleeping face does not wink.
    assert.equal(playedMotion(FACE_MOTION.SLEEPING, gesture), FACE_MOTION.SLEEPING);
    // With nothing resting, the gesture is what there is.
    assert.equal(playedMotion(undefined, gesture), gesture);
  }
});

test("with neither a rest nor a gesture the face is still", () => {
  assert.equal(playedMotion(undefined, undefined), undefined);
  for (const resting of Object.values(FACE_MOTION)) {
    assert.equal(playedMotion(resting, undefined), resting);
  }
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

test("a gesture the rest is covering is not a play", () => {
  const gesture = { motion: FACE_MOTION.WAITING, play: 7 };
  // Nothing resting: the gesture is what is drawn, and it carries its own play
  // so that being asked for one motion twice plays it twice.
  assert.deepEqual(facePlay(undefined, gesture), {
    motion: FACE_MOTION.WAITING,
    repeat: false,
    play: 7,
  });
  // A rest on the face: the gesture is not being played, and counting it would
  // rebuild the drawing — restarting the rest's own loop — at a session the rest
  // is meant to be ignoring, and again a frame later when the rest dropped it.
  for (const resting of [
    FACE_MOTION.LISTENING,
    FACE_MOTION.TALKING,
    FACE_MOTION.SLEEPING,
    FACE_MOTION.HUSHED,
  ]) {
    assert.deepEqual(facePlay(resting, gesture), { motion: resting, repeat: true, play: 0 });
    assert.deepEqual(facePlay(resting, undefined), { motion: resting, repeat: true, play: 0 });
  }
  // Still: nothing drawn, nothing repeating, and one play for all of stillness.
  assert.deepEqual(facePlay(undefined, undefined), {
    motion: undefined,
    repeat: false,
    play: 0,
  });
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
  // A hushed face keeps its eyes — the state is the grayed-out ink, and the
  // one thing a spent allowance must not say is that Luke stopped watching.
  assert.equal(FACE_MOTION_PARTS[FACE_MOTION.HUSHED].lids, false);
});

const NO_METER = { hasAudioSignal: false, fixtureSpeaking: false, voiceActive: false };

test("the face follows whose turn it is, not the meter", () => {
  const meter = { hasAudioSignal: true, fixtureSpeaking: false, voiceActive: true };

  // The same bars draw both voices, so amplitude alone would have Luke talking
  // back at someone mid-sentence.
  assert.deepEqual(speechFaceInputs({ ...meter, turn: SPEECH_TURN.DEVELOPER }), {
    speaking: false,
    microphoneLive: true,
  });
  assert.deepEqual(speechFaceInputs({ ...meter, turn: SPEECH_TURN.LUKE }), {
    speaking: true,
    microphoneLive: false,
  });
});

test("without a turn to read, the meter is what there is", () => {
  // A microphone opened from Settings with no call behind it, and the fixture.
  assert.deepEqual(
    speechFaceInputs({ hasAudioSignal: true, fixtureSpeaking: false, voiceActive: true }),
    { speaking: true, microphoneLive: true },
  );
  assert.deepEqual(
    speechFaceInputs({ hasAudioSignal: true, fixtureSpeaking: true, voiceActive: false }),
    { speaking: true, microphoneLive: true },
  );
  // A closed microphone cannot still be carrying speech.
  assert.deepEqual(
    speechFaceInputs({ hasAudioSignal: false, fixtureSpeaking: false, voiceActive: true }),
    { speaking: false, microphoneLive: false },
  );
});

test("a turn drives the resting motion the face plays", () => {
  const sessions = { attention: 1, working: 2, complete: 0, total: 3 };

  // Waiting sessions do not outrank a conversation in progress.
  assert.equal(
    restingMotion({ ...sessions, ...speechFaceInputs({ ...NO_METER, turn: SPEECH_TURN.LUKE }) }),
    FACE_MOTION.TALKING,
  );
  assert.equal(
    restingMotion({
      ...sessions,
      ...speechFaceInputs({ ...NO_METER, turn: SPEECH_TURN.DEVELOPER }),
    }),
    FACE_MOTION.LISTENING,
  );
});

test("Luke steps aside only for your own voice, and only for a meter", () => {
  assert.equal(
    faceYieldsToMeter({ turn: SPEECH_TURN.DEVELOPER, hasAudioSignal: true }),
    true,
    "your turn is the one thing that displaces him",
  );
  // His own reply is his to show: the talking face is what says he is answering.
  assert.equal(faceYieldsToMeter({ turn: SPEECH_TURN.LUKE, hasAudioSignal: true }), false);
  assert.equal(faceYieldsToMeter({ hasAudioSignal: true }), false);
  // Standing aside for nothing would leave the capsule blank for the length of
  // a turn, which says less than either of them alone.
  assert.equal(faceYieldsToMeter({ turn: SPEECH_TURN.DEVELOPER, hasAudioSignal: false }), false);
});
