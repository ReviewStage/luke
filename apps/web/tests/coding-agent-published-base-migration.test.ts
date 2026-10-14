import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER } from "@sidecar/database/core/migrator";
import { Database } from "@sidecar/database/core/query";
import {
  createCodingAgent,
  listPublishedCodingAgents,
  recordCodingAgentPublished,
} from "@sidecar/database/models/coding-agent-store";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import {
  CHECK_SUMMARY,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { startPlan } from "./support/workspaces";

/**
 * coding-agent-published-base-migration.test.ts -- the coding_agent_published_base migration forgets every pull request an agent's row kept from before a read carried its base and merge.
 *
 * The row's `published` is GitHub's last answer, and the next read of what
 * the agent published writes it again whole, so a kept answer without a base
 * is dropped rather than given one GitHub never said. The database is
 * migrated whole, a kept answer written raw as a read before the migration wrote it,
 * and the migration's statements run over it; the agent then reads through
 * the store as one no read has found a pull request for. One written since
 * keeps it. Synthetic accounts, plans, and repositories throughout.
 */

const MIGRATION = "20261014181838_coding_agent_published_base";

const MIGRATION_STATEMENTS = readFileSync(
  join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql"),
  "utf8",
)
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

/** A pull request as a read answers it now, merged into main. */
const MERGED: CodingAgentPullRequest = {
  number: 41,
  title: "Teammate invitations",
  url: "https://github.com/acme/relay/pull/41",
  state: PULL_REQUEST_STATE.MERGED,
  checks: CHECK_SUMMARY.PASSING,
  base: "main",
  mergedSha: "9f3c2ab0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6",
  additions: 210,
  deletions: 14,
  changedFiles: 6,
};

const runMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of MIGRATION_STATEMENTS) yield* sql.unsafe(statement);
});

/** An agent started on a plan of a fresh account. */
const startedAgent = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const plan = yield* startPlan(userId, { name: "Teammate invitations" });
  const started = Option.getOrThrow(
    yield* createCodingAgent(userId, {
      planId: plan.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
      planSnapshot: "# Teammate invitations\n",
      task: null,
    }),
  );
  return { userId, planId: plan.id, agentId: started.agent.id };
});

const keptOf = (userId: string, planId: string) =>
  Effect.map(listPublishedCodingAgents(userId, [planId]), ([agent]) => agent?.published);

it.layer(getTestDB())(
  "the coding_agent_published_base migration onto a pull request's base and merge",
  (it) => {
    it.effect("a pull request kept before the read carried its base reads as none kept", () =>
      Effect.gen(function* () {
        const { userId, planId, agentId } = yield* startedAgent;
        const { base: _base, mergedSha: _mergedSha, ...before } = MERGED;
        const sql = yield* SqlClient.SqlClient;
        yield* sql`update coding_agent set published = ${JSON.stringify(before)}::jsonb where id = ${agentId}`;

        yield* runMigration;

        assert.equal(yield* keptOf(userId, planId), null);
      }),
    );

    it.effect("a pull request kept since keeps its base and merge commit", () =>
      Effect.gen(function* () {
        const { userId, planId, agentId } = yield* startedAgent;
        yield* recordCodingAgentPublished(userId, agentId, MERGED);

        yield* runMigration;

        assert.deepEqual(yield* keptOf(userId, planId), MERGED);
      }),
    );
  },
);
