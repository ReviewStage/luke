import assert from "node:assert/strict";
import { EXCESS_KEYS, type UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Result } from "effect";
import { test } from "vitest";
import { liveCreateAnswerSchema } from "./session.js";

function parseLiveCreateAnswer(value: UnparsedWireValue) {
  return Result.getOrUndefined(
    readEither(liveCreateAnswerSchema, { excess: EXCESS_KEYS.DROP })(value),
  );
}

test("the creation answer is read for its id and SDP, ignoring what else the service adds", () => {
  const answer = parseLiveCreateAnswer({
    session: { id: "live_123", status: "active" },
    transport: { type: "webrtc", sdp: "v=0\r\na=answer\r\n", extra: true },
  });

  assert.deepEqual(answer, {
    session: { id: "live_123" },
    transport: { type: "webrtc", sdp: "v=0\r\na=answer\r\n" },
  });
});
