import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { readPlan } from "@sidecar/database/models/plan-store";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { NOTE_KIND, PLAN_FIELD_HEADING, PLAN_HEADING } from "@sidecar/hosted/plan-template";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { openWorkspace } from "./support/workspaces";

/**
 * plan-agent-edits-headings-migration.test.ts -- the migration that names every journaled agent note by its heading.
 *
 * Before notes named headings, a coding agent took its notes under the fixed
 * template's fields, and the plan's journal of agent saves still holds them
 * so. The migration rewrites each such note as the note under its field's
 * heading that the reader takes it for, so the reader of field notes can go.
 * A plan whose journal holds field notes, one already under a heading, and
 * one of every field is written as a raw row on a migrated database, the
 * migration's statements are run over it again, and the plan is read back
 * through the store and as its row. Synthetic accounts and plans throughout.
 */

const MIGRATION_SQL = readFileSync(
  fileURLToPath(
    new URL(
      "../../../packages/database/migrations/20261013054758_plan_agent_edits_headings.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const MIGRATION_STATEMENTS = MIGRATION_SQL.split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

const AGENT_ID = randomUUID();

/** A note an agent took under a heading, as every agent takes one now. */
const HEADING_NOTE = { kind: "add", section: "Rollout", text: "Behind a flag first." };

/** A journal as agents started before heading notes kept it, with one heading note among them. */
const FIELD_EDITS = [
  {
    agentId: AGENT_ID,
    at: 1_000,
    notes: [
      { kind: "add", field: "approach", text: "Email only, because a shared link leaks." },
      {
        kind: "add",
        field: "openQuestions",
        text: "1. Who may withdraw an invite?\nThe sender, or any admin.",
      },
      { kind: "replace", field: "goal", find: "invite", text: "invite by email" },
      { kind: "remove", field: "testing", find: "opens its link" },
      HEADING_NOTE,
    ],
  },
];

/** The same journal as the migration leaves it: every note under a heading, a list's item drawn as its section's bullet. */
const HEADING_NOTES = [
  {
    kind: NOTE_KIND.ADD,
    section: PLAN_HEADING.APPROACH,
    text: "Email only, because a shared link leaks.",
  },
  {
    kind: NOTE_KIND.ADD,
    section: PLAN_HEADING.OPEN_QUESTIONS,
    text: "- Who may withdraw an invite?\n  The sender, or any admin.",
  },
  { kind: NOTE_KIND.REPLACE, find: "invite", text: "invite by email" },
  { kind: NOTE_KIND.REMOVE, find: "opens its link" },
  HEADING_NOTE,
];

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** A plan row, one empty document, written as raw SQL, whatever shape its journal is in. */
const insertPlan = (userId: string, edits: readonly unknown[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const planId = randomUUID();
    const organizationId = yield* openWorkspace(userId);
    yield* sql`
      insert into plan (id, user_id, organization_id, name, document, agent_edits)
      values (${planId}, ${userId}, ${organizationId}, ${"Teammate invitations"}, '',
        ${JSON.stringify(edits)}::jsonb)
    `;
    return planId;
  });

const runMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of MIGRATION_STATEMENTS) yield* sql.unsafe(statement);
});

const journalOf = (userId: string, planId: string) =>
  Effect.map(readPlan(userId, planId), (stored) =>
    Option.getOrThrow(stored).agentEdits.map(({ agentId, at, notes }) => ({ agentId, at, notes })),
  );

/** The journal as the row holds it, so a key the store would drop on reading is still seen. */
const storedJournalOf = (planId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ agent_edits: unknown }>`
      select agent_edits from plan where id = ${planId}
    `;
    return rows[0]?.agent_edits;
  });

it.layer(getTestDB())("the migration naming every journaled agent note by its heading", (it) => {
  it.effect("a plan whose agents saved under fields reads each note under its heading", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const planId = yield* insertPlan(userId, FIELD_EDITS);

      yield* runMigration;

      const expected = [{ agentId: AGENT_ID, at: 1_000, notes: HEADING_NOTES }];
      assert.deepEqual(yield* journalOf(userId, planId), expected);
      assert.deepEqual(yield* storedJournalOf(planId), expected);
    }),
  );

  it.effect("every field's note lands under the heading the default template gives it", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const fields = Object.entries(PLAN_FIELD_HEADING);
      const notes = fields.map(([field]) => ({ kind: "add", field, text: "A point." }));
      const planId = yield* insertPlan(userId, [{ agentId: AGENT_ID, at: 1_000, notes }]);

      yield* runMigration;

      const [edit] = yield* journalOf(userId, planId);
      assert.deepEqual(
        edit?.notes.map((note) => ("section" in note ? note.section : undefined)),
        fields.map(([, heading]) => heading),
      );
    }),
  );

  it.effect("a journal already under headings is left as it stood, however often it runs", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const edits = [{ agentId: AGENT_ID, at: 1_000, notes: HEADING_NOTES }];
      const planId = yield* insertPlan(userId, edits);

      yield* runMigration;
      yield* runMigration;

      assert.deepEqual(yield* storedJournalOf(planId), edits);
    }),
  );
});
