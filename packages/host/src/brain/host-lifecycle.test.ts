import assert from "node:assert/strict";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  type BrainRequestRecord,
} from "@sidecar/brain";
import { test } from "vitest";
import { answerOf, brainHarness, drainMicrotasks, heldModel } from "../testing/index.js";

test("removing the capability under five outstanding runs leaves every run interrupted and marked, with no line written", async () => {
  const c = await brainHarness();
  const client = heldModel();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const runIds = await c.submitMany(5);
  await drainMicrotasks();

  await c.host.replace(() => undefined);
  await drainMicrotasks();
  assert.equal(c.host.current(), undefined);
  const stored = c.repository.state;
  assert.equal(stored?.requests.length, 5);
  for (const runId of runIds) {
    const kept: BrainRequestRecord | undefined = stored?.requests.find(
      (entry) => entry.runId === runId,
    );
    assert.equal(kept?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
    // The end is marked taken without a line: the transcript of what Luke
    // actually says is Conversation's record, never the brain's reply text.
    assert.ok(kept?.conversationRecordedAt !== undefined, `${runId} marked`);
    assert.equal(kept?.askRecordedAt, undefined);
  }
  assert.deepEqual(c.broadcasts.at(-1), []);
  // The old agent's late model answer changes nothing anyone can see.
  client.release(
    answerOf({
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "late" }] },
      ],
    }),
  );
  await drainMicrotasks();
  assert.equal(
    c.repository.state?.requests.every((r) => r.status === BRAIN_REQUEST_STATUS.INTERRUPTED),
    true,
  );
});

test("a successor replacing the agent under outstanding runs inherits every end marked, and owns the store alone", async () => {
  const c = await brainHarness();
  const first = heldModel();
  await c.host.replace(() => c.build(first));
  const agent = c.host.current();
  assert.ok(agent);
  const runIds = await c.submitMany(5);
  await drainMicrotasks();
  const second = heldModel();
  await c.host.replace(() => c.build(second));
  await drainMicrotasks();
  const successor = c.host.current();
  assert.ok(successor && successor !== agent);
  for (const runId of runIds) {
    assert.equal(successor.request(runId)?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
    assert.ok(successor.request(runId)?.conversationRecordedAt !== undefined, `${runId} marked`);
  }
  // The successor's own run proceeds and is the only writer.
  const result = await c.submit({
    submissionId: "fresh",
    question: "new ask",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.equal(result.outcome, "accepted");
  // The host reaches its first inference only after the run's own
  // bookkeeping; the answer is released once the model has been asked.
  await drainMicrotasks();
  second.release(
    answerOf({
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] },
      ],
    }),
  );
  await drainMicrotasks();
  const fresh = c.repository.state?.requests.find((r) => r.question === "new ask");
  assert.equal(fresh?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(fresh?.text, "done");
  assert.ok(fresh?.conversationRecordedAt !== undefined);
  // The retired agent takes nothing more and writes nothing more: its store
  // lease passed to the successor with the handoff.
  assert.equal(
    (
      await agent.submitAsk({
        submissionId: "stale",
        question: "old ask",
        origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
      })
    ).outcome,
    "rejected",
  );
  assert.equal(c.store.holdsLease(agent.lease), false);
  assert.equal(c.store.holdsLease(successor.lease), true);
});

test("a reset under outstanding runs discards them without publishing, and the successor starts clean", async () => {
  const c = await brainHarness();
  const client = heldModel();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  await c.submitMany(3);
  await drainMicrotasks();
  assert.equal(await c.store.clear(), true);
  await drainMicrotasks();
  assert.deepEqual(agent.requests(), []);
  // The file holds the empty successor and the marker of the erasure alone.
  const stored = c.repository.state;
  assert.equal(stored?.requests.length, 0);
  assert.equal(stored?.reset?.generationId, "gen-1");
  await c.host.replace(() => undefined);
  await drainMicrotasks();
  assert.equal(c.repository.state?.requests.length, 0);
});
