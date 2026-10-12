import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { createCodingAgent, readCodingAgent } from "../server/hosted/coding-agent-store";
import { createPlan } from "../server/hosted/plan-store";
import { testSqlClient } from "./support/sql-client";

/**
 * coding-agent-rollout-migration.test.ts -- migration 0097 gives every coding agent a rollout position and a base branch, both empty.
 *
 * The database is migrated whole, the two columns dropped again so it stands
 * as it did before 0097, an agent written as a raw row naming only the
 * columns it had then, and the migration's statements run over it. The agent
 * then reads through the store as one started outside a rollout. The
 * migration adds nothing a database already has, so a preview database that
 * ran it under an earlier number takes it again unchanged. Synthetic
 * accounts, plans, and repositories throughout.
 */

const MIGRATION_STATEMENTS = readFileSync(
  fileURLToPath(new URL("../drizzle/0097_coding_agent_rollout.sql", import.meta.url)),
  "utf8",
)
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

/** The database as it stood before 0097: coding agents with no position or base. */
const beforeRollout = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`alter table coding_agent drop column rollout_position`;
  yield* sql`alter table coding_agent drop column base_branch`;
});

const runMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of MIGRATION_STATEMENTS) yield* sql.unsafe(statement);
});

const openPlan = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const plan = yield* createPlan(userId, { name: "Teammate invitations" });
  return { userId, planId: plan.id };
});

/** An agent on the plan, a raw row naming only the columns it had before 0097. */
const writtenBefore = (userId: string, planId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const conversationId = randomUUID();
    const agentId = randomUUID();
    yield* sql`insert into conversations (id, user_id, kind) values (${conversationId}, ${userId}, ${CONVERSATION_KIND.CODING_AGENT})`;
    yield* sql`
      insert into coding_agent (id, plan_id, user_id, conversation_id, model, effort, plan_snapshot, repository, idempotency_key)
      values (${agentId}, ${planId}, ${userId}, ${conversationId}, ${"anthropic/claude-opus-5.5"}, ${"high"}, ${"# Teammate invitations\n"}, ${"acme/relay"}, ${randomUUID()})
    `;
    return agentId;
  });

it.layer(testSqlClient)("migration 0097 onto a rollout position and base for every agent", (it) => {
  it.effect("an agent stored before the rollout reads as one started outside it", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      yield* beforeRollout;
      const agentId = yield* writtenBefore(userId, planId);

      yield* runMigration;

      const agent = Option.getOrThrow(yield* readCodingAgent(userId, agentId));
      assert.equal(agent.position, null);
      assert.equal(agent.baseBranch, null);
    }),
  );

  it.effect(
    "running it again over a database that already has the columns keeps every worker's position and base",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const started = Option.getOrThrow(
          yield* createCodingAgent(userId, {
            planId,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "acme/relay",
            planSnapshot: "# Teammate invitations\n",
            task: null,
            position: 2,
            baseBranch: "luke/teammate-invitations/1-table",
          }),
        );

        yield* runMigration;

        const agent = Option.getOrThrow(yield* readCodingAgent(userId, started.agent.id));
        assert.equal(agent.position, 2);
        assert.equal(agent.baseBranch, "luke/teammate-invitations/1-table");
      }),
  );
});
