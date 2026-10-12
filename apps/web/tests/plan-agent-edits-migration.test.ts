import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { NOTE_KIND, type PlanReadNote } from "@sidecar/hosted/plan-template";
import { PLAN_FIELD } from "@sidecar/hosted/plan-wire";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { readPlan } from "../server/hosted/plan-store";

/**
 * plan-agent-edits-migration.test.ts -- migration 0084 carries a coding agent's journaled notes onto the new template.
 *
 * Migration 0082 carried a plan's fields and writers onto the teammate
 * template but left the journal of its coding agents' saves naming the old
 * fields, so a plan an agent had saved to no longer read. A plan whose
 * journal holds notes under old fields, and an example added to a rule, is
 * written as a raw row on a migrated database, the migration's statements
 * are run over it again, and the plan is read back through the store: every
 * note names the section 0082 carried its field into, an example reads as a
 * point under the hard parts, and a note already in the new shape is left
 * as it stood. Synthetic accounts and plans throughout.
 */

const MIGRATION_SQL = readFileSync(
  fileURLToPath(
    new URL(
      "../../../packages/database/migrations/0084_plan_agent_edits_teammate.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const MIGRATION_STATEMENTS = MIGRATION_SQL.split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

/** A journal as the old template's agents kept it: notes under old fields, and an example added to a rule. */
const OLD_EDITS = [
  {
    agentId: randomUUID(),
    at: 1_000,
    notes: [
      { kind: "add", field: "decisions", text: "Email only, because a shared link leaks." },
      { kind: "replace", field: "contracts", find: "invite(", text: "invite(email" },
      { kind: "remove", field: "verification", find: "opens its link" },
      {
        kind: "addExample",
        rule: 2,
        given: "a withdrawn invite",
        when: "its link is opened",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the old template's example key, and an example is data that is never awaited.
        then: null, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
      },
      { kind: "add", field: "openQuestions", text: "Who may withdraw an invite?" },
    ],
  },
];

/** The same journal as migration 0084 leaves it: every note under the new template's fields. */
const CARRIED_EDITS = [
  {
    agentId: OLD_EDITS[0]?.agentId,
    at: 1_000,
    notes: [
      { kind: "add", field: "approach", text: "Email only, because a shared link leaks." },
      { kind: "replace", field: "interfaces", find: "invite(", text: "invite(email" },
      { kind: "remove", field: "testing", find: "opens its link" },
      {
        kind: "add",
        field: "hardParts",
        text: "Rule 2: Given a withdrawn invite, when its link is opened, then ?",
      },
      { kind: "add", field: "openQuestions", text: "Who may withdraw an invite?" },
    ],
  },
];

/** The carried journal's notes as the store reads them: each still naming its field, as the fixed template's notetaker took it. */
const CARRIED_NOTES: readonly PlanReadNote[] = [
  {
    kind: NOTE_KIND.ADD,
    field: PLAN_FIELD.APPROACH,
    text: "Email only, because a shared link leaks.",
  },
  { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.INTERFACES, find: "invite(", text: "invite(email" },
  { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.TESTING, find: "opens its link" },
  {
    kind: NOTE_KIND.ADD,
    field: PLAN_FIELD.HARD_PARTS,
    text: "Rule 2: Given a withdrawn invite, when its link is opened, then ?",
  },
  { kind: NOTE_KIND.ADD, field: PLAN_FIELD.OPEN_QUESTIONS, text: "Who may withdraw an invite?" },
];

/** A journal as a row may hold it: naming the new fields or the old ones. */
type StoredEdits = typeof CARRIED_EDITS | typeof OLD_EDITS;

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** A plan row, one empty document, written as raw SQL, whatever shape its journal is in. */
const insertPlan = (userId: string, edits: StoredEdits) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const planId = randomUUID();
    yield* sql`
      insert into plan (id, user_id, name, document, agent_edits)
      values (${planId}, ${userId}, ${"Teammate invitations"}, '',
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

it.layer(getTestDB())("migration 0084 onto the teammate template's journal", (it) => {
  it.effect(
    "a plan whose agents saved under the old fields reads, each note in its new section",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const planId = yield* insertPlan(userId, OLD_EDITS);

        yield* runMigration;

        assert.deepEqual(yield* journalOf(userId, planId), [
          { agentId: OLD_EDITS[0]?.agentId, at: 1_000, notes: CARRIED_NOTES },
        ]);
      }),
  );

  it.effect("a journal already in the new template is left as it stood", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const planId = yield* insertPlan(userId, CARRIED_EDITS);

      yield* runMigration;

      assert.deepEqual(yield* journalOf(userId, planId), [
        { agentId: CARRIED_EDITS[0]?.agentId, at: 1_000, notes: CARRIED_NOTES },
      ]);
    }),
  );
});
