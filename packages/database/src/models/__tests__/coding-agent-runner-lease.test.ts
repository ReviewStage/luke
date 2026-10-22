import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, startTask } from "../../testing/index.js";
import {
  claimCodingAgentRunnerLease,
  releaseCodingAgentRunnerLease,
} from "../coding-agent-runner-lease.js";
import { createCodingAgent } from "../coding-agent-store.js";

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
  const started = yield* createCodingAgent(userId, {
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
            claimCodingAgentRunnerLease(agentId, first, NOW, HELD_UNTIL),
            claimCodingAgentRunnerLease(agentId, second, NOW, HELD_UNTIL),
          ],
          { concurrency: "unbounded" },
        );
        assert.deepEqual(claimed, [true, false]);

        yield* releaseCodingAgentRunnerLease(agentId, first);
        assert.equal(yield* claimCodingAgentRunnerLease(agentId, second, NOW, HELD_UNTIL), true);
      }),
  );

  it.effect("a lapsed lease is taken over, and its old holder's release leaves the new one's", () =>
    Effect.gen(function* () {
      const agentId = yield* openAgent;
      const [killed, next, third] = [randomUUID(), randomUUID(), randomUUID()];
      assert.equal(yield* claimCodingAgentRunnerLease(agentId, killed, NOW, HELD_UNTIL), true);

      assert.equal(
        yield* claimCodingAgentRunnerLease(agentId, next, HELD_UNTIL, LATER_UNTIL),
        true,
      );
      yield* releaseCodingAgentRunnerLease(agentId, killed);

      assert.equal(yield* claimCodingAgentRunnerLease(agentId, third, PAST_IT, LATER_UNTIL), false);
    }),
  );

  it.effect("one agent's lease holds no other agent's runner", () =>
    Effect.gen(function* () {
      const [one, other] = [yield* openAgent, yield* openAgent];

      assert.equal(yield* claimCodingAgentRunnerLease(one, randomUUID(), NOW, HELD_UNTIL), true);
      assert.equal(yield* claimCodingAgentRunnerLease(other, randomUUID(), NOW, HELD_UNTIL), true);
    }),
  );
});
