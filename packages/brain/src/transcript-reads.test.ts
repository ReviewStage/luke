import assert from "node:assert/strict";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { ACTION_RESULT_STATUS, isWireString, unparsedWire, wireRecord } from "@sidecar/wire";
import { test } from "vitest";
import {
  ABC,
  answered,
  call,
  DELTA_PER_SESSION_CHARS,
  edge,
  FULL_TRANSCRIPT_CHARS,
  harness,
  itemsOfType,
  message,
  NOW,
  UNKNOWN,
} from "./harness.js";
import { BRAIN_TOOL } from "./tools.js";

/**
 * The two bounded reads: a whole transcript at the developer's ask, cut from
 * the front, and a wake's delta from the capture cursor, cut and marked.
 */

test("read_transcript answers a bounded tail for an observed session and refuses the rest", async () => {
  const h = harness({
    readTranscript: async () => ({
      status: ACTION_RESULT_STATUS.ACCEPTED,
      transcript: `${"x".repeat(FULL_TRANSCRIPT_CHARS * 2)}END`,
    }),
  });
  h.client.answers.push(
    answered([
      call("call_1", BRAIN_TOOL.READ_TRANSCRIPT, {
        provider_id: ABC.providerId,
        provider_session_id: ABC.providerSessionId,
      }),
      call("call_2", BRAIN_TOOL.READ_TRANSCRIPT, {
        provider_id: UNKNOWN.providerId,
        provider_session_id: UNKNOWN.providerSessionId,
      }),
    ]),
    answered([message("")]),
  );
  await h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  const outputs = itemsOfType(
    h.client.inputs[1] ?? [],
    RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
  );
  const read = outputs.find((item) => item.call_id === "call_1");
  assert.ok(read && isWireString(read.output));
  const record = wireRecord(unparsedWire(JSON.parse(read.output)));
  assert.ok(record);
  assert.equal(record.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(record.truncated, true);
  assert.ok(isWireString(record.transcript));
  assert.ok(record.transcript.length <= FULL_TRANSCRIPT_CHARS);
});

test("a delta longer than its bound is cut from the front and marked truncated", async () => {
  const h = harness({
    readTranscriptSince: async () => ({
      status: ACTION_RESULT_STATUS.ACCEPTED,
      text: `${"y".repeat(DELTA_PER_SESSION_CHARS * 2)}TAIL`,
      truncated: false,
    }),
  });
  await h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  assert.deepEqual(h.persisted.at(-1)?.cursors, {});
});
