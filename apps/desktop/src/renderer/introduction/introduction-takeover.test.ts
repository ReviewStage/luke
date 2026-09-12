import assert from "node:assert/strict";
import { test } from "vitest";
import {
  INTRODUCTION_BEAT,
  INTRODUCTION_EVENT,
  type IntroductionBeat,
  nextIntroductionBeat,
} from "./introduction-takeover";

function walk(from: IntroductionBeat, steps: readonly (readonly [string, IntroductionBeat])[]) {
  let beat = from;
  for (const [event, expected] of steps) {
    // SAFETY: the table's own event vocabulary, spelled by the test.
    beat = nextIntroductionBeat(beat, event as never);
    assert.equal(beat, expected);
  }
  return beat;
}

const SESSION_BEATS: readonly IntroductionBeat[] = [
  INTRODUCTION_BEAT.CONNECT,
  INTRODUCTION_BEAT.GREETING,
];

test("the happy path asks for the microphone, flies, greets, and stands down on the quiet", () => {
  walk(INTRODUCTION_BEAT.DARK, [
    [INTRODUCTION_EVENT.DARK_SETTLED, INTRODUCTION_BEAT.WAKE],
    [INTRODUCTION_EVENT.WAKE_DONE, INTRODUCTION_BEAT.MICROPHONE],
    [INTRODUCTION_EVENT.MICROPHONE_PRESSED, INTRODUCTION_BEAT.MICROPHONE_DIALOG],
    [INTRODUCTION_EVENT.MICROPHONE_GRANTED, INTRODUCTION_BEAT.FLIGHT],
    [INTRODUCTION_EVENT.FLIGHT_SETTLED, INTRODUCTION_BEAT.CONNECT],
    [INTRODUCTION_EVENT.SESSION_STARTED, INTRODUCTION_BEAT.GREETING],
    [INTRODUCTION_EVENT.OUTPUT_QUIET, INTRODUCTION_BEAT.STAND_DOWN],
    [INTRODUCTION_EVENT.STOOD_DOWN, INTRODUCTION_BEAT.DONE],
  ]);
});

test("the greeting is scripted: it leaves only for the stand-down, on the quiet or the ceiling", () => {
  const exits = new Map<string, IntroductionBeat>();
  for (const event of Object.values(INTRODUCTION_EVENT)) {
    const next = nextIntroductionBeat(INTRODUCTION_BEAT.GREETING, event);
    if (next !== INTRODUCTION_BEAT.GREETING) exits.set(event, next);
  }
  assert.deepEqual(
    exits,
    new Map<string, IntroductionBeat>([
      [INTRODUCTION_EVENT.OUTPUT_QUIET, INTRODUCTION_BEAT.STAND_DOWN],
      [INTRODUCTION_EVENT.GREETING_CEILING, INTRODUCTION_BEAT.STAND_DOWN],
      [INTRODUCTION_EVENT.VOICE_FAILED, INTRODUCTION_BEAT.STAND_DOWN],
    ]),
  );
});

test("no session beat is reachable until the microphone has been answered", () => {
  const beats = Object.values(INTRODUCTION_BEAT);
  const beforeAnswer: readonly IntroductionBeat[] = [
    INTRODUCTION_BEAT.DARK,
    INTRODUCTION_BEAT.WAKE,
    INTRODUCTION_BEAT.MICROPHONE,
    INTRODUCTION_BEAT.MICROPHONE_DIALOG,
  ];
  for (const beat of beforeAnswer) {
    for (const event of Object.values(INTRODUCTION_EVENT)) {
      const next = nextIntroductionBeat(beat, event);
      assert.equal(SESSION_BEATS.includes(next), false);
      assert.equal(beats.includes(next), true);
    }
  }
});

test("the microphone's answer decides nothing of the greeting: granted or refused, Luke flies on", () => {
  for (const beat of [INTRODUCTION_BEAT.MICROPHONE, INTRODUCTION_BEAT.MICROPHONE_DIALOG]) {
    assert.equal(
      nextIntroductionBeat(beat, INTRODUCTION_EVENT.MICROPHONE_GRANTED),
      INTRODUCTION_BEAT.FLIGHT,
    );
    assert.equal(
      nextIntroductionBeat(beat, INTRODUCTION_EVENT.MICROPHONE_DENIED),
      INTRODUCTION_BEAT.FLIGHT,
    );
  }
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.MICROPHONE, INTRODUCTION_EVENT.MICROPHONE_PRESSED),
    INTRODUCTION_BEAT.MICROPHONE_DIALOG,
  );
});

test("every beat with a session standing leaves on some event other than the voice failing", () => {
  // The trap this guards against: a beat whose only exit waits on the model.
  for (const beat of SESSION_BEATS) {
    const exits = Object.values(INTRODUCTION_EVENT).filter(
      (event) =>
        event !== INTRODUCTION_EVENT.VOICE_FAILED && nextIntroductionBeat(beat, event) !== beat,
    );
    assert.ok(exits.length >= 1, beat);
  }
});

test("an event a beat does not name leaves it standing", () => {
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.GREETING, INTRODUCTION_EVENT.SESSION_STARTED),
    INTRODUCTION_BEAT.GREETING,
  );
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.DARK, INTRODUCTION_EVENT.FLIGHT_SETTLED),
    INTRODUCTION_BEAT.DARK,
  );
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.CONNECT, INTRODUCTION_EVENT.OUTPUT_QUIET),
    INTRODUCTION_BEAT.CONNECT,
  );
  assert.equal(
    nextIntroductionBeat(INTRODUCTION_BEAT.CONNECT, INTRODUCTION_EVENT.GREETING_CEILING),
    INTRODUCTION_BEAT.CONNECT,
  );
});

test("a voice that failed before the flight glides; one that died after stands down", () => {
  for (const beat of [
    INTRODUCTION_BEAT.DARK,
    INTRODUCTION_BEAT.WAKE,
    INTRODUCTION_BEAT.MICROPHONE,
    INTRODUCTION_BEAT.MICROPHONE_DIALOG,
  ]) {
    assert.equal(
      nextIntroductionBeat(beat, INTRODUCTION_EVENT.VOICE_FAILED),
      INTRODUCTION_BEAT.GLIDE,
    );
  }
  walk(INTRODUCTION_BEAT.GLIDE, [
    [INTRODUCTION_EVENT.FLIGHT_SETTLED, INTRODUCTION_BEAT.STAND_DOWN],
    [INTRODUCTION_EVENT.STOOD_DOWN, INTRODUCTION_BEAT.DONE],
  ]);
  // The real signed-out gate needs no voice, so a failure past the flight
  // stands the capsule down and hands the screen to it rather than replaying
  // the whole introduction.
  for (const beat of [
    INTRODUCTION_BEAT.FLIGHT,
    INTRODUCTION_BEAT.CONNECT,
    INTRODUCTION_BEAT.GREETING,
    INTRODUCTION_BEAT.STAND_DOWN,
  ]) {
    assert.equal(
      nextIntroductionBeat(beat, INTRODUCTION_EVENT.VOICE_FAILED),
      INTRODUCTION_BEAT.STAND_DOWN,
    );
  }
});

test("the ending is terminal", () => {
  for (const event of Object.values(INTRODUCTION_EVENT)) {
    assert.equal(nextIntroductionBeat(INTRODUCTION_BEAT.DONE, event), INTRODUCTION_BEAT.DONE);
  }
});
