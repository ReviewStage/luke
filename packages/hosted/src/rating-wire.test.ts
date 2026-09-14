import assert from "node:assert/strict";
import {
  EXCESS_KEYS,
  MESSAGE_RATING,
  SCHEMA_REFUSAL,
  type UnparsedWireValue,
  unparsedWire,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { type Schema as EffectSchema, Result } from "effect";
import { test } from "vitest";
import {
  hostedMessageRatingAnswerSchema,
  hostedMessageRatingRequestSchema,
} from "./rating-wire.js";

const DEVICE_ID = "6C1F2F14-9A0B-4C2D-8E3F-0A1B2C3D4E50";

/** A request read: a key the declaration does not name refuses it. */
function parse<S extends EffectSchema.ConstraintDecoder<unknown>>(
  schema: S,
  value: UnparsedWireValue,
): S["Type"] | undefined {
  return Result.getOrUndefined(readEither(schema)(value));
}

/** An answer read: a key a newer service added is dropped rather than refused. */
function parseAnswer<S extends EffectSchema.ConstraintDecoder<unknown>>(
  schema: S,
  value: UnparsedWireValue,
): S["Type"] | undefined {
  return Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));
}

function requestRefusal(value: Parameters<typeof unparsedWire>[0]) {
  return Result.match(readEither(hostedMessageRatingRequestSchema)(unparsedWire(value)), {
    onFailure: (refused) => [refused.refusal, refused.path],
    onSuccess: () => "admitted",
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
  assert.deepEqual(
    parseAnswer(hostedMessageRatingAnswerSchema, { id: "e-1", seq: 4, later: true }),
    {
      id: "e-1",
      seq: 4,
    },
  );
  assert.equal(
    Result.isFailure(
      readEither(hostedMessageRatingAnswerSchema, { excess: EXCESS_KEYS.DROP })(
        unparsedWire({ id: "e-1", seq: -1 }),
      ),
    ),
    true,
  );
});
