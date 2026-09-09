import assert from "node:assert/strict";
import test from "node:test";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { OMISSION_MARKER } from "@sidecar/session";
import { ACT_RESULT_STATUS, isWireString, unparsedWire, wireRecord } from "@sidecar/wire";
import {
  ABC,
  answered,
  call,
  DELTA_PER_SESSION_CHARS,
  edge,
  FULL_TRANSCRIPT_CHARS,
  harness,
  itemsOfType,
  itemText,
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
      status: ACT_RESULT_STATUS.ACCEPTED,
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
  assert.equal(record.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(record.truncated, true);
  assert.ok(isWireString(record.transcript));
  assert.ok(record.transcript.startsWith(OMISSION_MARKER));
  assert.ok(record.transcript.endsWith("END"));
  assert.ok(record.transcript.length <= FULL_TRANSCRIPT_CHARS);
  const refused = outputs.find((item) => item.call_id === "call_2");
  assert.ok(refused && isWireString(refused.output) && refused.output.includes("not an observed"));
});

test("a delta longer than its bound is cut from the front and marked truncated", async () => {
  const h = harness({
    readTranscriptSince: async () => ({
      status: ACT_RESULT_STATUS.ACCEPTED,
      text: `${"y".repeat(DELTA_PER_SESSION_CHARS * 2)}TAIL`,
      truncated: false,
    }),
  });
  await h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  const wake = itemText(h.client.inputs[0]?.[0]);
  assert.ok(wake.includes(OMISSION_MARKER));
  assert.ok(wake.includes('"truncated":true'));
  assert.ok(wake.includes("TAIL"));
  assert.ok(!wake.includes("y".repeat(DELTA_PER_SESSION_CHARS + 1)));
  assert.deepEqual(h.persisted.at(-1)?.cursors, {});
});
