import assert from "node:assert/strict";
import { Result } from "effect";
import { test } from "vitest";
import {
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  isSpeechEventKind,
  MESSAGE_RATING,
  maximumRatingNoteLength,
  RATING_EVENT_PAYLOAD,
  RATING_WORD,
  STANDING_RATING,
  standingRating,
} from "./conversation-event.js";
import { readEither } from "./effect/json-schema.js";
import { unparsedWire } from "./json.js";
import { SCHEMA_REFUSAL } from "./schema-vocabulary.js";

test("the speech kinds are every event kind but the rating", () => {
  const kinds: ConversationEventKind[] = Object.values(CONVERSATION_EVENT_KIND);
  for (const kind of kinds) {
    assert.equal(isSpeechEventKind(kind), kind !== CONVERSATION_EVENT_KIND.RATING);
  }
});

test("a rating payload is a verdict with an optional bounded note, and nothing else", () => {
  const read = readEither(RATING_EVENT_PAYLOAD);
  const parse = (value: Parameters<typeof unparsedWire>[0]) =>
    Result.getOrUndefined(read(unparsedWire(value)));
  assert.deepEqual(parse({ rating: MESSAGE_RATING.DOWN, note: "too long" }), {
    rating: MESSAGE_RATING.DOWN,
    note: "too long",
  });
  assert.deepEqual(parse({ rating: MESSAGE_RATING.UP }), {
    rating: MESSAGE_RATING.UP,
  });
  const refusalOf = (value: Parameters<typeof unparsedWire>[0]) =>
    Result.match(read(unparsedWire(value)), {
      onFailure: (refused) => [refused.refusal, refused.path],
      onSuccess: () => "admitted",
    });
  assert.deepEqual(refusalOf({ rating: "sideways" }), [SCHEMA_REFUSAL.MALFORMED, ["rating"]]);
  assert.deepEqual(
    refusalOf({ rating: MESSAGE_RATING.UP, note: "n".repeat(maximumRatingNoteLength + 1) }),
    [SCHEMA_REFUSAL.TOO_LARGE, ["note"]],
  );
  assert.equal(
    refusalOf({ rating: MESSAGE_RATING.UP, note: "n".repeat(maximumRatingNoteLength) }),
    "admitted",
  );
  assert.deepEqual(refusalOf({ rating: MESSAGE_RATING.UP, turnId: "t" }), [
    SCHEMA_REFUSAL.MALFORMED,
    ["turnId"],
  ]);
});

test("a rating event may withdraw the verdict, and a withdrawal never stands on a message", () => {
  const parse = (value: Parameters<typeof unparsedWire>[0]) =>
    Result.getOrUndefined(readEither(RATING_EVENT_PAYLOAD)(unparsedWire(value)));
  assert.deepEqual(parse({ rating: RATING_WORD.WITHDRAWN }), { rating: RATING_WORD.WITHDRAWN });
  // The standing shape is the verdict's alone: a page or a view never carries the withdrawal.
  assert.equal(
    Result.isFailure(readEither(STANDING_RATING)(unparsedWire({ rating: RATING_WORD.WITHDRAWN }))),
    true,
  );
  assert.equal(standingRating({ rating: RATING_WORD.WITHDRAWN }), undefined);
  assert.equal(standingRating(undefined), undefined);
  assert.deepEqual(standingRating({ rating: MESSAGE_RATING.DOWN, note: "Too early." }), {
    rating: MESSAGE_RATING.DOWN,
    note: "Too early.",
  });
});
