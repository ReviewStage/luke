import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import {
  type AgentRunnerRecord,
  forgetAgentRunnerRecord,
  readAgentRunnerRecord,
  writeAgentRunnerRecord,
} from "../agent-runner-record.js";
import { createAgent } from "../agent-store.js";

/**
 * Where a cloud agent's runner stands in its session's sandbox, over a real
 * dialect: an account reads its own session's record and never another's,
 * and a forget naming a session's older sandbox leaves the record of the
 * sandbox that replaced it. Synthetic accounts throughout.
 */

const SESSION = "claude-code-0000019a5c3e-session";

/** An account of its own with an agent of its own. */
const openAgent = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const task = yield* startTask(userId, { name: "Invitations" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });
  return { userId, agentId: Option.getOrThrow(started).agent.id };
});

/** A runner running in the sandbox named, launched at event 7. */
const runningIn = (agentId: string, sandboxName: string): AgentRunnerRecord => ({
  agentId,
  sandboxName,
  firstSequence: 7,
  fingerprint: "launch-digest",
  sandboxSessionId: `sbs_${sandboxName}`,
  commandId: "cmd_1",
});

it.layer(getTestDB())("a cloud agent's runner record", (it) => {
  it.effect("an account reads its own session's record, and never another account's", () =>
    Effect.gen(function* () {
      const owner = yield* openAgent;
      const other = yield* openAgent;
      const record = runningIn(owner.agentId, "agent-sandbox-one");
      yield* writeAgentRunnerRecord(owner.userId, SESSION, record);

      assert.deepEqual(yield* readAgentRunnerRecord(owner.userId, SESSION), Option.some(record));
      assert.ok(Option.isNone(yield* readAgentRunnerRecord(other.userId, SESSION)));
    }),
  );

  it.effect("a forget naming a session's older sandbox leaves the newer sandbox's record", () =>
    Effect.gen(function* () {
      const { userId, agentId } = yield* openAgent;
      yield* writeAgentRunnerRecord(userId, SESSION, runningIn(agentId, "agent-sandbox-expired"));
      const fresh = runningIn(agentId, "agent-sandbox-fresh");
      yield* writeAgentRunnerRecord(userId, SESSION, fresh);

      yield* forgetAgentRunnerRecord(userId, SESSION, "agent-sandbox-expired");
      assert.deepEqual(yield* readAgentRunnerRecord(userId, SESSION), Option.some(fresh));

      yield* forgetAgentRunnerRecord(userId, SESSION, "agent-sandbox-fresh");
      assert.ok(Option.isNone(yield* readAgentRunnerRecord(userId, SESSION)));
    }),
  );
});
