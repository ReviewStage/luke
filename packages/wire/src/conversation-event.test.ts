import assert from "node:assert/strict";
import { Either } from "effect";
import { test } from "vitest";
import {
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  isSpeechEventKind,
  MESSAGE_RATING,
  maximumRatingNoteLength,
  RATING_EVENT_PAYLOAD,
} from "./conversation-event.js";
import { readEither } from "./effect/json-schema.js";
import { unparsedWire } from "./json.js";
import { SCHEMA_REFUSAL } from "./schema-vocabulary.js";

test("the speech kinds are every event kind but the rating", () => {
  const kinds: ConversationEventKind[] = Object.values(CONVERSATION_EVENT_KIND);
  assert.equal(kinds.length, 7);
  for (const kind of kinds) {
    assert.equal(isSpeechEventKind(kind), kind !== CONVERSATION_EVENT_KIND.RATING);
  }
});

test("a rating payload is a verdict with an optional bounded note, and nothing else", () => {
  const read = readEither(RATING_EVENT_PAYLOAD);
  const parse = (value: Parameters<typeof unparsedWire>[0]) =>
    Either.getOrUndefined(read(unparsedWire(value)));
  assert.deepEqual(parse({ rating: MESSAGE_RATING.DOWN, note: "too long" }), {
    rating: MESSAGE_RATING.DOWN,
    note: "too long",
  });
  assert.deepEqual(parse({ rating: MESSAGE_RATING.UP }), {
    rating: MESSAGE_RATING.UP,
  });
  const refusalOf = (value: Parameters<typeof unparsedWire>[0]) =>
    Either.match(read(unparsedWire(value)), {
      onLeft: (refused) => [refused.refusal, refused.path],
      onRight: () => "admitted",
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
