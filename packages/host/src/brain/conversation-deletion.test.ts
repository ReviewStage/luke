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
      fence: (deletedAt) => {
        calls.push(`fence:${deletedAt}`);
      },
      fenceBrain: (deletedAt) => {
        calls.push(`fenceBrain:${deletedAt}`);
        return Effect.runPromise(Deferred.await(marker));
      },
      erase: (deletedAt) => {
        calls.push(`erase:${deletedAt}`);
      },
      report: (message) => {
        calls.push(`report:${message}`);
      },
    });
    const running = yield* Effect.fork(flow);
    yield* Effect.yieldNow();
    return { calls, release: Deferred.succeed(marker, marks), running };
  });
}

it.effect("both fences run before anything is awaited, and the erasure follows the marker", () =>
  Effect.gen(function* () {
    const h = yield* harness(true);
    assert.deepEqual(h.calls, [`fence:${NOW}`, `fenceBrain:${NOW}`]);
    yield* h.release;
    assert.equal(yield* Fiber.join(h.running), CONVERSATION_DELETE_OUTCOME.COMPLETE);
    assert.deepEqual(h.calls, [`fence:${NOW}`, `fenceBrain:${NOW}`, `erase:${NOW}`]);
  }),
);

it.effect(
  "a marker that does not stand refuses the deletion with the fences standing and nothing erased",
  () =>
    Effect.gen(function* () {
      const h = yield* harness(false);
      yield* h.release;
      assert.equal(yield* Fiber.join(h.running), CONVERSATION_DELETE_OUTCOME.REFUSED);
      assert.deepEqual(h.calls, [
        `fence:${NOW}`,
        `fenceBrain:${NOW}`,
        "report:Delete conversation incomplete: the brain's memory could not be marked erased",
      ]);
    }),
);
