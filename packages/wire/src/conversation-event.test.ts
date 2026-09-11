import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  isSpeechEventKind,
  MESSAGE_RATING,
  maximumRatingNoteLength,
  RATING_EVENT_PAYLOAD,
} from "./conversation-event.js";
import { unparsedWire } from "./json.js";
import { SCHEMA_REFUSAL } from "./schema.js";

test("the speech kinds are every event kind but the rating", () => {
  const kinds: ConversationEventKind[] = Object.values(CONVERSATION_EVENT_KIND);
  assert.equal(kinds.length, 7);
  for (const kind of kinds) {
    assert.equal(isSpeechEventKind(kind), kind !== CONVERSATION_EVENT_KIND.RATING);
  }
});

test("a rating payload is a verdict with an optional bounded note, and nothing else", () => {
  assert.deepEqual(RATING_EVENT_PAYLOAD.parse({ rating: MESSAGE_RATING.DOWN, note: "too long" }), {
    rating: MESSAGE_RATING.DOWN,
    note: "too long",
  });
  assert.deepEqual(RATING_EVENT_PAYLOAD.parse({ rating: MESSAGE_RATING.UP }), {
    rating: MESSAGE_RATING.UP,
  });
  const refusalOf = (value: Parameters<typeof unparsedWire>[0]) => {
    const read = RATING_EVENT_PAYLOAD.read(unparsedWire(value));
    return read.ok ? "admitted" : [read.refusal, read.path];
  };
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
