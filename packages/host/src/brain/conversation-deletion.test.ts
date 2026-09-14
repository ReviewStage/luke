import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { CONVERSATION_DELETE_OUTCOME, deleteConversationFlow } from "./conversation-deletion.js";

const NOW = 1_800_000_000_000;

function harness(marks: boolean) {
  const calls: string[] = [];
  return Effect.gen(function* () {
    const marker = yield* Deferred.make<boolean>();
    const flow = deleteConversationFlow({
      now: () => NOW,
      fenceBrain: (deletedAt) => {
        calls.push(`fenceBrain:${deletedAt}`);
        return Effect.runPromise(Deferred.await(marker));
      },
      report: (message) => {
        calls.push(`report:${message}`);
      },
    });
    // Started on this stack, because what the first assertion is about is the
    // step the fence stands in: the flow must have reached its own await
    // before the harness answers.
    const running = yield* Effect.forkChild(flow, { startImmediately: true });
    yield* Effect.yieldNow;
    return { calls, release: Deferred.succeed(marker, marks), running };
  });
}

it.effect(
  "the fence runs before anything is awaited, and the deletion completes on the marker",
  () =>
    Effect.gen(function* () {
      const h = yield* harness(true);
      assert.deepEqual(h.calls, [`fenceBrain:${NOW}`]);
      yield* h.release;
      assert.equal(yield* Fiber.join(h.running), CONVERSATION_DELETE_OUTCOME.COMPLETE);
      assert.deepEqual(h.calls, [`fenceBrain:${NOW}`]);
    }),
);

it.effect("a marker that does not stand refuses the deletion with the fence standing", () =>
  Effect.gen(function* () {
    const h = yield* harness(false);
    yield* h.release;
    assert.equal(yield* Fiber.join(h.running), CONVERSATION_DELETE_OUTCOME.REFUSED);
    assert.deepEqual(h.calls, [
      `fenceBrain:${NOW}`,
      "report:Delete conversation incomplete: the brain's memory could not be marked erased",
    ]);
  }),
);
