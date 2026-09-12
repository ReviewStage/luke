import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  type BrainRequestRecord,
} from "@sidecar/brain";
import { Effect } from "effect";
import { answerOf, brainHarness, heldModel } from "../testing/index.js";

/**
 * Polls `condition` across up to `rounds` batches of a hundred fiber yields
 * each, letting Effect's own scheduler interleave with pending Promises
 * rather than pumping `setImmediate` a fixed number of times.
 */
function waitFor(condition: () => boolean, rounds = 300): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      if (condition()) return;
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
    }
    assert.ok(condition(), "the condition did not hold in time");
  });
}

it.effect(
  "removing the capability under five outstanding runs leaves every run interrupted and marked, with no line written",
  () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(() => brainHarness());
      const client = heldModel();
      yield* Effect.promise(() => c.host.replace(() => c.build(client)));
      const agent = c.host.current();
      assert.ok(agent);
      const runIds = yield* Effect.promise(() => c.submitMany(5));
      yield* waitFor(() => (c.repository.state?.requests.length ?? 0) === 5);

      yield* Effect.promise(() => c.host.replace(() => undefined));
      yield* waitFor(
        () =>
          c.host.current() === undefined &&
          (c.repository.state?.requests.every(
            (r) => r.status === BRAIN_REQUEST_STATUS.INTERRUPTED,
          ) ??
            false),
      );
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
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "late" }],
            },
          ],
        }),
      );
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
      assert.equal(
        c.repository.state?.requests.every((r) => r.status === BRAIN_REQUEST_STATUS.INTERRUPTED),
        true,
      );
    }),
);

it.effect(
  "a successor replacing the agent under outstanding runs inherits every end marked, and owns the store alone",
  () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(() => brainHarness());
      const first = heldModel();
      yield* Effect.promise(() => c.host.replace(() => c.build(first)));
      const agent = c.host.current();
      assert.ok(agent);
      const runIds = yield* Effect.promise(() => c.submitMany(5));
      yield* waitFor(() => (c.repository.state?.requests.length ?? 0) === 5);
      const second = heldModel();
      yield* Effect.promise(() => c.host.replace(() => c.build(second)));
      yield* waitFor(
        () =>
          c.host.current() !== undefined &&
          c.host.current() !== agent &&
          runIds.every(
            (runId) =>
              c.host.current()?.request(runId)?.status === BRAIN_REQUEST_STATUS.INTERRUPTED,
          ),
      );
      const successor = c.host.current();
      assert.ok(successor && successor !== agent);
      for (const runId of runIds) {
        assert.equal(successor.request(runId)?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
        assert.ok(
          successor.request(runId)?.conversationRecordedAt !== undefined,
          `${runId} marked`,
        );
      }
      // The successor's own run proceeds and is the only writer.
      const result = yield* Effect.promise(() =>
        c.submit({
          submissionId: "fresh",
          question: "new ask",
          origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
        }),
      );
      assert.equal(result.outcome, "accepted");
      // The host reaches its first inference only after the run's own
      // bookkeeping, some of which still runs after the record already reads
      // running, so the release is retried every round rather than issued
      // once: a `release` before the model's own `respond()` has been called
      // finds nothing waiting and answers nobody.
      yield* Effect.gen(function* () {
        for (let round = 0; round < 300; round += 1) {
          second.release(
            answerOf({
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "done" }],
                },
              ],
            }),
          );
          if (
            c.repository.state?.requests.find((r) => r.question === "new ask")?.status ===
            BRAIN_REQUEST_STATUS.SUCCEEDED
          )
            return;
          for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
        }
        assert.fail("the successor's run never succeeded");
      });
      const fresh = c.repository.state?.requests.find((r) => r.question === "new ask");
      assert.equal(fresh?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      assert.equal(fresh?.text, "done");
      assert.ok(fresh?.conversationRecordedAt !== undefined);
      // The retired agent takes nothing more and writes nothing more: its store
      // lease passed to the successor with the handoff.
      assert.equal(
        (yield* Effect.promise(() =>
          agent.submitAsk({
            submissionId: "stale",
            question: "old ask",
            origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
          }),
        )).outcome,
        "rejected",
      );
      assert.equal(c.store.holdsLease(agent.lease), false);
      assert.equal(c.store.holdsLease(successor.lease), true);
    }),
);

it.effect(
  "a reset under outstanding runs discards them without publishing, and the successor starts clean",
  () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(() => brainHarness());
      const client = heldModel();
      yield* Effect.promise(() => c.host.replace(() => c.build(client)));
      const agent = c.host.current();
      assert.ok(agent);
      yield* Effect.promise(() => c.submitMany(3));
      yield* waitFor(() => (c.repository.state?.requests.length ?? 0) === 3);
      assert.equal(yield* Effect.promise(() => c.store.clear()), true);
      yield* waitFor(
        () => agent.requests().length === 0 && (c.repository.state?.requests.length ?? -1) === 0,
      );
      assert.deepEqual(agent.requests(), []);
      // The file holds the empty successor and the marker of the erasure alone.
      const stored = c.repository.state;
      assert.equal(stored?.requests.length, 0);
      assert.equal(stored?.reset?.generationId, "gen-1");
      yield* Effect.promise(() => c.host.replace(() => undefined));
      yield* waitFor(
        () => c.host.current() === undefined && (c.repository.state?.requests.length ?? -1) === 0,
      );
      assert.equal(c.repository.state?.requests.length, 0);
    }),
);
