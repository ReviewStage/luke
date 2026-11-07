import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@repo/wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { turns } from "../../schemas/storage.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import {
  type AgentRunnerRecord,
  forgetAgentRunnerRecord,
  readAgentRunnerRecord,
  warmCloudAgentLaunches,
  writeAgentRunnerRecord,
} from "../agent-runner-record.js";
import { createAgent, recordAgentSeen } from "../agent-store.js";

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

/** An agent of its own whose runner record says it runs, in a session of its own, after one turn of the status and settle time given. */
const runningAfter = (
  status: TurnStatus,
  settledAt: Date | null,
  commandId: string | null = "cmd_1",
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const opened = yield* openAgent;
    const [agent] = yield* db
      .select({ conversationId: agentTable.conversationId })
      .from(agentTable)
      .where(eq(agentTable.id, opened.agentId));
    assert.ok(agent !== undefined);
    yield* db.insert(turns).values({
      userId: opened.userId,
      conversationId: agent.conversationId,
      origin: TURN_ORIGIN.TYPED,
      status,
      queuedAt: new Date(0),
      settledAt,
    });
    const sessionId = `claude-code-${randomUUID()}`;
    yield* writeAgentRunnerRecord(opened.userId, sessionId, {
      ...runningIn(opened.agentId, `agent-sandbox-${randomUUID()}`),
      commandId,
    });
    return { ...opened, sessionId };
  });

it.layer(getTestDB())("a cloud agent's runner record", (it) => {
  it.effect(
    "the warm cloud launches are the running runners whose turn ended and whose agent was last on screen before the bound and since the horizon, oldest use first, never one under way, seen since, cleared, or past the horizon",
    () =>
      Effect.gen(function* () {
        // Note that the clock is moved off the epoch first, which the read takes as never.
        yield* TestClock.adjust("1 day");
        const startedAt = yield* Clock.currentTimeMillis;
        const at = (minutes: number) => new Date(startedAt + minutes * 60_000);
        const SETTLED = TURN_STATUS.SETTLED;
        const ended = yield* runningAfter(SETTLED, at(0));
        const earlier = yield* runningAfter(SETTLED, at(-10));
        const seen = yield* runningAfter(SETTLED, at(-10));
        const underWay = yield* runningAfter(TURN_STATUS.RUNNING, null);
        const cleared = yield* runningAfter(SETTLED, at(0), null);
        const capped = yield* runningAfter(SETTLED, at(-100));
        yield* TestClock.adjust("8 minutes");
        assert.equal(yield* recordAgentSeen(seen.userId, seen.agentId), true);
        const ours = new Set(
          [ended, earlier, seen, underWay, cleared, capped].map((each) => each.agentId),
        );

        const read = (limit: number) =>
          warmCloudAgentLaunches({ since: at(-60), before: at(5), limit });
        const warm = (yield* read(10_000)).filter((each) => ours.has(each.agentId));
        const bounded = yield* read(1);

        assert.deepEqual(warm, [
          { userId: earlier.userId, agentId: earlier.agentId, sessionId: earlier.sessionId },
          { userId: ended.userId, agentId: ended.agentId, sessionId: ended.sessionId },
        ]);
        assert.equal(bounded.length, 1);
      }),
  );

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
