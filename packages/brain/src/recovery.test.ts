import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL } from "@sidecar/actions";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { checkpointFormatTag } from "@sidecar/runtime/vocabulary";
import { UNKNOWN_ACTION_STATUS } from "@sidecar/wire";
import { BRAIN_RECOVERY } from "./agent.js";
import { type BrainPersistedState, freshBrainState } from "./envelope.js";
import {
  ABC,
  answered,
  CHECKPOINT,
  call,
  edge,
  functionOutputs,
  gatedClient,
  harness,
  itemsOfType,
  itemText,
  message,
  NOW,
  settle,
  submit,
} from "./harness.js";
import { BRAIN_INPUT_MARKER } from "./input-items.js";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS, type BrainRequestRecord } from "./requests.js";
import type { ResponsesInputItem } from "./responses-api.js";
import { fakeBrainStateRepository } from "./testing.js";

/**
 * The recovery a request-scoped host asks for: a run the last host left
 * unfinished is picked up rather than interrupted, over the checkpoint it
 * left, and nothing journaled is performed twice.
 */

function userMessage(text: string) {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
    role: "user",
    content: [{ type: "input_text", text }],
  };
}

function record(overrides: Partial<BrainRequestRecord>): BrainRequestRecord {
  return {
    runId: "run-left",
    submissionId: "submission-left",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
    question: "send the checkout agent a nudge",
    status: BRAIN_REQUEST_STATUS.RUNNING,
    revision: 1,
    acceptedAt: NOW - 5_000,
    startedAt: NOW - 4_000,
    performedActions: 0,
    unknownActions: 0,
    ...overrides,
  };
}

/** The developer's words in a request: the user messages that are not the standing context rebuilt for every inference. */
function developerWords(items: readonly ResponsesInputItem[]): string[] {
  return itemsOfType(items, RESPONSES_INPUT_ITEM_TYPE.MESSAGE)
    .filter((item) => item.role === "user")
    .map(itemText)
    .filter((text) => !text.startsWith(BRAIN_INPUT_MARKER.STANDING_CONTEXT));
}

async function drained(h: ReturnType<typeof harness>): Promise<void> {
  await h.agent.ready();
  for (let round = 0; round < 50 && h.agent.busy(); round += 1) await settle();
}

const MESSAGE_CALL = call("call-left", REALTIME_TOOL.SEND_SESSION_MESSAGE, {
  provider_id: ABC.providerId,
  provider_session_id: ABC.providerSessionId,
  text: "run the tests",
});

/** A generation a host died in mid-action: the ask and the call on record, the call's result never written. */
function leftRunning(): BrainPersistedState {
  return {
    ...freshBrainState("gen-left", NOW - 10_000),
    checkpointFormat: checkpointFormatTag(CHECKPOINT),
    items: [userMessage("[developer ask] send the checkout agent a nudge"), MESSAGE_CALL],
    requests: [record({})],
    journal: [
      {
        runId: "run-left",
        callId: "call-left",
        name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
        argumentsJson: String(MESSAGE_CALL.arguments),
        startedAt: NOW - 3_000,
      },
    ],
  };
}

test("a resuming host continues a running run over its checkpoint and performs no journaled action again", async () => {
  const h = harness({ recovery: BRAIN_RECOVERY.RESUME }, fakeBrainStateRepository(leftRunning()));
  h.client.answers.push(answered([message("Nudged. The result of the earlier send was lost.")]));

  await drained(h);

  const settled = h.agent.request("run-left");
  assert.equal(settled?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(settled?.text, "Nudged. The result of the earlier send was lost.");
  // The journaled call's result was lost with the last host, so it counts as
  // unknown, is paired as such in what the model reads, and is never re-run.
  assert.equal(settled?.unknownActions, 1);
  assert.deepEqual(h.performed, []);
  assert.equal(h.client.inputs.length, 1);
  const outputs = functionOutputs(h.client.inputs[0] ?? []);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0]?.callId, "call-left");
  assert.ok(outputs[0]?.output.includes(UNKNOWN_ACTION_STATUS));
  // The model was asked again with no new words: the ask already stands in the context.
  assert.deepEqual(developerWords(h.client.inputs[0] ?? []), [
    "[developer ask] send the checkout agent a nudge",
  ]);
});

test("a resuming host re-admits a queued ask, and the default host still interrupts both", async () => {
  const queued = {
    ...freshBrainState("gen-queued", NOW - 10_000),
    requests: [
      record({ runId: "run-queued", status: BRAIN_REQUEST_STATUS.QUEUED, startedAt: undefined }),
    ],
  };
  const resuming = harness({ recovery: BRAIN_RECOVERY.RESUME }, fakeBrainStateRepository(queued));
  resuming.client.answers.push(answered([message("Here is the answer.")]));
  await drained(resuming);
  assert.equal(resuming.agent.request("run-queued")?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(resuming.agent.request("run-queued")?.text, "Here is the answer.");
  assert.equal(resuming.client.inputs.length, 1);

  const interrupting = harness({}, fakeBrainStateRepository(leftRunning()));
  await drained(interrupting);
  assert.equal(interrupting.agent.request("run-left")?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
  assert.equal(interrupting.client.inputs.length, 0);
});

test("a resuming host checkpoints an ask's opening words before the model reads them", async () => {
  const inner = harness().client;
  const gate = gatedClient(inner);
  const h = harness({ recovery: BRAIN_RECOVERY.RESUME, client: gate.client });
  inner.answers.push(answered([message("Done.")]));

  await submit(h, "what is the checkout agent doing?");
  await settle();

  // The model has not answered, and the checkpoint already carries the ask.
  assert.equal(inner.inputs.length, 0);
  const latest = h.persisted.at(-1);
  assert.ok(latest);
  const words = developerWords(latest.items);
  assert.equal(words.length, 1);
  assert.ok(words[0]?.includes("what is the checkout agent doing?"));
  assert.equal(latest.requests[0]?.status, BRAIN_REQUEST_STATUS.RUNNING);

  gate.open();
  for (let round = 0; round < 50 && h.agent.busy(); round += 1) await settle();
  assert.equal(h.agent.requests()[0]?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  // The runtime opened with no words of its own: the checkpointed ask is what it read.
  assert.equal(inner.inputs.length, 1);
  assert.equal(developerWords(inner.inputs[0] ?? []).length, 1);
});

test("observe captures the events and opens their turn at once, with no window to wait out", async () => {
  const h = harness({ recovery: BRAIN_RECOVERY.RESUME });
  h.client.answers.push(
    answered([call("announce-1", "announce", { briefing: "abc finished its work." })]),
    answered([message("")]),
  );

  await h.agent.observe([edge(ABC)]);

  assert.equal(h.client.inputs.length, 2);
  assert.deepEqual(
    h.deliveries.map((delivery) => delivery.briefing),
    ["abc finished its work."],
  );
  assert.equal(h.agent.pendingWakes(), 0);
  assert.deepEqual(h.clock.timers.size, 0);
});
