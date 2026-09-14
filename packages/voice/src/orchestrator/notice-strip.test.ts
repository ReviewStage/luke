import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { NoticeStrip, VOICE_ERROR_NOTICE_MS } from "./notice-strip.js";

/** Lets a fiber the strip forked on this test's runtime run what fell due, with no time passing. */
const settle = Effect.repeat(Effect.andThen(Effect.yieldNow, TestClock.adjust(Duration.zero)), {
  times: 5,
});

/** Advances the clock the strip's own bounds are forked against, then lets what fell due settle. */
function advance(delayMs: number): Effect.Effect<void> {
  return Effect.andThen(TestClock.adjust(Duration.millis(delayMs)), settle);
}

/** One strip under this test's own services, so its clocks are this test's `TestClock`. */
function strip(): Effect.Effect<{
  subject: NoticeStrip;
  changes: () => number;
}> {
  return Effect.map(Effect.context<never>(), (services) => {
    let changes = 0;
    const subject = new NoticeStrip({
      onChanged: () => {
        changes += 1;
      },
      fork: (effect) => Effect.runForkWith(services)(effect),
    });
    return { subject, changes: () => changes };
  });
}

it.effect("the strip takes no pointer, so time is what dismisses a fault", () =>
  Effect.gen(function* () {
    const { subject } = yield* strip();
    subject.showError("The talk key needs the microphone.");
    yield* advance(VOICE_ERROR_NOTICE_MS - 1);
    assert.equal(subject.error, "The talk key needs the microphone.");
    yield* advance(1);
    assert.equal(subject.error, undefined);
  }),
);

it.effect("a new message is a new thing to read, so it re-arms the clock", () =>
  Effect.gen(function* () {
    const { subject, changes } = yield* strip();
    subject.showError("First.");
    const afterFirst = changes();
    subject.showError("Second.");
    assert.equal(subject.error, "Second.");
    // The first message's clock was interrupted rather than left to fire.
    yield* advance(VOICE_ERROR_NOTICE_MS);
    assert.equal(subject.error, undefined);
    assert.equal(changes(), afterFirst + 2);
  }),
);

it.effect("the two lines share the strip but not each other's clock", () =>
  Effect.gen(function* () {
    const { subject } = yield* strip();
    subject.showError("A fault.");
    yield* advance(VOICE_ERROR_NOTICE_MS / 2);
    subject.showNotice("Temporarily unavailable.");
    // The error's clock, armed first, ends the error alone.
    yield* advance(VOICE_ERROR_NOTICE_MS / 2);
    assert.equal(subject.error, undefined);
    assert.equal(subject.notice, "Temporarily unavailable.");
  }),
);

it.effect("an exchange going live outranks whichever clock either line was on", () =>
  Effect.gen(function* () {
    const { subject, changes } = yield* strip();
    subject.showError("A fault.");
    subject.showNotice("Temporarily unavailable.");
    const beforeClear = changes();
    subject.clear();
    assert.equal(subject.error, undefined);
    assert.equal(subject.notice, undefined);
    assert.equal(changes(), beforeClear + 2);
    // Neither clock is left standing to fire and report a change nobody asked for.
    yield* advance(VOICE_ERROR_NOTICE_MS);
    assert.equal(changes(), beforeClear + 2);
  }),
);

it.effect("stop lets go of both clocks without clearing the words themselves", () =>
  Effect.gen(function* () {
    const { subject, changes } = yield* strip();
    subject.showError("A fault.");
    subject.showNotice("Temporarily unavailable.");
    const beforeStop = changes();
    subject.stop();
    assert.equal(subject.error, "A fault.");
    assert.equal(subject.notice, "Temporarily unavailable.");
    yield* advance(VOICE_ERROR_NOTICE_MS);
    assert.equal(subject.error, "A fault.");
    assert.equal(subject.notice, "Temporarily unavailable.");
    assert.equal(changes(), beforeStop);
  }),
);
