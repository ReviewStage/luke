import assert from "node:assert/strict";
import { EXCESS_KEYS, type UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Result, type Schema } from "effect";
import { test } from "vitest";
import {
  LIVE_SDP_MAX_CHARACTERS,
  voiceCreateLiveSessionParamsSchema,
  voiceCreateLiveSessionResultSchema,
} from "./protocol.js";

function parse<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Result.getOrUndefined(readEither(schema)(value));
}

/**
 * The same read for an answer, which drops a key a newer host added rather
 * than refusing the whole shape. The grain lives at the read now that a schema
 * cannot carry a parse option of its own, so an answer's tolerance is asserted
 * here exactly where the readers in the desktop ask for it.
 */
function parseAnswer<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));
}

test("a create request carries the offer and the plan it is about, and nothing else", () => {
  const offer = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";
  const taskId = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
  assert.deepEqual(parse(voiceCreateLiveSessionParamsSchema, { sdp: offer, taskId }), {
    sdp: offer,
    taskId,
  });
  assert.equal(parse(voiceCreateLiveSessionParamsSchema, {}), undefined);
  // Every call is about a plan: an offer about none is refused.
  assert.equal(parse(voiceCreateLiveSessionParamsSchema, { sdp: offer }), undefined);
  assert.equal(parse(voiceCreateLiveSessionParamsSchema, { sdp: "", taskId }), undefined);
  assert.equal(
    parse(voiceCreateLiveSessionParamsSchema, { sdp: offer, taskId, voice: "marin" }),
    undefined,
  );
  assert.equal(
    parse(voiceCreateLiveSessionParamsSchema, {
      sdp: "a".repeat(LIVE_SDP_MAX_CHARACTERS + 1),
      taskId,
    }),
    undefined,
  );
});

test("a create answer names the session and the SDP answer, tolerating what a newer host adds", () => {
  const answer = { sessionId: "sess_1", sdpAnswer: "v=0\r\n", quota: { remaining: 1 } };
  assert.deepEqual(parseAnswer(voiceCreateLiveSessionResultSchema, answer), {
    sessionId: "sess_1",
    sdpAnswer: "v=0\r\n",
  });
  // The store's id for the session's row rides the answer where the host has one, and is not owed.
  assert.deepEqual(
    parseAnswer(voiceCreateLiveSessionResultSchema, {
      ...answer,
      voiceSessionId: "vs_1",
    }),
    { sessionId: "sess_1", sdpAnswer: "v=0\r\n", voiceSessionId: "vs_1" },
  );
  assert.equal(
    parseAnswer(voiceCreateLiveSessionResultSchema, { ...answer, voiceSessionId: "" }),
    undefined,
  );
  assert.equal(parseAnswer(voiceCreateLiveSessionResultSchema, { sessionId: "sess_1" }), undefined);
  assert.equal(
    parseAnswer(voiceCreateLiveSessionResultSchema, { sdpAnswer: "v=0\r\n" }),
    undefined,
  );
});
