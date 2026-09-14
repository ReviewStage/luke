import assert from "node:assert/strict";
import { test } from "vitest";
import { APPEND_TOKEN_BOUND } from "./chunks.js";
import {
  type ArrivalSpeech,
  type BriefingSpeech,
  OBSERVED_VALUE_LENGTH,
  PROACTIVE_SPEECH_KIND,
  speechAppends,
  speechOpening,
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

test("every onboarding beat is one append under the bound, and none opens with an instruction", () => {
  for (const turn of [
    arrivalOf({}),
    arrivalOf({ sessionTitle: "Fix flaky checkout test", talkKeyLabel: "Right Option" }),
    { kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING, decidedAt: DECIDED_AT } as const,
  ]) {
    const appends = speechAppends(turn);
    assert.equal(appends.length, 1);
    assert.ok(estimatedTokens(appends[0] ?? "") <= APPEND_TOKEN_BOUND);
    assert.equal(speechOpening(turn), undefined);
  }
  assert.equal(speechOpening(briefingOf("News.")), undefined);
});

test("the launch greeting is an opening pair under the bound and no commentary of its own", () => {
  const turn = {
    kind: PROACTIVE_SPEECH_KIND.LAUNCH,
    firstName: "Ada",
    decidedAt: DECIDED_AT,
  } as const;
  const opening = speechOpening(turn);

  assert.deepEqual(speechAppends(turn), []);
  assert.ok(opening);
  assert.ok(estimatedTokens(opening.instruction) <= APPEND_TOKEN_BOUND);
  assert.ok(estimatedTokens(opening.cue) <= APPEND_TOKEN_BOUND);
});

test("the launch greeting's name is bounded, flattened, and unquoted before it enters the instruction", () => {
  const unnamed = speechOpening({ kind: PROACTIVE_SPEECH_KIND.LAUNCH, decidedAt: DECIDED_AT });
  const named = speechOpening({
    kind: PROACTIVE_SPEECH_KIND.LAUNCH,
    firstName: `"Ada\n${"a".repeat(OBSERVED_VALUE_LENGTH * 2)}`,
    decidedAt: DECIDED_AT,
  });
  const quotesOnly = speechOpening({
    kind: PROACTIVE_SPEECH_KIND.LAUNCH,
    firstName: '""',
    decidedAt: DECIDED_AT,
  });

  assert.ok(unnamed && named && quotesOnly);
  assert.equal(named.instruction.includes("\n"), false);
  assert.equal(named.instruction.split('"').length, unnamed.instruction.split('"').length);
  assert.ok(named.instruction.length - unnamed.instruction.length < OBSERVED_VALUE_LENGTH + 8);
  assert.ok(named.instruction.length > unnamed.instruction.length);
  assert.equal(quotesOnly.instruction, unnamed.instruction);
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
