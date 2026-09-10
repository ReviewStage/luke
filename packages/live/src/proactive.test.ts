import assert from "node:assert/strict";
import test from "node:test";
import { APPEND_TOKEN_BOUND } from "./chunks.js";
import {
  type ArrivalSpeech,
  type BriefingSpeech,
  OBSERVED_VALUE_LENGTH,
  PROACTIVE_SPEECH_KIND,
  speechAppends,
} from "./proactive.js";
import { estimatedTokens } from "./tokens.js";

const DECIDED_AT = 1_800_000_000_000;

function briefingOf(words: string): BriefingSpeech {
  return { kind: PROACTIVE_SPEECH_KIND.BRIEFING, briefing: words, decidedAt: DECIDED_AT };
}

function arrivalOf(fields: Omit<ArrivalSpeech, "kind" | "decidedAt">): ArrivalSpeech {
  return { kind: PROACTIVE_SPEECH_KIND.ARRIVAL, decidedAt: DECIDED_AT, ...fields };
}

test("a briefing's words become commentary chunks, whole and in order", () => {
  const words = "Claude Code on checkout-service is waiting: approve the migration?";

  assert.deepEqual(speechAppends(briefingOf(words)), [words]);
  assert.deepEqual(speechAppends(briefingOf("   ")), []);
});

test("a long briefing is several appends, each under the bound", () => {
  const sentence = "One more agent finished its task and is waiting for a review.";
  const appends = speechAppends(briefingOf(Array.from({ length: 120 }, () => sentence).join(" ")));

  assert.ok(appends.length > 1);
  for (const append of appends) assert.ok(estimatedTokens(append) <= APPEND_TOKEN_BOUND);
});

test("every beat is one append under the bound", () => {
  for (const turn of [
    arrivalOf({}),
    arrivalOf({ sessionTitle: "Fix flaky checkout test", talkKeyLabel: "Right Option" }),
    { kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING, decidedAt: DECIDED_AT } as const,
  ]) {
    const appends = speechAppends(turn);
    assert.equal(appends.length, 1);
    assert.ok(estimatedTokens(appends[0] ?? "") <= APPEND_TOKEN_BOUND);
  }
});

test("the arrival beat's observed values are bounded and flattened before they enter an append", () => {
  const title = `first line\nsecond line ${"t".repeat(OBSERVED_VALUE_LENGTH * 2)}`;
  const [withTitle] = speechAppends(arrivalOf({ sessionTitle: title }));
  const [withoutTitle] = speechAppends(arrivalOf({}));

  assert.ok(withTitle);
  assert.ok(withoutTitle);
  assert.equal(withTitle.includes("\n"), false);
  assert.ok(withTitle.length - withoutTitle.length < OBSERVED_VALUE_LENGTH + 80);
  assert.ok(withTitle.length > withoutTitle.length);
});

test("the arrival beat's suggestion follows whether the talk key would work", () => {
  const [typed] = speechAppends(arrivalOf({}));
  const [held] = speechAppends(arrivalOf({ talkKeyLabel: "Right Option" }));
  const [blankKey] = speechAppends(arrivalOf({ talkKeyLabel: "   " }));

  assert.notEqual(typed, held);
  assert.equal(blankKey, typed);
});
