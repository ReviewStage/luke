import assert from "node:assert/strict";
import {
  MESSAGE_RATING,
  SCHEMA_REFUSAL,
  type UnparsedWireValue,
  unparsedWire,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { type Schema as EffectSchema, Either } from "effect";
import { test } from "vitest";
import {
  hostedMessageRatingAnswerSchema,
  hostedMessageRatingRequestSchema,
} from "./rating-wire.js";

const DEVICE_ID = "6C1F2F14-9A0B-4C2D-8E3F-0A1B2C3D4E50";

function parse<Value, Encoded>(
  schema: EffectSchema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Either.getOrUndefined(readEither(schema)(value));
}

function requestRefusal(value: Parameters<typeof unparsedWire>[0]) {
  return Either.match(readEither(hostedMessageRatingRequestSchema)(unparsedWire(value)), {
    onLeft: (refused) => [refused.refusal, refused.path],
    onRight: () => "admitted",
  });
}

test("a rating request is a verdict, an optional bounded note, and the device's id, case folded", () => {
  assert.deepEqual(
    parse(hostedMessageRatingRequestSchema, {
      rating: MESSAGE_RATING.DOWN,
      note: "It answered a different question.",
      deviceId: DEVICE_ID,
    }),
    {
      rating: MESSAGE_RATING.DOWN,
      note: "It answered a different question.",
      deviceId: DEVICE_ID.toLowerCase(),
    },
  );
  assert.deepEqual(
    parse(hostedMessageRatingRequestSchema, { rating: MESSAGE_RATING.UP, deviceId: DEVICE_ID }),
    { rating: MESSAGE_RATING.UP, deviceId: DEVICE_ID.toLowerCase() },
  );
});

test("a rating request refuses a malformed device, a missing one, and a key it did not name", () => {
  assert.deepEqual(requestRefusal({ rating: MESSAGE_RATING.UP, deviceId: "laptop" }), [
    SCHEMA_REFUSAL.MALFORMED,
    ["deviceId"],
  ]);
  assert.deepEqual(requestRefusal({ rating: MESSAGE_RATING.UP }), [
    SCHEMA_REFUSAL.MALFORMED,
    ["deviceId"],
  ]);
  assert.deepEqual(
    requestRefusal({ rating: MESSAGE_RATING.UP, deviceId: DEVICE_ID, messageId: "m" }),
    [SCHEMA_REFUSAL.MALFORMED, ["messageId"]],
  );
});

test("a rating answer carries the event's id and sequence, and ignores what a newer service adds", () => {
  assert.deepEqual(parse(hostedMessageRatingAnswerSchema, { id: "e-1", seq: 4, later: true }), {
    id: "e-1",
    seq: 4,
  });
  assert.equal(
    Either.isLeft(
      readEither(hostedMessageRatingAnswerSchema)(unparsedWire({ id: "e-1", seq: -1 })),
    ),
    true,
  );
});
