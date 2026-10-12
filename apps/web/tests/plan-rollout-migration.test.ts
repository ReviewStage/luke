import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { readRevisionContent } from "../server/hosted/plan-revisions";
import { readPlan } from "../server/hosted/plan-store";
import { INVITATIONS_TEXT } from "./support/plan-documents";
import { cutRollout, INVITATIONS_ROLLOUT } from "./support/plan-rollouts";
import { testSqlClient } from "./support/sql-client";

/**
 * plan-rollout-migration.test.ts -- migration 0096 gives every plan and every revision an empty rollout beside its text.
 *
 * The database is migrated whole, the rollout's two columns dropped again so
 * it stands as it did before 0096, a plan and a revision written as raw rows
 * naming only the columns they had then, and the migration's statements run
 * over them. The plan and its revision then read through the store with an
 * empty rollout and their text as it stood. The migration adds nothing a
 * database already has, so a preview database that ran it under an earlier
 * number takes it again unchanged. Synthetic accounts and plans throughout.
 */

const MIGRATION_STATEMENTS = readFileSync(
  fileURLToPath(new URL("../drizzle/0096_plan_rollout.sql", import.meta.url)),
  "utf8",
)
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

/** The database as it stood before 0096: the plan and its revisions with no rollout column. */
const beforeRollout = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`alter table plan drop column rollout`;
  yield* sql`alter table plan_revision drop column rollout`;
});

const runMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of MIGRATION_STATEMENTS) yield* sql.unsafe(statement);
});

/** A plan and its first revision, each a raw row naming only the columns it had before 0096. */
const writtenBefore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const userId = `user-${randomUUID()}`;
  const planId = randomUUID();
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  yield* sql`
    insert into plan (id, user_id, name, document)
    values (${planId}, ${userId}, ${"Teammate invitations"}, ${INVITATIONS_TEXT})
  `;
  yield* sql`
    insert into plan_revision (plan_id, seq, actor, document, changes, started_at, at)
    values (${planId}, 1, 'notetaker', ${INVITATIONS_TEXT}, 1, now(), now())
  `;
  return { userId, planId };
});

it.layer(testSqlClient)("migration 0096 onto a rollout beside every plan", (it) => {
  it.effect(
    "a plan and its revision stored before the rollout read with an empty one, their text as it stood",
    () =>
      Effect.gen(function* () {
        yield* beforeRollout;
        const { userId, planId } = yield* writtenBefore;

        yield* runMigration;

        const stored = Option.getOrThrow(yield* readPlan(userId, planId));
        assert.deepEqual(stored.plan.rollout, []);
        assert.equal(stored.text, INVITATIONS_TEXT);
        assert.deepEqual(Option.getOrThrow(yield* readRevisionContent(userId, planId, 1)), {
          text: INVITATIONS_TEXT,
          rollout: [],
        });
      }),
  );

  it.effect(
    "running it again over a database that already has the rollout keeps every rollout as it stood",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* writtenBefore;
        yield* cutRollout(planId, INVITATIONS_ROLLOUT);

        yield* runMigration;

        assert.deepEqual(
          Option.getOrThrow(yield* readPlan(userId, planId)).plan.rollout,
          INVITATIONS_ROLLOUT,
        );
      }),
  );
});
