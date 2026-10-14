import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER } from "@sidecar/database/core/migrator";
import { Database } from "@sidecar/database/core/query";
import { createCodingAgent, readCodingAgent } from "@sidecar/database/models/coding-agent-store";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { ROLLOUT_ROLE } from "@sidecar/hosted/coding-agent-wire";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { startPlan } from "./support/workspaces";

/**
 * coding-agent-rollout-migration.test.ts -- the coding_agent_rollout migration gives every coding agent a rollout role, position, and base branch, all empty.
 *
 * The database is migrated whole, an agent started outside a rollout, and
 * the three columns dropped again so it stands as it did before the
 * migration; its statements then run over it. The agent then reads through
 * the store as one started outside a rollout. The migration adds nothing a
 * database already has, so a preview database that ran it under an earlier
 * name takes it again unchanged. Synthetic accounts, plans, and repositories
 * throughout.
 */

const MIGRATION = "20261014181134_coding_agent_rollout";

const MIGRATION_STATEMENTS = readFileSync(
  join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql"),
  "utf8",
)
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

/** The database as it stood before the migration: coding agents with no role, position, or base. */
const beforeRollout = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`alter table coding_agent drop column rollout_position`;
  yield* sql`alter table coding_agent drop column base_branch`;
  yield* sql`alter table coding_agent drop column rollout_role`;
});

const runMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of MIGRATION_STATEMENTS) yield* sql.unsafe(statement);
});

const openPlan = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const plan = yield* startPlan(userId, { name: "Teammate invitations" });
  return { userId, planId: plan.id };
});

/** An agent on the plan, started as one with no place in a rollout. */
const startAgent = (
  userId: string,
  planId: string,
  rollout: { role?: typeof ROLLOUT_ROLE.BUILDER; position?: number; baseBranch?: string } = {},
) =>
  Effect.map(
    createCodingAgent(userId, {
      planId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
      planSnapshot: "# Teammate invitations\n",
      task: null,
      ...rollout,
    }),
    (started) => Option.getOrThrow(started).agent.id,
  );

it.layer(getTestDB())(
  "the coding_agent_rollout migration onto a rollout position and base for every agent",
  (it) => {
    it.effect("an agent stored before the rollout reads as one started outside it", () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const agentId = yield* startAgent(userId, planId);
        yield* beforeRollout;

        yield* runMigration;

        const agent = Option.getOrThrow(yield* readCodingAgent(userId, agentId));
        assert.equal(agent.position, null);
        assert.equal(agent.baseBranch, null);
        assert.equal(agent.role, null);
      }),
    );

    it.effect(
      "running it again over a database that already has the columns keeps every builder's role, position, and base",
      () =>
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const agentId = yield* startAgent(userId, planId, {
            role: ROLLOUT_ROLE.BUILDER,
            position: 2,
            baseBranch: "luke/teammate-invitations/1-table",
          });

          yield* runMigration;

          const agent = Option.getOrThrow(yield* readCodingAgent(userId, agentId));
          assert.equal(agent.role, ROLLOUT_ROLE.BUILDER);
          assert.equal(agent.position, 2);
          assert.equal(agent.baseBranch, "luke/teammate-invitations/1-table");
        }),
    );
  },
);
