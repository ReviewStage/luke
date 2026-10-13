import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { PLAN_HEADING } from "@sidecar/hosted/plan-template";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { PLAN_SAVE_STATUS, saveDeveloperEdit, saveNotes } from "../server/hosted/plan-notes";
import { listRevisions } from "../server/hosted/plan-revisions";
import { createPlan, readPlan } from "../server/hosted/plan-store";
import { added } from "./support/plan-contents";
import { testSqlClient } from "./support/sql-client";

/**
 * The fixed template's columns, which the migration after this release
 * drops while this release still serves. A deployment migrates within
 * seconds of its push and the release before it serves the migrated
 * database for up to an hour, and Drizzle names every column a module
 * declares in an insert, so this release starts a plan, takes notes, and
 * keeps revisions over a database those columns are already gone from.
 * Synthetic account and plan.
 */

/** The statements the drop takes, run over the test's own database before anything is written. */
const DROPPED = [
  `alter table "plan" drop column "body"`,
  `alter table "plan" drop column "assumptions"`,
  `alter table "plan" drop column "fields"`,
  `alter table "plan" drop column "field_writers"`,
  `alter table "plan_revision" drop column "fields"`,
  `alter table "plan_revision" drop column "assumptions"`,
];

const dropColumns = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of DROPPED) yield* sql.unsafe(statement);
});

it.layer(testSqlClient)(
  "a plan over a database the fixed template's columns are gone from",
  (it) => {
    it.effect("starts, takes notes, takes the developer's edit, and keeps its history", () =>
      Effect.gen(function* () {
        yield* dropColumns;
        const userId = `user-${randomUUID()}`;
        yield* db
          .insert(user)
          .values({ id: userId, name: "Test User", email: `${userId}@luke.test` });

        const started = yield* createPlan(userId, { name: "Teammate invitations" });
        const noted = yield* saveNotes({ userId, planId: started.id }, [
          added(PLAN_HEADING.GOAL, "- Members invite by email."),
        ]);
        const text = Option.getOrThrow(yield* readPlan(userId, started.id)).text;
        const edited = yield* saveDeveloperEdit(
          { userId, planId: started.id },
          { document: { base: text, value: `${text}\nInvites expire.\n` } },
        );
        const { revisions } = yield* listRevisions(userId, started.id);

        assert.equal(noted.status, PLAN_SAVE_STATUS.SAVED);
        assert.equal(edited.status, PLAN_SAVE_STATUS.SAVED);
        assert.ok(text.includes("- Members invite by email."));
        assert.equal(revisions.length, 2);
      }),
    );
  },
);
