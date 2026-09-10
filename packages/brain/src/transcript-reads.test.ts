import assert from "node:assert/strict";
import test from "node:test";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { OMISSION_MARKER } from "@sidecar/session";
import { ACTION_RESULT_STATUS, isWireString, unparsedWire, wireRecord } from "@sidecar/wire";
import {
  ABC,
  answered,
  call,
  FULL_TRANSCRIPT_CHARS,
  harness,
  itemsOfType,
  itemText,
  message,
  TRANSCRIPT_SECRET,
  tick,
  UNKNOWN,
} from "./harness.js";
import { BRAIN_INPUT_MARKER } from "./input-items.js";
import { BRAIN_TOOL } from "./tools.js";

/**
 * The one bounded read: a whole transcript through `read_transcript`, cut
 * from the front, and reached by nothing else — a tick turn opens with the
 * change records alone and sees no transcript it did not ask for.
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
  await h.agent.tick(tick(ABC));
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
  assert.ok(record.transcript.startsWith(OMISSION_MARKER));
  assert.ok(record.transcript.endsWith("END"));
  assert.ok(record.transcript.length <= FULL_TRANSCRIPT_CHARS);
  const refused = outputs.find((item) => item.call_id === "call_2");
  assert.ok(refused && isWireString(refused.output) && refused.output.includes("not an observed"));
});

test("a tick turn is shown the change records and no transcript until the model reads one", async () => {
  const h = harness();
  h.client.answers.push(
    answered([
      call("call_1", BRAIN_TOOL.READ_TRANSCRIPT, {
        provider_id: ABC.providerId,
        provider_session_id: ABC.providerSessionId,
      }),
    ]),
    answered([message("")]),
  );
  await h.agent.tick(tick(ABC));
  const opening = itemText(h.client.inputs[0]?.[0]);
  assert.ok(opening.startsWith(BRAIN_INPUT_MARKER.TICK));
  assert.ok(opening.includes('"provider_session_id":"abc"'));
  assert.ok(opening.includes('"transcript_chars_gained":120'));
  assert.ok(!JSON.stringify(h.client.inputs[0]).includes(TRANSCRIPT_SECRET));
  assert.deepEqual(h.wholeReads, [ABC]);
  assert.ok(JSON.stringify(h.client.inputs[1]).includes(TRANSCRIPT_SECRET));
});
