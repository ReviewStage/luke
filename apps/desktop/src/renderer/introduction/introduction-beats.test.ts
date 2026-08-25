import assert from "node:assert/strict";
import test from "node:test";
import {
  INTRODUCTION_BEAT,
  INTRODUCTION_EVENT,
  type IntroductionBeat,
  nextIntroductionBeat,
} from "./introduction-beats";

test("the happy path walks every beat in order", () => {
  const walk = [
    [INTRODUCTION_EVENT.DARK_SETTLED, INTRODUCTION_BEAT.WAKE],
    [INTRODUCTION_EVENT.WAKE_DONE, INTRODUCTION_BEAT.HELLO],
    [INTRODUCTION_EVENT.LINES_DONE, INTRODUCTION_BEAT.DETECT],
    [INTRODUCTION_EVENT.LINES_DONE, INTRODUCTION_BEAT.FLIGHT],
    [INTRODUCTION_EVENT.FLIGHT_SETTLED, INTRODUCTION_BEAT.TOUR],
    [INTRODUCTION_EVENT.LINES_DONE, INTRODUCTION_BEAT.MICROPHONE],
    [INTRODUCTION_EVENT.MICROPHONE_GRANTED, INTRODUCTION_BEAT.PRACTICE],
    [INTRODUCTION_EVENT.PRACTICE_DONE, INTRODUCTION_BEAT.SIGN_OFF],
    [INTRODUCTION_EVENT.LINES_DONE, INTRODUCTION_BEAT.STAND_DOWN],
    [INTRODUCTION_EVENT.STOOD_DOWN, INTRODUCTION_BEAT.DONE],
  ] as const;
  let beat: IntroductionBeat = INTRODUCTION_BEAT.DARK;
  for (const [event, expected] of walk) {
    beat = nextIntroductionBeat(beat, event);
    assert.equal(beat, expected);
  }
});

test("a denied microphone walks past practice to the sign-off", () => {
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.MICROPHONE, INTRODUCTION_EVENT.MICROPHONE_DENIED_SAID),
    INTRODUCTION_BEAT.SIGN_OFF,
  );
});

test("an event a beat does not name leaves it standing", () => {
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.PRACTICE, INTRODUCTION_EVENT.LINES_DONE),
    INTRODUCTION_BEAT.PRACTICE,
  );
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.DARK, INTRODUCTION_EVENT.FLIGHT_SETTLED),
    INTRODUCTION_BEAT.DARK,
  );
});

test("a voice that failed before the flight glides; one that died after stands down", () => {
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.DARK, INTRODUCTION_EVENT.VOICE_FAILED),
    INTRODUCTION_BEAT.GLIDE,
  );
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.HELLO, INTRODUCTION_EVENT.VOICE_FAILED),
    INTRODUCTION_BEAT.GLIDE,
  );
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.DETECT, INTRODUCTION_EVENT.VOICE_FAILED),
    INTRODUCTION_BEAT.GLIDE,
  );
  // The glide lands where the flight lands and hands off from there.
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.GLIDE, INTRODUCTION_EVENT.FLIGHT_SETTLED),
    INTRODUCTION_BEAT.STAND_DOWN,
  );
  // The real signed-out gate needs no voice, so a failure past the flight
  // stands the panel down and hands the screen to it rather than replaying
  // the whole introduction.
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.FLIGHT, INTRODUCTION_EVENT.VOICE_FAILED),
    INTRODUCTION_BEAT.STAND_DOWN,
  );
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.TOUR, INTRODUCTION_EVENT.VOICE_FAILED),
    INTRODUCTION_BEAT.STAND_DOWN,
  );
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.SIGN_OFF, INTRODUCTION_EVENT.VOICE_FAILED),
    INTRODUCTION_BEAT.STAND_DOWN,
  );
});

test("the ending is terminal", () => {
  for (const event of Object.values(INTRODUCTION_EVENT)) {
    assert.equal(nextIntroductionBeat(INTRODUCTION_BEAT.DONE, event), INTRODUCTION_BEAT.DONE);
  }
});
