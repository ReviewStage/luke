import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import {
  createAgent,
  readAgentRouting,
  readRunnerTokenConversation,
} from "../../models/agent-store.js";
import { createTask } from "../../models/task-store.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import {
  getTestDB,
  laterRenames,
  migrationStatements,
  openWorkspace,
  syncCaptureTakenOff,
} from "../../testing/index.js";
import { user } from "../auth.js";

const MIGRATION = "20261021143346_coding_agent_runner_token_hash";

const UNDO = [
  `ALTER TABLE "conversations" ADD COLUMN "runner_token_hash" text`,
  `DROP INDEX "coding_agent_runner_token_hash"`,
  `ALTER TABLE "coding_agent" DROP COLUMN "runner_token_hash"`,
];

const agentHolding = () =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Dean", email: `${userId}@app.test` });
    const organizationId = yield* openWorkspace(userId);
    const task = yield* createTask(userId, { organizationId, name: "Teammate invitations" });
    const agent = Option.getOrThrow(
      yield* createAgent(userId, {
        taskId: task.id,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: null,
        descriptionSnapshot: "# Teammate invitations\n",
        prompt: null,
        runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      }),
    ).agent;
    return { userId, agentId: agent.id, conversationId: agent.conversationId };
  });

it.layer(getTestDB())("coding_agent_runner_token_hash over a database from before it", (it) => {
  it.effect(
    "a digest its conversation held is the agent's, found through the agent, and one that held none stays none; run twice it changes nothing",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const digest = randomUUID();
        const holding = yield* agentHolding();
        const bare = yield* agentHolding();
        const agentTables = yield* laterRenames();
        for (const statement of [...syncCaptureTakenOff(), ...agentTables.back, ...UNDO]) {
          yield* sql.unsafe(statement);
        }
        yield* sql`UPDATE conversations SET runner_token_hash = ${digest} WHERE id = ${holding.conversationId}`;

        const migration = yield* migrationStatements(MIGRATION);
        for (const statement of migration) yield* sql.unsafe(statement);
        for (const statement of migration) yield* sql.unsafe(statement);
        for (const statement of agentTables.forward) yield* sql.unsafe(statement);

        const routing = (agent: { userId: string; agentId: string }) =>
          Effect.map(
            readAgentRouting(agent.userId, agent.agentId),
            (read) => Option.getOrThrow(read).runnerTokenHash,
          );
        assert.deepEqual([yield* routing(holding), yield* routing(bare)], [digest, null]);
        assert.deepEqual(Option.getOrThrow(yield* readRunnerTokenConversation(digest)), {
          userId: holding.userId,
          conversationId: holding.conversationId,
          runtimeSessionId: null,
        });
      }),
  );
});
