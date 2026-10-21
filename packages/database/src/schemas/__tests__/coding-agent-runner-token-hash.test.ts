import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import {
  createCodingAgent,
  readCodingAgentRouting,
  readRunnerTokenConversation,
} from "../../models/coding-agent-store.js";
import { createTask } from "../../models/task-store.js";
import { getTestDB, migrationStatements, openWorkspace } from "../../testing/index.js";
import { user } from "../auth.js";
import { conversations } from "../storage.js";

/**
 * The migration that moves a runner's bearer digest from its conversation's
 * row to its agent's: over a database from before it, a digest a runner
 * holds is found again through the agent, an agent whose conversation held
 * none stays without one, and running it twice changes nothing. Synthetic
 * accounts and digests throughout.
 */

const MIGRATION = "20261021143346_coding_agent_runner_token_hash";

/** The migration undone, so the database stands as one from before it. */
const UNDO = [
  `DROP INDEX "coding_agent_runner_token_hash"`,
  `ALTER TABLE "coding_agent" DROP COLUMN "runner_token_hash"`,
];

/** An account's coding agent, its conversation holding the digest given as one from before the migration held it. */
const agentHolding = (digest: string | null) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Dean", email: `${userId}@luke.test` });
    const organizationId = yield* openWorkspace(userId);
    const task = yield* createTask(userId, { organizationId, name: "Teammate invitations" });
    const agent = Option.getOrThrow(
      yield* createCodingAgent(userId, {
        taskId: task.id,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: null,
        planSnapshot: "# Teammate invitations\n",
        prompt: null,
      }),
    ).agent;
    yield* db
      .update(conversations)
      .set({ runnerTokenHash: digest })
      .where(eq(conversations.id, agent.conversationId));
    return { userId, agentId: agent.id, conversationId: agent.conversationId };
  });

it.layer(getTestDB())("coding_agent_runner_token_hash over a database from before it", (it) => {
  it.effect(
    "a digest its conversation held is the agent's, found through the agent, and one that held none stays none; run twice it changes nothing",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The agents are made by this build's code, then the column is taken away, as before the migration.
        const digest = randomUUID();
        const holding = yield* agentHolding(digest);
        const bare = yield* agentHolding(null);
        for (const statement of UNDO) yield* sql.unsafe(statement);

        const migration = yield* migrationStatements(MIGRATION);
        for (const statement of migration) yield* sql.unsafe(statement);
        for (const statement of migration) yield* sql.unsafe(statement);

        const routing = (agent: { userId: string; agentId: string }) =>
          Effect.map(
            readCodingAgentRouting(agent.userId, agent.agentId),
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
