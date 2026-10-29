import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { claimAgentRunnerLease, releaseAgentRunnerLease } from "../agent-runner-lease.js";
import { createAgent } from "../agent-store.js";

/**
 * The lease a call holds on a native agent's runner, over a real dialect:
 * of two claims one holds it, a lapsed lease is taken over, a holder lets
 * go of its own lease alone, and one agent's lease holds no other agent's
 * runner. Synthetic accounts throughout.
 */

const NOW = new Date("2026-10-22T02:00:00Z");
const HELD_UNTIL = new Date("2026-10-22T02:05:00Z");
const PAST_IT = new Date("2026-10-22T02:05:01Z");
const LATER_UNTIL = new Date("2026-10-22T02:10:01Z");

const openAgent = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` }),
  );
  const task = yield* startTask(userId, { name: "Invitations" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
  });
  return Option.getOrThrow(started).agent.id;
});

it.layer(getTestDB())("a native agent's runner lease", (it) => {
  it.effect(
    "of two claims at once exactly one holds the lease, and the other takes it once let go",
    () =>
      Effect.gen(function* () {
        const agentId = yield* openAgent;
        const [first, second] = [randomUUID(), randomUUID()];

        const claimed = yield* Effect.all(
          [
            claimAgentRunnerLease(agentId, first, NOW, HELD_UNTIL),
            claimAgentRunnerLease(agentId, second, NOW, HELD_UNTIL),
          ],
          { concurrency: "unbounded" },
        );
        assert.deepEqual(claimed, [true, false]);

        yield* releaseAgentRunnerLease(agentId, first);
        assert.equal(yield* claimAgentRunnerLease(agentId, second, NOW, HELD_UNTIL), true);
      }),
  );

  it.effect("a lapsed lease is taken over, and its old holder's release leaves the new one's", () =>
    Effect.gen(function* () {
      const agentId = yield* openAgent;
      const [killed, next, third] = [randomUUID(), randomUUID(), randomUUID()];
      assert.equal(yield* claimAgentRunnerLease(agentId, killed, NOW, HELD_UNTIL), true);

      assert.equal(yield* claimAgentRunnerLease(agentId, next, HELD_UNTIL, LATER_UNTIL), true);
      yield* releaseAgentRunnerLease(agentId, killed);

      assert.equal(yield* claimAgentRunnerLease(agentId, third, PAST_IT, LATER_UNTIL), false);
    }),
  );

  it.effect("one agent's lease holds no other agent's runner", () =>
    Effect.gen(function* () {
      const [one, other] = [yield* openAgent, yield* openAgent];

      assert.equal(yield* claimAgentRunnerLease(one, randomUUID(), NOW, HELD_UNTIL), true);
      assert.equal(yield* claimAgentRunnerLease(other, randomUUID(), NOW, HELD_UNTIL), true);
    }),
  );
});
