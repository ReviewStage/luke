import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER } from "@sidecar/database/core/migrator";
import { Database } from "@sidecar/database/core/query";
import { readRevisionContent } from "@sidecar/database/models/plan-revisions";
import { readPlan } from "@sidecar/database/models/plan-store";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { INVITATIONS_TEXT, makeDocumentPlan } from "./support/plan-documents";
import { cutRollout, INVITATIONS_ROLLOUT } from "./support/plan-rollouts";
import { startPlan } from "./support/workspaces";

/**
 * plan-rollout-migration.test.ts -- the plan_rollout migration gives every plan and every revision an empty rollout beside its text.
 *
 * The database is migrated whole, a plan and a revision written, and the
 * rollout's two columns dropped again so they stand as they did before the
 * migration; its statements then run over them. The plan and its revision
 * read through the store with an empty rollout and their text as it stood.
 * The migration adds nothing a database already has, so a preview database
 * that ran it under an earlier name takes it again unchanged. Synthetic
 * accounts and plans throughout.
 */

const MIGRATION = "20261014181044_plan_rollout";

const MIGRATION_STATEMENTS = readFileSync(
  join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql"),
  "utf8",
)
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

/** The database as it stood before the migration: the plan and its revisions with no rollout column. */
const beforeRollout = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`alter table plan drop column rollout`;
  yield* sql`alter table plan_revision drop column rollout`;
});

const runMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of MIGRATION_STATEMENTS) yield* sql.unsafe(statement);
});

/** A plan holding the invitations text and its first revision, as an account wrote them. */
const written = Effect.gen(function* () {
  const db = yield* Database;
  const sql = yield* SqlClient.SqlClient;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const planId = (yield* startPlan(userId, { name: "Teammate invitations" })).id;
  yield* makeDocumentPlan(planId, INVITATIONS_TEXT);
  yield* sql`
    insert into plan_revision (plan_id, seq, actor, document, changes, started_at, at)
    values (${planId}, 1, 'notetaker', ${INVITATIONS_TEXT}, 1, now(), now())
  `;
  return { userId, planId };
});

it.layer(getTestDB())("the plan_rollout migration onto a rollout beside every plan", (it) => {
  it.effect(
    "a plan and its revision stored before the rollout read with an empty one, their text as it stood",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* written;
        yield* beforeRollout;

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
        const { userId, planId } = yield* written;
        yield* cutRollout(planId, INVITATIONS_ROLLOUT);

        yield* runMigration;

        assert.deepEqual(
          Option.getOrThrow(yield* readPlan(userId, planId)).plan.rollout,
          INVITATIONS_ROLLOUT,
        );
      }),
  );
});
